import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';

const execFileAsync = promisify(execFile);
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const PORT = Number(process.env.TOKENS_COST_ANALYZER_PORT || process.env.PORT || '8790');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const OUTPUT_DIR = resolve(process.env.TOKENS_COST_ANALYZER_OUT || join(WORKSPACE_ROOT, '.tools-config', 'tokens-cost-analyzer'));
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');

export function createTokensCostAnalyzerHandler(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot || WORKSPACE_ROOT);
  const outputDir = resolve(options.outputDir || join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer'));
  const basePath = normalizeBasePath(options.basePath || '');
  const cockpit = options.cockpit || { tools: [] };
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
      if (pathname === '/api/report') { sendJson(res, 200, await loadReport({ workspaceRoot, outputDir, refresh: url.searchParams.get('refresh') === '1' })); return true; }
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

async function loadReport({ workspaceRoot, outputDir, refresh }) {
  const normalizedPath = join(outputDir, 'normalized.json');
  if (refresh || !(await exists(normalizedPath))) {
    await execFileAsync(process.execPath, [join(TOOL_DIR, 'analyze.mjs'), '--workspace', workspaceRoot, '--out', outputDir], { maxBuffer: 1024 * 1024 * 20 });
  }
  const normalized = JSON.parse(await readFile(normalizedPath, 'utf8'));
  const subscriptions = await readSubscriptions(join(outputDir, 'subscriptions.json'));
  return summarize(normalized, subscriptions);
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

function summarize(normalized, subscriptions) {
  const records = normalized.records || [];
  const byMonth = group(records, (r) => (r.date || 'unknown').slice(0, 7));
  const monthly = [...byMonth.entries()].map(([month, rows]) => {
    const tokens = sum(rows, 'totalTokens');
    const recorded = sum(rows, 'recordedCost');
    const estimated = sum(rows, 'estimatedCost');
    const subscription = subscriptions.byMonth.find((m) => m.month === month)?.amount || 0;
    return { month, tokens, recordedCost: round(recorded), estimatedCost: round(estimated), subscriptionCost: subscription, effectiveSubscriptionPer1M: tokens ? round(subscription / (tokens / 1_000_000)) : null };
  }).sort((a, b) => a.month.localeCompare(b.month));
  return {
    generatedAt: normalized.generatedAt,
    workspaceRoot: normalized.workspaceRoot,
    totals: {
      records: records.length,
      tokens: sum(records, 'totalTokens'),
      recordedCost: round(sum(records, 'recordedCost')),
      estimatedCost: round(sum(records, 'estimatedCost')),
      unknownCostRecords: records.filter((r) => r.recordedCost == null && r.estimatedCost == null).length,
      subscriptionCost: subscriptions.total,
    },
    warnings: warnings(normalized.warnings || [], records, subscriptions),
    byModel: rows(group(records, (r) => r.modelLabel || r.model || 'unknown-model')),
    bySource: rows(group(records, (r) => r.source || 'unknown-source')),
    monthly,
    subscriptions,
    topDrivers: sessionDrivers(records).slice(0, 12),
    topMessageDrivers: records.slice().sort(compareTopDrivers).slice(0, 12),
    trustIssues: trustIssues(records).slice(0, 50),
  };
}

function trustIssues(records) {
  return records
    .filter((record) => record.recordedCost == null && record.estimatedCost == null || (record.warnings || []).length)
    .sort(compareTopDrivers)
    .map((record) => ({
      source: record.source,
      date: record.date,
      sessionId: record.sessionId,
      messageId: record.messageId,
      sessionRef: record.sessionRef,
      sessionBrowserPath: record.sessionBrowserPath,
      sessionTopicId: record.sessionTopicId,
      provider: record.provider,
      model: record.model,
      variant: record.variant,
      modelLabel: record.modelLabel,
      totalTokens: record.totalTokens,
      recordedCost: record.recordedCost,
      estimatedCost: record.estimatedCost,
      confidence: record.confidence,
      warnings: issueReasons(record),
    }));
}

function issueReasons(record) {
  const reasons = [...(record.warnings || [])];
  if (record.recordedCost == null && record.estimatedCost == null && !reasons.includes('unknown/unpriced cost')) reasons.push('unknown/unpriced cost');
  return reasons;
}

function topDriverCost(record) { return Math.max(Number(record.recordedCost) || 0, Number(record.estimatedCost) || 0); }
function compareTopDrivers(a, b) { return topDriverCost(b) - topDriverCost(a) || (Number(b.totalTokens) || 0) - (Number(a.totalTokens) || 0); }
function sessionDrivers(records) {
  const bySession = new Map();
  for (const record of records) {
    const key = `${record.source || 'unknown'}:${record.sessionId || record.sessionRef || 'unknown'}`;
    const current = bySession.get(key) || { source: record.source, sessionId: record.sessionId, sessionRef: record.sessionRef, sessionBrowserPath: record.sessionBrowserPath, date: record.date, model: record.model, modelLabel: record.modelLabel, totalTokens: 0, recordedCost: 0, estimatedCost: 0, recordCount: 0, confidence: record.confidence };
    current.totalTokens += Number(record.totalTokens) || 0;
    current.recordedCost += Number(record.recordedCost) || 0;
    current.estimatedCost += Number(record.estimatedCost) || 0;
    current.recordCount += 1;
    current.date = [current.date, record.date].filter(Boolean).sort()[0] || null;
    current.modelLabel ||= record.modelLabel;
    current.model ||= record.model;
    if (current.confidence === 'unknown' && record.confidence) current.confidence = record.confidence;
    bySession.set(key, current);
  }
  return [...bySession.values()]
    .map((driver) => ({ ...driver, recordedCost: driver.recordedCost || null, estimatedCost: driver.estimatedCost || null }))
    .sort(compareTopDrivers);
}

function rows(map) { return [...map.entries()].map(([key, records]) => ({ key, records: records.length, tokens: sum(records, 'totalTokens'), recordedCost: round(sum(records, 'recordedCost')), estimatedCost: round(sum(records, 'estimatedCost')), unknown: records.filter((r) => r.recordedCost == null && r.estimatedCost == null).length })).sort((a, b) => b.tokens - a.tokens); }
function warnings(adapterWarnings, records, subscriptions) {
  const result = adapterWarnings.map((w) => `${w.source}: ${w.warning}`);
  const unknown = records.filter((r) => r.recordedCost == null && r.estimatedCost == null).length;
  if (unknown) result.push(`${unknown} records have unknown/unpriced cost`);
  const unpriced = records.filter((r) => (r.warnings || []).includes('unpriced model')).length;
  if (unpriced) result.push(`${unpriced} records use unpriced models`);
  const currencies = subscriptions?.currencies || [];
  if (currencies.length > 1) result.push(`Subscription records use multiple currencies (${currencies.join(', ')}); token estimates are USD pricing-table estimates, so subscription totals are not directly comparable until records are normalized manually.`);
  else if (currencies.length === 1 && currencies[0] !== 'USD') result.push(`Subscription records are in ${currencies[0]} while token estimates are USD pricing-table estimates; compare trends only, not combined totals, until subscription records are manually converted to USD.`);
  return result;
}
function group(items, keyFn) { const map = new Map(); for (const item of items) { const key = keyFn(item); if (!map.has(key)) map.set(key, []); map.get(key).push(item); } return map; }
function sum(items, field) { return items.reduce((total, item) => total + (Number(item[field]) || 0), 0); }
function round(value) { return Math.round((Number(value) || 0) * 1000000) / 1000000; }
async function findWorkspaceRoot(start) { let current = resolve(start); while (true) { if (await exists(join(current, 'AGENTS.md'))) return current; const parent = dirname(current); if (parent === current) return resolve(start); current = parent; } }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: WORKSPACE_ROOT, outputDir: OUTPUT_DIR, basePath: BASE_PATH });
  createServer(async (req, res) => { const handled = await handler(req, res); if (!handled && !res.writableEnded) sendJson(res, 404, { error: 'Not found' }); }).listen(PORT, () => {
    console.log(`Tokens / Cost Analyzer for ${basename(WORKSPACE_ROOT)}: http://localhost:${PORT}${BASE_PATH || '/'}`);
  });
}
