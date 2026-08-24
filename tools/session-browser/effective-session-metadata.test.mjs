import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { sha256 } from './archive-metadata-bundle.mjs';
import { createEffectiveMetadataStore, loadArchiveMetadataIndex } from './effective-session-metadata.mjs';

async function fixture({ corrupt = false, malformed = false, workspaceId = 'framework', bundleMachineId = 'old', duplicateWorkspace = false, escapingSnapshot = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'effective-metadata-'));
  const archiveRoot = join(root, 'archive', 'pi');
  const bundleRoot = join(root, 'archive', 'metadata');
  const sessionFile = join(archiveRoot, 'session.jsonl');
  await mkdir(join(bundleRoot, 'workspaces'), { recursive: true });
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify({ type: 'session', id: 's1', cwd: '/old/framework' })}\n`);
  const key = `pi@old:${sessionFile}`;
  const snapshot = Buffer.from(JSON.stringify({ version: 2, sessions: { [key]: { bookmarked: true, labels: ['legacy'], savedTopics: { archived: { title: 'Archived topic' } } } } }));
  const snapshotPath = join(bundleRoot, 'workspaces', 'metadata.json');
  if (escapingSnapshot) {
    const outside = join(root, 'outside.json');
    await writeFile(outside, snapshot);
    await symlink(outside, snapshotPath);
  } else {
    await writeFile(snapshotPath, corrupt ? Buffer.from('{}') : malformed ? Buffer.from('{') : snapshot);
  }
  const workspaceEntry = { workspaceId, workspaceLabel: 'Framework', oldRoot: '/old/framework', sourceMetadataPath: '/old/metadata.json', snapshotPath: 'workspaces/metadata.json', sha256: sha256(malformed ? Buffer.from('{') : snapshot), bytes: malformed ? 1 : snapshot.byteLength, exportedAt: '2026-01-01T00:00:00.000Z' };
  const bundle = {
    version: 1,
    machine: { id: bundleMachineId, label: 'Old' },
    exportedAt: '2026-01-01T00:00:00.000Z',
    archiveManifest: { path: '../../archive-manifest.json', sha256: 'a'.repeat(64) },
    workspaces: duplicateWorkspace ? [workspaceEntry, { ...workspaceEntry, snapshotPath: 'workspaces/duplicate.json' }] : [workspaceEntry],
  };
  const bundlePath = join(bundleRoot, 'bundle.json');
  await writeFile(bundlePath, JSON.stringify(bundle));
  return {
    workspace: { id: 'framework', root: join(root, 'current') },
    machines: { old: { id: 'old', roots: { pi: archiveRoot }, originalRoots: {}, pathMap: [{ from: '/old/framework', to: join(root, 'current') }] } },
    bindings: [{ machineId: 'old', metadataBundlePath: bundlePath }],
    bundle, bundlePath, snapshotPath, sessionFile,
  };
}

test('reads, verifies, canonicalizes, and indexes an owned snapshot', async () => {
  const value = await fixture();
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics));
  assert.equal(result.entries.size, 1);
  const entry = [...result.entries.values()][0];
  assert.deepEqual(entry.tags, ['legacy']);
  assert.equal(entry.bookmarked, true);
  assert.deepEqual(entry.provenance, { source: 'archive', machineId: 'old', workspaceId: 'framework' });
});

test('checksum failure is diagnostic and fails soft', async () => {
  const value = await fixture({ corrupt: true });
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.entries.size, 0);
  assert.equal(result.diagnostics[0].code, 'snapshot-checksum-mismatch');
});

test('requires exact workspace identity unless explicitly rebound', async () => {
  const value = await fixture({ workspaceId: 'retired' });
  let result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.diagnostics[0].code, 'missing-workspace-snapshot');
  result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: [{ ...value.bindings[0], archivedWorkspaceId: 'retired' }] });
  assert.equal(result.entries.size, 1, JSON.stringify(result.diagnostics));
});

test('duplicate selected workspace claims are ambiguous and expose no default', async () => {
  const value = await fixture({ duplicateWorkspace: true });
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.entries.size, 0);
  assert.equal(result.diagnostics[0].code, 'ambiguous-archive-metadata');
});

test('machine mismatch fails soft with a focused diagnostic', async () => {
  const value = await fixture({ bundleMachineId: 'other' });
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.entries.size, 0);
  assert.equal(result.diagnostics[0].code, 'machine-mismatch');
});

test('snapshot symlinks cannot escape bundle containment', async () => {
  const value = await fixture({ escapingSnapshot: true });
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.entries.size, 0);
  assert.equal(result.diagnostics[0].code, 'invalid-bundle');
});

test('malformed snapshot JSON fails soft after byte verification', async () => {
  const value = await fixture({ malformed: true });
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.entries.size, 0);
  assert.equal(result.diagnostics[0].code, 'invalid-snapshot');
});

test('missing Pi original root is actionable and repeated ownership failures are bounded', async () => {
  const value = await fixture();
  const sessions = { 'pi:/old/live/session.jsonl': { bookmarked: true } };
  for (let index = 0; index < 8; index += 1) sessions[`codex@old:missing-${index}`] = { bookmarked: true };
  const bytes = Buffer.from(JSON.stringify({ version: 3, sessions }));
  await writeFile(value.snapshotPath, bytes);
  value.bundle.workspaces[0].sha256 = sha256(bytes);
  value.bundle.workspaces[0].bytes = bytes.length;
  await writeFile(value.bundlePath, JSON.stringify(value.bundle));
  const result = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  assert.equal(result.diagnostics.filter(({ code }) => code === 'missing-original-root').length, 1);
  assert.equal(result.diagnostics.filter(({ code }) => code === 'ownership-rejected').length, 5);
  assert.equal(result.diagnostics.filter(({ code }) => code === 'ownership-rejected-summary').length, 1);
});

test('live entries override whole archive entries and reset restores defaults', async () => {
  const value = await fixture();
  const archived = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  const key = [...archived.entries.keys()][0];
  let live = { version: 3, sessions: { [key]: { bookmarked: false, tags: [], savedTopics: {} } } };
  const store = createEffectiveMetadataStore({
    workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings, metadataPath: 'memory',
    readLive: async () => ({ metadata: structuredClone(live), error: null }),
    writeLive: async (metadata) => { live = structuredClone(metadata); },
  });
  let result = await store.readForSessions([key]);
  assert.equal(result.entries.get(key).provenance.source, 'live');
  assert.deepEqual(result.entries.get(key).tags, []);
  assert.equal(result.entries.get(key).canReset, true);
  await store.reset(key);
  result = await store.readForSessions([key]);
  assert.equal(result.entries.get(key).provenance.source, 'archive');
  assert.deepEqual(result.entries.get(key).tags, ['legacy']);
});

for (const { name, patch, assertPreserved } of [
  { name: 'bookmark', patch: { bookmarked: false }, assertPreserved: (entry) => { assert.deepEqual(entry.tags, ['legacy']); assert.equal(entry.savedTopicCount, 1); } },
  { name: 'tags', patch: { tags: ['edited'] }, assertPreserved: (entry) => { assert.equal(entry.bookmarked, true); assert.equal(entry.savedTopicCount, 1); } },
  { name: 'saved topics', patch: { savedTopics: { edited: { title: 'Edited' } } }, assertPreserved: (entry) => { assert.equal(entry.bookmarked, true); assert.deepEqual(entry.tags, ['legacy']); } },
]) test(`${name}-first mutation preserves every untouched archived field`, async () => {
  const value = await fixture();
  const archived = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  const key = [...archived.entries.keys()][0];
  let live = { version: 3, sessions: {} };
  const store = createEffectiveMetadataStore({
    workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings, metadataPath: `memory-${name}`,
    readLive: async () => ({ metadata: structuredClone(live), error: null }),
    writeLive: async (metadata) => { live = structuredClone(metadata); },
  });
  const entry = await store.mutate(key, patch);
  assertPreserved(entry);
  assert.equal(entry.provenance.source, 'live');
  assert.equal(Object.hasOwn(live.sessions, key), true);
});

test('first mutation materializes the complete archive entry and retains an empty override', async () => {
  const value = await fixture();
  const archived = await loadArchiveMetadataIndex({ workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings });
  const key = [...archived.entries.keys()][0];
  let live = { version: 3, sessions: {} };
  const store = createEffectiveMetadataStore({
    workspace: value.workspace, machines: value.machines, sessionArchiveBindings: value.bindings, metadataPath: 'memory-2',
    readLive: async () => ({ metadata: structuredClone(live), error: null }),
    writeLive: async (metadata) => { live = structuredClone(metadata); },
  });
  let entry = await store.mutate(key, { savedTopics: { topic: { title: 'Saved' } } });
  assert.equal(entry.bookmarked, true);
  assert.deepEqual(entry.tags, ['legacy']);
  assert.equal(entry.savedTopicCount, 1);
  entry = await store.mutate(key, { bookmarked: false, tags: [], savedTopics: {} });
  assert.equal(Object.hasOwn(live.sessions, key), true);
  assert.equal(entry.canReset, true);
});
