import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLiveSessionLookup, createOwnershipAwareResolver } from './archive-session-ownership.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'archive-ownership-'));
  const piRoot = join(root, 'pi');
  const codexRoot = join(root, 'codex');
  const claudeRoot = join(root, 'claude');
  await Promise.all([piRoot, codexRoot, claudeRoot].map((path) => mkdir(path, { recursive: true })));
  const piFile = join(piRoot, 'one.jsonl');
  await writeFile(piFile, `${JSON.stringify({ type: 'session', id: 'pi-one', cwd: '/old/framework/project' })}\n`);
  await writeFile(join(codexRoot, 'codex-one.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id: 'codex-one', cwd: '/old/framework/codex' } })}\n`);
  await writeFile(join(claudeRoot, 'claude-one.jsonl'), `${JSON.stringify({ sessionId: 'claude-one', cwd: '/old/framework/claude' })}\n`);
  const machine = {
    id: 'old-linux',
    roots: { pi: piRoot, codex: codexRoot, 'claude-code': claudeRoot, opencode: join(root, 'opencode.db') },
    originalRoots: { pi: '/old/pi-store' },
    pathMap: [{ from: '/old/framework', to: '/new/framework' }],
  };
  return { root, piFile, machine };
}

function resolver(machine, options = {}) {
  return createOwnershipAwareResolver({
    machine,
    archivedWorkspace: { oldRoot: '/old/framework' },
    destinationWorkspace: { root: '/new/framework' },
    ...options,
  });
}

test('extracts cwd and verifies ownership for Pi, Codex, Claude Code, and OpenCode', async () => {
  const { machine, piFile } = await fixture();
  const resolveKey = resolver(machine, {
    openCodeLookup: async (_database, id) => id === 'open-one' ? [{ id, cwd: '/old/framework/open' }] : [],
  });
  const results = await Promise.all([
    resolveKey('pi:/old/pi-store/one.jsonl'),
    resolveKey('codex:codex-one'),
    resolveKey('claude-code:claude-one'),
    resolveKey('opencode:open-one'),
  ]);
  assert.deepEqual(results.map(({ cwd }) => cwd), [
    '/old/framework/project', '/old/framework/codex', '/old/framework/claude', '/old/framework/open',
  ]);
  assert.equal(results[0].targetKey, `pi@old-linux:${piFile}`);
  assert.equal(results[1].targetKey, 'codex@old-linux:codex-one');
  assert.deepEqual(results.map(({ translatedCwd }) => translatedCwd), [
    '/new/framework/project', '/new/framework/codex', '/new/framework/claude', '/new/framework/open',
  ]);
});

test('Codex fallback identity extracts the rollout UUID used by the server', async () => {
  const { machine } = await fixture();
  const id = '12345678-1234-1234-1234-123456789abc';
  const file = join(machine.roots.codex, `rollout-2026-08-01T10-00-00-${id}.jsonl`);
  await writeFile(file, [
    JSON.stringify({ type: 'session_meta', payload: {} }),
    JSON.stringify({ type: 'turn_context', payload: { cwd: '/old/framework/codex-fallback' } }),
    '',
  ].join('\n'));

  const result = await resolver(machine)(`codex:${id}`);
  assert.equal(result.targetKey, `codex@old-linux:${id}`);
  assert.equal(result.cwd, '/old/framework/codex-fallback');
});

test('Claude Code sidechain identity uses recorded parent id and directory fallback', async () => {
  const { machine } = await fixture();
  const recorded = join(machine.roots['claude-code'], 'path-parent', 'subagents');
  const fallback = join(machine.roots['claude-code'], 'fallback-parent', 'subagents');
  await Promise.all([recorded, fallback].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(recorded, 'agent-abc.jsonl'), `${JSON.stringify({ sessionId: 'recorded-parent', cwd: '/old/framework/claude-recorded' })}\n`);
  await writeFile(join(fallback, 'agent-xyz.jsonl'), `${JSON.stringify({ cwd: '/old/framework/claude-fallback' })}\n`);

  const resolveKey = resolver(machine);
  assert.equal((await resolveKey('claude-code:recorded-parent/agent-abc')).targetKey, 'claude-code@old-linux:recorded-parent/agent-abc');
  assert.equal((await resolveKey('claude-code:fallback-parent/agent-xyz')).targetKey, 'claude-code@old-linux:fallback-parent/agent-xyz');
});

test('already-namespaced eligible keys are verified and retain their key', async () => {
  const { machine, piFile } = await fixture();
  const result = await resolver(machine)(`pi@old-linux:${piFile}`);
  assert.equal(result.targetKey, `pi@old-linux:${piFile}`);
});

test('rejects missing, live, foreign-machine, and ambiguous sessions with named reasons', async () => {
  const { machine, root } = await fixture();
  const duplicateDir = join(root, 'codex-duplicate');
  await mkdir(duplicateDir);
  await writeFile(join(duplicateDir, 'codex-one.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id: 'codex-one', cwd: '/old/framework/other' } })}\n`);
  machine.roots.codex = root;
  const resolveKey = resolver(machine, { liveSessionExists: async (source, id) => source === 'opencode' && id === 'live' });

  assert.match((await resolveKey('codex:missing')).reason, /not found/);
  assert.match((await resolveKey('opencode:live')).reason, /still resolves/);
  assert.match((await resolveKey('codex@another:codex-one')).reason, /another machine/);
  assert.match((await resolveKey('codex:codex-one')).reason, /ambiguous/);
});

test('snapshot ownership and destination containment are both required despite Global overlap', async () => {
  const { machine } = await fixture();
  const globalVisible = resolver(machine, {
    openCodeLookup: async () => [{ id: 'global-session', cwd: '/old/another-workspace' }],
  });
  assert.match((await globalVisible('opencode:global-session')).reason, /outside snapshot workspace ownership/);

  const wrongDestination = createOwnershipAwareResolver({
    machine,
    archivedWorkspace: { oldRoot: '/old' },
    destinationWorkspace: { root: '/new/client' },
    openCodeLookup: async () => [{ id: 'framework', cwd: '/old/framework/project' }],
  });
  assert.match((await wrongDestination('opencode:framework')).reason, /outside destination workspace/);
});

test('Pi realpath containment rejects an escaping symlink while normal keys resolve', async () => {
  const { root, machine, piFile } = await fixture();
  const outside = join(root, 'outside.jsonl');
  await writeFile(outside, `${JSON.stringify({ type: 'session', id: 'outside', cwd: '/old/framework/outside' })}\n`);
  await symlink(outside, join(machine.roots.pi, 'escape.jsonl'));
  const resolveKey = resolver(machine);

  assert.match((await resolveKey('pi:/old/pi-store/escape.jsonl')).reason, /not found/);
  assert.equal((await resolveKey('pi:/old/pi-store/one.jsonl')).targetKey, `pi@old-linux:${piFile}`);
});

test('indexes file stores once per resolver run and caches OpenCode ids', async () => {
  const { machine } = await fixture();
  await writeFile(join(machine.roots.codex, 'codex-two.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id: 'codex-two', cwd: '/old/framework/two' } })}\n`);
  let reads = 0;
  let openCodeReads = 0;
  const readSessionFile = async (...args) => { reads += 1; return readFile(...args); };
  const resolveKey = resolver(machine, {
    readSessionFile,
    openCodeLookup: async (_database, id) => { openCodeReads += 1; return [{ id, cwd: '/old/framework/open' }]; },
  });
  await resolveKey('codex:codex-one');
  await resolveKey('codex:codex-two');
  await resolveKey('opencode:open-one');
  await resolveKey('opencode:open-one');
  assert.equal(reads, 2);
  assert.equal(openCodeReads, 1);
});

test('live lookup indexes each file root once per run', async () => {
  const { machine } = await fixture();
  await writeFile(join(machine.roots.codex, 'codex-two.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { id: 'codex-two', cwd: '/live/two' } })}\n`);
  let reads = 0;
  const lookup = createLiveSessionLookup({
    roots: { codex: machine.roots.codex },
    readSessionFile: async (...args) => { reads += 1; return readFile(...args); },
  });
  assert.equal(await lookup('codex', 'codex-one'), true);
  assert.equal(await lookup('codex', 'codex-two'), true);
  assert.equal(reads, 2);
});

test('requires an explicit path mapping before producing a destination key', async () => {
  const { machine } = await fixture();
  machine.pathMap = [];
  assert.match((await resolver(machine)('codex:codex-one')).reason, /no destination mapping/);
});
