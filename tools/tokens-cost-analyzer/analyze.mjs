#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { modelLabelFromParts, openCodeMessageModelParts, parseOpenCodeModel } from '../shared-web/model-normalization.mjs';

const execFileAsync = promisify(execFile);
const args = parseArgs(process.argv.slice(2));
const workspaceRoot = resolve(args.workspace || process.env.WORKSPACE_ROOT || process.cwd());
const outDir = resolve(args.out || join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer'));
const piRoot = resolve(args.piRoot || process.env.PI_SESSION_ROOT || join(homedir(), '.pi', 'agent', 'sessions'));
const opencodeDb = resolve(args.opencodeDb || process.env.OPENCODE_DB || join(homedir(), '.local', 'share', 'opencode', 'opencode.db'));
const pricingPath = resolve(args.pricing || join(outDir, 'pricing.json'));
const bundledPricingPath = fileURLToPath(new URL('./data/pi-pricing.json', import.meta.url));
const limit = Number(args.limit || 200);

const pricing = await loadPricing(pricingPath, bundledPricingPath);
const records = [];
const warnings = [];

if (args.source !== 'opencode') {
  try { records.push(...await readPiRecords({ piRoot, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'pi', warning: safeError(error) }); }
}
if (args.source !== 'pi') {
  try { records.push(...await readOpenCodeRecords({ opencodeDb, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'opencode', warning: safeError(error) }); }
}

records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'normalized.json'), JSON.stringify({ generatedAt: new Date().toISOString(), workspaceRoot, pricingPath, pricingSources: pricing.pricingSources || [], warnings, records }, null, 2));
await writeFile(join(outDir, 'report.md'), renderReport(records, warnings));
console.log(`Wrote ${records.length} records to ${outDir}`);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') help();
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    opts[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return opts;
}

function help() {
  console.log(`Usage: node analyze.mjs [--workspace PATH] [--out DIR] [--pricing FILE] [--source pi|opencode] [--limit N]\n\nOutputs normalized.json and report.md. Defaults write to .tools-config/tokens-cost-analyzer/.`);
  process.exit(0);
}

async function loadPricing(path, bundledPath) {
  const bundled = JSON.parse(await readFile(bundledPath, 'utf8'));
  const bundledModels = (bundled.models || []).map((model) => ({ ...model, source: 'bundled-pi-derived' }));
  if (!existsSync(path)) return { ...bundled, models: bundledModels, pricingSources: [{ path: bundledPath, role: 'bundled-pi-derived' }] };
  const local = JSON.parse(await readFile(path, 'utf8'));
  const localModels = (local.models || []).map((model) => ({ ...model, source: 'local-override' }));
  return {
    ...bundled,
    ...local,
    models: [...localModels, ...bundledModels],
    pricingSources: [
      { path, role: 'local-override' },
      { path: bundledPath, role: 'bundled-pi-derived' },
    ],
  };
}

async function readPiRecords({ piRoot, workspaceRoot, pricing, limit }) {
  const files = (await piSessionFilesInScope(piRoot, workspaceRoot)).sort((a, b) => a.localeCompare(b)).slice(-(Number(limit) || 200));
  const records = [];
  for (const sessionPath of files) {
    const file = basename(sessionPath);
    const lines = (await readFile(sessionPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    const modelState = { source: 'pi', provider: '', model: '', variant: '' };
    let latestUserMessageId = null;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry?.type === 'message' && entry.message?.role === 'user') latestUserMessageId = entry.id || latestUserMessageId;
      if (entry?.type === 'model_change') {
        modelState.provider = entry.provider || '';
        modelState.model = entry.modelId || entry.model || '';
      } else if (entry?.type === 'thinking_level_change') {
        modelState.variant = entry.thinkingLevel || '';
      }
      const message = entry.message;
      const usage = message?.usage;
      if (!usage) continue;
      const model = message.model || modelState.model || entry.modelId || null;
      const provider = message.provider || modelState.provider || entry.provider || null;
      const variant = modelState.variant || null;
      records.push(buildRecord({
        source: 'pi',
        sessionId: basename(file, '.jsonl'),
        sessionRef: redactHome(sessionPath),
        sessionBrowserPath: sessionPath,
        sessionTopicId: latestUserMessageId,
        timestamp: entry.timestamp || isoFromMs(message.timestamp),
        provider,
        model,
        variant,
        modelLabel: modelLabelFromParts({ source: 'pi', provider, model, variant }) || null,
        tokens: {
          input: knownNumber(usage.input),
          output: knownNumber(usage.output),
          cacheRead: knownNumber(usage.cacheRead),
          cacheWrite: knownNumber(usage.cacheWrite),
        },
        recordedCost: knownNumber(usage.cost?.total),
        rawFieldRefs: {
          model: 'message.model or session model_change/thinking_level_change state',
          provider: 'message.provider',
          tokens: 'message.usage.{input,output,cacheRead,cacheWrite,totalTokens}',
          cost: 'message.usage.cost.total',
        },
        calculationMethod: 'Pi assistant message usage is recorded per response; total is source-derived from recorded token fields when present.',
        pricing,
      }));
    }
  }
  return records;
}

async function readOpenCodeRecords({ opencodeDb, workspaceRoot, pricing, limit }) {
  const rootPrefix = `${workspaceRoot.replace(/\/+$/, '')}/%`;
  const sql = `select id,directory,path,time_created,model,cost,tokens_input,tokens_output,tokens_cache_read,tokens_cache_write from session where directory=${sqlString(workspaceRoot)} or directory like ${sqlString(rootPrefix)} or path=${sqlString(workspaceRoot)} or path like ${sqlString(rootPrefix)} order by time_updated desc limit ${Number(limit) || 200}`;
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', opencodeDb, sql], { maxBuffer: 20 * 1024 * 1024 });
  const sessions = stdout.trim() ? JSON.parse(stdout) : [];
  if (!sessions.length) return [];
  const messageRecords = await readOpenCodeMessageRecords(opencodeDb, sessions, pricing);
  const sessionsWithMessages = new Set(messageRecords.map((record) => record.sessionId));
  const fallbackRecords = sessions
    .filter((session) => !sessionsWithMessages.has(session.id) && hasOpenCodeAggregateUsageEvidence(session))
    .map((session) => openCodeSessionRecord(session, pricing));
  return [...messageRecords, ...fallbackRecords];
}

function hasOpenCodeAggregateUsageEvidence(session) {
  return [session.tokens_input, session.tokens_output, session.tokens_cache_read, session.tokens_cache_write].some((value) => Number(value) > 0) || Number(session.cost) > 0;
}

async function readOpenCodeMessageRecords(opencodeDb, sessions, pricing) {
  const sessionIds = sessions.map((session) => session.id);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const sql = `select session_id as sessionId,id,time_created,data from message where session_id in (${sessionIds.map(sqlString).join(',')}) and json_extract(data,'$.role') in ('user','assistant') order by session_id,time_created,id`;
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', opencodeDb, sql], { maxBuffer: 50 * 1024 * 1024 });
  const rows = stdout.trim() ? JSON.parse(stdout) : [];
  const latestUserBySession = new Map();
  const records = [];
  for (const row of rows) {
    const data = parseJson(row.data);
    if (data.role === 'user') {
      latestUserBySession.set(row.sessionId, row.id);
      continue;
    }
    const tokens = data.tokens || {};
    if (!tokens || Object.keys(tokens).length === 0) continue;
    const modelParts = openCodeMessageModelParts({ data });
    const session = sessionById.get(row.sessionId) || {};
    records.push(buildRecord({
      source: 'opencode',
      sessionId: row.sessionId,
      messageId: row.id,
      sessionRef: `opencode.db:message/${row.id}`,
      sessionBrowserPath: `opencode:${row.sessionId}`,
      sessionTopicId: latestUserBySession.get(row.sessionId) || null,
      timestamp: isoFromMs(row.time_created || data.time?.created || session.time_created),
      provider: modelParts.provider || null,
      model: modelParts.model || null,
      variant: modelParts.variant || null,
      modelLabel: modelLabelFromParts(modelParts) || null,
      tokens: {
        input: knownNumber(tokens.input ?? tokens.prompt),
        output: knownNumber(tokens.output ?? tokens.completion),
        cacheRead: knownNumber(tokens.cacheRead ?? tokens.cache_read ?? tokens.cache?.read),
        cacheWrite: knownNumber(tokens.cacheWrite ?? tokens.cache_write ?? tokens.cache?.write),
      },
      recordedCost: Number(data.cost) > 0 ? Number(data.cost) : null,
      rawFieldRefs: {
        model: 'message.data.{providerID,modelID,variant}',
        tokens: 'message.data.tokens.{input,output,cache.read,cache.write}',
        cost: 'message.data.cost',
      },
      calculationMethod: 'OpenCode assistant-message token usage is recorded per response; session aggregate rows are used only when message-level usage is unavailable.',
      pricing,
    }));
  }
  return records;
}

function openCodeSessionRecord(row, pricing) {
  const sourceModel = parseOpenCodeModel(row.model) || null;
  return buildRecord({
    source: 'opencode',
    sessionId: row.id,
    sessionRef: `opencode.db:session/${row.id}`,
    sessionBrowserPath: `opencode:${row.id}`,
    timestamp: isoFromMs(row.time_created),
    provider: sourceModel?.provider || null,
    model: sourceModel?.model || null,
    variant: sourceModel?.variant || null,
    modelLabel: modelLabelFromParts(sourceModel || {}) || null,
    tokens: {
      input: knownNumber(row.tokens_input),
      output: knownNumber(row.tokens_output),
      cacheRead: knownNumber(row.tokens_cache_read),
      cacheWrite: knownNumber(row.tokens_cache_write),
    },
    recordedCost: Number(row.cost) > 0 ? Number(row.cost) : null,
    rawFieldRefs: {
      model: 'session.model',
      tokens: 'session.tokens_input/tokens_output/tokens_cache_read/tokens_cache_write',
      cost: 'session.cost',
    },
    calculationMethod: 'OpenCode session table aggregate fallback used because message-level usage was unavailable.',
    pricing,
  });
}

function buildRecord({ source, sessionId, messageId = null, sessionRef, sessionBrowserPath, sessionTopicId = null, timestamp, provider, model, variant, modelLabel, tokens, recordedCost, rawFieldRefs, calculationMethod, pricing }) {
  const normalizedTokens = normalizeTokens(tokens);
  const displayModel = modelLabel || modelLabelFromParts({ source, provider, model, variant }) || model;
  const price = findPrice(pricing, provider, model, displayModel);
  const estimate = estimateCost(normalizedTokens, price);
  const totalTokens = sumKnown(normalizedTokens.input, normalizedTokens.output, normalizedTokens.cacheRead, normalizedTokens.cacheWrite);
  return {
    source,
    sessionId,
    messageId,
    sessionRef,
    sessionBrowserPath: sessionBrowserPath || null,
    sessionTopicId: sessionTopicId || null,
    timestamp,
    date: String(timestamp || '').slice(0, 10) || null,
    provider,
    model,
    variant: variant || null,
    modelLabel: displayModel || null,
    modelAlias: price?.alias || displayModel || model || null,
    tokens: normalizedTokens,
    totalTokens: totalTokens.value,
    totalTokensClass: totalTokens.known ? 'source-derived' : 'unknown',
    recordedCost: recordedCost ?? null,
    recordedCostClass: recordedCost == null ? 'unknown' : 'recorded',
    estimatedCost: estimate.cost,
    estimatedCostClass: estimate.class,
    confidence: confidence(recordedCost, estimate, normalizedTokens),
    provenance: { rawFieldRefs, calculationMethod, pricing: price ? { source: price.source || 'pricing-table', effectiveDate: price.effectiveDate, notes: price.notes || null } : null },
    warnings: estimate.warnings,
  };
}

function normalizeTokens(tokens) {
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, { value: value ?? null, class: value == null ? 'unknown' : 'recorded' }]));
}

function estimateCost(tokens, price) {
  const warnings = [];
  if (!price) return { cost: null, class: 'unknown', warnings: ['unpriced model'] };
  let cost = 0;
  for (const [field, priceField] of [['input', 'input'], ['output', 'output'], ['cacheRead', 'cacheRead'], ['cacheWrite', 'cacheWrite']]) {
    const value = tokens[field].value;
    if (value == null) { warnings.push(`unknown ${field} tokens`); continue; }
    if (price[priceField] == null) { if (value > 0) warnings.push(`unpriced ${field} tokens`); continue; }
    cost += (value / 1_000_000) * Number(price[priceField]);
  }
  return { cost: Number(cost.toFixed(6)), class: warnings.length ? 'estimated-partial' : 'estimated', warnings };
}

function findPrice(pricing, provider, model, modelLabel = null) {
  if (!model && !modelLabel) return null;
  const wanted = [model, modelLabel, stripModelVariant(model), stripModelVariant(modelLabel)].filter(Boolean).map((value) => String(value).toLowerCase());
  const providerWanted = String(provider || '').toLowerCase();
  for (const item of pricing.models || []) {
    const names = [item.model, ...(item.aliases || [])].filter(Boolean).map((v) => String(v).toLowerCase());
    const providerMatch = !item.provider || !providerWanted || String(item.provider).toLowerCase() === providerWanted;
    if ((providerMatch || wanted.some((value) => names.includes(value))) && wanted.some((value) => names.includes(value))) return { ...item, alias: item.model };
  }
  return null;
}

function confidence(recordedCost, estimate, tokens) {
  if (recordedCost != null) return 'high-recorded-cost';
  if (estimate.class === 'estimated' && Object.values(tokens).every((t) => t.value != null)) return 'medium-estimated-complete-tokens';
  if (estimate.cost != null) return 'low-estimated-partial';
  return 'unknown';
}

function renderReport(records, warnings) {
  const totalTokens = records.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
  const recordedCost = records.reduce((sum, r) => sum + (r.recordedCost || 0), 0);
  const estimatedCost = records.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
  const unknownCost = records.filter((r) => r.estimatedCost == null && r.recordedCost == null).length;
  const recordWarnings = warningSummary(records);
  return [`# Tokens / Cost Analyzer Report`, '', `Generated: ${new Date().toISOString()}`, '', '## Summary', '', `- Records: ${records.length}`, `- Source-derived total tokens: ${totalTokens}`, `- Recorded native cost total: ${money(recordedCost)}`, `- Estimated cost total: ${money(estimatedCost)}`, `- Records with unknown/unpriced cost: ${unknownCost}`, '', '## Warnings', '', ...(warnings.length ? warnings.map((w) => `- ${w.source}: ${w.warning}`) : []), ...(recordWarnings.length ? recordWarnings.map((w) => `- ${w}`) : []), ...(!warnings.length && !recordWarnings.length ? ['- None'] : []), '', '## By Model', '', table(groupBy(records, (r) => r.modelLabel || r.model || 'unknown-model')), '', '## By Day', '', table(groupBy(records, (r) => r.date || 'unknown-date')), '', '## Top Drivers — Sessions', '', ...sessionDrivers(records).slice(0, 10).map((r) => `- ${r.date || 'unknown'} ${r.source} ${r.modelLabel || r.model || 'unknown-model'} records=${r.recordCount} tokens=${r.totalTokens ?? 'unknown'} recorded=${money(r.recordedCost)} estimated=${money(r.estimatedCost)} confidence=${r.confidence}${sessionBrowserMarkdownLink(r)}`), '', '## Top Drivers — Prompts / Messages', '', ...records.slice().sort(compareTopDrivers).slice(0, 10).map((r) => `- ${r.date || 'unknown'} ${r.source} ${r.modelLabel || r.model || 'unknown-model'} tokens=${r.totalTokens ?? 'unknown'} recorded=${money(r.recordedCost)} estimated=${money(r.estimatedCost)} confidence=${r.confidence}${sessionBrowserMarkdownLink(r)}`), '', 'Costs are estimates unless marked recorded in `normalized.json`. Missing values are unknown, not zero.', ''].join('\n');
}

function warningSummary(records) {
  const counts = new Map();
  for (const record of records) {
    if (record.recordedCost == null && record.estimatedCost == null) counts.set('unknown/unpriced cost records', (counts.get('unknown/unpriced cost records') || 0) + 1);
    if (!record.model) counts.set('unknown model records', (counts.get('unknown model records') || 0) + 1);
    for (const warning of record.warnings || []) counts.set(warning, (counts.get(warning) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${label}: ${count}`);
}

function sessionBrowserMarkdownLink(record) {
  if (!record.sessionBrowserPath) return '';
  const params = new URLSearchParams({ selectSession: record.sessionBrowserPath });
  if (record.sessionTopicId) params.set('selectTopic', record.sessionTopicId);
  return ` [Session Browser](../session-browser/?${params.toString()})`;
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

function groupBy(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    const key = keyFn(record);
    const current = groups.get(key) || { key, records: 0, tokens: 0, recorded: 0, estimated: 0, unknown: 0 };
    current.records += 1;
    current.tokens += record.totalTokens || 0;
    current.recorded += record.recordedCost || 0;
    current.estimated += record.estimatedCost || 0;
    if (record.estimatedCost == null && record.recordedCost == null) current.unknown += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 20);
}

function table(rows) {
  const lines = ['| Bucket | Records | Tokens | Recorded Cost | Estimated Cost | Unknown/Unpriced |', '|---|---:|---:|---:|---:|---:|'];
  for (const row of rows) lines.push(`| ${escapeCell(row.key)} | ${row.records} | ${row.tokens} | ${money(row.recorded)} | ${money(row.estimated)} | ${row.unknown} |`);
  return lines.join('\n');
}

function stripModelVariant(value) { return value ? String(value).replace(/:[^/:]+$/, '') : null; }
function parseJson(value) { try { return JSON.parse(value); } catch { return {}; } }
async function piSessionFilesInScope(piRoot, workspaceRoot) {
  const exact = encodePiWorkspace(workspaceRoot);
  const prefix = exact.slice(0, -2);
  const dirs = (await readdir(piRoot)).filter((name) => name === exact || name.startsWith(`${prefix}-`));
  const files = [];
  for (const dir of dirs) {
    for (const file of (await readdir(join(piRoot, dir))).filter((name) => name.endsWith('.jsonl'))) files.push(join(piRoot, dir, file));
  }
  return files;
}
function encodePiWorkspace(path) { return `-${resolve(path).replace(/\//g, '-')}--`; }
function knownNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function sumKnown(...values) { const known = values.filter((v) => v.value != null); return { known: known.length > 0, value: known.reduce((s, v) => s + v.value, 0) }; }
function isoFromMs(value) { return Number.isFinite(Number(value)) ? new Date(Number(value)).toISOString() : null; }
function sqlString(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
function safeError(error) { return String(error?.message || error).split('\n')[0].slice(0, 220); }
function money(value) { return value == null ? 'unknown' : `$${Number(value).toFixed(6)}`; }
function escapeCell(value) { return String(value).replace(/\|/g, '\\|'); }
function redactHome(path) { return String(path).replace(homedir(), '~'); }
