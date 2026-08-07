import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write.mjs';
import { SCHEMA_VERSION, validateReport } from './report-contract.mjs';
import { fetchSource, validateSourceEntry } from './source-fetch.mjs';
import { safeError } from '../shared-web/http.mjs';

// Drives every configured external source concurrently and independently. Like
// `source-fetch.mjs` nothing here throws: a source can only ever contribute
// records or a typed state, which is what makes the local-isolation invariant
// structural rather than aspirational (design §6).

export const CACHE_DIRNAME = 'cache';

// Cache fallback is limited to the transport failures §6 names ("cache used if
// present"). A report that arrives and fails validation is a source actively
// serving broken data, so it is excluded rather than papered over with history.
const CACHEABLE_FAILURES = new Set(['unreachable', 'unauthorized', 'missing', 'unreadable']);

export async function loadExternalSources({ outputDir, config, now = Date.now(), fetch = fetchSource, fetchOptions = {} }) {
  const entries = Array.isArray(config?.sources) ? config.sources : [];
  const context = {
    cacheDir: join(outputDir, CACHE_DIRNAME),
    staleReportAfterHours: config?.staleReportAfterHours ?? 24,
    staleFetchAfterHours: config?.staleFetchAfterHours ?? 24,
    maxBytes: config?.maxReportBytes,
    now,
    fetch,
    fetchOptions,
  };
  const loaded = await Promise.all(entries.map((entry, index) => loadSource(entry, index, context)));
  // `loads` keeps each state paired with the records it produced. Merge needs
  // that pairing, because two sources can legitimately share one `sourceKey`
  // (§5.3's duplicate-machine case) and could not be told apart afterwards.
  // `records` and `sourceStates` are projections of the same arrays.
  return {
    loads: loaded,
    records: loaded.flatMap((result) => result.records),
    sourceStates: loaded.map((result) => result.state),
  };
}

/**
 * The outer contract: one source can never reject. `fetchSource` is injectable,
 * so an unexpected throw is always possible here however careful the inner
 * path is, and step 8 hands this promise to the request handler.
 */
async function loadSource(entry, index, context) {
  try {
    return await attemptSource(entry, index, context);
  } catch (error) {
    return failed({ id: labelFor(entry, index), state: 'unreadable', detail: boundedDetail(error) });
  }
}

async function attemptSource(entry, index, context) {
  const validation = validateSourceEntry(entry, index);
  if (!validation.ok) return failed({ id: labelFor(entry, index), state: 'invalid', detail: validation.detail });
  const source = validation.value;
  if (!source.enabled) return failed({ id: source.id, state: 'disabled', detail: 'this source is turned off in sources.json' });

  const fetched = await context.fetch(source, { ...context.fetchOptions, index, maxBytes: context.maxBytes });
  if (!fetched || typeof fetched !== 'object') throw new Error('the fetcher returned no result for this source');
  const parsed = fetched.ok ? parseReport(fetched.text) : fetched;
  if (parsed.ok) return await acceptReport(source, parsed.value, context);
  return await fallBackToCache(source, parsed, context);
}

async function acceptReport(source, report, context) {
  const lastSuccessAt = new Date(context.now).toISOString();
  await writeCache(context.cacheDir, source.id, { lastSuccessAt, report });
  return describe({ source, report, lastSuccessAt, fromCache: false, failure: null, context });
}

async function fallBackToCache(source, failure, context) {
  const cached = CACHEABLE_FAILURES.has(failure.state) ? await readCache(context.cacheDir, source.id) : null;
  if (!cached) return failed({ id: source.id, state: failure.state, detail: failure.detail });
  return describe({ source, report: cached.report, lastSuccessAt: cached.lastSuccessAt, fromCache: true, failure, context });
}

/**
 * Both ages carry different meanings and are never collapsed into one word
 * (§6.1): a stale report on a fresh fetch means nothing new happened on that
 * machine, while a stale fetch means we could not check.
 */
function describe({ source, report, lastSuccessAt, fromCache, failure, context }) {
  const reportAgeHours = ageHours(report.report?.generatedAt, context.now);
  const fetchAgeHours = ageHours(lastSuccessAt, context.now);
  const staleReport = reportAgeHours != null && reportAgeHours > context.staleReportAfterHours;
  const staleFetch = fetchAgeHours != null && fetchAgeHours > context.staleFetchAfterHours;
  const included = !staleReport || source.includeWhenStale;
  const sourceKey = report.origin?.machineId ?? null;
  const records = included ? report.records.map((record) => ({ ...record, sourceKey })) : [];
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
      lastSuccessAt,
      reportAgeHours,
      fetchAgeHours,
      staleReport,
      staleFetch,
      fromCache,
      records: records.length,
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

async function readCache(cacheDir, sourceId) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(cachePath(cacheDir, sourceId), 'utf8'));
  } catch {
    return null;
  }
  if (!validDate(parsed?.lastSuccessAt)) return null;
  const validated = validateReport(parsed.report);
  return validated.ok ? { lastSuccessAt: parsed.lastSuccessAt, report: parsed.report } : null;
}

async function writeCache(cacheDir, sourceId, payload) {
  try {
    await mkdir(cacheDir, { recursive: true });
    await atomicWrite(cachePath(cacheDir, sourceId), JSON.stringify(payload));
  } catch {
    // A cache write failure costs the next refresh its fallback, never this one
    // its records, so it must not turn a good fetch into a source failure.
  }
}

// `sourceId` is validated against the id pattern before reaching here, so it
// carries no separators and cannot escape the cache directory.
function cachePath(cacheDir, sourceId) { return join(cacheDir, `${sourceId}.json`); }

function failed({ id, state, detail }) {
  return {
    records: [],
    state: {
      id, type: null, sourceKey: null, reportId: null, state, included: false, detail,
      generatedAt: null, currency: null, coverageMode: null, lastSuccessAt: null,
      reportAgeHours: null, fetchAgeHours: null, staleReport: false, staleFetch: false,
      fromCache: false, records: 0,
    },
  };
}

// Details render in the browser, so an unexpected `Error.message` is bounded to
// one line and 220 characters before it can get there (§7).
function boundedDetail(error) {
  const message = safeError(error).split('\n')[0].trim() || 'Unknown error';
  return message.length > 220 ? `${message.slice(0, 219)}…` : message;
}

function labelFor(entry, index) { return typeof entry?.id === 'string' && entry.id ? entry.id : `sources[${index}]`; }
function ageHours(value, now) { return validDate(value) ? (now - Date.parse(value)) / 3_600_000 : null; }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
