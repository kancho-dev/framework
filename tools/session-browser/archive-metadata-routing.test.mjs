import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSuccessfulImport, importLedgerKey, routeMetadataSnapshots, validateImportLedger } from './archive-metadata-routing.mjs';

const digests = { framework: 'a'.repeat(64), retired: 'b'.repeat(64), global: 'c'.repeat(64) };
const bundle = {
  machine: { id: 'old.machine' },
  workspaces: Object.entries(digests).map(([workspaceId, sha256]) => ({ workspaceId, sha256 })),
};
const emptyLedger = () => ({ version: 1, records: [] });

function tuple(archivedWorkspaceId, destinationWorkspaceId, snapshotSha256 = digests[archivedWorkspaceId]) {
  return { machineId: bundle.machine.id, archivedWorkspaceId, snapshotSha256, destinationWorkspaceId, importedAt: '2026-08-21T12:00:00.000Z' };
}

test('routes by explicit override, then exact stable id, otherwise leaves snapshot unbound', () => {
  const routes = routeMetadataSnapshots({
    bundle,
    currentWorkspaces: [{ id: 'framework' }, { id: 'client-history' }, { id: 'global' }],
    bindings: { retired: 'client-history' },
  });
  assert.deepEqual(routes.map(({ status, destination, route }) => [status, destination?.id || null, route || null]), [
    ['bound', 'framework', 'exact'],
    ['bound', 'client-history', 'override'],
    ['bound', 'global', 'exact'],
  ]);

  const unbound = routeMetadataSnapshots({ bundle, currentWorkspaces: [{ id: 'framework' }, { id: 'global' }] });
  assert.equal(unbound.find(({ snapshot }) => snapshot.workspaceId === 'retired').status, 'unbound');
});

test('normalizes destination and binding ids before collision and ledger use', () => {
  const routes = routeMetadataSnapshots({
    bundle,
    currentWorkspaces: [{ id: ' framework ' }],
    bindings: new Map([['retired', ' framework ']]),
  });
  assert.deepEqual(routes.slice(0, 2).map(({ status }) => status), ['invalid', 'invalid']);
  assert.equal(routes[0].destination.id, 'framework');
});

test('an unbound snapshot becomes routable after history-only workspace registration', () => {
  const before = routeMetadataSnapshots({ bundle, currentWorkspaces: [{ id: 'framework' }] });
  assert.equal(before.find(({ snapshot }) => snapshot.workspaceId === 'retired').status, 'unbound');
  const after = routeMetadataSnapshots({ bundle, currentWorkspaces: [{ id: 'framework' }, { id: 'history' }], bindings: { retired: 'history' } });
  assert.equal(after.find(({ snapshot }) => snapshot.workspaceId === 'retired').destination.id, 'history');
});

test('rejects unknown destinations and disables every side of a many-to-one route', () => {
  const unknown = routeMetadataSnapshots({ bundle, currentWorkspaces: [{ id: 'framework' }], bindings: { retired: 'missing' } });
  assert.equal(unknown.find(({ snapshot }) => snapshot.workspaceId === 'retired').status, 'invalid');

  const collision = routeMetadataSnapshots({
    bundle,
    currentWorkspaces: [{ id: 'combined' }],
    bindings: { framework: 'combined', retired: 'combined' },
  });
  assert.deepEqual(collision.slice(0, 2).map(({ status }) => status), ['invalid', 'invalid']);
  assert.match(collision[0].reason, /multiple archived workspaces/);
});

test('ledger tuple makes exact reimport a no-op', () => {
  const record = tuple('framework', 'framework');
  const ledger = appendSuccessfulImport(emptyLedger(), record);
  assert.equal(ledger.records.length, 1);
  assert.equal(appendSuccessfulImport(ledger, { ...record }), ledger);
  assert.equal(importLedgerKey(record), JSON.stringify(['old.machine', 'framework', digests.framework, 'framework']));

  const routes = routeMetadataSnapshots({ bundle, currentWorkspaces: [{ id: 'framework' }], ledger });
  assert.equal(routes[0].status, 'already-imported');
  assert.deepEqual(routes[0].ledgerRecord, record);
});

test('changed snapshot is new, while cross-destination import requires allowRebind', () => {
  const ledger = { version: 1, records: [tuple('retired', 'old-history')] };
  const blocked = routeMetadataSnapshots({
    bundle,
    currentWorkspaces: [{ id: 'new-history' }],
    bindings: { retired: 'new-history' },
    ledger,
  }).find(({ snapshot }) => snapshot.workspaceId === 'retired');
  assert.equal(blocked.status, 'failed');
  assert.match(blocked.reason, /allow rebind explicitly/);

  const allowed = routeMetadataSnapshots({
    bundle,
    currentWorkspaces: [{ id: 'new-history' }],
    bindings: { retired: 'new-history' },
    ledger,
    allowRebind: true,
  }).find(({ snapshot }) => snapshot.workspaceId === 'retired');
  assert.equal(allowed.status, 'bound');
  assert.equal(allowed.rebindAcknowledged, true);

  const changed = { ...bundle, workspaces: bundle.workspaces.map((entry) => entry.workspaceId === 'retired' ? { ...entry, sha256: 'f'.repeat(64) } : entry) };
  const sameDestination = routeMetadataSnapshots({ bundle: changed, currentWorkspaces: [{ id: 'old-history' }], bindings: { retired: 'old-history' }, ledger });
  assert.equal(sameDestination.find(({ snapshot }) => snapshot.workspaceId === 'retired').status, 'bound');
});

test('validates ledger records and duplicate successful tuples', () => {
  const record = tuple('framework', 'framework');
  assert.throws(() => validateImportLedger({ version: 1, records: [record, { ...record }] }), /duplicates/);
  assert.throws(() => validateImportLedger({ version: 2, records: [] }), /Unsupported/);
  assert.throws(() => appendSuccessfulImport(emptyLedger(), { ...record, snapshotSha256: 'bad' }), /SHA-256/);
});
