import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA, SCHEMA_VERSION } from './report-contract.mjs';
import { CACHE_DIRNAME, loadExternalSources } from './sources.mjs';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const HOUR = 3_600_000;
const sshSource = { id: 'laptop', type: 'ssh', host: 'laptop.local', remotePath: '~/.tools-config/tokens-cost-analyzer/report.v1.json' };

function record(overrides = {}) {
  return {
    source: 'claude-code',
    sessionId: 'session-a',
    timestamp: '2026-08-06T09:00:00.000Z',
    unitId: 'laptop/claude-code/session-a/uuid-1',
    workspaceId: 'framework',
    identityClass: 'native',
    contentFingerprint: 'a1b2c3d4e5f60718',
    derivation: { generatorVersion: '0.6.0', pricingFingerprint: 'sha256:abc' },
    totalTokens: 100,
    ...overrides,
  };
}

function report({ machineId = 'laptop', generatedAt = '2026-08-06T11:00:00.000Z', records = [record()], ...rest } = {}) {
  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    report: {
      reportId: `report-${machineId}`,
      generatedAt,
      generatorVersion: '0.6.0',
      currency: 'USD',
      coverage: { mode: 'full-history', limit: null, limitScope: 'recent sessions/files per source', earliestRecordDate: null, latestRecordDate: null },
      pricingSources: [],
      warnings: [],
    },
    origin: { machineId, workspaces: ['framework'] },
    records,
    ...rest,
  };
}

async function outDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-sources-load-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const fetchReturning = (result, calls = []) => async (source, options) => {
  calls.push({ source, options });
  return typeof result === 'function' ? result(source, options) : result;
};
const serving = (payload) => fetchReturning({ ok: true, text: JSON.stringify(payload) });
const failing = (state, detail = 'nope') => fetchReturning({ ok: false, state, detail });

async function load(dir, sources, { fetch, now = NOW, ...config } = {}) {
  return loadExternalSources({ outputDir: dir, now, fetch, config: { sources, staleReportAfterHours: 24, staleFetchAfterHours: 24, ...config } });
}

test('no configured sources yields no records and no states', async (t) => {
  const dir = await outDir(t);
  assert.deepEqual(await loadExternalSources({ outputDir: dir, config: { configured: false } }), { loads: [], records: [], sourceStates: [] });
});

test('a fresh source contributes records stamped with its machine id', async (t) => {
  const dir = await outDir(t);
  const { records, sourceStates } = await load(dir, [sshSource], { fetch: serving(report()) });

  assert.equal(records.length, 1);
  assert.equal(records[0].sourceKey, 'laptop');
  assert.equal(records[0].unitId, 'laptop/claude-code/session-a/uuid-1');
  assert.equal(sourceStates.length, 1);
  assert.equal(sourceStates[0].state, 'ok');
  assert.equal(sourceStates[0].included, true);
  assert.equal(sourceStates[0].records, 1);
  assert.equal(sourceStates[0].currency, 'USD');
  assert.equal(sourceStates[0].coverageMode, 'full-history');
  assert.equal(sourceStates[0].reportAgeHours, 1);
  assert.equal(sourceStates[0].fetchAgeHours, 0);
  assert.equal(sourceStates[0].fromCache, false);
});

test('a disabled source is listed but never fetched', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  const { records, sourceStates } = await load(dir, [{ ...sshSource, enabled: false }], { fetch: fetchReturning({ ok: true, text: '{}' }, calls) });

  assert.deepEqual(records, []);
  assert.equal(calls.length, 0);
  assert.equal(sourceStates[0].state, 'disabled');
  assert.equal(sourceStates[0].included, false);
});

test('a source rejected by config validation never reaches the fetcher', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  const hostile = { ...sshSource, id: 'evil', host: 'laptop.local; rm -rf ~' };
  const { sourceStates } = await load(dir, [hostile], { fetch: fetchReturning({ ok: true, text: '{}' }, calls) });

  assert.equal(calls.length, 0, 'validation happens before any fetch');
  assert.equal(sourceStates[0].id, 'evil');
  assert.equal(sourceStates[0].state, 'invalid');
  assert.match(sourceStates[0].detail, /host is invalid/);
});

test('an entry without a usable id is still reported positionally', async (t) => {
  const dir = await outDir(t);
  const { sourceStates } = await load(dir, [{ type: 'ssh' }], { fetch: failing('unreachable') });
  assert.equal(sourceStates[0].id, 'sources[0]');
  assert.equal(sourceStates[0].state, 'invalid');
});

test('malformed and future-schema reports are typed distinctly and excluded', async (t) => {
  const dir = await outDir(t);
  const cases = [
    { fetch: fetchReturning({ ok: true, text: '{"partial"' }), state: 'invalid', detail: /not valid JSON/ },
    { fetch: serving({ ...report(), origin: { machineId: 'BAD ID', workspaces: [] } }), state: 'invalid', detail: /origin\.machineId/ },
    { fetch: serving({ ...report(), schemaVersion: 99 }), state: 'incompatible', detail: /schemaVersion 99/ },
  ];

  for (const { fetch, state, detail } of cases) {
    const result = await load(dir, [sshSource], { fetch });
    assert.deepEqual(result.records, [], state);
    assert.equal(result.sourceStates[0].state, state);
    assert.match(result.sourceStates[0].detail, detail);
    assert.equal(result.sourceStates[0].included, false);
  }
});

test('a report older than the threshold is stale but still counted', async (t) => {
  const dir = await outDir(t);
  const stale = report({ generatedAt: new Date(NOW - 50 * HOUR).toISOString() });
  const { records, sourceStates } = await load(dir, [sshSource], { fetch: serving(stale) });

  assert.equal(records.length, 1, 'stale history is complete data, not degraded data');
  assert.equal(sourceStates[0].state, 'stale-report');
  assert.equal(sourceStates[0].included, true);
  assert.equal(sourceStates[0].staleReport, true);
  assert.equal(sourceStates[0].staleFetch, false, 'a stale report on a fresh fetch means nothing new happened there');
});

test('includeWhenStale false excludes a stale report from the records', async (t) => {
  const dir = await outDir(t);
  const stale = report({ generatedAt: new Date(NOW - 50 * HOUR).toISOString() });
  const { records, sourceStates } = await load(dir, [{ ...sshSource, includeWhenStale: false }], { fetch: serving(stale) });

  assert.deepEqual(records, []);
  assert.equal(sourceStates[0].state, 'stale-report');
  assert.equal(sourceStates[0].included, false);
});

test('a successful fetch writes the last-known-good cache', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });

  const cached = JSON.parse(await readFile(join(dir, CACHE_DIRNAME, 'laptop.json'), 'utf8'));
  assert.equal(cached.lastSuccessAt, new Date(NOW).toISOString());
  assert.equal(cached.report.origin.machineId, 'laptop');
});

test('an unreachable source with a warm cache keeps its records and totals', async (t) => {
  const dir = await outDir(t);
  const warm = await load(dir, [sshSource], { fetch: serving(report()) });

  const later = NOW + 5 * HOUR;
  const cold = await load(dir, [sshSource], { fetch: failing('unreachable', 'ssh could not connect to the host'), now: later });

  assert.deepEqual(cold.records, warm.records, 'totals do not oscillate as a machine sleeps');
  assert.equal(cold.sourceStates[0].state, 'unreachable', 'the state still names the underlying failure');
  assert.equal(cold.sourceStates[0].included, true);
  assert.equal(cold.sourceStates[0].fromCache, true);
  assert.equal(cold.sourceStates[0].fetchAgeHours, 5, 'fetch age is surfaced separately from report age');
});

test('a stale report reached only from a stale cache reports both ages as stale', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report({ generatedAt: new Date(NOW - 2 * HOUR).toISOString() })) });

  const { sourceStates } = await load(dir, [sshSource], { fetch: failing('unreachable'), now: NOW + 40 * HOUR });
  assert.equal(sourceStates[0].staleReport, true);
  assert.equal(sourceStates[0].staleFetch, true, 'we could not check, which is distinct from nothing new happening');
  assert.equal(sourceStates[0].included, true);
});

test('an unreachable source with no cache is skipped rather than failing the load', async (t) => {
  const dir = await outDir(t);
  const { records, sourceStates } = await load(dir, [sshSource], { fetch: failing('unreachable') });

  assert.deepEqual(records, []);
  assert.equal(sourceStates[0].state, 'unreachable');
  assert.equal(sourceStates[0].included, false);
  assert.equal(sourceStates[0].records, 0);
});

test('a corrupt cache file is ignored rather than crashing the load', async (t) => {
  const dir = await outDir(t);
  await mkdir(join(dir, CACHE_DIRNAME), { recursive: true });
  await writeFile(join(dir, CACHE_DIRNAME, 'laptop.json'), '{ not json');

  const { records, sourceStates } = await load(dir, [sshSource], { fetch: failing('unreachable') });
  assert.deepEqual(records, []);
  assert.equal(sourceStates[0].state, 'unreachable');
});

test('a source now serving broken data is excluded rather than replaced by its cache', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });

  const { records, sourceStates } = await load(dir, [sshSource], { fetch: fetchReturning({ ok: true, text: '{"partial"' }) });
  assert.deepEqual(records, [], 'a validation failure is not masked by history');
  assert.equal(sourceStates[0].state, 'invalid');
});

test('sources load concurrently and independently of each other', async (t) => {
  const dir = await outDir(t);
  const slow = async (source) => {
    await new Promise((done) => setTimeout(done, 60));
    if (source.id === 'broken') return { ok: false, state: 'unreachable', detail: 'nope' };
    return { ok: true, text: JSON.stringify(report({ machineId: source.id, records: [record({ unitId: `${source.id}/claude-code/session-a/uuid-1` })] })) };
  };
  const sources = [
    { ...sshSource, id: 'alpha' },
    { ...sshSource, id: 'broken' },
    { ...sshSource, id: 'beta' },
  ];

  const started = Date.now();
  const { records, sourceStates } = await load(dir, sources, { fetch: slow });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 150, `expected concurrent loads, took ${elapsed}ms`);
  assert.deepEqual(records.map((r) => r.sourceKey), ['alpha', 'beta']);
  assert.deepEqual(sourceStates.map((s) => s.state), ['ok', 'unreachable', 'ok']);
});

test('the configured size cap reaches the fetcher', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  await load(dir, [sshSource], { fetch: fetchReturning({ ok: false, state: 'unreachable', detail: 'x' }, calls), maxReportBytes: 4096 });
  assert.equal(calls[0].options.maxBytes, 4096);
});

test('an uncachable output directory still yields this refresh its records', async (t) => {
  const dir = await outDir(t);
  const outcome = await loadExternalSources({
    outputDir: join(dir, 'does', 'not', 'exist'),
    now: NOW,
    fetch: serving(report()),
    config: { sources: [sshSource] },
  });
  assert.equal(outcome.records.length, 1, 'a cache-write failure costs the next refresh its fallback, not this one its records');
});

test('loading never throws, whatever the fetcher does', async (t) => {
  const dir = await outDir(t);
  const misbehaving = {
    rejecting: () => Promise.reject(new Error('boom')),
    'returning garbage': async () => undefined,
    'throwing synchronously': () => { throw new Error('boom'); },
  };

  for (const [name, broken] of Object.entries(misbehaving)) {
    // The broken source sits between two healthy ones: an unexpected throw must
    // cost that source alone, never the whole load.
    const fetch = async (source, options) => (source.id === 'broken' ? broken(source, options) : serving(report({ machineId: source.id }))(source, options));
    const sources = [{ ...sshSource, id: 'alpha' }, { ...sshSource, id: 'broken' }, { ...sshSource, id: 'beta' }];

    const { records, sourceStates } = await load(dir, sources, { fetch });
    assert.deepEqual(sourceStates.map((s) => s.state), ['ok', 'unreadable', 'ok'], name);
    assert.deepEqual(records.map((r) => r.sourceKey), ['alpha', 'beta'], `${name}: every other source keeps its records`);
    assert.equal(sourceStates[1].included, false, name);
    assert.equal(typeof sourceStates[1].detail, 'string', name);
  }
});

test('an unexpected error detail is bounded to one line and 220 characters', async (t) => {
  const dir = await outDir(t);
  const sprawling = new Error(`${'x'.repeat(400)}\nsecond line`);
  const { sourceStates } = await load(dir, [sshSource], { fetch: () => Promise.reject(sprawling) });

  assert.equal(sourceStates[0].state, 'unreadable');
  assert.ok(sourceStates[0].detail.length <= 220, `detail was ${sourceStates[0].detail.length} chars`);
  assert.doesNotMatch(sourceStates[0].detail, /\n/);
  assert.doesNotMatch(sourceStates[0].detail, /second line/);
});
