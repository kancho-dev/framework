import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportHeader, contentFingerprint, contentKeyFor, MAX_RECORDS, SCHEMA, SCHEMA_VERSION, unitIdFor, validateReport } from './report-contract.mjs';

const record = {
  source: 'pi', sessionId: 'session-1', messageId: 'message-1', timestamp: '2026-01-02T03:04:05.000Z',
  provider: 'anthropic', model: 'claude', variant: null,
  tokens: { input: { value: 10 }, output: { value: 2 }, cacheRead: { value: 3 }, cacheWrite: { value: null } }, recordedCost: 0.01,
};

test('report header contains the portable contract fields without local paths', () => {
  const header = buildReportHeader({ generatorVersion: '0.6.0', generatedAt: '2026-01-02T03:04:05.000Z', reportId: 'report-1', pricingSources: [{ role: 'local-override', fingerprint: 'sha256:abc', path: '/private' }] });
  assert.equal(header.reportId, 'report-1');
  assert.equal(header.coverage.mode, 'full-history');
  assert.deepEqual(header.pricingSources, [{ role: 'local-override', fingerprint: 'sha256:abc' }]);
  assert.equal(JSON.stringify(header).includes('/private'), false);
});

test('native and fingerprint identities are deterministic and machine scoped', () => {
  assert.equal(contentKeyFor(record), 'pi/session-1/message-1');
  assert.equal(unitIdFor('workstation', record), 'workstation/pi/session-1/message-1');

  const codex = { ...record, source: 'codex', messageId: 'token-count-9' };
  const fingerprint = contentFingerprint(codex);
  assert.equal(contentKeyFor(codex), `codex/session-1/${fingerprint}`);
  assert.equal(contentKeyFor(codex, { duplicateOrdinal: 2 }), `codex/session-1/${fingerprint}-2`);
  assert.equal(contentFingerprint({ ...codex }), fingerprint);
});

test('content key can be recovered from an imported unit id', () => {
  assert.equal(contentKeyFor({ unitId: 'laptop/opencode/session/message' }), 'opencode/session/message');
});

test('report validation accepts v1, ignores additions, and rejects newer schemas', () => {
  const candidate = {
    schema: SCHEMA, schemaVersion: SCHEMA_VERSION,
    report: { ...buildReportHeader({ generatorVersion: '0.6.0' }), extra: true },
    origin: { machineId: 'workstation', workspaces: ['home', 'framework'] }, records: [], extra: true,
  };
  assert.equal(validateReport(candidate).ok, true);
  assert.match(validateReport({ ...candidate, schemaVersion: 99 }).error, /newer than supported/);
  assert.match(validateReport({ ...candidate, records: {} }).error, /records must be an array/);
  assert.match(validateReport({ ...candidate, records: [{ source: 'pi' }] }).error, /sessionId is required/);
});

test('report validation rejects reports over the record-count cap', () => {
  const candidate = {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    report: buildReportHeader({ generatorVersion: '0.6.0' }),
    origin: { machineId: 'workstation', workspaces: ['home'] },
    records: Array(MAX_RECORDS + 1),
  };
  assert.equal(validateReport(candidate).error, `records exceeds the ${MAX_RECORDS} record limit`);
});
