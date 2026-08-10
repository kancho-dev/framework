import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA, SCHEMA_VERSION } from './report-contract.mjs';
import { CACHE_DIRNAME, loadExternalSources } from './sources.mjs';
import { mergeReports } from './merge.mjs';
import { sourceTone } from './public/provenance.js';
import { fetchSource } from './source-fetch.mjs';

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
// The transport failures allowed to leave a warm cache standing.
const CACHEABLE = new Set(['unreachable', 'unauthorized', 'missing', 'unreadable']);
const failing = (state, detail = 'nope') => fetchReturning({ ok: false, state, detail });

async function load(dir, sources, { fetch, now = NOW, force = false, ...config } = {}) {
  return loadExternalSources({ outputDir: dir, now, force, fetch, config: { sources, staleReportAfterHours: 24, staleFetchAfterHours: 24, ...config } });
}

// Revalidation is detached by design, so its effect is observed rather than
// awaited. Both helpers fail loudly instead of letting a race pass silently.
async function until(condition, what, limit = 400) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

async function settledLoad(dir, sources, options, ready) {
  let result;
  await until(async () => { result = await load(dir, sources, options); return ready(result); }, 'the detached refresh to land');
  return result;
}

test('no configured sources yields no records and no states', async (t) => {
  const dir = await outDir(t);
  assert.deepEqual(await loadExternalSources({ outputDir: dir, config: { configured: false } }), { loads: [], records: [], sourceStates: [] });
});

test('external loads are age-guarded, single-flight, failure-aware, and forceable per source', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  let release;
  const fetch = fetchReturning(async () => {
    await new Promise((resolveFetch) => { release = resolveFetch; });
    return { ok: true, text: JSON.stringify(report()) };
  }, calls);

  const first = load(dir, [sshSource], { fetch });
  const concurrent = load(dir, [sshSource], { fetch });
  while (!release) await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(calls.length, 1, 'concurrent loads share one source fetch');
  release();
  await Promise.all([first, concurrent]);

  await load(dir, [sshSource], { fetch, now: NOW + 8 * 60_000 });
  assert.equal(calls.length, 1, 'a recent attempt is reused');

  // The forced path bypasses the guard and reaches the network, but is no
  // longer awaited. The never-resolving fetch is the assertion: before this step
  // the load below could not have returned at all.
  const forcedCalls = [];
  const forcedNever = fetchReturning(() => new Promise(() => {}), forcedCalls);
  const forced = await Promise.race([
    load(dir, [sshSource], { fetch: forcedNever, now: NOW + 8 * 60_000, force: true }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the forced load awaited the external fetch')), 10_000)),
  ]);
  assert.equal(forcedCalls.length, 1, 'forced refresh bypasses the age guard');
  assert.equal(forced.records.length, 1, 'and returns last-known-good instead of awaiting the fetch');
  assert.equal(forced.sourceStates[0].state, 'ok');

  // Repeated clicks while one forced fetch is in flight coalesce onto it.
  await Promise.race([
    load(dir, [sshSource], { fetch: forcedNever, now: NOW + 9 * 60_000, force: true }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('a repeated forced refresh awaited the in-flight fetch')), 10_000)),
  ]);
  assert.equal(forcedCalls.length, 1, 'per-source single-flight holds across repeated forced refreshes');
});

test('a source in flight carries an additive flag that changes neither its state nor its tone', async (t) => {
  // Two identical timelines, differing only in whether a fetch is in flight at
  // the moment the state is derived — so any difference between them is the
  // flag's doing and nothing else.
  const quiet = await outDir(t);
  const dir = await outDir(t);
  for (const target of [quiet, dir]) await load(target, [sshSource], { fetch: serving(report()) });

  // The cadence window is held open so the quiet timeline starts no fetch of its
  // own at the same instant; nothing about the window reaches the source state.
  const settled = (await load(quiet, [sshSource], { fetch: failing('unreachable', 'must not run'), now: NOW + HOUR, refreshAfterMinutes: 24 * 60 })).sourceStates[0];
  assert.equal(settled.refreshing, false, 'a source that is not being fetched never carries the flag');

  const inFlight = (await Promise.race([
    load(dir, [sshSource], { fetch: fetchReturning(() => new Promise(() => {})), now: NOW + HOUR, force: true }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the load awaited the external fetch')), 10_000)),
  ])).sourceStates[0];
  assert.equal(inFlight.refreshing, true, 'the flag is projected from the real flight, not a timer');

  // The guarantee: in-flight is orthogonal. Everything the status card reads —
  // above all the state word and the tone — is byte-identical either way.
  assert.deepEqual({ ...inFlight, refreshing: false }, settled, 'in-flight changes nothing but its own flag');
  assert.equal(sourceTone(inFlight), sourceTone(settled));
  assert.equal(inFlight.state, 'ok');
});

test('the in-flight flag clears once the fetch lands, and an archived source never carries it', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  await load(dir, [sshSource], { fetch: serving(report()) });

  const started = await load(dir, [sshSource], { fetch: fetchReturning({ ok: true, text: JSON.stringify(report()) }, calls), now: NOW + HOUR, force: true });
  assert.equal(started.sourceStates[0].refreshing, true);
  assert.equal(started.sourceStates[0].fetchAgeHours, 1, 'and still reports the age of the success it is serving');

  // Waited on the refresh actually landing — observed on disk rather than by
  // re-loading, since a poll made of loads would start flights of its own and
  // could only ever prove the flag against a state the poll itself disturbed.
  const cacheFile = join(dir, CACHE_DIRNAME, 'laptop.json');
  await until(async () => JSON.parse(await readFile(cacheFile, 'utf8')).lastSuccessAt === new Date(NOW + HOUR).toISOString(), 'the detached refresh to land');

  const after = await load(dir, [sshSource], { fetch: failing('unreachable', 'must not run'), now: NOW + HOUR + 60_000 });
  assert.equal(calls.length, 1);
  assert.equal(after.sourceStates[0].fetchAgeHours, 1 / 60, 'the landed refresh is what is being served');
  assert.equal(after.sourceStates[0].refreshing, false, 'the flag follows the flight and does not linger');

  // An archived source takes no flight at all, so it can never render as
  // refreshing beside a live source that is.
  const archiveDir = join(dir, 'archive');
  await mkdir(archiveDir, { recursive: true });
  await writeFile(join(archiveDir, 'old-laptop.json'), JSON.stringify(report({ machineId: 'old-laptop' })));
  // The archived source reads its own file through the real fetcher: it shares
  // the injected executor, and stalling it would stall a read that is local.
  const liveStalls = async (source, options) => (source.type === 'archived' ? fetchSource(source, options) : new Promise(() => {}));
  const mixed = await Promise.race([
    load(dir, [sshSource, { id: 'old-laptop', type: 'archived' }], { fetch: liveStalls, now: NOW + 2 * HOUR, force: true }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the load awaited the external fetch')), 10_000)),
  ]);

  assert.equal(mixed.sourceStates[0].refreshing, true, 'the live source is being fetched');
  assert.equal(mixed.sourceStates[1].state, 'archived');
  assert.equal(mixed.sourceStates[1].refreshing, false, 'an archived source is never in flight');
});

test('a failed attempt is reused without advancing the last genuine success', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });
  const calls = [];
  const failedAt = NOW + 10 * 60_000;
  const failed = await load(dir, [sshSource], { fetch: fetchReturning({ ok: false, state: 'unreachable', detail: 'asleep' }, calls), now: failedAt });
  const reused = await load(dir, [sshSource], { fetch: fetchReturning({ ok: false, state: 'unreachable', detail: 'must not run' }, calls), now: failedAt + 8 * 60_000 });

  assert.equal(calls.length, 1);
  assert.equal(reused.sourceStates[0].lastSuccessAt, failed.sourceStates[0].lastSuccessAt);
  assert.equal(reused.sourceStates[0].fetchAgeHours, 18 / 60, 'cache serving recomputes age from the genuine success');
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
    // A forced refresh is detached, so each typed exclusion is observed
    // once it lands rather than in the response that started it.
    await load(dir, [sshSource], { fetch, force: true });
    const result = await settledLoad(dir, [sshSource], { fetch: failing('unreachable', 'must not run') }, (r) => r.sourceStates[0].state === state);
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
  const calls = [];
  const unreachable = fetchReturning({ ok: false, state: 'unreachable', detail: 'ssh could not connect to the host' }, calls);

  // The revalidation is detached, so this response is the last known good one
  // and does not wait to discover the machine is asleep.
  const during = await load(dir, [sshSource], { fetch: unreachable, now: later });
  assert.deepEqual(during.records, warm.records, 'totals do not oscillate as a machine sleeps');
  await until(() => calls.length === 1, 'the detached refresh runs');

  const cold = await settledLoad(dir, [sshSource], { fetch: unreachable, now: later }, (result) => result.sourceStates[0].fromCache);
  assert.deepEqual(cold.records, warm.records, 'history survives the failed attempt');
  assert.equal(cold.sourceStates[0].state, 'unreachable', 'the state still names the underlying failure');
  assert.equal(cold.sourceStates[0].included, true);
  assert.equal(cold.sourceStates[0].fromCache, true);
  assert.equal(cold.sourceStates[0].fetchAgeHours, 5, 'fetch age is surfaced separately from report age');
  assert.equal(calls.length, 1, 'a failed attempt is not retried inside the retry window');
});

test('a slow source never delays the response once there is anything to serve', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });

  let stuck = false;
  const neverResolves = async () => { stuck = true; await new Promise(() => {}); };
  const started = Date.now();
  const { records, sourceStates } = await Promise.race([
    load(dir, [sshSource], { fetch: neverResolves, now: NOW + HOUR }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the load awaited the external fetch')), 10_000)),
  ]);
  const elapsed = Date.now() - started;

  assert.equal(records.length, 1, 'the cached records are served whole');
  assert.equal(sourceStates[0].state, 'ok');
  assert.ok(elapsed < 500, `expected an immediate response, took ${elapsed}ms`);
  await until(() => stuck, 'the refresh really was started, just not awaited');
});

test('a detached refresh that rejects after the response cannot take the process down', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });

  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  let threw = false;
  const explodes = async () => { threw = true; throw new Error('detached boom'); };
  const { records } = await load(dir, [sshSource], { fetch: explodes, now: NOW + HOUR });
  assert.equal(records.length, 1);
  await until(() => threw, 'the detached refresh ran');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(rejections, [], 'an unhandled rejection after the response would terminate the process');
  const next = await load(dir, [sshSource], { fetch: serving(report()), now: NOW + HOUR });
  assert.equal(next.records.length, 1, 'the source is still served afterwards');
});

test('serving from the snapshot never advances the genuine last success', async (t) => {
  const dir = await outDir(t);
  const first = await load(dir, [sshSource], { fetch: serving(report()) });
  assert.equal(first.sourceStates[0].fetchAgeHours, 0);

  const calls = [];
  const later = await load(dir, [sshSource], { fetch: fetchReturning({ ok: true, text: JSON.stringify(report()) }, calls), now: NOW + 3 * HOUR });
  assert.equal(later.sourceStates[0].lastSuccessAt, first.sourceStates[0].lastSuccessAt, 'a served snapshot is not a new success');
  assert.equal(later.sourceStates[0].fetchAgeHours, 3, 'the fetch age keeps growing until a fetch genuinely lands');
  await until(() => calls.length === 1, 'a revalidation was started because the snapshot aged past the window');
});

test('cadence is configurable and is never rendered as freshness', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });

  const calls = [];
  const fetch = fetchReturning({ ok: true, text: JSON.stringify(report()) }, calls);
  const patient = { fetch, now: NOW + 3 * HOUR, refreshAfterMinutes: 24 * 60 };
  const held = await load(dir, [sshSource], patient);
  assert.equal(calls.length, 0, 'a longer cadence means fewer attempts');

  const eager = await load(dir, [sshSource], { fetch, now: NOW + 3 * HOUR, refreshAfterMinutes: 1 });
  await until(() => calls.length === 1, 'a shorter cadence attempts sooner');

  // Same instant, opposite cadence, identical user-facing truth.
  assert.equal(held.sourceStates[0].fetchAgeHours, eager.sourceStates[0].fetchAgeHours);
  assert.equal(held.sourceStates[0].staleFetch, eager.sourceStates[0].staleFetch);
  assert.equal(held.sourceStates[0].reportAgeHours, eager.sourceStates[0].reportAgeHours);
});

test('a failed attempt follows retryAfterMinutes rather than the success cadence', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report()) });
  const calls = [];
  const unreachable = fetchReturning({ ok: false, state: 'unreachable', detail: 'asleep' }, calls);

  const cadence = { refreshAfterMinutes: 1, retryAfterMinutes: 120 };
  await load(dir, [sshSource], { fetch: unreachable, now: NOW + 2 * 60_000, ...cadence });
  await settledLoad(dir, [sshSource], { fetch: unreachable, now: NOW + 2 * 60_000, ...cadence }, (result) => result.sourceStates[0].fromCache);

  await load(dir, [sshSource], { fetch: unreachable, now: NOW + 30 * 60_000, ...cadence });
  assert.equal(calls.length, 1, 'a machine that is off for weeks is not retried on the success cadence');

  // Loads are repeated rather than counted once: the previous refresh may still
  // be finishing its cache write, and a request arriving then correctly joins it.
  await until(async () => { await load(dir, [sshSource], { fetch: unreachable, now: NOW + 3 * HOUR, ...cadence }); return calls.length === 2; }, 'past the retry window it tries again');
});

test('a source that has never succeeded still holds the retry cadence', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  const cadence = { refreshAfterMinutes: 1, retryAfterMinutes: 120 };
  const asleep = fetchReturning({ ok: false, state: 'unreachable', detail: 'asleep' }, calls);

  // Adding a machine that happens to be asleep is the ordinary case, not an edge:
  // the first attempt is awaited, and every request after it must not be.
  const first = await load(dir, [sshSource], { fetch: asleep, ...cadence });
  assert.equal(first.sourceStates[0].state, 'unreachable');
  assert.equal(first.sourceStates[0].included, false);

  let blocked = false;
  const stalls = async () => { blocked = true; await new Promise(() => {}); };
  const second = await Promise.race([
    load(dir, [sshSource], { fetch: stalls, now: NOW + 30 * 60_000, ...cadence }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('a request inside the retry window awaited the source')), 10_000)),
  ]);

  assert.equal(calls.length, 1, 'inside the retry window the executor is not reached again');
  assert.equal(blocked, false, 'and no request is left waiting on a machine we know is asleep');
  assert.equal(second.sourceStates[0].state, 'unreachable', 'the typed state is served from the attempt snapshot');
  assert.deepEqual(second.records, []);

  await until(async () => { await load(dir, [sshSource], { fetch: asleep, now: NOW + 3 * HOUR, ...cadence }); return calls.length === 2; }, 'past the retry window it tries again');
});

test('a successful detached revalidation replaces the snapshot, the cache, and the next response', async (t) => {
  const dir = await outDir(t);
  await load(dir, [sshSource], { fetch: serving(report({ records: [record()] })) });

  const fresher = report({ generatedAt: '2026-08-06T14:00:00.000Z', records: [record(), record({ unitId: 'laptop/claude-code/session-b/uuid-2', sessionId: 'session-b' })] });
  const later = NOW + 3 * HOUR;
  const calls = [];
  const serveFresher = fetchReturning({ ok: true, text: JSON.stringify(fresher) }, calls);

  await load(dir, [sshSource], { fetch: serveFresher, now: later });
  await until(() => calls.length === 1, 'the revalidation runs');

  const next = await settledLoad(dir, [sshSource], { fetch: serveFresher, now: later }, (result) => result.records.length === 2);
  assert.equal(next.sourceStates[0].lastSuccessAt, new Date(later).toISOString(), 'a genuine success advances the success time');
  assert.equal(next.sourceStates[0].fetchAgeHours, 0);
  assert.equal(next.sourceStates[0].generatedAt, '2026-08-06T14:00:00.000Z');

  // The snapshot is servable before its write completes, so the file is polled
  // rather than assumed (the same ordering that made an earlier test race).
  const readEntry = async () => JSON.parse(await readFile(join(dir, CACHE_DIRNAME, 'laptop.json'), 'utf8'));
  await until(async () => (await readEntry()).report.records.length === 2, 'the newer report reaches disk');
  const cached = await readEntry();
  assert.equal(cached.lastSuccessAt, new Date(later).toISOString());
  assert.equal(cached.lastFailure, null, 'a success clears the persisted failure');
});

test('every degraded state keeps local records intact through the decoupled loader', async (t) => {
  // Re-proved against the real loader rather than injected loads: shared mutable
  // state is what is new here, and the invariant is what must not be.
  const failures = [
    ['unreachable', { ok: false, state: 'unreachable', detail: 'asleep' }],
    ['unauthorized', { ok: false, state: 'unauthorized', detail: 'no key' }],
    ['missing', { ok: false, state: 'missing', detail: 'no report there' }],
    ['unreadable', { ok: false, state: 'unreadable', detail: 'over the limit' }],
    ['invalid', { ok: true, text: '{"partial"' }],
    ['incompatible', { ok: true, text: JSON.stringify({ ...report(), schemaVersion: 99 }) }],
    ['empty', { ok: true, text: '   ' }],
    ['fetcher exploded', () => { throw new Error('boom'); }],
  ];

  for (const [name, outcome] of failures) {
    for (const warm of [false, true]) {
      const dir = await outDir(t);
      if (warm) await load(dir, [sshSource], { fetch: serving(report()) });

      const at = warm ? NOW + 3 * HOUR : NOW;
      const label = `${name}${warm ? ' with a warm cache' : ''}`;
      // Cold has nothing to serve, so its fetch is awaited. Warm returns
      // last-known-good and refreshes detached, so the degraded outcome is
      // observed once it lands.
      const started = await load(dir, [sshSource], { fetch: fetchReturning(outcome), now: at, force: true });
      const cold = warm
        ? await settledLoad(dir, [sshSource], { fetch: failing('unreachable', 'must not run'), now: at }, (result) => result.sourceStates[0].state !== 'ok')
        : started;

      assert.equal(cold.sourceStates.length, 1, label);
      assert.equal(cold.sourceStates[0].included, warm && CACHEABLE.has(cold.sourceStates[0].state), label);
      // The load never throws and never removes a local record: `records` here is
      // the external contribution alone, so the local half is untouched by construction.
      assert.ok(Array.isArray(cold.records), label);
      assert.equal(cold.records.length, cold.sourceStates[0].included ? 1 : 0, label);
    }
  }
});

test('an old cache entry without attempt state is read and revalidated exactly once', async (t) => {
  const dir = await outDir(t);
  await mkdir(join(dir, CACHE_DIRNAME), { recursive: true });
  // Written by an install that predates `lastAttemptAt` / `lastFailure`.
  await writeFile(join(dir, CACHE_DIRNAME, 'laptop.json'), JSON.stringify({ lastSuccessAt: new Date(NOW - HOUR).toISOString(), report: report() }));

  const calls = [];
  const fetch = fetchReturning({ ok: true, text: JSON.stringify(report()) }, calls);
  const { records, sourceStates } = await load(dir, [sshSource], { fetch });

  assert.equal(records.length, 1, 'the old entry is served, not discarded');
  assert.equal(sourceStates[0].fetchAgeHours, 1);
  await until(() => calls.length === 1, 'exactly one revalidation, no migration');
  await load(dir, [sshSource], { fetch });
  assert.equal(calls.length, 1);
});

test('attempt state persists to the cache so a restart does not re-contact a dead host', async (t) => {
  const dir = await outDir(t);
  const calls = [];
  await load(dir, [sshSource], { fetch: serving(report()) });
  await load(dir, [sshSource], { fetch: fetchReturning({ ok: false, state: 'unreachable', detail: 'asleep' }, calls), now: NOW + HOUR });
  await until(() => calls.length === 1, 'the detached refresh runs');

  const persisted = async () => JSON.parse(await readFile(join(dir, CACHE_DIRNAME, 'laptop.json'), 'utf8'));
  await until(async () => (await persisted()).lastFailure != null, 'the failure reaches disk');
  const entry = await persisted();
  assert.equal(entry.lastSuccessAt, new Date(NOW).toISOString(), 'a failed attempt never advances the genuine success');
  assert.equal(entry.lastAttemptAt, new Date(NOW + HOUR).toISOString());
  assert.deepEqual(entry.lastFailure, { state: 'unreachable', detail: 'asleep' });
  assert.ok(entry.report, 'the last known good report stays beside the attempt state');
});

test('an archived source is included forever, exempt from both staleness axes, and never fetched over a transport', async (t) => {
  const dir = await outDir(t);
  const archiveDir = join(dir, 'archive');
  await mkdir(archiveDir, { recursive: true });
  const retired = report({ machineId: 'old-laptop', generatedAt: '2024-01-01T00:00:00.000Z' });
  await writeFile(join(archiveDir, 'old-laptop.json'), JSON.stringify(retired));

  const { records, sourceStates } = await loadExternalSources({
    outputDir: dir, now: NOW, config: { sources: [{ id: 'old-laptop', type: 'archived' }], staleReportAfterHours: 24, staleFetchAfterHours: 24 },
  });

  assert.equal(records.length, 1, 'a retired machine keeps contributing its history');
  assert.equal(records[0].sourceKey, 'old-laptop');
  const state = sourceStates[0];
  assert.equal(state.state, 'archived');
  assert.equal(state.included, true);
  assert.equal(state.staleReport, false, 'a two-year-old archive is not stale, it is archival');
  assert.equal(state.staleFetch, false);
  assert.equal(state.fetchAgeHours, null, 'nothing was ever reached');
  assert.equal(state.fromCache, false);

  // Cache-bypassing: the file is the durable copy, so no second copy is written.
  await assert.rejects(readFile(join(dir, CACHE_DIRNAME, 'old-laptop.json'), 'utf8'));
});

test('an archived report from a newer schema is incompatible, not archival', async (t) => {
  // An immutable file from an old machine is *more* likely to disagree with the
  // current schema than less, which is why archived reports are validated.
  const dir = await outDir(t);
  await mkdir(join(dir, 'archive'), { recursive: true });
  await writeFile(join(dir, 'archive', 'future.json'), JSON.stringify({ ...report({ machineId: 'future' }), schemaVersion: 99 }));

  const { records, sourceStates } = await loadExternalSources({
    outputDir: dir, now: NOW, config: { sources: [{ id: 'future', type: 'archived' }], staleReportAfterHours: 24, staleFetchAfterHours: 24 },
  });
  assert.equal(sourceStates[0].state, 'incompatible');
  assert.equal(sourceStates[0].included, false);
  assert.deepEqual(records, []);
});

test('an archived file replaced on disk is served after the guard window, with no cache written', async (t) => {
  const dir = await outDir(t);
  await mkdir(join(dir, 'archive'), { recursive: true });
  const archived = join(dir, 'archive', 'old-laptop.json');
  const config = (now) => ({ outputDir: dir, now, config: { sources: [{ id: 'old-laptop', type: 'archived' }], staleReportAfterHours: 24, staleFetchAfterHours: 24 } });
  await writeFile(archived, JSON.stringify(report({ machineId: 'old-laptop', records: [record()] })));

  const first = await loadExternalSources(config(NOW));
  assert.equal(first.records.length, 1);

  // Immutability is a promise about the machine, not a lock on the file.
  await writeFile(archived, JSON.stringify(report({ machineId: 'old-laptop', records: [record(), record({ unitId: 'old-laptop/claude-code/session-b/uuid-2', sessionId: 'session-b' })] })));
  const held = await loadExternalSources(config(NOW + 60_000));
  assert.equal(held.records.length, 1, 'inside the window the parsed copy is reused rather than re-read');

  const reread = await loadExternalSources(config(NOW + 2 * HOUR));
  assert.equal(reread.records.length, 2, 'past the window the new content is served');
  await assert.rejects(readFile(join(dir, CACHE_DIRNAME, 'old-laptop.json'), 'utf8'), 'an archived source is never cached: the file is the durable copy');
});

test('an archived machine that is also configured live trips the existing duplicate guard', async (t) => {
  // Deliberately unchanged behaviour: inventing an archived-loses-to-live rule
  // would hide a configuration error.
  const dir = await outDir(t);
  await mkdir(join(dir, 'archive'), { recursive: true });
  await writeFile(join(dir, 'archive', 'laptop-archive.json'), JSON.stringify(report({ machineId: 'laptop' })));

  const { sourceStates, loads } = await loadExternalSources({
    outputDir: dir,
    now: NOW,
    fetch: serving(report({ machineId: 'laptop' })),
    config: { sources: [sshSource, { id: 'laptop-archive', type: 'archived' }], staleReportAfterHours: 24, staleFetchAfterHours: 24 },
  });

  assert.deepEqual(sourceStates.map((state) => state.sourceKey), ['laptop', 'laptop']);
  assert.deepEqual(sourceStates.map((state) => state.state), ['ok', 'archived']);

  // `mergeReports` owns the decision, so the behaviour is proved where it lives:
  // the second source is skipped wholesale with the existing warning.
  const merged = mergeReports({ local: { machineId: 'workstation', records: [] }, external: loads });
  const external = merged.merge.sources.filter((row) => row.type !== 'local');
  assert.deepEqual(external.map((row) => row.included), [true, false], 'the second is skipped entirely');
  assert.ok(merged.merge.warnings.some((warning) => /duplicate machine/.test(warning)), 'and it says why');
});

test('a broken archived file is red and excluded rather than archival-neutral', async (t) => {
  const dir = await outDir(t);
  const archiveDir = join(dir, 'archive');
  await mkdir(archiveDir, { recursive: true });
  await writeFile(join(archiveDir, 'corrupt.json'), '{ not json');

  const config = { staleReportAfterHours: 24, staleFetchAfterHours: 24 };
  const missing = await loadExternalSources({ outputDir: dir, now: NOW, config: { ...config, sources: [{ id: 'absent', type: 'archived' }] } });
  assert.equal(missing.sourceStates[0].state, 'missing');
  assert.equal(missing.sourceStates[0].included, false);

  const corrupt = await loadExternalSources({ outputDir: dir, now: NOW, config: { ...config, sources: [{ id: 'corrupt', type: 'archived' }] } });
  assert.equal(corrupt.sourceStates[0].state, 'invalid');
  assert.equal(corrupt.records.length, 0);

  // The type must survive the fault, because it is what the browser reads to
  // decide the row's wording. Erased here, a broken archive is described as a
  // machine we failed to contact — the one row where that is most misleading.
  assert.equal(missing.sourceStates[0].type, 'archived');
  assert.equal(corrupt.sourceStates[0].type, 'archived');
});

// Every fault path funnels through one `failed()` constructor, so a field it
// drops is dropped everywhere at once and is invisible from the code that
// consumes it. `type` decides presentation, so it is asserted across the paths
// rather than in the one that happened to be noticed.
test('a source keeps its type on every fault path, whatever went wrong', async (t) => {
  const dir = await outDir(t);
  const config = { staleReportAfterHours: 24, staleFetchAfterHours: 24 };
  const state = async (sources, options) =>
    (await loadExternalSources({ outputDir: dir, now: NOW, config: { ...config, sources }, ...options })).sourceStates[0];

  const disabled = await state([{ ...sshSource, enabled: false }]);
  assert.equal(disabled.state, 'disabled');
  assert.equal(disabled.type, 'ssh');

  const broken = await state([{ id: 'gone', type: 'file', path: join(dir, 'nope.json') }]);
  assert.equal(broken.included, false);
  assert.equal(broken.type, 'file', 'a local file that cannot be read was still never going to be reached');

  const threw = await state([sshSource], { fetch: () => { throw new Error('boom'); } });
  assert.equal(threw.state, 'unreadable');
  assert.equal(threw.type, 'ssh');

  // The one case that genuinely cannot know: the entry failed validation, so
  // there is no trustworthy type to report and null is the honest answer.
  const invalid = await state([{ id: 'bad', type: 'nonsense' }]);
  assert.equal(invalid.state, 'invalid');
  assert.equal(invalid.type, null);
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

  // The forced refresh is detached, so the exclusion is observed once it
  // lands rather than in the response that started it.
  await load(dir, [sshSource], { fetch: fetchReturning({ ok: true, text: '{"partial"' }), force: true });
  const { records, sourceStates } = await settledLoad(dir, [sshSource], { fetch: failing('unreachable', 'must not run') }, (result) => result.sourceStates[0].state === 'invalid');
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
