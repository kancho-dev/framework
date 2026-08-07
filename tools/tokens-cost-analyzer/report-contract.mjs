import { createHash, randomUUID } from 'node:crypto';

export const SCHEMA = 'tokens-cost-analyzer/report';
export const SCHEMA_VERSION = 1;
export const MAX_RECORDS = 1_000_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function buildReportHeader({ generatedAt = new Date().toISOString(), generatorVersion, currency = 'USD', coverage, pricingSources = [], warnings = [], reportId = randomUUID() } = {}) {
  if (!generatorVersion) throw new Error('generatorVersion is required');
  const normalizedCoverage = {
    mode: coverage?.mode || 'full-history',
    limit: coverage?.limit ?? null,
    limitScope: coverage?.limitScope || 'recent sessions/files per source',
    earliestRecordDate: coverage?.earliestRecordDate ?? null,
    latestRecordDate: coverage?.latestRecordDate ?? null,
  };
  return {
    reportId,
    generatedAt,
    generatorVersion,
    currency,
    coverage: normalizedCoverage,
    pricingSources: pricingSources.map(({ role, fingerprint }) => ({ role, fingerprint })),
    warnings: warnings.map(({ source, warning }) => ({ source, warning })),
  };
}

export function validateReport(candidate, { maxSchemaVersion = SCHEMA_VERSION } = {}) {
  const error = reportValidationError(candidate, maxSchemaVersion);
  return error ? { ok: false, error } : { ok: true, value: candidate };
}

export function contentFingerprint(record) {
  const tuple = [
    record?.timestamp ?? null,
    record?.model ?? null,
    record?.provider ?? null,
    record?.variant ?? null,
    tokenValue(record, 'input'),
    tokenValue(record, 'output'),
    tokenValue(record, 'cacheRead'),
    tokenValue(record, 'cacheWrite'),
    numberOrNull(record?.recordedCost),
  ];
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex').slice(0, 16);
}

export function contentKeyFor(record, { duplicateOrdinal = 1, nativeId } = {}) {
  const fromUnitId = unitIdContentKey(record?.unitId);
  if (fromUnitId) return fromUnitId;
  requireIdentityBase(record);
  // An explicit `nativeId` (including null) overrides inference: only the
  // producing adapter knows whether its `messageId` is a durable source id or a
  // positional stand-in such as `claude-entry-7`.
  const native = nativeId === undefined ? nativeDiscriminator(record) : (nativeId ? String(nativeId) : null);
  const discriminator = native || fingerprintDiscriminator(record, duplicateOrdinal);
  return `${record.source}/${record.sessionId}/${discriminator}`;
}

export function unitIdFor(machineId, record, options = {}) {
  assertId(machineId, 'machineId');
  return `${machineId}/${contentKeyFor(record, options)}`;
}

/**
 * Stamp the §3.3 identity fields plus the §3.4 derivation onto locally produced
 * records, in file order so fingerprint ordinals are reproducible across scans.
 */
export function stampRecordIdentity(records, { machineId, generatorVersion, pricingFingerprint, nativeIdOf = nativeDiscriminator }) {
  assertId(machineId, 'machineId');
  if (!generatorVersion) throw new Error('generatorVersion is required');
  const seenFingerprints = new Map();
  for (const record of records) {
    const fingerprint = contentFingerprint(record);
    const nativeId = nativeIdOf(record) ?? null;
    let duplicateOrdinal = 1;
    if (!nativeId) {
      const ordinalKey = `${record.source}/${record.sessionId}/${fingerprint}`;
      duplicateOrdinal = (seenFingerprints.get(ordinalKey) || 0) + 1;
      seenFingerprints.set(ordinalKey, duplicateOrdinal);
    }
    record.contentFingerprint = fingerprint;
    record.identityClass = nativeId ? 'native' : 'fingerprint';
    record.unitId = unitIdFor(machineId, record, { duplicateOrdinal, nativeId });
    record.derivation = { generatorVersion, pricingFingerprint };
  }
  return records;
}

function reportValidationError(candidate, maxSchemaVersion) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return 'report must be an object';
  if (candidate.schema !== SCHEMA) return `schema must be ${SCHEMA}`;
  if (!Number.isInteger(candidate.schemaVersion) || candidate.schemaVersion < 1) return 'schemaVersion must be a positive integer';
  if (candidate.schemaVersion > maxSchemaVersion) return `schemaVersion ${candidate.schemaVersion} is newer than supported version ${maxSchemaVersion}`;
  if (!candidate.report || typeof candidate.report !== 'object') return 'report header is required';
  if (!candidate.origin || typeof candidate.origin !== 'object') return 'origin is required';
  if (!ID_PATTERN.test(candidate.origin.machineId || '')) return 'origin.machineId is invalid';
  if (!Array.isArray(candidate.origin.workspaces) || candidate.origin.workspaces.some((id) => !ID_PATTERN.test(id || ''))) return 'origin.workspaces must contain valid ids';
  if (!Array.isArray(candidate.records)) return 'records must be an array';
  if (candidate.records.length > MAX_RECORDS) return `records exceeds the ${MAX_RECORDS} record limit`;
  for (let index = 0; index < candidate.records.length; index += 1) {
    const recordError = recordValidationError(candidate.records[index]);
    if (recordError) return `records[${index}].${recordError}`;
  }
  if (!candidate.report.reportId || typeof candidate.report.reportId !== 'string') return 'report.reportId is required';
  if (!validDate(candidate.report.generatedAt)) return 'report.generatedAt must be an ISO timestamp';
  if (!candidate.report.generatorVersion || typeof candidate.report.generatorVersion !== 'string') return 'report.generatorVersion is required';
  if (!/^[A-Z]{3}$/.test(candidate.report.currency || '')) return 'report.currency must be a three-letter uppercase code';
  if (!['full-history', 'limited'].includes(candidate.report.coverage?.mode)) return 'report.coverage.mode is invalid';
  return null;
}

function recordValidationError(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return 'record must be an object';
  if (!record.source) return 'source is required';
  if (!record.sessionId) return 'sessionId is required';
  if (!validDate(record.timestamp)) return 'timestamp must be an ISO timestamp';
  if (!record.unitId || typeof record.unitId !== 'string') return 'unitId is required';
  if (!ID_PATTERN.test(record.workspaceId || '')) return 'workspaceId is invalid';
  if (!['native', 'fingerprint'].includes(record.identityClass)) return 'identityClass is invalid';
  if (!/^[a-f0-9]{16}$/.test(record.contentFingerprint || '')) return 'contentFingerprint is invalid';
  if (!record.derivation || typeof record.derivation.generatorVersion !== 'string' || typeof record.derivation.pricingFingerprint !== 'string') return 'derivation is invalid';
  return null;
}

function nativeDiscriminator(record) {
  if (record.source === 'codex') return null;
  return record.messageId ? String(record.messageId) : null;
}

function fingerprintDiscriminator(record, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('duplicateOrdinal must be a positive integer');
  const fingerprint = record.contentFingerprint || contentFingerprint(record);
  return ordinal === 1 ? fingerprint : `${fingerprint}-${ordinal}`;
}

function unitIdContentKey(unitId) {
  if (typeof unitId !== 'string') return null;
  const firstSlash = unitId.indexOf('/');
  return firstSlash > 0 ? unitId.slice(firstSlash + 1) : null;
}

function requireIdentityBase(record) {
  if (!record?.source) throw new Error('record.source is required');
  if (!record?.sessionId) throw new Error('record.sessionId is required');
  if (!record?.timestamp) throw new Error('record.timestamp is required');
}

function tokenValue(record, field) {
  const value = record?.tokens?.[field];
  return numberOrNull(value && typeof value === 'object' ? value.value : value);
}
function numberOrNull(value) { return value != null && Number.isFinite(Number(value)) ? Number(value) : null; }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function assertId(value, field) { if (!ID_PATTERN.test(value || '')) throw new Error(`${field} is invalid`); }
