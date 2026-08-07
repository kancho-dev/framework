import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributePiWorkspace, attributeWorkspace, encodePiWorkspace, parseSelfConfig } from './workspace-scope.mjs';

test('defaults preserve one catch-all scan rooted at the current workspace', () => {
  const scopes = parseSelfConfig(null, { workspaceRoot: '/home/dev/project', host: 'Dev Machine' });
  assert.deepEqual(scopes, { machineId: 'dev-machine', root: '/home/dev/project', catchAllId: 'project', workspaces: [] });
  assert.equal(attributeWorkspace('/home/dev/project/src', scopes), 'project');
  assert.equal(attributeWorkspace('/home/dev/other', scopes), null);
});

test('most-specific workspace wins while unmatched records stay in catch-all', () => {
  const scopes = parseSelfConfig({
    machineId: 'workstation', root: '/home/dev', catchAllId: 'home',
    workspaces: [
      { id: 'work', root: '/home/dev/work' },
      { id: 'client', root: '/home/dev/work/client' },
    ],
  }, { workspaceRoot: '/ignored' });
  assert.equal(attributeWorkspace('/home/dev/work/client/repo', scopes), 'client');
  assert.equal(attributeWorkspace('/home/dev/work/other', scopes), 'work');
  assert.equal(attributeWorkspace('/home/dev/notes', scopes), 'home');
  assert.equal(attributeWorkspace('/home/developer', scopes), null);
});

test('Pi attribution compares encoded roots without decoding ambiguous hyphens', () => {
  const scopes = parseSelfConfig({
    machineId: 'workstation', root: '/home/dev', catchAllId: 'home',
    workspaces: [{ id: 'client', root: '/home/dev/work/client-x' }],
  }, { workspaceRoot: '/ignored' });
  assert.equal(attributePiWorkspace(encodePiWorkspace('/home/dev/work/client-x/repo'), scopes), 'client');
  // The encoding makes this sibling indistinguishable from client/x-old.
  assert.equal(attributePiWorkspace(encodePiWorkspace('/home/dev/work/client-x-old/repo'), scopes), 'client');
  assert.equal(attributeWorkspace('/home/dev/work/client-x-old/repo', scopes), 'home');
  assert.equal(attributePiWorkspace(encodePiWorkspace('/home/dev/other'), scopes), 'home');
  assert.equal(attributePiWorkspace(encodePiWorkspace('/home/other'), scopes), null);
});

test('workspace configuration rejects ambiguous ids and roots outside the scan', () => {
  assert.throws(() => parseSelfConfig({ machineId: 'machine', root: '/home/dev', catchAllId: 'same', workspaces: [{ id: 'same', root: '/home/dev/work' }] }, { workspaceRoot: '/ignored' }), /unique/);
  assert.throws(() => parseSelfConfig({ machineId: 'machine', root: '/home/dev', catchAllId: 'home', workspaces: [{ id: 'other', root: '/tmp/other' }] }, { workspaceRoot: '/ignored' }), /within self.root/);
});
