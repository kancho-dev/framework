import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';
import { loadSourcesConfig } from './sources-config.mjs';
import { parseSelfConfig, scanScope, SCAN_SCOPE_FILE } from './workspace-scope.mjs';
import { loadExternalSources } from './sources.mjs';
import { mergeReports } from './merge.mjs';
import { dailyUsage, round, summarize } from './rollups.mjs';
import { createReportViewCache } from './report-view-cache.mjs';

const execFileAsync = promisify(execFile);
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const PORT = Number(process.env.TOKENS_COST_ANALYZER_PORT || process.env.PORT || '8790');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const OUTPUT_DIR = resolve(process.env.TOKENS_COST_ANALYZER_OUT || join(WORKSPACE_ROOT, '.tools-config', 'tokens-cost-analyzer'));
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');
const ANALYSIS_LIMIT = parseAnalysisLimit(process.env.TOKENS_COST_ANALYZER_LIMIT);
const MIN_ARTIFACT_AGE_MS = 9 * 60 * 1000;
const REPORT_FILE = 'report.v1.json';
const analysisFlights = new Map();

export function createTokensCostAnalyzerHandler(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot || WORKSPACE_ROOT);
  const outputDir = resolve(options.outputDir || join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer'));
  const basePath = normalizeBasePath(options.basePath || '');
  const cockpit = options.cockpit || { tools: [] };
  const analysisLimit = Object.hasOwn(options, 'analysisLimit') ? options.analysisLimit : ANALYSIS_LIMIT;
  // Injected like `ensureArtifacts`'s `runAnalysis`, so every §6 degraded state
  // is testable through the real request path with no network.
  const loadExternal = options.loadExternal || loadExternalSources;
  // One cache per handler, not per module: a test's fixture handler must never
  // inherit another's parsed artifact.
  const readReportView = options.readReportView || createReportViewCache();
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (basePath && url.pathname === basePath) {
      res.writeHead(302, { location: `${basePath}/${url.search || ''}` });
      res.end();
      return true;
    }
    const pathname = stripBasePath(url.pathname, basePath);
    if (pathname === null) return false;
    try {
      const refresh = url.searchParams.get('refresh') === '1';
      const manual = url.searchParams.get('manual') === '1';
      if (pathname === '/api/report') { sendJson(res, 200, await loadReport({ workspaceRoot, outputDir, refresh, manual, analysisLimit, loadExternal, readReportView })); return true; }
      if (pathname === '/api/daily-usage') { sendJson(res, 200, await loadDailyUsage({ workspaceRoot, outputDir, refresh, manual, analysisLimit, loadExternal, readReportView })); return true; }
      if (pathname.startsWith('/shared/')) { await serveStaticPath(res, SHARED_WEB_DIR, pathname.replace('/shared', '')); return true; }
      if (pathname === '/') {
        const html = await readStaticText(PUBLIC_DIR, '/index.html');
        const workspaceQuery = cockpit.workspaceId ? `?workspace=${encodeURIComponent(cockpit.workspaceId)}` : '';
        await sendHtml(res, html
          .replaceAll('href="icon.svg"', `href="icon.svg${workspaceQuery}"`)
          .replaceAll('src="icon.svg"', `src="icon.svg${workspaceQuery}"`)
          .replaceAll('href="style.css"', `href="style.css${workspaceQuery}"`)
          .replaceAll('src="app.js"', `src="app.js${workspaceQuery}"`)
          .replace('<!-- __FRAMEWORK_COCKPIT_CONFIG__ -->', `<script>window.__FRAMEWORK_COCKPIT__=${JSON.stringify(cockpit)}</script>`));
        return true;
      }
      await serveStaticPath(res, PUBLIC_DIR, pathname);
      return true;
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: safeError(error) });
      return true;
    }
    return false;
  };
}

async function loadReport(options) {
  const { local, merged, merge, machineId, workspaceIds } = await loadMergedRecords(options);
  const subscriptions = await readSubscriptions(join(options.outputDir, 'subscriptions.json'));
  const summary = summarize({ ...local, records: merged }, dailyUsage(merged), subscriptions, merge);
  return { ...summary, linkTargets: await localLinkTargets(options, { machineId, workspaceIds }) };
}

/**
 * §8.2 condition 2 is a *local* lookup: reports carry no roots (§7), so the
 * browser is given this machine's own workspace roots to match against the
 * Cockpit's registered workspaces.
 *
 * These come from `scan-scope.json`, written by the run that stamped the
 * records' `workspaceId`s. Re-deriving them here instead lets a CLI-generated
 * artifact and a differently-rooted server disagree, and the failure is silent:
 * no id resolves, so every deep link disappears. Falling back to the local
 * configuration keeps older artifacts working, and `unresolvedWorkspaces` makes
 * a residual disagreement visible rather than letting the UI go quietly inert.
 */
async function localLinkTargets({ outputDir, workspaceRoot }, { machineId, workspaceIds }) {
  const scope = await readScanScope(outputDir, workspaceRoot);
  const known = new Set(scope.workspaces.map((workspace) => workspace.id));
  return {
    machineId: machineId ?? scope.machineId,
    workspaces: scope.workspaces,
    unresolvedWorkspaces: workspaceIds.filter((id) => !known.has(id)),
  };
}

async function readScanScope(outputDir, workspaceRoot) {
  try {
    const parsed = JSON.parse(await readFile(join(outputDir, SCAN_SCOPE_FILE), 'utf8'));
    if (Array.isArray(parsed?.workspaces) && parsed.workspaces.length) return parsed;
  } catch {
    // Absent (a pre-`scan-scope.json` artifact) or unreadable: fall through.
  }
  try {
    return scanScope(parseSelfConfig((await loadSourcesConfig(outputDir)).self, { workspaceRoot }));
  } catch {
    return scanScope(parseSelfConfig(null, { workspaceRoot }));
  }
}

/**
 * The local-isolation invariant lives here: external loading sits below the
 * request handler's catch and inside its own, so no external-source condition
 * can stop `/api/report` returning 200 with complete local records (§6).
 */
async function loadMergedRecords(options) {
  await ensureArtifacts(options);
  const { local, mergeInput, machineId, workspaceIds } = await readLocalReport(options);
  const external = await loadExternalSafely(options);
  const { records, merge } = mergeReports({ local: mergeInput, external });
  return { local, merged: records, merge, machineId, workspaceIds };
}

/**
 * Everything here derives from `report.v1.json` alone, so it is cached against
 * that file's identity rather than rebuilt per request. External loading and
 * merging deliberately stay outside the cache: they depend on remote state and
 * on `refresh`, which the artifact's identity says nothing about.
 */
function readLocalReport({ outputDir, workspaceRoot, readReportView = defaultReportView }) {
  return readReportView(join(outputDir, REPORT_FILE), (report) => {
    const local = localReportView(report, workspaceRoot);
    return {
      local,
      mergeInput: localMergeInput(report, local),
      machineId: report.origin?.machineId ?? null,
      // What this machine's own scan actually attributed to, straight from the
      // artifact — the evidence that exposes a scope disagreement (§8.2).
      workspaceIds: (report.origin?.workspaces || []).filter((id) => typeof id === 'string'),
    };
  });
}

// A caller that built no handler gets a correct read with no reuse, rather than
// sharing one process-wide cache with every other caller.
const defaultReportView = async (path, build) => build(JSON.parse(await readFile(path, 'utf8')));

async function loadExternalSafely({ outputDir, refresh, manual, loadExternal = loadExternalSources }) {
  try {
    const config = await loadSourcesConfig(outputDir);
    if (!config.sources.length) return [];
    return (await loadExternal({ outputDir, config, force: refresh && manual })).loads;
  } catch (error) {
    // Reached only when configuration itself is unreadable — `loadExternalSources`
    // never throws. One unusable source file must not blank the dashboard.
    return [{ records: [], state: { id: 'sources.json', type: 'config', state: 'invalid', included: false, detail: safeError(error) } }];
  }
}

function localMergeInput(report, local) {
  return {
    machineId: report.origin?.machineId ?? null,
    reportId: report.report?.reportId ?? null,
    generatedAt: local.generatedAt,
    currency: report.report?.currency ?? null,
    coverageMode: local.analysis.mode,
    records: local.records,
  };
}

/**
 * Adapt `report.v1.json` to the shape `summarize` consumes. Roots are redacted
 * out of the artifact by design (§7), so local path knowledge is reapplied here
 * from local configuration rather than read back from the report.
 */
function localReportView(report, workspaceRoot) {
  const coverage = report.report?.coverage || {};
  return {
    generatedAt: report.report?.generatedAt,
    workspaceRoot,
    analysis: { mode: coverage.mode || 'unknown', limit: coverage.limit ?? null, limitScope: coverage.limitScope || 'unknown' },
    warnings: report.report?.warnings || [],
    records: (report.records || []).map((record) => expandLocalPaths(record, report.origin?.machineId)),
  };
}

// Only this machine's own records can address a local session; an imported
// record's `~` belongs to another machine's home directory.
function expandLocalPaths(record, machineId) {
  const isLocal = machineId != null && String(record.unitId || '').startsWith(`${machineId}/`);
  if (!isLocal || !String(record.sessionBrowserPath || '').startsWith('~/')) return record;
  return { ...record, sessionBrowserPath: join(homedir(), String(record.sessionBrowserPath).slice(2)) };
}

// `daily.json` is regenerated from merged records rather than served as the
// analyzer wrote it, so the Cockpit widget cannot disagree with the dashboard.
async function loadDailyUsage(options) {
  const { merged } = await loadMergedRecords(options);
  const artifact = JSON.parse(await readFile(join(options.outputDir, 'daily.json'), 'utf8'));
  return { ...artifact, daily: dailyUsage(merged) };
}

export async function ensureArtifacts({ workspaceRoot, outputDir, refresh, manual, analysisLimit, runAnalysis = executeAnalysis, now = Date.now }) {
  const reportPath = join(outputDir, REPORT_FILE);
  const dailyPath = join(outputDir, 'daily.json');
  const artifactsExist = await exists(reportPath) && await exists(dailyPath);
  if (artifactsExist && (!refresh || (!manual && await artifactIsFresh(dailyPath, now)))) return;
  let flight = analysisFlights.get(outputDir);
  if (!flight) {
    flight = runAnalysis({ workspaceRoot, outputDir, analysisLimit });
    analysisFlights.set(outputDir, flight);
    flight.finally(() => analysisFlights.delete(outputDir)).catch(() => {});
  }
  await flight;
}

async function executeAnalysis({ workspaceRoot, outputDir, analysisLimit }) {
  const analyzeArgs = [join(TOOL_DIR, 'analyze.mjs'), '--workspace', workspaceRoot, '--out', outputDir];
  if (analysisLimit) analyzeArgs.push('--limit', analysisLimit);
  await execFileAsync(process.execPath, analyzeArgs, { maxBuffer: 1024 * 1024 * 20 });
}

async function artifactIsFresh(path, now) {
  try {
    const artifact = JSON.parse(await readFile(path, 'utf8'));
    const generatedAt = Date.parse(artifact.generatedAt);
    return Number.isFinite(generatedAt) && now() - generatedAt < MIN_ARTIFACT_AGE_MS;
  } catch {
    return false;
  }
}

function parseAnalysisLimit(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'all') return 'all';
  const limit = Number(normalized);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('TOKENS_COST_ANALYZER_LIMIT must be a positive integer or all');
  return String(limit);
}

async function readSubscriptions(path) {
  if (!(await exists(path))) return { records: [], currency: 'USD', currencies: [], total: 0, byMonth: [], byService: [] };
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const records = Array.isArray(parsed.records) ? parsed.records : [];
  const currencies = [...new Set(records.map((record) => String(record.currency || '').trim().toUpperCase()).filter(Boolean))];
  const currency = currencies.length === 1 ? currencies[0] : (currencies[0] || 'USD');
  const byMonthMap = new Map();
  const byServiceMap = new Map();
  for (const record of records) {
    const amount = Number(record.amount) || 0;
    byMonthMap.set(record.month, (byMonthMap.get(record.month) || 0) + amount);
    byServiceMap.set(record.service, (byServiceMap.get(record.service) || 0) + amount);
  }
  return {
    records,
    currency,
    currencies,
    total: round(records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
    byMonth: [...byMonthMap.entries()].map(([month, amount]) => ({ month, amount: round(amount) })).sort((a, b) => a.month.localeCompare(b.month)),
    byService: [...byServiceMap.entries()].map(([service, amount]) => ({ service, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

async function findWorkspaceRoot(start) { let current = resolve(start); while (true) { if (await exists(join(current, 'AGENTS.md'))) return current; const parent = dirname(current); if (parent === current) return resolve(start); current = parent; } }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: WORKSPACE_ROOT, outputDir: OUTPUT_DIR, basePath: BASE_PATH });
  createServer(async (req, res) => { const handled = await handler(req, res); if (!handled && !res.writableEnded) sendJson(res, 404, { error: 'Not found' }); }).listen(PORT, () => {
    console.log(`Tokens / Cost Analyzer for ${basename(WORKSPACE_ROOT)}: http://localhost:${PORT}${BASE_PATH || '/'}`);
  });
}
