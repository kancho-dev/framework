import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_REPORT_BYTES } from './source-fetch.mjs';

export const SOURCES_CONFIG_FILE = 'sources.json';
const DEFAULT_STALE_HOURS = 24;
// Refresh *cadence*, deliberately separate from the two `stale…Hours` values,
// which are user-facing truth. Cadence is never rendered.
// 10 minutes matches the browser's poll and sits beside the local path's
// 9-minute artifact guard, so a page load refreshes both on one rhythm.
export const DEFAULT_REFRESH_MINUTES = 10;

// Single reader for sources.json so `analyze.mjs` (self/workspaces) and the
// refresh-time source loader (sources[]) cannot disagree about the same file.
export async function loadSourcesConfig(outputDir) {
  const raw = await readOptionalJson(join(outputDir, SOURCES_CONFIG_FILE));
  if (raw == null) return { configured: false, self: null, sources: [], staleReportAfterHours: DEFAULT_STALE_HOURS, staleFetchAfterHours: DEFAULT_STALE_HOURS, maxReportBytes: MAX_REPORT_BYTES, refreshAfterMinutes: DEFAULT_REFRESH_MINUTES, retryAfterMinutes: DEFAULT_REFRESH_MINUTES };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${SOURCES_CONFIG_FILE} must contain a JSON object`);
  if (raw.schemaVersion != null && raw.schemaVersion !== 1) throw new Error(`${SOURCES_CONFIG_FILE} schemaVersion ${raw.schemaVersion} is not supported`);
  if (raw.sources != null && !Array.isArray(raw.sources)) throw new Error(`${SOURCES_CONFIG_FILE} sources must be an array`);
  const sourceIds = (raw.sources ?? []).map((source) => source?.id);
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error(`${SOURCES_CONFIG_FILE} source ids must be unique`);
  return {
    configured: true,
    self: raw.self ?? null,
    sources: raw.sources ?? [],
    staleReportAfterHours: positiveHours(raw.staleReportAfterHours, 'staleReportAfterHours'),
    staleFetchAfterHours: positiveHours(raw.staleFetchAfterHours, 'staleFetchAfterHours'),
    maxReportBytes: positiveBytes(raw.maxReportBytes),
    refreshAfterMinutes: positiveMinutes(raw.refreshAfterMinutes, 'refreshAfterMinutes'),
    retryAfterMinutes: positiveMinutes(raw.retryAfterMinutes, 'retryAfterMinutes'),
  };
}

async function readOptionalJson(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${SOURCES_CONFIG_FILE} is not valid JSON: ${String(error?.message || error).split('\n')[0]}`);
  }
}

function positiveBytes(value) {
  if (value == null) return MAX_REPORT_BYTES;
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new Error(`${SOURCES_CONFIG_FILE} maxReportBytes must be a positive integer number of bytes`);
  return bytes;
}

function positiveMinutes(value, field) {
  if (value == null) return DEFAULT_REFRESH_MINUTES;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`${SOURCES_CONFIG_FILE} ${field} must be a positive number of minutes`);
  return minutes;
}

function positiveHours(value, field) {
  if (value == null) return DEFAULT_STALE_HOURS;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error(`${SOURCES_CONFIG_FILE} ${field} must be a positive number of hours`);
  return hours;
}
