import { normalizeWorkspaceId } from '../shared-web/workspace-identity.mjs';

export const ARCHIVE_METADATA_LEDGER_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;

export function importLedgerKey({ machineId, archivedWorkspaceId, snapshotSha256, destinationWorkspaceId }) {
  return JSON.stringify([machineId, archivedWorkspaceId, snapshotSha256, destinationWorkspaceId]);
}

export function validateImportLedger(input = { version: ARCHIVE_METADATA_LEDGER_VERSION, records: [] }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Import ledger must be an object');
  if (input.version !== ARCHIVE_METADATA_LEDGER_VERSION) throw new Error(`Unsupported import ledger version: ${input.version}`);
  if (!Array.isArray(input.records)) throw new Error('Import ledger records must be an array');
  const keys = new Set();
  for (const [index, record] of input.records.entries()) {
    const field = `records[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${field} must be an object`);
    if (typeof record.machineId !== 'string' || !record.machineId.trim()) throw new Error(`${field}.machineId must be a non-empty string`);
    for (const name of ['archivedWorkspaceId', 'destinationWorkspaceId']) normalizeWorkspaceId(record[name], `${field}.${name}`);
    if (!SHA256.test(record.snapshotSha256 || '')) throw new Error(`${field}.snapshotSha256 must be a SHA-256 digest`);
    const key = importLedgerKey(record);
    if (keys.has(key)) throw new Error(`${field} duplicates a successful import tuple`);
    keys.add(key);
  }
  return input;
}

function bindingMap(bindings) {
  const entries = bindings instanceof Map ? [...bindings] : Object.entries(bindings || {});
  if (!(bindings instanceof Map) && (!bindings || typeof bindings !== 'object' || Array.isArray(bindings))) throw new Error('Bindings must be an object or Map');
  return new Map(entries.map(([archivedId, destinationId]) => [
    normalizeWorkspaceId(archivedId, 'archived workspace binding id'),
    normalizeWorkspaceId(destinationId, 'destination workspace binding id'),
  ]));
}

export function routeMetadataSnapshots({ bundle, currentWorkspaces, bindings = {}, ledger = { version: ARCHIVE_METADATA_LEDGER_VERSION, records: [] }, allowRebind = false }) {
  if (!bundle?.machine?.id || !Array.isArray(bundle.workspaces)) throw new Error('A validated metadata bundle is required');
  if (!Array.isArray(currentWorkspaces)) throw new Error('currentWorkspaces must be an array');
  validateImportLedger(ledger);
  const destinations = new Map();
  for (const workspace of currentWorkspaces) {
    const id = normalizeWorkspaceId(workspace?.id);
    if (destinations.has(id)) throw new Error(`Duplicate current workspace id: ${id}`);
    destinations.set(id, { ...workspace, id });
  }
  const overrides = bindingMap(bindings);
  const archivedIds = new Set(bundle.workspaces.map(({ workspaceId }) => workspaceId));
  for (const [archivedId] of overrides) {
    if (!archivedIds.has(archivedId)) throw new Error(`Binding names unknown archived workspace: ${archivedId}`);
  }

  const routes = bundle.workspaces.map((snapshot) => {
    const override = overrides.get(snapshot.workspaceId);
    const destinationId = override || (destinations.has(snapshot.workspaceId) ? snapshot.workspaceId : null);
    if (!destinationId) return { status: 'unbound', snapshot, destination: null, reason: 'no explicit binding or exact workspace id match' };
    const destination = destinations.get(destinationId);
    if (!destination) return { status: 'invalid', snapshot, destination: null, reason: `destination workspace is not configured: ${destinationId}` };
    return { status: 'bound', snapshot, destination, route: override ? 'override' : 'exact' };
  });

  const byDestination = new Map();
  for (const route of routes.filter(({ status }) => status === 'bound')) {
    const list = byDestination.get(route.destination.id) || [];
    list.push(route);
    byDestination.set(route.destination.id, list);
  }
  for (const [destinationId, matches] of byDestination) {
    if (matches.length < 2) continue;
    for (const route of matches) {
      route.status = 'invalid';
      route.reason = `multiple archived workspaces route to destination: ${destinationId}`;
    }
  }

  for (const route of routes.filter(({ status }) => status === 'bound')) {
    const tuple = {
      machineId: bundle.machine.id,
      archivedWorkspaceId: route.snapshot.workspaceId,
      snapshotSha256: route.snapshot.sha256,
      destinationWorkspaceId: route.destination.id,
    };
    const exact = ledger.records.find((record) => importLedgerKey(record) === importLedgerKey(tuple));
    if (exact) {
      route.status = 'already-imported';
      route.ledgerRecord = exact;
      continue;
    }
    const priorDestination = ledger.records.find((record) => record.machineId === tuple.machineId
      && record.archivedWorkspaceId === tuple.archivedWorkspaceId
      && record.destinationWorkspaceId !== tuple.destinationWorkspaceId);
    if (priorDestination && !allowRebind) {
      route.status = 'failed';
      route.reason = `archived workspace was already imported into ${priorDestination.destinationWorkspaceId}; allow rebind explicitly`;
      route.ledgerRecord = priorDestination;
    } else if (priorDestination) {
      route.rebindAcknowledged = true;
      route.ledgerRecord = priorDestination;
    }
  }
  return routes;
}

export function appendSuccessfulImport(ledger, record) {
  validateImportLedger(ledger);
  const next = { ...record };
  validateImportLedger({ version: ARCHIVE_METADATA_LEDGER_VERSION, records: [next] });
  const key = importLedgerKey(next);
  if (ledger.records.some((existing) => importLedgerKey(existing) === key)) return ledger;
  return { ...ledger, records: [...ledger.records, next] };
}
