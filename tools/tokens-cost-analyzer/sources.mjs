import { join } from 'node:path';
import { SCHEMA_VERSION, validateReport } from './report-contract.mjs';
import { CACHE_DIRNAME, readCache, writeCache } from './source-cache.mjs';
import { ARCHIVE_DIRNAME, fetchSource, validateSourceEntry } from './source-fetch.mjs';
import { DEFAULT_REFRESH_MINUTES } from './sources-config.mjs';
import { safeError } from '../shared-web/http.mjs';

// Drives every configured external source concurrently and independently. Like
// `source-fetch.mjs` nothing here throws: a source can only ever contribute
// records or a typed state, which is what makes the local-isolation invariant
// structural rather than aspirational.
//
// A request serves the last-known-good snapshot and, when it is older than the
// cadence window, starts a detached revalidation it never awaits. The only
// synchronous fetch left in the common path is a source's very first one, which
// has nothing to serve yet.

export { CACHE_DIRNAME };
const MINUTE_MS = 60_000;
// Keyed `cacheDir\0sourceId`: one Cockpit process serves several workspaces from
// one module instance, so the directory has to be part of the identity.
const sourceFlights = new Map();
const sourceSnapshots = new Map();

// Cache fallback is limited to transport failures. A report that arrives and
// fails validation is a source actively serving broken data, so it is excluded
// rather than papered over with history.
const CACHEABLE_FAILURES = new Set(['unreachable', 'unauthorized', 'missing', 'unreadable']);

export async function loadExternalSources({ outputDir, config, now = Date.now(), fetch = fetchSource, fetchOptions = {}, force = false }) {
  const entries = sourceEntries(config);
  const context = buildContext({ outputDir, config, now, fetch, fetchOptions });
  const loaded = await Promise.all(entries.map((entry, index) => guardedLoadSource(entry, index, context, force)));
  // `loads` keeps each state paired with the records it produced. Merge needs
  // that pairing, because two sources can legitimately share one `sourceKey`
  // (the duplicate-machine case) and could not be told apart afterwards.
  // `records` and `sourceStates` are projections of the same arrays.
  return {
    loads: loaded,
    records: loaded.flatMap((result) => result.records),
    sourceStates: loaded.map((result) => result.state),
  };
}

function sourceEntries(config) {
  return Array.isArray(config?.sources) ? config.sources : [];
}

function buildContext({ outputDir, config, now, fetch = fetchSource, fetchOptions = {} }) {
  return {
    cacheDir: join(outputDir, CACHE_DIRNAME),
    archiveDir: join(outputDir, ARCHIVE_DIRNAME),
    staleReportAfterHours: config?.staleReportAfterHours ?? 24,
    staleFetchAfterHours: config?.staleFetchAfterHours ?? 24,
    maxBytes: config?.maxReportBytes,
    refreshAfterMs: (config?.refreshAfterMinutes ?? DEFAULT_REFRESH_MINUTES) * MINUTE_MS,
    retryAfterMs: (config?.retryAfterMinutes ?? DEFAULT_REFRESH_MINUTES) * MINUTE_MS,
    now,
    fetch,
    fetchOptions,
  };
}

/**
 * What `/api/sources/status` serves. It reports the state of flights
 * started by `/api/report` and **starts nothing** — no fetch, no flight, not
 * even a cache read, so polling it can never cause traffic to a source machine.
 * That is the whole point of the endpoint existing: an open browser tab must not
 * become an unbounded fetch loop against every configured host.
 *
 * States are derived by the same `describeSnapshot` at the same `now` as
 * `/api/report`, so the two cannot disagree. A source with no snapshot in this
 * process is omitted rather than invented: it has never been loaded here, and
 * the only honest thing to say about it is nothing.
 */
export function readSourceStates({ outputDir, config, now = Date.now() }) {
  const context = buildContext({ outputDir, config, now });
  return sourceEntries(config)
    .map((entry, index) => describeWithoutFetching(entry, index, context))
    .filter((result) => result != null)
    .map((result) => withRefreshing(result, context).state);
}

function describeWithoutFetching(entry, index, context) {
  const validation = validateSourceEntry(entry, index);
  if (!validation.ok) return failed({ id: labelFor(entry, index), state: 'invalid', detail: validation.detail });
  const source = validation.value;
  if (!source.enabled) return failed({ id: source.id, state: 'disabled', detail: 'this source is turned off in sources.json', type: source.type });
  const key = sourceKeyFor(context, source.id);
  if (source.type === 'archived') {
    const held = sourceSnapshots.get(`${key}\0archived`);
    return held ? describeArchived(source, held, context, { materialize: false }) : null;
  }
  const snapshot = sourceSnapshots.get(key);
  return snapshot ? describeSnapshot(source, snapshot, context, { materialize: false }) : null;
}

/**
 * The outer contract: one source can never reject. `fetchSource` is injectable,
 * so an unexpected throw is always possible here however careful the inner path
 * is, and the request handler hands this promise straight to a response.
 */
async function guardedLoadSource(entry, index, context, force) {
  let result;
  try {
    result = await loadSource(entry, index, context, force);
  } catch (error) {
    // Re-validated rather than read off the raw entry: an unvalidated `type` is
    // user input, and this is the one fault path with no validated source in
    // scope. An entry that does not validate reports no type at all.
    const validated = validateSourceEntry(entry, index);
    result = failed({ id: labelFor(entry, index), state: 'unreadable', detail: boundedDetail(error), type: validated.ok ? validated.value.type : null });
  }
  return withRefreshing(result, context);
}

/**
 * The in-flight flag is additive — an orthogonal boolean beside the state,
 * never a value of `state` and never a tone. It is projected here, at the one
 * point every path passes through, from `sourceFlights` itself: real observed
 * state rather than a client-side optimism timer. An archived source keys its
 * snapshot elsewhere and never takes a flight, so it can never report `true`.
 */
function withRefreshing(result, context) {
  const refreshing = sourceFlights.has(sourceKeyFor(context, result.state.id));
  return { ...result, state: { ...result.state, refreshing } };
}

async function loadSource(entry, index, context, force) {
  const validation = validateSourceEntry(entry, index);
  if (!validation.ok) return failed({ id: labelFor(entry, index), state: 'invalid', detail: validation.detail });
  const source = validation.value;
  if (!source.enabled) return failed({ id: source.id, state: 'disabled', detail: 'this source is turned off in sources.json', type: source.type });
  if (source.type === 'archived') return loadArchived(source, index, context);

  const key = sourceKeyFor(context, source.id);
  const snapshot = await currentSnapshot(key, source, context);
  // Nothing to serve yet, so this one is awaited — at most once per source per
  // install, and it is what makes adding a source give immediate feedback.
  if (!snapshot) return describeSnapshot(source, await startRefresh(key, source, index, context), context);
  // A forced refresh bypasses the cadence guard and reaches the network, but not
  // the response — it returns last-known-good immediately and runs detached under
  // startRefresh's catch, exactly like an ordinary revalidation. A forced refresh
  // therefore guarantees the refresh was started, not that this response contains
  // it; the per-source in-flight flag is what reports that.
  if (dueForRefresh(snapshot, context, force)) startRefresh(key, source, index, context);
  return describeSnapshot(source, snapshot, context);
}

/**
 * A request takes the snapshot once, as a frozen value. A completing
 * refresh replaces the map reference with a new object, so no request can
 * observe a half-updated source and a fetch landing mid-merge cannot change
 * what the in-progress response contains.
 */
async function currentSnapshot(key, source, context) {
  if (sourceSnapshots.has(key)) return sourceSnapshots.get(key);
  const stored = await readCache(context.cacheDir, source.id);
  if (stored) sourceSnapshots.set(key, stored);
  return stored;
}

function dueForRefresh(snapshot, context, force) {
  if (force) return true;
  const window = snapshot.lastFailure ? context.retryAfterMs : context.refreshAfterMs;
  const attemptedAt = Date.parse(snapshot.lastAttemptAt ?? snapshot.lastSuccessAt);
  return !Number.isFinite(attemptedAt) || context.now - attemptedAt >= window;
}

/**
 * Per-source single-flight and detachment in one place. Every caller that does
 * not await the returned promise still leaves it caught: an unhandled rejection
 * after the response is sent terminates the process by default, which would be
 * a worse isolation failure than the latency this design removes.
 */
function startRefresh(key, source, index, context) {
  let flight = sourceFlights.get(key);
  if (!flight) {
    flight = refreshSnapshot(key, source, index, context);
    sourceFlights.set(key, flight);
    flight.finally(() => sourceFlights.delete(key)).catch(() => {});
  }
  flight.catch(() => {});
  return flight;
}

async function refreshSnapshot(key, source, index, context) {
  const prior = sourceSnapshots.get(key) ?? null;
  const attemptedAt = new Date(context.now).toISOString();
  const outcome = await attemptFetch(source, index, context);
  const failure = outcome.ok ? null : { state: outcome.state, detail: outcome.detail };
  // A source that has never succeeded still gets an attempt-only snapshot. Without
  // it there is nothing to hold the cadence, and "awaited at most once per
  // source" would silently become "awaited on every request" for the ordinary case
  // of adding a machine that happens to be asleep.
  const next = outcome.ok
    ? { lastSuccessAt: attemptedAt, lastAttemptAt: attemptedAt, lastFailure: null, report: outcome.value }
    : { ...(prior ?? { lastSuccessAt: null, report: null }), lastAttemptAt: attemptedAt, lastFailure: failure };
  sourceSnapshots.set(key, next);
  // Only a snapshot with a report is worth persisting; an attempt-only one holds
  // the cadence for this process and is re-established cheaply after a restart.
  await writeCache(context.cacheDir, source.id, next);
  return next;
}

async function attemptFetch(source, index, context) {
  try {
    const fetched = await context.fetch(source, { ...context.fetchOptions, index, maxBytes: context.maxBytes, archiveDir: context.archiveDir });
    if (!fetched || typeof fetched !== 'object') return { ok: false, state: 'unreadable', detail: 'the fetcher returned no result for this source' };
    return fetched.ok ? parseReport(fetched.text) : fetched;
  } catch (error) {
    // A detached refresh has no caller to catch for it, so an injected fetcher
    // throwing must become a typed failure here rather than a rejection.
    return { ok: false, state: 'unreadable', detail: boundedDetail(error) };
  }
}

/**
 * An archived source is a local immutable file, never a transport and never
 * cached on disk — the file *is* the durable copy. It keeps an in-memory snapshot
 * and the cadence window only to avoid re-parsing a large report on every request;
 * nothing is ever contacted, and replacing the file takes effect on the next load
 * past the window.
 */
async function loadArchived(source, index, context) {
  const key = `${sourceKeyFor(context, source.id)}\0archived`;
  const held = sourceSnapshots.get(key);
  if (held && context.now - Date.parse(held.lastAttemptAt) < context.refreshAfterMs) return describeArchived(source, held, context);

  const outcome = await attemptFetch(source, index, context);
  // A missing or broken archived file is a real fault, not archival neutrality.
  if (!outcome.ok) return failed({ id: source.id, state: outcome.state, detail: outcome.detail, type: source.type });
  const snapshot = { lastSuccessAt: null, lastAttemptAt: new Date(context.now).toISOString(), lastFailure: null, report: outcome.value };
  sourceSnapshots.set(key, snapshot);
  return describeArchived(source, snapshot, context);
}

function describeArchived(source, snapshot, context, { materialize = true } = {}) {
  const base = describeSnapshot(source, snapshot, context, { archived: true, materialize });
  if (!base.state.included) return base;
  // `fetchAgeHours` is null because nothing was ever reached, and the cadence
  // field is withheld for the same reason: there is no attempt to report.
  return { records: base.records, state: { ...base.state, state: 'archived', detail: null, lastSuccessAt: null, fetchAgeHours: null, attemptAgeHours: null, fromCache: false } };
}

/**
 * The one place a source state is derived, so the two ages cannot drift apart
 * in the code that decides what a user is told about their totals.
 * Both ages carry different meanings and are never collapsed into one word:
 * a stale report on a fresh fetch means nothing new happened on that
 * machine, while a stale fetch means we could not check.
 */
function describeSnapshot(source, snapshot, context, { archived = false, materialize = true } = {}) {
  const failure = snapshot.lastFailure;
  // A source actively serving broken data is excluded rather than replaced by
  // its own history; only transport failures may leave the cached report standing.
  if (!snapshot.report || (failure && !CACHEABLE_FAILURES.has(failure.state))) {
    return failed({ id: source.id, state: failure?.state ?? 'unreadable', detail: failure?.detail ?? 'this source has no usable report', type: source.type });
  }
  const report = snapshot.report;
  const reportAgeHours = ageHours(report.report?.generatedAt, context.now);
  const fetchAgeHours = ageHours(snapshot.lastSuccessAt, context.now);
  // An archived source is exempt from both staleness axes and is included
  // unconditionally: the history of a retired machine is real and does not
  // decay, so ageing it would only ever misrepresent it.
  const staleReport = !archived && reportAgeHours != null && reportAgeHours > context.staleReportAfterHours;
  const staleFetch = !archived && fetchAgeHours != null && fetchAgeHours > context.staleFetchAfterHours;
  const included = archived || !staleReport || source.includeWhenStale;
  const sourceKey = report.origin?.machineId ?? null;
  // `/api/sources/status` wants the count and none of the rows. Stamping a
  // hundred megabytes of records with their `sourceKey` once a second, to
  // render one word, is the cost the status endpoint exists to avoid.
  const contributed = included ? report.records.length : 0;
  const records = materialize && included ? report.records.map((record) => ({ ...record, sourceKey })) : [];
  return {
    records,
    state: {
      id: source.id,
      type: source.type,
      sourceKey,
      reportId: report.report?.reportId ?? null,
      state: failure ? failure.state : (staleReport ? 'stale-report' : 'ok'),
      included,
      detail: detailFor({ failure, included, staleReport, source }),
      generatedAt: report.report?.generatedAt ?? null,
      currency: report.report?.currency ?? null,
      coverageMode: report.report?.coverage?.mode ?? null,
      lastSuccessAt: snapshot.lastSuccessAt,
      reportAgeHours,
      fetchAgeHours,
      // Cadence, not freshness: present for diagnostics and rendered nowhere,
      // so that raising the refresh window can never read as fresher data.
      attemptAgeHours: ageHours(snapshot.lastAttemptAt, context.now),
      staleReport,
      staleFetch,
      // True when we are serving history because the newest attempt failed. A
      // successful attempt's report is the newest there is, whatever store it
      // was read back from.
      fromCache: failure != null,
      records: contributed,
    },
  };
}

function detailFor({ failure, included, staleReport, source }) {
  if (failure) return failure.detail;
  if (staleReport && !included) return `this source is stale and ${source.id} is configured with includeWhenStale: false`;
  return null;
}

function parseReport(text) {
  let candidate;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { ok: false, state: 'invalid', detail: 'the report is not valid JSON' };
  }
  if (Number.isInteger(candidate?.schemaVersion) && candidate.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, state: 'incompatible', detail: `the report uses schemaVersion ${candidate.schemaVersion}, newer than the supported version ${SCHEMA_VERSION}; upgrade this tool` };
  }
  const validated = validateReport(candidate);
  if (!validated.ok) return { ok: false, state: 'invalid', detail: `the report is not a valid report: ${validated.error}` };
  return { ok: true, value: candidate };
}

function sourceKeyFor(context, sourceId) { return `${context.cacheDir}\0${sourceId}`; }

/**
 * Every fault path ends here, so a field this drops is dropped everywhere. `type`
 * is not diagnostic decoration: the browser reads it to decide the row's wording,
 * and without it a broken archive or local file is described as a machine we
 * failed to contact. It defaults to null only for an entry that failed validation,
 * where there is no type we can trust.
 */
function failed({ id, state, detail, type = null }) {
  return {
    records: [],
    state: {
      id, type, sourceKey: null, reportId: null, state, included: false, detail,
      generatedAt: null, currency: null, coverageMode: null, lastSuccessAt: null,
      reportAgeHours: null, fetchAgeHours: null, attemptAgeHours: null, staleReport: false, staleFetch: false,
      fromCache: false, records: 0,
    },
  };
}

// Details render in the browser, so an unexpected `Error.message` is bounded to
// one line and 220 characters before it can get there.
function boundedDetail(error) {
  const message = safeError(error).split('\n')[0].trim() || 'Unknown error';
  return message.length > 220 ? `${message.slice(0, 219)}…` : message;
}

function labelFor(entry, index) { return typeof entry?.id === 'string' && entry.id ? entry.id : `sources[${index}]`; }
function ageHours(value, now) { return validDate(value) ? (now - Date.parse(value)) / 3_600_000 : null; }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
