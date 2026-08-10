import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './atomic-write.mjs';
import { validateReport } from './report-contract.mjs';

// Persistence for the one last-known-good store, extracted from `sources.mjs`
// only to keep that file readable. `sources.mjs` remains its sole owner and
// `atomicWrite` its only writer; nothing else may write here.

export const CACHE_DIRNAME = 'cache';

/**
 * An entry written by an install that predates `lastAttemptAt` / `lastFailure`
 * is read as `lastAttemptAt = lastSuccessAt` with no failure, which triggers
 * exactly one revalidation on first use — the whole migration.
 */
export async function readCache(cacheDir, sourceId) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(cachePath(cacheDir, sourceId), 'utf8'));
  } catch {
    return null;
  }
  if (!validDate(parsed?.lastSuccessAt)) return null;
  if (!validateReport(parsed.report).ok) return null;
  return {
    lastSuccessAt: parsed.lastSuccessAt,
    lastAttemptAt: validDate(parsed.lastAttemptAt) ? parsed.lastAttemptAt : parsed.lastSuccessAt,
    lastFailure: parsed.lastFailure?.state ? { state: parsed.lastFailure.state, detail: parsed.lastFailure.detail ?? null } : null,
    report: parsed.report,
  };
}

export async function writeCache(cacheDir, sourceId, snapshot) {
  // Nothing worth keeping until a genuine success has produced a report.
  if (!snapshot.report || !snapshot.lastSuccessAt) return;
  try {
    await mkdir(cacheDir, { recursive: true });
    await atomicWrite(cachePath(cacheDir, sourceId), JSON.stringify(snapshot));
  } catch {
    // A cache write failure costs the next refresh its fallback, never this one
    // its records, so it must not turn a good fetch into a source failure.
  }
}

// `sourceId` is validated against the id pattern before reaching here, so it
// carries no separators and cannot escape the cache directory.
function cachePath(cacheDir, sourceId) { return join(cacheDir, `${sourceId}.json`); }
function validDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
