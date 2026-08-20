import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreCommand } from './restore-command.js';

test('all archived source types are non-resumable', () => {
  for (const source of ['pi', 'opencode', 'codex', 'claude-code']) {
    assert.equal(restoreCommand({ source, machineId: 'old', id: 'id', path: '/archive/session', cwd: '/work' }), '');
  }
});

test('current-machine restore commands remain available', () => {
  assert.match(restoreCommand({ source: 'pi', path: '/live/session' }), /^pi --session/);
  assert.match(restoreCommand({ source: 'codex', id: 'id' }), /^codex resume/);
});
