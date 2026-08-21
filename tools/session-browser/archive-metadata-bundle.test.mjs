import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EMPTY_METADATA_SNAPSHOT,
  planMetadataBundleExport,
  sha256,
  sha256File,
  validateBundleManifest,
} from './archive-metadata-bundle.mjs';

const manifestDigest = sha256('archive manifest');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metadata-bundle-'));
  const paths = Object.fromEntries(['framework', 'morph', 'global', 'retired'].map((id) => [id, join(root, `${id}.json`)]));
  await Promise.all(Object.entries(paths).map(([id, path]) => writeFile(path, `${JSON.stringify({ version: 3, sessions: { [id]: { bookmarked: true } } })}\n`)));
  return { root, paths };
}

function input(root, paths) {
  return {
    machine: { id: 'old-linux', label: 'Old Linux' },
    archiveManifest: { path: '../../archive-manifest.json', sha256: manifestDigest },
    exportedAt: '2026-08-21T12:00:00.000Z',
    workspaces: [
      { id: 'framework', name: 'Framework', root: join(root, 'framework'), sessionMetadataPath: paths.framework },
      { id: 'morph', name: 'Morph', root: join(root, 'morph'), sessionMetadataPath: paths.morph },
      { id: 'global', name: 'Global', root, sessionMetadataPath: paths.global },
      { id: 'retired-client', name: 'Retired client', root: join(root, 'retired'), sessionMetadataPath: paths.retired },
      { id: 'history-only', name: 'History only', root: join(root, 'history') },
    ],
  };
}

test('plans distinct immutable snapshots for every configured workspace', async () => {
  const { root, paths } = await fixture();
  const result = await planMetadataBundleExport(input(root, paths));

  assert.deepEqual(result.bundle.workspaces.map(({ workspaceId }) => workspaceId), [
    'framework', 'morph', 'global', 'retired-client', 'history-only',
  ]);
  assert.equal(result.snapshots.size, 5);
  for (const entry of result.bundle.workspaces.slice(0, 4)) {
    const original = await readFile(paths[entry.workspaceId === 'retired-client' ? 'retired' : entry.workspaceId]);
    assert.deepEqual(result.snapshots.get(entry.snapshotPath), original);
    assert.equal(entry.sha256, sha256(original));
    assert.equal(entry.bytes, original.byteLength);
    assert.equal(entry.absentSource, undefined);
  }
  const absent = result.bundle.workspaces.at(-1);
  assert.equal(absent.sourceMetadataPath, null);
  assert.equal(absent.absentSource, true);
  assert.equal(result.snapshots.get(absent.snapshotPath).toString(), EMPTY_METADATA_SNAPSHOT);
  assert.deepEqual(result.diagnostics, [{ workspaceId: 'history-only', reason: 'absentSource' }]);
});

test('configured missing source is absent and no process default is consulted', async () => {
  const { root, paths } = await fixture();
  const decoy = join(root, '.tools-config', 'session-browser', 'metadata.json');
  const request = input(root, paths);
  request.workspaces = [{ id: 'missing', root, sessionMetadataPath: join(root, 'missing.json') }];
  process.env.SESSION_BROWSER_METADATA = decoy;
  try {
    const result = await planMetadataBundleExport(request);
    assert.equal(result.bundle.workspaces[0].absentSource, true);
    assert.equal(result.snapshots.values().next().value.toString(), EMPTY_METADATA_SNAPSHOT);
  } finally {
    delete process.env.SESSION_BROWSER_METADATA;
  }
});

test('malformed configured metadata fails planning before archive publication', async () => {
  const { root, paths } = await fixture();
  await writeFile(paths.framework, '{broken');
  await assert.rejects(planMetadataBundleExport(input(root, paths)), /Cannot export metadata for workspace framework/);
});

test('validates top-level contract while isolating invalid workspace entries', async () => {
  const { root, paths } = await fixture();
  const { bundle } = await planMetadataBundleExport(input(root, paths));
  bundle.futureField = { tolerated: true };
  bundle.workspaces[0].futureField = true;
  bundle.workspaces[1] = { ...bundle.workspaces[1], snapshotPath: '../escape.json' };

  const result = validateBundleManifest(bundle);
  assert.equal(result.manifest.futureField.tolerated, true);
  assert.deepEqual(result.manifest.workspaces.map(({ workspaceId }) => workspaceId), ['framework', 'global', 'retired-client', 'history-only']);
  assert.equal(result.invalidWorkspaces.length, 1);
  assert.match(result.invalidWorkspaces[0].reason, /beneath the bundle directory/);
  assert.throws(() => validateBundleManifest({ ...bundle, version: 2 }), /Unsupported metadata bundle version/);
});

test('rejects duplicate workspace identities without disabling the first entry', async () => {
  const { root, paths } = await fixture();
  const { bundle } = await planMetadataBundleExport(input(root, paths));
  bundle.workspaces.push({ ...bundle.workspaces[0] });
  const result = validateBundleManifest(bundle);
  assert.equal(result.manifest.workspaces.filter(({ workspaceId }) => workspaceId === 'framework').length, 1);
  assert.match(result.invalidWorkspaces.at(-1).reason, /duplicate workspaceId/);
});

test('SHA-256 helpers hash bytes without text normalization', async () => {
  const { root } = await fixture();
  const path = join(root, 'bytes.bin');
  const bytes = Buffer.from([0, 10, 13, 255]);
  await writeFile(path, bytes);
  assert.equal(await sha256File(path), sha256(bytes));
  assert.equal(sha256(bytes).length, 64);
});
