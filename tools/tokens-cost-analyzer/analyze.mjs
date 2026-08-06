#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { atomicWrite } from './atomic-write.mjs';
import { modelLabelFromParts, openCodeMessageModelParts, parseOpenCodeModel } from '../shared-web/model-normalization.mjs';
import { openCodeTokenValues, openCodeTotalTokens } from '../shared-web/opencode-usage.mjs';

const execFileAsync = promisify(execFile);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', (error) => {
    console.error(`Error: ${safeError(error)}`);
    console.error('Run with --help for usage.');
    process.exit(1);
  });
}
const args = parseArgs(process.argv.slice(2));
const workspaceRoot = resolve(args.workspace || process.env.WORKSPACE_ROOT || process.cwd());
const outDir = resolve(args.out || join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer'));
const piRoot = resolve(args.piRoot || process.env.PI_SESSION_ROOT || join(homedir(), '.pi', 'agent', 'sessions'));
const opencodeDb = resolve(args.opencodeDb || process.env.OPENCODE_DB || join(homedir(), '.local', 'share', 'opencode', 'opencode.db'));
const codexRoot = resolve(args.codexRoot || process.env.CODEX_SESSION_ROOT || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'));
const claudeRoot = resolve(args.claudeRoot || process.env.CLAUDE_PROJECTS_ROOT || join(process.env.CLAUDE_HOME || join(homedir(), '.claude'), 'projects'));
const pricingPath = resolve(args.pricing || join(outDir, 'pricing.json'));
const bundledPricingPath = fileURLToPath(new URL('./data/pi-pricing.json', import.meta.url));
const limit = parseLimit(args.limit);
const analysis = { mode: limit == null ? 'full-history' : 'limited', limit, limitScope: 'recent sessions/files per source' };

const pricing = await loadPricing(pricingPath, bundledPricingPath);
const records = [];
const warnings = [];

if (sourceRequested(args.source, 'pi')) {
  try { records.push(...await readPiRecords({ piRoot, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'pi', warning: safeError(error) }); }
}
if (sourceRequested(args.source, 'opencode')) {
  try { records.push(...await readOpenCodeRecords({ opencodeDb, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'opencode', warning: safeError(error) }); }
}
if (sourceRequested(args.source, 'codex')) {
  try { records.push(...await readCodexRecords({ codexRoot, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'codex', warning: safeError(error) }); }
}
if (sourceRequested(args.source, 'claude-code')) {
  try { records.push(...await readClaudeCodeRecords({ claudeRoot, workspaceRoot, pricing, limit })); }
  catch (error) { warnings.push({ source: 'claude-code', warning: safeError(error) }); }
}

records.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
const generatedAt = new Date().toISOString();
const daily = dailyUsage(records);
await mkdir(outDir, { recursive: true });
await atomicWrite(join(outDir, 'normalized.json'), JSON.stringify({ generatedAt, workspaceRoot, analysis, pricingPath, pricingSources: pricing.pricingSources || [], warnings, records }, null, 2));
await atomicWrite(join(outDir, 'daily.json'), JSON.stringify({ generatedAt, workspaceRoot, analysis, daily }, null, 2));
console.log(`Wrote ${records.length} records to ${outDir}`);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') help();
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    opts[key] = value;
    i += 1;
  }
  return opts;
}

function help() {
  console.log(`Usage: node analyze.mjs [--workspace PATH] [--out DIR] [--pricing FILE] [--source pi|opencode|codex|claude-code] [--limit N|all]\n\nOutputs normalized.json and daily.json. Defaults write to .tools-config/tokens-cost-analyzer/. By default all in-scope sessions/files are analyzed; use --limit for a bounded recent sessions/files slice per source, not a record/message limit.`);
  process.exit(0);
}

function sourceRequested(requested, source) {
  return !requested || requested === source;
}

function parseLimit(value) {
  if (value == null || value === '' || String(value).toLowerCase() === 'all') return null;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer or all');
  return limit;
}

function applyRecentLimit(items, limit) {
  return limit == null ? items : items.slice(-limit);
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
  const files = applyRecentLimit((await piSessionFilesInScope(piRoot, workspaceRoot)).sort((a, b) => a.localeCompare(b)), limit);
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
  const limitClause = limit == null ? '' : ` limit ${limit}`;
  const sql = `select id,directory,path,time_created,model,cost,tokens_input,tokens_output,tokens_cache_read,tokens_cache_write from session where directory=${sqlString(workspaceRoot)} or directory like ${sqlString(rootPrefix)} or path=${sqlString(workspaceRoot)} or path like ${sqlString(rootPrefix)} order by time_updated desc${limitClause}`;
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
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const latestUserBySession = new Map();
  const records = [];
  for (const batch of chunks(sessions.map((session) => session.id), 250)) {
    const sql = `select session_id as sessionId,id,time_created,json_extract(data,'$.role') as role,json_extract(data,'$.tokens') as tokens,json_extract(data,'$.cost') as cost,json_extract(data,'$.providerID') as providerID,json_extract(data,'$.modelID') as modelID,json_extract(data,'$.model') as model,json_extract(data,'$.variant') as variant,json_extract(data,'$.time.created') as dataTimeCreated from message where session_id in (${batch.map(sqlString).join(',')}) and json_extract(data,'$.role') in ('user','assistant') order by session_id,time_created,id`;
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', opencodeDb, sql], { maxBuffer: 50 * 1024 * 1024 });
    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    for (const row of rows) {
      const data = {
        role: row.role,
        tokens: parseJson(row.tokens),
        cost: row.cost,
        providerID: row.providerID,
        modelID: row.modelID,
        model: row.model,
        variant: row.variant,
        time: { created: row.dataTimeCreated },
      };
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
        tokens: openCodeRecordTokens(tokens),
        sourceTotalTokens: openCodeTotalTokens(tokens),
        recordedCost: Number(data.cost) > 0 ? Number(data.cost) : null,
        rawFieldRefs: {
          model: 'message.data.{providerID,modelID,variant}',
          tokens: 'message.data.tokens.{input,output,reasoning,cache.read,cache.write,total}',
          cost: 'message.data.cost',
        },
        calculationMethod: 'OpenCode assistant-message token usage is recorded per response; its explicit tokens.total is authoritative and covers reasoning tokens, falling back to the component sum (reasoning included) when absent. Session aggregate rows are used only when message-level usage is unavailable. Cost is priced from input/output/cache components only.',
        pricing,
      }));
    }
  }
  return records;
}

// `reasoning` is only reported when OpenCode recorded it, so records without it keep
// the four-component shape every other source uses.
function openCodeRecordTokens(tokens) {
  const values = openCodeTokenValues(tokens);
  return {
    input: values.input,
    output: values.output,
    ...(values.reasoning == null ? {} : { reasoning: values.reasoning }),
    cacheRead: values.cacheRead,
    cacheWrite: values.cacheWrite,
  };
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

async function readCodexRecords({ codexRoot, workspaceRoot, pricing, limit }) {
  const files = applyRecentLimit((await walkJsonlFiles(codexRoot)).sort((a, b) => a.localeCompare(b)), limit);
  const records = [];
  for (const sessionPath of files) {
    const lines = (await readFile(sessionPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    let sessionMeta = {};
    let latestCwd = '';
    let latestModel = null;
    let latestUserMessageId = null;
    const sessionId = codexSessionIdFromFile(sessionPath);
    for (let index = 0; index < lines.length; index += 1) {
      const entry = JSON.parse(lines[index]);
      const payload = entry.payload || {};
      if (entry.type === 'session_meta') {
        sessionMeta = payload;
        latestCwd = payload.cwd || latestCwd;
        continue;
      }
      if (entry.type === 'turn_context') {
        latestCwd = payload.cwd || latestCwd;
        latestModel = payload.model || latestModel;
        continue;
      }
      if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
        latestUserMessageId = payload.id || `codex-entry-${index}`;
        continue;
      }
      if (entry.type !== 'event_msg' || payload.type !== 'token_count') continue;
      if (!isUnderRoot(latestCwd || sessionMeta.cwd, workspaceRoot)) continue;
      const rawUsage = payload.info?.last_token_usage || {};
      if (!hasCodexTokenUsage(rawUsage)) continue;
      const usage = normalizeCodexTokenUsage(rawUsage);
      records.push(buildRecord({
        source: 'codex',
        sessionId: sessionMeta.session_id || sessionMeta.id || sessionId,
        messageId: `token-count-${index}`,
        sessionRef: redactHome(sessionPath),
        sessionBrowserPath: codexRef(sessionMeta.session_id || sessionMeta.id || sessionId),
        sessionTopicId: latestUserMessageId,
        timestamp: entry.timestamp || payload.timestamp || sessionMeta.timestamp,
        provider: sessionMeta.model_provider || null,
        model: latestModel,
        variant: null,
        modelLabel: latestModel || null,
        tokens: usage.tokens,
        recordedCost: null,
        rawFieldRefs: {
          model: 'turn_context.model',
          provider: 'session_meta.model_provider',
          tokens: 'event_msg.token_count.info.last_token_usage.{input_tokens,cached_input_tokens,output_tokens,total_tokens}',
          cost: 'not recorded in observed Codex rollout token_count events',
        },
        calculationMethod: 'Codex token_count events expose cumulative and last-turn usage; analyzer records use last_token_usage only and split cached_input_tokens out of input_tokens to avoid double counting.',
        omittedTokenWarnings: ['cacheWrite'],
        pricing,
      }));
    }
  }
  return records;
}

async function readClaudeCodeRecords({ claudeRoot, workspaceRoot, pricing, limit }) {
  const files = applyRecentLimit((await walkJsonlFiles(claudeRoot)).sort((a, b) => a.localeCompare(b)), limit);
  const records = [];
  for (const sessionPath of files) {
    const lines = (await readFile(sessionPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    const sessionId = claudeCodeSessionId(sessionPath);
    const browserRef = claudeCodeRef(sessionId);
    let latestUserMessageId = null;
    for (let index = 0; index < lines.length; index += 1) {
      let entry;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (entry?.type === 'user' && entry.message) { latestUserMessageId = entry.uuid || latestUserMessageId; continue; }
      if (entry?.type !== 'assistant' || !entry.message) continue;
      if (entry.message.model === '<synthetic>') continue; // local placeholder (e.g. "No response requested."), not a real Anthropic turn
      const usage = entry.message.usage;
      if (!usage) continue;
      if (!isUnderRoot(entry.cwd, workspaceRoot)) continue;
      const model = entry.message.model || null;
      records.push(buildRecord({
        source: 'claude-code',
        sessionId,
        messageId: entry.uuid || `claude-entry-${index}`,
        sessionRef: redactHome(sessionPath),
        sessionBrowserPath: browserRef,
        sessionTopicId: latestUserMessageId,
        timestamp: entry.timestamp,
        provider: 'anthropic',
        model,
        variant: null,
        modelLabel: model,
        tokens: {
          input: knownNumber(usage.input_tokens),
          output: knownNumber(usage.output_tokens),
          cacheRead: knownNumber(usage.cache_read_input_tokens),
          cacheWrite: knownNumber(usage.cache_creation_input_tokens),
        },
        recordedCost: null,
        rawFieldRefs: {
          model: 'message.model',
          provider: 'constant anthropic',
          tokens: 'message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}',
          cost: 'not recorded in Claude Code session JSONL',
        },
        calculationMethod: 'Claude Code assistant messages record per-response Anthropic usage; input_tokens already excludes cached reads, so token fields map directly with no de-duplication. Sub-agent (sidechain) messages are counted under the same source.',
        pricing,
      }));
    }
  }
  return records;
}

function normalizeCodexTokenUsage(usage) {
  const inputTotal = knownNumber(usage.input_tokens);
  const cacheRead = knownNumber(usage.cached_input_tokens);
  const output = knownNumber(usage.output_tokens);
  const input = inputTotal == null ? null : Math.max(0, inputTotal - (cacheRead || 0));
  return {
    tokens: {
      input,
      output,
      cacheRead,
      cacheWrite: null,
    },
  };
}
function hasCodexTokenUsage(usage) {
  return ['input_tokens', 'cached_input_tokens', 'output_tokens'].some((key) => knownNumber(usage[key]) != null);
}

function buildRecord({ source, sessionId, messageId = null, sessionRef, sessionBrowserPath, sessionTopicId = null, timestamp, provider, model, variant, modelLabel, tokens, sourceTotalTokens = null, recordedCost, rawFieldRefs, calculationMethod, omittedTokenWarnings = [], pricing }) {
  const normalizedTokens = normalizeTokens(tokens);
  const displayModel = modelLabel || modelLabelFromParts({ source, provider, model, variant }) || model;
  const price = findPrice(pricing, provider, model, displayModel);
  const estimate = estimateCost(normalizedTokens, price, { omittedTokenWarnings });
  // A source-reported total wins over the component sum; otherwise every recorded
  // component the source provided contributes, reasoning included.
  const totalTokens = sourceTotalTokens != null
    ? { known: true, value: sourceTotalTokens }
    : sumKnown(...Object.values(normalizedTokens));
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

function estimateCost(tokens, price, options = {}) {
  const warnings = [];
  const omittedTokenWarnings = new Set(options.omittedTokenWarnings || []);
  if (!price) return { cost: null, class: 'unknown', warnings: ['unpriced model'] };
  let cost = 0;
  for (const [field, priceField] of [['input', 'input'], ['output', 'output'], ['cacheRead', 'cacheRead'], ['cacheWrite', 'cacheWrite']]) {
    const value = tokens[field].value;
    if (value == null) {
      if (!omittedTokenWarnings.has(field)) warnings.push(`unknown ${field} tokens`);
      continue;
    }
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

function dailyUsage(records) {
  const byDay = new Map();
  for (const record of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) continue;
    const current = byDay.get(record.date) || { date: record.date, tokens: 0, records: 0 };
    current.tokens += Number(record.totalTokens) || 0;
    current.records += 1;
    byDay.set(record.date, current);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
function stripModelVariant(value) { return value ? String(value).replace(/:[^/:]+$/, '') : null; }
function parseJson(value) { if (value && typeof value === 'object') return value; try { return JSON.parse(value); } catch { return {}; } }
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
async function walkJsonlFiles(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (files.length === 0) throw error;
    return files;
  }
  await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkJsonlFiles(full, files);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
  }));
  return files;
}
function isUnderRoot(candidate, root) {
  if (!candidate) return false;
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
}
function codexRef(sessionId) { return `codex:${sessionId}`; }
function codexSessionIdFromFile(file) { return basename(file, '.jsonl').match(/([0-9a-f]{8}-[0-9a-f-]{27,})/)?.[1] || basename(file, '.jsonl'); }
function claudeCodeRef(id) { return `claude-code:${id}`; }
function claudeCodeSessionId(file) {
  const inSubagents = basename(dirname(file)) === 'subagents';
  if (inSubagents && basename(file).startsWith('agent-')) return `${basename(dirname(dirname(file)))}/${basename(file, '.jsonl')}`;
  return basename(file, '.jsonl');
}
function encodePiWorkspace(path) { return `-${resolve(path).replace(/\//g, '-')}--`; }
function knownNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function sumKnown(...values) { const known = values.filter((v) => v.value != null); return { known: known.length > 0, value: known.reduce((s, v) => s + v.value, 0) }; }
function isoFromMs(value) { return Number.isFinite(Number(value)) ? new Date(Number(value)).toISOString() : null; }
function sqlString(value) { return `'${String(value ?? '').replace(/'/g, "''")}'`; }
function safeError(error) { return String(error?.message || error).split('\n')[0].slice(0, 220); }
function redactHome(path) { return String(path).replace(homedir(), '~'); }
