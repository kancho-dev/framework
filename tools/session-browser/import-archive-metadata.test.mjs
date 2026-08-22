import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from './archive-metadata-bundle.mjs';
import { createArchiveMetadataDryRun, printReport } from './import-archive-metadata.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'metadata-dry-run-'));
  const bundleDir = join(root, 'archive', 'old-linux', 'metadata');
  const snapshotDir = join(bundleDir, 'workspaces', 'framework');
  const piRoot = join(root, 'archive', 'old-linux', 'pi', 'sessions');
  const destinationRoot = join(root, 'current', 'framework');
  await Promise.all([snapshotDir, piRoot, destinationRoot].map((path) => mkdir(path, { recursive: true })));
  const archivedSession = join(piRoot, 'one.jsonl');
  await writeFile(archivedSession, `${JSON.stringify({ type: 'session', id: 'one', cwd: '/old/framework/project' })}\n`);
  const snapshotPath = join(snapshotDir, 'metadata.json');
  const snapshotBytes = `${JSON.stringify({ version: 2, sessions: { 'pi:/old/pi-store/one.jsonl': { labels: ['archived'], bookmarked: true } } }, null, 2)}\n`;
  await writeFile(snapshotPath, snapshotBytes);
  const destinationPath = join(destinationRoot, 'metadata.json');
  const destinationBytes = `${JSON.stringify({ version: 3, sessions: {} }, null, 2)}\n`;
  await writeFile(destinationPath, destinationBytes);
  const manifestPath = join(root, 'archive-manifest.json');
  const manifest = {
    version: 1,
    machines: [{
      id: 'old-linux',
      immutable: true,
      roots: { pi: archivedSession.endsWith('one.jsonl') ? join('archive', 'old-linux', 'pi', 'sessions') : '' },
      originalRoots: { pi: '/old/pi-store' },
    }],
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestBytes);
  const bundlePath = join(bundleDir, 'bundle.json');
  const bundle = {
    version: 1,
    machine: { id: 'old-linux', label: 'Old Linux' },
    exportedAt: '2026-08-21T12:00:00.000Z',
    archiveManifest: { path: '../../../archive-manifest.json', sha256: sha256(manifestBytes) },
    workspaces: [
      {
        workspaceId: 'framework', workspaceLabel: 'Framework', oldRoot: '/old/framework',
        sourceMetadataPath: '/old/framework/metadata.json', snapshotPath: 'workspaces/framework/metadata.json',
        sha256: sha256(snapshotBytes), bytes: Buffer.byteLength(snapshotBytes), exportedAt: '2026-08-21T12:00:00.000Z',
      },
      {
        workspaceId: 'retired', workspaceLabel: 'Retired', oldRoot: '/old/retired', sourceMetadataPath: null,
        snapshotPath: 'workspaces/retired/metadata.json', sha256: sha256('{"version":3,"sessions":{}}\n'),
        bytes: Buffer.byteLength('{"version":3,"sessions":{}}\n'), exportedAt: '2026-08-21T12:00:00.000Z', absentSource: true,
      },
    ],
  };
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  const workspaceConfigPath = join(root, 'tool-orchestrator', 'workspaces.json');
  await mkdir(join(root, 'tool-orchestrator'));
  await writeFile(workspaceConfigPath, JSON.stringify({
    sessionArchiveManifestPath: '../archive-manifest.json',
    workspaces: [{
      id: 'framework', root: destinationRoot, sessionMetadataPath: destinationPath,
      sessionArchiveBindings: [{ machineId: 'old-linux', pathMap: [{ from: '/old/framework', to: '.' }] }],
    }],
  }));
  return { bundlePath, workspaceConfigPath, manifestPath, snapshotPath, snapshotBytes, destinationPath, destinationBytes };
}

test('dry run verifies, canonicalizes, and merges without writing snapshot, destination, or ledger', async () => {
  const state = await fixture();
  const report = await createArchiveMetadataDryRun({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    liveSessionExists: async () => false,
  });
  const framework = report.workspaces.find(({ archivedWorkspaceId }) => archivedWorkspaceId === 'framework');
  const retired = report.workspaces.find(({ archivedWorkspaceId }) => archivedWorkspaceId === 'retired');

  assert.equal(framework.status, 'bound');
  assert.equal(framework.canonicalized, true);
  assert.equal(framework.counts.eligible, 1);
  assert.equal(framework.counts.resultingSessions, 1);
  assert.equal(retired.status, 'unbound');
  assert.deepEqual(report.summary, { bound: 1, unbound: 1, invalid: 0, 'already-imported': 0, failed: 0 });
  assert.equal(report.ok, true);
  assert.equal(await readFile(state.snapshotPath, 'utf8'), state.snapshotBytes);
  assert.equal(await readFile(state.destinationPath, 'utf8'), state.destinationBytes);
});

test('snapshot failure is isolated and exposed in the machine-readable summary', async () => {
  const state = await fixture();
  const bundle = JSON.parse(await readFile(state.bundlePath, 'utf8'));
  bundle.workspaces[0].sha256 = 'f'.repeat(64);
  await writeFile(state.bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

  const report = await createArchiveMetadataDryRun({ bundlePath: state.bundlePath, workspaceConfigPath: state.workspaceConfigPath, liveSessionExists: async () => false });
  assert.equal(report.workspaces[0].status, 'failed');
  assert.match(report.workspaces[0].reason, /checksum mismatch/);
  assert.equal(report.workspaces[1].status, 'unbound');
  assert.equal(report.summary.failed, 1);
  assert.equal(report.ok, false);
});

test('ledger exact tuple classifies already-imported without reading destination', async () => {
  const state = await fixture();
  const bundle = JSON.parse(await readFile(state.bundlePath, 'utf8'));
  const ledgerPath = join(dirname(state.workspaceConfigPath), 'ledger.json');
  await writeFile(ledgerPath, JSON.stringify({ version: 1, records: [{
    machineId: 'old-linux', archivedWorkspaceId: 'framework', snapshotSha256: bundle.workspaces[0].sha256,
    destinationWorkspaceId: 'framework', importedAt: '2026-08-21T12:30:00.000Z',
  }] }));
  const report = await createArchiveMetadataDryRun({ bundlePath: state.bundlePath, workspaceConfigPath: state.workspaceConfigPath, ledgerPath, liveSessionExists: async () => false });
  assert.equal(report.workspaces[0].status, 'already-imported');
  assert.equal(report.summary['already-imported'], 1);
});

test('shared-manifest checksum drift is provenance-only and visible in human output', async () => {
  const state = await fixture();
  const manifest = JSON.parse(await readFile(state.manifestPath, 'utf8'));
  manifest.machines[0].label = 'Changed after export';
  await writeFile(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const report = await createArchiveMetadataDryRun({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    liveSessionExists: async () => false,
  });
  assert.equal(report.archiveManifest.provenanceChanged, true);
  assert.equal(report.workspaces[0].status, 'bound');
  assert.equal(report.ok, true);

  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try { printReport(report); } finally { console.log = originalLog; }
  assert.equal(lines.some((line) => line.includes('provenance changed: yes')), true);
  assert.equal(lines.some((line) => line.includes('canonicalized archived metadata: yes')), true);
});

test('snapshot traversal is rejected without preventing other classifications', async () => {
  const state = await fixture();
  const bundle = JSON.parse(await readFile(state.bundlePath, 'utf8'));
  bundle.workspaces[0].snapshotPath = '../../../../escape.json';
  await writeFile(state.bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  const report = await createArchiveMetadataDryRun({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    liveSessionExists: async () => false,
  });
  assert.equal(report.workspaces[0].status, 'invalid');
  assert.match(report.workspaces[0].reason, /beneath the bundle directory/);
  assert.equal(report.workspaces[1].status, 'unbound');
  assert.equal(report.ok, false);
});

test('bundle machine not bound to destination fails only that workspace', async () => {
  const state = await fixture();
  const config = JSON.parse(await readFile(state.workspaceConfigPath, 'utf8'));
  config.workspaces[0].sessionArchiveBindings = [];
  await writeFile(state.workspaceConfigPath, JSON.stringify(config));
  const report = await createArchiveMetadataDryRun({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    liveSessionExists: async () => false,
  });
  assert.equal(report.workspaces[0].status, 'failed');
  assert.match(report.workspaces[0].reason, /not bound/);
  assert.equal(report.workspaces[1].status, 'unbound');
});

test('still-live source key remains unmatched and is never merged', async () => {
  const state = await fixture();
  const report = await createArchiveMetadataDryRun({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    liveSessionExists: async () => true,
  });
  const framework = report.workspaces[0];
  assert.equal(framework.status, 'bound');
  assert.equal(framework.counts.eligible, 0);
  assert.equal(framework.counts.unmatched, 1);
  assert.match(framework.unmatched[0].reason, /still resolves in the current live store/);
  assert.equal(framework.counts.resultingSessions, 0);
});
