import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { sha256 } from './archive-metadata-bundle.mjs';
import { applyArchiveMetadata, createArchiveMetadataDryRun, printReport } from './import-archive-metadata.mjs';

const execFileAsync = promisify(execFile);

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

test('real CLI emits complete JSON without exposing internal planned metadata', async () => {
  const state = await fixture();
  const { stdout } = await execFileAsync(process.execPath, [
    new URL('./import-archive-metadata.mjs', import.meta.url).pathname,
    '--bundle', state.bundlePath,
    '--workspaces', state.workspaceConfigPath,
    '--json',
  ]);
  const report = JSON.parse(stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.workspaces[0].status, 'bound');
  assert.equal(report.workspaces[0].plannedMetadata, undefined);
  assert.equal(report.workspaces[0].snapshotSha256.length, 64);
  assert.equal(report.workspaces[0].counts.eligible, 1);
  assert.deepEqual(report.summary, { bound: 1, unbound: 1, invalid: 0, 'already-imported': 0, failed: 0 });
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

test('apply backs up, writes atomically, records ledger, and repeated import is a no-op', async () => {
  const state = await fixture();
  const ledgerPath = join(dirname(state.workspaceConfigPath), 'imports.json');
  const options = {
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    ledgerPath,
    liveSessionExists: async () => false,
    now: () => new Date('2026-08-22T00:30:00.000Z'),
  };
  const applied = await applyArchiveMetadata(options);
  const framework = applied.workspaces[0];
  assert.equal(framework.status, 'imported');
  assert.equal(framework.backupPath !== null, true);
  assert.equal(await readFile(framework.backupPath, 'utf8'), state.destinationBytes);
  const destination = JSON.parse(await readFile(state.destinationPath, 'utf8'));
  assert.deepEqual(Object.values(destination.sessions)[0].tags, ['archived']);
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].postSha256, framework.postSha256);

  const backupsBefore = (await readdir(dirname(state.destinationPath))).filter((name) => name.includes('.backup-'));
  const repeated = await applyArchiveMetadata(options);
  assert.equal(repeated.workspaces[0].status, 'already-imported');
  const backupsAfter = (await readdir(dirname(state.destinationPath))).filter((name) => name.includes('.backup-'));
  assert.deepEqual(backupsAfter, backupsBefore);
  assert.equal(JSON.parse(await readFile(ledgerPath, 'utf8')).records.length, 1);
});

test('cross-destination rebind is blocked unless acknowledged and keeps both ledger records', async () => {
  const state = await fixture();
  const ledgerPath = join(dirname(state.workspaceConfigPath), 'rebind-ledger.json');
  const base = {
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    ledgerPath,
    liveSessionExists: async () => false,
  };
  assert.equal((await applyArchiveMetadata(base)).workspaces[0].status, 'imported');
  const firstLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));

  const config = JSON.parse(await readFile(state.workspaceConfigPath, 'utf8'));
  const newRoot = join(dirname(dirname(state.destinationPath)), 'new-history');
  const newDestination = join(newRoot, 'metadata.json');
  await mkdir(newRoot, { recursive: true });
  await writeFile(newDestination, state.destinationBytes);
  config.workspaces = [{
    id: 'new-history', root: newRoot, sessionMetadataPath: newDestination,
    sessionArchiveBindings: [{ machineId: 'old-linux', pathMap: [{ from: '/old/framework', to: '.' }] }],
  }];
  await writeFile(state.workspaceConfigPath, JSON.stringify(config));
  const rebound = { ...base, bindings: { framework: 'new-history' } };

  const blocked = await applyArchiveMetadata(rebound);
  assert.equal(blocked.workspaces[0].status, 'failed');
  assert.match(blocked.workspaces[0].reason, /allow rebind explicitly/);
  assert.deepEqual(JSON.parse(await readFile(ledgerPath, 'utf8')), firstLedger);
  assert.equal(await readFile(newDestination, 'utf8'), state.destinationBytes);

  const allowed = await applyArchiveMetadata({ ...rebound, allowRebind: true });
  assert.equal(allowed.workspaces[0].status, 'imported');
  const finalLedger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  assert.equal(finalLedger.records.length, 2);
  assert.deepEqual(finalLedger.records[0], firstLedger.records[0]);
  assert.deepEqual(finalLedger.records.map(({ destinationWorkspaceId }) => destinationWorkspaceId), ['framework', 'new-history']);
});

test('apply creates an absent destination without a meaningless backup', async () => {
  const state = await fixture();
  await rm(state.destinationPath);
  const report = await applyArchiveMetadata({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    ledgerPath: join(dirname(state.workspaceConfigPath), 'absent-ledger.json'),
    liveSessionExists: async () => false,
  });
  assert.equal(report.workspaces[0].status, 'imported');
  assert.equal(report.workspaces[0].backupPath, null);
  await access(state.destinationPath);
  assert.equal((await readdir(dirname(state.destinationPath))).some((name) => name.includes('.backup-')), false);
});

test('compare-before-write aborts a stale destination and does not record the ledger', async () => {
  const state = await fixture();
  const ledgerPath = join(dirname(state.workspaceConfigPath), 'stale-ledger.json');
  const report = await applyArchiveMetadata({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    ledgerPath,
    liveSessionExists: async () => false,
    beforeDestinationCommit: async (entry) => writeFile(entry.destinationMetadataPath, '{"version":3,"sessions":{"concurrent":{}}}\n'),
  });
  assert.equal(report.workspaces[0].status, 'failed');
  assert.match(report.workspaces[0].reason, /became stale/);
  await assert.rejects(access(ledgerPath));
  assert.equal(JSON.parse(await readFile(state.destinationPath, 'utf8')).sessions.concurrent !== undefined, true);
});

test('stale destination failure does not block another valid workspace apply', async () => {
  const state = await fixture();
  const bundle = JSON.parse(await readFile(state.bundlePath, 'utf8'));
  const secondSnapshot = join(dirname(dirname(bundle.workspaces[0].snapshotPath)), 'second', 'metadata.json');
  const secondSnapshotPath = join(dirname(state.bundlePath), secondSnapshot);
  await mkdir(dirname(secondSnapshotPath), { recursive: true });
  await writeFile(secondSnapshotPath, state.snapshotBytes);
  bundle.workspaces.push({
    ...bundle.workspaces[0], workspaceId: 'second', workspaceLabel: 'Second', snapshotPath: secondSnapshot,
  });
  await writeFile(state.bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  const config = JSON.parse(await readFile(state.workspaceConfigPath, 'utf8'));
  const secondRoot = join(dirname(dirname(state.destinationPath)), 'second');
  const secondDestination = join(secondRoot, 'metadata.json');
  await mkdir(secondRoot, { recursive: true });
  await writeFile(secondDestination, state.destinationBytes);
  config.workspaces.push({
    id: 'second', root: secondRoot, sessionMetadataPath: secondDestination,
    sessionArchiveBindings: [{ machineId: 'old-linux', pathMap: [{ from: '/old/framework', to: '.' }] }],
  });
  await writeFile(state.workspaceConfigPath, JSON.stringify(config));

  const report = await applyArchiveMetadata({
    bundlePath: state.bundlePath,
    workspaceConfigPath: state.workspaceConfigPath,
    ledgerPath: join(dirname(state.workspaceConfigPath), 'partial-ledger.json'),
    liveSessionExists: async () => false,
    beforeDestinationCommit: async (entry) => {
      if (entry.destinationWorkspaceId === 'framework') await writeFile(entry.destinationMetadataPath, '{"version":3,"sessions":{"concurrent":{}}}\n');
    },
  });
  assert.equal(report.workspaces.find(({ archivedWorkspaceId }) => archivedWorkspaceId === 'framework').status, 'failed');
  assert.equal(report.workspaces.find(({ archivedWorkspaceId }) => archivedWorkspaceId === 'second').status, 'imported');
  assert.equal(JSON.parse(await readFile(join(dirname(state.workspaceConfigPath), 'partial-ledger.json'), 'utf8')).records.length, 1);
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
