import { createServer } from 'node:http';
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';
import { modelLabelFromParts, openCodeMessageModelParts, parseOpenCodeModel, piModelState } from '../shared-web/model-normalization.mjs';
import { openCodeSessionUsage, openCodeTokenSql } from '../shared-web/opencode-usage.mjs';
import { codexSessionIdFromFile } from './codex-session.mjs';
import { createImmutableSourceMemo } from './immutable-source-memo.mjs';
import { createSingleFlight, createSummaryCache } from './summary-cache.mjs';
import { loadLegacyMachines, translateCwd } from './legacy-machines.mjs';
import { formatSessionRef, isSourceRef, parseSessionRef, sessionKey } from './session-ref.mjs';
import { emptyMetadata, METADATA_VERSION } from './metadata-schema.mjs';
import { createEffectiveMetadataStore } from './effective-session-metadata.mjs';
import { isUnderRoot } from './workspace-paths.mjs';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = parsePort(process.env.PORT || '8787');
const PI_SESSION_ROOT = resolve(process.env.SESSION_ROOT || process.env.PI_SESSION_ROOT || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions'));
const OPENCODE_DATA_DIR = resolve(process.env.OPENCODE_DATA_DIR || join(homedir(), '.local', 'share', 'opencode'));
const OPENCODE_DB = resolve(process.env.OPENCODE_DB || join(OPENCODE_DATA_DIR, 'opencode.db'));
const CODEX_HOME = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const CODEX_SESSION_ROOT = resolve(process.env.CODEX_SESSION_ROOT || join(CODEX_HOME, 'sessions'));
const CLAUDE_HOME = resolve(process.env.CLAUDE_HOME || join(homedir(), '.claude'));
const CLAUDE_PROJECTS_ROOT = resolve(process.env.CLAUDE_PROJECTS_ROOT || join(CLAUDE_HOME, 'projects'));
const ENABLED_SOURCES = new Set(String(process.env.SESSION_SOURCES || 'pi,opencode,codex,claude-code').split(',').map((source) => source.trim().toLowerCase()).filter(Boolean));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const DEFAULT_WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const DEFAULT_WORKSPACE_NAME = basename(DEFAULT_WORKSPACE_ROOT) || DEFAULT_WORKSPACE_ROOT;
const DEFAULT_METADATA_PATH = resolve(process.env.SESSION_BROWSER_METADATA || join(DEFAULT_WORKSPACE_ROOT, '.tools-config', 'session-browser', 'metadata.json'));
const execFileAsync = promisify(execFile);
const SOURCE_TIMEOUT_MS = Number(process.env.SESSION_SOURCE_TIMEOUT_MS || '8000');
const REQUEST_TIMEOUT_MS = Number(process.env.SESSION_REQUEST_TIMEOUT_MS || '10000');
const OPENCODE_SESSION_LIMIT = parsePositiveInteger(process.env.SESSION_BROWSER_OPENCODE_LIMIT || '500', 'SESSION_BROWSER_OPENCODE_LIMIT');
const PREFERRED_CONTEXT_CEILING = 200_000;

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function safeSourceError(error) {
  const message = safeError(error);
  if (message.includes('sqlite3')) return 'sqlite3 unavailable or OpenCode database cannot be read';
  if (message.includes('ENOENT')) return 'source path cannot be read';
  if (message.includes('no such table')) return 'unexpected OpenCode database schema';
  return message.split('\n')[0].slice(0, 220);
}

function sourceEnabled(source) {
  return ENABLED_SOURCES.has(source);
}

function sourceError(source, error) {
  return { source, error: safeSourceError(error) };
}

async function withTimeout(promise, label, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (await exists(join(current, 'AGENTS.md'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
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
    if (entry.isDirectory()) {
      await walkJsonlFiles(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(full);
    }
  }));
  return files;
}

async function sqliteJson(dbPath, sql) {
  const args = ['-readonly', '-json', dbPath, sql];
  const { stdout } = await execFileAsync('sqlite3', args, { maxBuffer: 50 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlLike(value) {
  return String(value ?? '').replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseJsonl(content) {
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function truncate(text, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function modelKeyFromParts(parts = {}) {
  return modelLabelFromParts(parts);
}

function enrichPiModelEvents(entries) {
  const state = { source: 'pi', provider: '', model: '', variant: '' };
  return entries.map((entry, index) => {
    if (entry?.type === 'model_change') {
      state.provider = entry.provider || '';
      state.model = entry.modelId || entry.model || '';
      if (entries[index + 1]?.type === 'thinking_level_change') return null;
      return { ...entry, modelLabel: modelLabelFromParts(state), rawProvider: entry.provider || '', rawModel: entry.modelId || entry.model || '', variant: state.variant || '' };
    }
    if (entry?.type === 'thinking_level_change') {
      state.variant = entry.thinkingLevel || '';
      return { ...entry, type: 'model_change', modelLabel: modelLabelFromParts(state), rawProvider: state.provider || '', rawModel: state.model || '', variant: state.variant || '', thinkingLevel: state.variant || '' };
    }
    return entry;
  }).filter(Boolean);
}

function latestSessionName(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type === 'session_info' && typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim();
  }
  return undefined;
}

function findNewestLeafId(entries) {
  const nodeEntries = entries.filter((entry) => entry?.id && entry.type !== 'label' && entry.type !== 'session_info' && entry.type !== 'custom');
  if (nodeEntries.length === 0) return entries.find((entry) => entry?.id)?.id || null;

  const childrenByParent = new Map();
  const ids = new Set(nodeEntries.map((entry) => entry.id));
  for (const entry of nodeEntries) {
    const parentId = entry.parentId && ids.has(entry.parentId) && entry.parentId !== entry.id ? entry.parentId : null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(entry);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  }

  let current = childrenByParent.get(null)?.at(-1) || nodeEntries.at(-1);
  while (childrenByParent.get(current.id)?.length) {
    current = childrenByParent.get(current.id).at(-1);
  }
  return current.id;
}

function buildActiveEntries(entries, leafId) {
  const byId = new Map(entries.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  let current = byId.get(leafId || findNewestLeafId(entries));
  const path = [];
  const seen = new Set();
  while (current?.id && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentId || current.parentId === current.id) break;
    current = byId.get(current.parentId);
  }
  return path.length > 0 ? path : entries;
}

function hasAssistantText(message) {
  if (!Array.isArray(message?.content)) return false;
  return message.content.some((block) => block?.type === 'text' && typeof block.text === 'string' && block.text.trim());
}

function emptyUsage() {
  return {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    contextLoad: { latest: null, preferredCeiling: PREFERRED_CONTEXT_CEILING },
  };
}

function emptyListStats() {
  return {
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    assistantRawMessageCount: 0,
    toolMessageCount: 0,
    toolResultCount: 0,
    toolCallCount: 0,
    toolNames: [],
  };
}

function collectStats(entries) {
  const stats = {
    assistantAnswerCount: 0,
    toolMessageCount: 0,
    toolCallCount: 0,
    toolNames: [],
    ...emptyUsage(),
  };
  const toolNames = new Set();
  for (const entry of entries) {
    if (entry?.type !== 'message' || entry.message?.role !== 'assistant') continue;
    if (hasAssistantText(entry.message)) stats.assistantAnswerCount += 1;
    else stats.toolMessageCount += 1;
    const usage = entry.message.usage;
    if (usage) {
      const input = usage.input || 0;
      const output = usage.output || 0;
      const cacheRead = usage.cacheRead || 0;
      const cacheWrite = usage.cacheWrite || 0;
      stats.tokens.input += input;
      stats.tokens.output += output;
      stats.tokens.cacheRead += cacheRead;
      stats.tokens.cacheWrite += cacheWrite;
      const total = usage.totalTokens || usage.total || 0;
      stats.tokens.total += total;
      stats.contextLoad.latest = input + output + cacheRead + cacheWrite;
    }
    if (!Array.isArray(entry.message.content)) continue;
    for (const block of entry.message.content) {
      if (block?.type === 'toolCall') {
        stats.toolCallCount += 1;
        if (block.name) toolNames.add(block.name);
      }
    }
  }
  if (!stats.tokens.total) {
    stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  }
  stats.toolNames = Array.from(toolNames).sort();
  return stats;
}

function summarizeSession(path, fileStat, parsed, { trustFileTimes = true } = {}) {
  const header = parsed.find((entry) => entry?.type === 'session') || null;
  const entries = parsed.filter((entry) => entry?.type !== 'session');
  const leafId = findNewestLeafId(entries);
  const activeEntries = buildActiveEntries(entries, leafId);
  const messageEntries = activeEntries.filter((entry) => entry?.type === 'message');
  const userEntries = messageEntries.filter((entry) => entry.message?.role === 'user');
  const assistantEntries = messageEntries.filter((entry) => entry.message?.role === 'assistant');
  const toolResultEntries = messageEntries.filter((entry) => entry.message?.role === 'toolResult');
  const firstPrompt = truncate(textFromContent(userEntries[0]?.message?.content));
  const entryUpdatedAt = entries.at(-1)?.timestamp;
  const fileUpdatedAt = fileStat.mtime?.toISOString();
  // An archived store was copied from another machine, so its mtimes describe the copy,
  // not the session. Trust the recorded entries and fall back to mtime only without them.
  const updatedAt = trustFileTimes
    ? [entryUpdatedAt, fileUpdatedAt].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0]
    : entryUpdatedAt || fileUpdatedAt;
  let stats = collectStats(activeEntries);
  if (!stats.tokens.total) {
    stats = collectStats(entries);
  }
  const modelState = piModelState(activeEntries);

  return {
    id: header?.id || path.split('/').pop()?.replace(/\.jsonl$/, '') || path,
    source: 'pi',
    path,
    cwd: header?.cwd || '',
    name: latestSessionName(entries),
    firstPrompt,
    createdAt: header?.timestamp || entries[0]?.timestamp || fileStat.birthtime?.toISOString(),
    updatedAt,
    leafId,
    messageCount: messageEntries.length,
    userMessageCount: userEntries.length,
    assistantMessageCount: stats.assistantAnswerCount,
    assistantRawMessageCount: assistantEntries.length,
    toolMessageCount: stats.toolMessageCount,
    toolResultCount: toolResultEntries.length,
    toolCallCount: stats.toolCallCount,
    toolNames: stats.toolNames,
    tokens: stats.tokens,
    contextLoad: stats.contextLoad,
    modelLabel: modelState.label,
    model: modelState,
  };
}

async function loadSessionFile(path, options = {}) {
  const [fileStat, content] = await Promise.all([stat(path), readFile(path, 'utf8')]);
  const parsed = parseJsonl(content);
  const summary = summarizeSession(path, fileStat, parsed, options);
  const entries = parsed.filter((entry) => entry?.type !== 'session');
  const activeEntries = enrichPiModelEvents(buildActiveEntries(entries, summary.leafId));
  const topicAnchors = activeEntries
    .filter((entry) => entry?.type === 'message' && entry.message?.role === 'user')
    .map((entry, index) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      title: truncate(textFromContent(entry.message.content), 80) || `User prompt ${index + 1}`,
      depth: index === 0 ? 'first-prompt' : 'user-prompt',
    }));

  return { ...summary, entries, activeEntries, topicAnchors };
}

const SUMMARY_CACHES = {
  pi: createSummaryCache(),
  codex: createSummaryCache(),
  'claude-code': createSummaryCache(),
};
const singleFlight = createSingleFlight();

function sessionSummary({ entries, activeEntries, topicAnchors, ...summary }) {
  return summary;
}

function encodedClaudeProject(cwd) {
  return cwd.replace(/\//g, '-');
}

function inferClaudeProjectCwd(session, candidates) {
  if (session.source !== 'claude-code' || session.cwd || !session.claudeProjectDirectory) return session;
  const matches = candidates.filter((cwd) => encodedClaudeProject(cwd) === session.claudeProjectDirectory);
  const { claudeProjectDirectory, ...summary } = session;
  return matches.length === 1 ? { ...summary, cwd: matches[0] } : summary;
}

function machineCwdCandidates(ctx, machine) {
  if (!machine) return [ctx.workspaceRoot];
  return [...new Set([
    ...machine.pathMap.map(({ from }) => from),
    ...(ctx.legacyMachineCwdHints?.[machine.id] || []),
  ])];
}

function withLegacyMachine(session, machine) {
  if (!machine) return session;
  const originalCwd = session.cwd || '';
  const cwd = translateCwd(machine, originalCwd);
  const value = session.source === 'pi' ? session.path : session.id;
  return {
    ...session,
    path: formatSessionRef(session.source, value, machine.id),
    cwd,
    originalCwd,
    machineId: machine.id,
    machineLabel: machine.label,
    retiredAt: machine.retiredAt,
    archived: true,
  };
}

async function legacyMachineForRef(ctx, ref) {
  const parsed = parseSessionRef(ref);
  if (!parsed?.machineId) return { parsed, machine: null };
  const { machines } = await ctx.legacyMachines;
  const machine = machines[parsed.machineId];
  if (!machine) throw new Error(`Unknown legacy machine: ${parsed.machineId}`);
  return { parsed, machine };
}

async function listFileSessions(ctx, root, cache, load, machine = null) {
  const files = await walkJsonlFiles(root);
  const loadOptions = { trustFileTimes: !machine };
  const cacheOptions = { provenance: machine ? 'archive' : 'live' };
  const settled = await Promise.allSettled(
    files.map((file) => cache.summarize(file, async (path) => sessionSummary(await load(path, loadOptions)), cacheOptions))
  );
  cache.prune(files, cacheOptions);
  const cwdCandidates = machineCwdCandidates(ctx, machine);
  const summaries = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => inferClaudeProjectCwd(result.value, cwdCandidates))
    .map((result) => withLegacyMachine(result, machine));
  const sessions = summaries
    .filter((session) => session.cwd && isUnderRoot(session.cwd, ctx.workspaceRoot))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return machine ? { sessions, unmappedSessions: summaries.length - sessions.length } : sessions;
}

async function listPiSessions(ctx, machine = null) {
  const root = machine?.roots.pi || PI_SESSION_ROOT;
  return listFileSessions(ctx, root, SUMMARY_CACHES.pi, loadSessionFile, machine);
}

function opencodeRef(sessionId) {
  return formatSessionRef('opencode', sessionId);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function metadataTags(value) {
  return normalizeTags([...(Array.isArray(value?.tags) ? value.tags : []), ...(Array.isArray(value?.labels) ? value.labels : [])]);
}

function normalizeSavedTopics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([entryId, topic]) => {
    const id = String(entryId || '').trim();
    if (!id) return [];
    return [[id, {
      title: String(topic?.title || '').trim().slice(0, 240),
      note: String(topic?.note || '').trim().slice(0, 1000),
      prompt: String(topic?.prompt || '').trim().slice(0, 1000),
      timestamp: String(topic?.timestamp || '').trim(),
    }]];
  }));
}

async function readMetadata(ctx) {
  try {
    const parsed = JSON.parse(await readFile(ctx.metadataPath, 'utf8'));
    const sessions = parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
    const normalized = { ...emptyMetadata(), version: Math.max(Number(parsed?.version || 1), METADATA_VERSION) };
    for (const [key, value] of Object.entries(sessions)) {
      const tags = metadataTags(value);
      normalized.sessions[key] = { bookmarked: Boolean(value?.bookmarked), tags, savedTopics: normalizeSavedTopics(value?.savedTopics) };
    }
    return { metadata: normalized, error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { metadata: emptyMetadata(), error: null };
    return { metadata: emptyMetadata(), error: `Metadata unavailable: ${safeError(error)}` };
  }
}

async function writeMetadata(ctx, metadata) {
  await mkdir(dirname(ctx.metadataPath), { recursive: true });
  const tmp = `${ctx.metadataPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(tmp, ctx.metadataPath);
}

function effectiveStore(ctx, legacyState) {
  if (!ctx.effectiveStore) ctx.effectiveStore = createEffectiveMetadataStore({
    workspace: { id: ctx.workspaceId, root: ctx.workspaceRoot, metadataPath: ctx.metadataPath },
    machines: legacyState.machines,
    sessionArchiveBindings: ctx.legacyMachineBindings,
    metadataPath: ctx.metadataPath,
    readLive: () => readMetadata(ctx),
    writeLive: (metadata) => writeMetadata(ctx, metadata),
    isAllowed: (session) => isAllowedSessionPath(ctx, typeof session === 'string' ? session : session.path),
  });
  return ctx.effectiveStore;
}

function isOpenCodeRef(ref) {
  return isSourceRef(ref, 'opencode');
}

function codexRef(sessionId) {
  return formatSessionRef('codex', sessionId);
}

function isCodexRef(ref) {
  return isSourceRef(ref, 'codex');
}

function timestampFromMs(value) {
  return value ? new Date(Number(value)).toISOString() : undefined;
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function openCodeModelLabel(value) {
  return modelLabelFromParts(parseOpenCodeModel(value) || {});
}

function latestOpenCodeMessageModel(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const label = modelLabelFromParts(openCodeMessageModelParts(messages[i]));
    if (label) return label;
  }
  return '';
}

function openCodeModelChangeEntries(entries) {
  const result = [];
  let previous = '';
  for (const entry of entries) {
    if (entry?.type === 'message' && entry.message?.role === 'assistant') {
      const parts = { source: 'opencode', provider: entry.message.provider || '', model: entry.message.model || '', variant: entry.message.variant || '' };
      const key = modelKeyFromParts(parts);
      if (key && key !== previous) {
        result.push({
          id: `model-${entry.id}`,
          type: 'model_change',
          timestamp: entry.timestamp,
          source: 'opencode',
          provider: parts.provider,
          modelId: parts.model,
          variant: parts.variant,
          modelLabel: key,
          synthetic: true,
        });
        previous = key;
      }
    }
    result.push(entry);
  }
  return result;
}

function extractOpenCodeText(parts) {
  return parts
    .filter((part) => part?.data?.type === 'text' && typeof part.data.text === 'string')
    .map((part) => part.data.text)
    .join('\n');
}

function isOpenCodeToolPart(part) {
  return part?.data?.type === 'tool' || part?.data?.tool || part?.data?.callID;
}

function isNoisyOpenCodePart(part) {
  const type = part?.data?.type;
  if (['snapshot', 'step-start', 'step-finish'].includes(type)) return true;
  if (type === 'text' && part.data.synthetic && !String(part.data.text || '').trim()) return true;
  if (type === 'tool' && ['pending', 'running'].includes(part.data.state?.status || part.data.state)) return true;
  return false;
}

function openCodePatchBlock(part, diffs, cwd = '') {
  const files = Array.isArray(part.data?.files) ? part.data.files : [];
  const matchingDiffs = diffs.filter((diff) => files.some((file) => file === diff.file || file.endsWith(`/${diff.file}`) || (cwd && file === join(cwd, diff.file))));
  return {
    type: 'patch',
    files,
    diffs: matchingDiffs.map((diff) => ({
      file: diff.file,
      patch: diff.patch || '',
      additions: diff.additions || 0,
      deletions: diff.deletions || 0,
      status: diff.status || '',
    })),
  };
}

function flattenPatchDiffs(patchBlocks) {
  return patchBlocks.flatMap((block) => block.diffs || []);
}

function openCodeToolBlock(part) {
  const data = part.data || {};
  const state = typeof data.state === 'object' && data.state ? data.state : {};
  const input = state.input || data.input || data.args || data.parameters || {};
  const output = state.output || data.output || data.result;
  return {
    type: 'toolCall',
    id: data.callID || part.id,
    name: data.tool || data.name || 'tool',
    arguments: typeof input === 'object' && input ? input : { input },
    result: typeof output === 'string' ? output : output ? JSON.stringify(output, null, 2) : '',
    state: state.status || data.state || '',
  };
}

function openCodeContentBlocks(message, parts, diffs = [], cwd = '') {
  if (message.role === 'user') return [{ type: 'text', text: extractOpenCodeText(parts) }];
  const visibleParts = parts.filter((part) => !isNoisyOpenCodePart(part));
  const patchBlocks = visibleParts
    .filter((part) => part.data?.type === 'patch')
    .map((part) => openCodePatchBlock(part, diffs, cwd));
  const attachedPatchDiffs = flattenPatchDiffs(patchBlocks);
  const hasApplyPatchTool = visibleParts.some((part) => isOpenCodeToolPart(part) && part.data?.tool === 'apply_patch');
  return visibleParts.map((part) => {
    const data = part.data || {};
    if (data.type === 'text') return { type: 'text', text: data.text || '' };
    if (data.type === 'reasoning') return { type: 'thinking', thinking: data.text || data.reasoning || '' };
    if (data.type === 'patch') return hasApplyPatchTool ? null : openCodePatchBlock(part, diffs, cwd);
    if (isOpenCodeToolPart(part)) {
      const block = openCodeToolBlock(part);
      if (block.name === 'apply_patch' && attachedPatchDiffs.length) block.diffs = attachedPatchDiffs;
      return block;
    }
    return null;
  }).filter(Boolean);
}

async function loadOpenCodeDiffs(sessionId, dataDir = OPENCODE_DATA_DIR) {
  if (!dataDir) return [];
  try {
    const content = await readFile(join(dataDir, 'storage', 'session_diff', `${sessionId}.json`), 'utf8');
    const diffs = JSON.parse(content);
    return Array.isArray(diffs) ? diffs : [];
  } catch {
    return [];
  }
}

function openCodeUsage(messages, parts) {
  const usage = openCodeSessionUsage(messages, parts);
  const stats = emptyUsage();
  stats.tokens.input = usage.input;
  stats.tokens.output = usage.output;
  stats.tokens.cacheRead = usage.cacheRead;
  stats.tokens.cacheWrite = usage.cacheWrite;
  stats.tokens.total = usage.total;
  stats.contextLoad.latest = usage.latestContext;
  return stats;
}

function codexPayload(entry) {
  return entry?.payload || {};
}

function codexTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => block?.text || block?.input_text || block?.output_text || '')
    .filter(Boolean)
    .join('\n');
}

function codexContentBlocks(content) {
  const text = codexTextFromContent(content);
  return text ? [{ type: 'text', text }] : [];
}

function parseCodexArguments(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { input: String(value) };
  }
}

function codexUsageFromTokenCount(payload) {
  const usage = payload?.info?.last_token_usage || {};
  const inputTotal = Number(usage.input_tokens || 0);
  const cacheRead = Number(usage.cached_input_tokens || 0);
  const input = Math.max(0, inputTotal - cacheRead);
  const output = Number(usage.output_tokens || 0);
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    total: input + output + cacheRead,
  };
}

function summarizeCodexSession(file, fileStat, parsed) {
  const meta = codexPayload(parsed.find((entry) => entry?.type === 'session_meta'));
  const contexts = parsed.filter((entry) => entry?.type === 'turn_context').map(codexPayload);
  const cwd = meta.cwd || [...contexts].reverse().find((ctx) => ctx.cwd)?.cwd || '';
  const id = meta.session_id || meta.id || codexSessionIdFromFile(file);
  const messagePayloads = parsed.filter((entry) => entry?.type === 'response_item' && codexPayload(entry).type === 'message').map((entry) => ({ timestamp: entry.timestamp, ...codexPayload(entry) }));
  const userMessages = messagePayloads.filter((message) => message.role === 'user');
  const assistantMessages = messagePayloads.filter((message) => message.role === 'assistant');
  const toolCalls = parsed.filter((entry) => entry?.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(codexPayload(entry).type));
  const tokenCounts = parsed.filter((entry) => entry?.type === 'event_msg' && codexPayload(entry).type === 'token_count');
  const tokens = emptyUsage();
  for (const entry of tokenCounts) {
    const usage = codexUsageFromTokenCount(codexPayload(entry));
    tokens.tokens.input += usage.input;
    tokens.tokens.output += usage.output;
    tokens.tokens.cacheRead += usage.cacheRead;
    tokens.tokens.cacheWrite += usage.cacheWrite;
    tokens.tokens.total += usage.total;
    tokens.contextLoad.latest = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  }
  const timestamps = parsed.map((entry) => entry?.timestamp).filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
  const model = [...contexts].reverse().find((ctx) => ctx.model)?.model || '';
  return {
    id,
    source: 'codex',
    path: codexRef(id),
    cwd,
    name: '',
    modelLabel: model,
    model: { source: 'codex', provider: meta.model_provider || '', model, variant: '' },
    firstPrompt: truncate(codexTextFromContent(userMessages[0]?.content)),
    createdAt: meta.timestamp || timestamps.at(-1) || fileStat.birthtime?.toISOString(),
    updatedAt: timestamps[0] || fileStat.mtime?.toISOString(),
    leafId: null,
    messageCount: messagePayloads.filter((message) => ['user', 'assistant'].includes(message.role)).length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.filter((message) => codexTextFromContent(message.content).trim()).length,
    assistantRawMessageCount: assistantMessages.length,
    toolMessageCount: toolCalls.length,
    toolResultCount: parsed.filter((entry) => entry?.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(codexPayload(entry).type)).length,
    toolCallCount: toolCalls.length,
    toolNames: Array.from(new Set(toolCalls.map((entry) => codexPayload(entry).name || 'tool'))).sort(),
    tokens: tokens.tokens,
    contextLoad: tokens.contextLoad,
  };
}

function codexEntries(parsed) {
  const entries = [];
  let counter = 0;
  for (const entry of parsed) {
    const payload = codexPayload(entry);
    const id = payload.id || payload.call_id || `codex-entry-${counter++}`;
    if (entry.type === 'turn_context' && payload.model) {
      entries.push({
        id: `model-${counter++}`,
        type: 'model_change',
        timestamp: entry.timestamp,
        source: 'codex',
        provider: '',
        modelId: payload.model,
        modelLabel: payload.model,
        synthetic: true,
      });
      continue;
    }
    if (entry.type !== 'response_item') continue;
    if (payload.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      entries.push({
        id,
        type: 'message',
        timestamp: entry.timestamp,
        source: 'codex',
        message: {
          role: payload.role,
          content: codexContentBlocks(payload.content),
        },
      });
    } else if (['function_call', 'custom_tool_call'].includes(payload.type)) {
      entries.push({
        id,
        type: 'message',
        timestamp: entry.timestamp,
        source: 'codex',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: payload.call_id || payload.id || id,
            name: payload.name || payload.tool || 'tool',
            arguments: parseCodexArguments(payload.arguments || payload.input),
            result: '',
          }],
        },
      });
    } else if (['function_call_output', 'custom_tool_call_output'].includes(payload.type)) {
      entries.push({
        id,
        type: 'message',
        timestamp: entry.timestamp,
        source: 'codex',
        message: {
          role: 'toolResult',
          toolCallId: payload.call_id,
          content: [{ type: 'text', text: typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '', null, 2) }],
        },
      });
    } else if (payload.type === 'reasoning') {
      const summary = Array.isArray(payload.summary) ? codexTextFromContent(payload.summary) : '';
      if (summary.trim()) {
        entries.push({
          id,
          type: 'message',
          timestamp: entry.timestamp,
          source: 'codex',
          message: { role: 'assistant', content: [{ type: 'thinking', thinking: summary }] },
        });
      }
    }
  }
  return entries;
}

async function loadCodexFile(file) {
  const [fileStat, content] = await Promise.all([stat(file), readFile(file, 'utf8')]);
  const parsed = parseJsonl(content);
  const summary = summarizeCodexSession(file, fileStat, parsed);
  const entries = codexEntries(parsed);
  const activeEntries = entries;
  const topicAnchors = activeEntries
    .filter((entry) => entry?.type === 'message' && entry.message?.role === 'user')
    .map((entry, index) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      title: truncate(textFromContent(entry.message.content), 80) || `User prompt ${index + 1}`,
      depth: index === 0 ? 'first-prompt' : 'user-prompt',
    }));
  return { ...summary, entries, activeEntries, topicAnchors };
}

async function listCodexSessions(ctx, machine = null) {
  const root = machine?.roots.codex || CODEX_SESSION_ROOT;
  return listFileSessions(ctx, root, SUMMARY_CACHES.codex, loadCodexFile, machine);
}

async function loadCodexSession(ctx, ref) {
  const { parsed, machine } = await legacyMachineForRef(ctx, ref);
  const sessionId = parsed?.value || ref.replace(/^codex:/, '');
  const root = machine?.roots.codex || CODEX_SESSION_ROOT;
  const files = await walkJsonlFiles(root);
  for (const file of files) {
    const detail = await loadCodexFile(file);
    if (detail.id === sessionId) return withLegacyMachine(detail, machine);
  }
  throw new Error('Codex session not found');
}

function claudeCodeRef(id) {
  return formatSessionRef('claude-code', id);
}

function isClaudeCodeRef(ref) {
  return isSourceRef(ref, 'claude-code');
}

// Claude Code stores one JSONL per parent session at <project>/<sessionId>.jsonl and
// sub-agent sidechains at <project>/<parentSessionId>/subagents/agent-<agentId>.jsonl.
// The parent session id is the directory name, so parent<->child links need no guessing.
function claudeCodeFileInfo(file) {
  const inSubagents = basename(dirname(file)) === 'subagents';
  if (inSubagents && basename(file).startsWith('agent-')) {
    return { isSidechain: true, parentId: basename(dirname(dirname(file))), agentName: basename(file, '.jsonl') };
  }
  return { isSidechain: false, parentId: null, agentName: null };
}

function claudeCodeFileId(file) {
  const info = claudeCodeFileInfo(file);
  return info.isSidechain ? `${info.parentId}/${info.agentName}` : basename(file, '.jsonl');
}

function parseClaudeCodeJsonl(content) {
  const lines = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try { lines.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return lines;
}

function claudeCodeUsage(usage) {
  if (!usage) return undefined;
  return {
    input: Number(usage.input_tokens || 0),
    output: Number(usage.output_tokens || 0),
    cacheRead: Number(usage.cache_read_input_tokens || 0),
    cacheWrite: Number(usage.cache_creation_input_tokens || 0),
  };
}

function claudeCodeAssistantBlocks(content) {
  if (!Array.isArray(content)) {
    const text = textFromContent(content);
    return text ? [{ type: 'text', text }] : [];
  }
  const blocks = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') blocks.push({ type: 'text', text: block.text });
    else if (block?.type === 'thinking' && typeof block.thinking === 'string') blocks.push({ type: 'thinking', thinking: block.thinking });
    else if (block?.type === 'tool_use') blocks.push({ type: 'toolCall', id: block.id, name: block.name || 'tool', arguments: block.input || {}, result: '' });
  }
  return blocks;
}

function claudeCodeToolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((block) => (typeof block === 'string' ? block : block?.text || '')).filter(Boolean).join('\n');
  return content == null ? '' : JSON.stringify(content, null, 2);
}

function claudeCodeUserMessages(content) {
  if (typeof content === 'string') return content.trim() ? [{ role: 'user', content: [{ type: 'text', text: content }] }] : [];
  if (!Array.isArray(content)) return [];
  const messages = [];
  const textBlocks = content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => ({ type: 'text', text: block.text }));
  if (textBlocks.length) messages.push({ role: 'user', content: textBlocks });
  for (const block of content) {
    if (block?.type === 'tool_result') {
      messages.push({ role: 'toolResult', toolCallId: block.tool_use_id, content: [{ type: 'text', text: claudeCodeToolResultText(block.content) }] });
    }
  }
  return messages;
}

function claudeCodeEntries(parsed) {
  const entries = [];
  let counter = 0;
  for (const line of parsed) {
    if (line?.type === 'assistant' && line.message) {
      entries.push({
        id: line.uuid || `claude-entry-${counter++}`,
        type: 'message',
        timestamp: line.timestamp,
        source: 'claude-code',
        message: {
          role: 'assistant',
          content: claudeCodeAssistantBlocks(line.message.content),
          usage: claudeCodeUsage(line.message.usage),
          model: line.message.model || '',
        },
      });
    } else if (line?.type === 'user' && line.message) {
      for (const message of claudeCodeUserMessages(line.message.content)) {
        entries.push({
          id: `${line.uuid || 'claude-user'}-${counter++}`,
          type: 'message',
          timestamp: line.timestamp,
          source: 'claude-code',
          message,
        });
      }
    }
  }
  return entries;
}

function summarizeClaudeCodeSession(file, fileStat, parsed) {
  const info = claudeCodeFileInfo(file);
  const projectDirectory = basename(info.isSidechain ? dirname(dirname(dirname(file))) : dirname(file));
  const recordedParentId = info.isSidechain ? parsed.find((line) => line?.sessionId)?.sessionId : null;
  const id = info.isSidechain && recordedParentId ? `${recordedParentId}/${info.agentName}` : claudeCodeFileId(file);
  const cwd = parsed.find((line) => line?.cwd)?.cwd || '';
  const title = parsed.find((line) => line?.type === 'ai-title')?.aiTitle || '';
  const entries = claudeCodeEntries(parsed);
  const messageEntries = entries.filter((entry) => entry.type === 'message');
  const userEntries = messageEntries.filter((entry) => entry.message.role === 'user');
  const assistantEntries = messageEntries.filter((entry) => entry.message.role === 'assistant');
  const toolResultEntries = messageEntries.filter((entry) => entry.message.role === 'toolResult');
  const stats = collectStats(entries);
  const timestamps = parsed.map((line) => line?.timestamp).filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
  const model = [...assistantEntries].reverse().find((entry) => entry.message.model && entry.message.model !== '<synthetic>')?.message.model || '';
  return {
    id,
    source: 'claude-code',
    path: claudeCodeRef(id),
    parentId: info.isSidechain ? (recordedParentId || info.parentId) : null,
    isSidechain: info.isSidechain,
    cwd,
    ...(!cwd ? { claudeProjectDirectory: projectDirectory } : {}),
    name: title,
    modelLabel: model,
    model: { source: 'claude-code', provider: 'anthropic', model, variant: '' },
    firstPrompt: truncate(textFromContent(userEntries[0]?.message?.content)),
    createdAt: timestamps.at(-1) || fileStat.birthtime?.toISOString(),
    updatedAt: timestamps[0] || fileStat.mtime?.toISOString(),
    leafId: null,
    messageCount: messageEntries.filter((entry) => ['user', 'assistant'].includes(entry.message.role)).length,
    userMessageCount: userEntries.length,
    assistantMessageCount: stats.assistantAnswerCount,
    assistantRawMessageCount: assistantEntries.length,
    toolMessageCount: stats.toolMessageCount,
    toolResultCount: toolResultEntries.length,
    toolCallCount: stats.toolCallCount,
    toolNames: stats.toolNames,
    tokens: stats.tokens,
    contextLoad: stats.contextLoad,
  };
}

async function loadClaudeCodeFile(file) {
  const [fileStat, content] = await Promise.all([stat(file), readFile(file, 'utf8')]);
  const parsed = parseClaudeCodeJsonl(content);
  const summary = summarizeClaudeCodeSession(file, fileStat, parsed);
  const entries = claudeCodeEntries(parsed);
  const activeEntries = entries;
  const topicAnchors = activeEntries
    .filter((entry) => entry?.type === 'message' && entry.message?.role === 'user')
    .map((entry, index) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      title: truncate(textFromContent(entry.message.content), 80) || `User prompt ${index + 1}`,
      depth: index === 0 ? 'first-prompt' : 'user-prompt',
    }));
  return { ...summary, entries, activeEntries, topicAnchors };
}

async function listClaudeCodeSessions(ctx, machine = null) {
  const root = machine?.roots['claude-code'] || CLAUDE_PROJECTS_ROOT;
  const result = await listFileSessions(ctx, root, SUMMARY_CACHES['claude-code'], loadClaudeCodeFile, machine);
  const sessions = machine ? result.sessions : result;
  const unique = [...new Map(sessions.map((session) => [session.id, session])).values()];
  return machine ? { ...result, sessions: unique } : unique;
}

function claudeCodeRelation(session, machine = null) {
  const related = withLegacyMachine(session, machine);
  return {
    id: related.id,
    path: related.path,
    source: 'claude-code',
    machineId: related.machineId,
    name: related.name || related.firstPrompt || related.id,
    cwd: related.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function loadClaudeCodeRelations(detail, root = CLAUDE_PROJECTS_ROOT, machine = null) {
  const files = await walkJsonlFiles(root).catch(() => []);
  if (detail.isSidechain) {
    const parentId = String(detail.id).split('/')[0];
    for (const file of files) {
      if (!claudeCodeFileInfo(file).isSidechain && basename(file, '.jsonl') === parentId) {
        const parent = await loadClaudeCodeFile(file).catch(() => null);
        if (parent) return { parentSession: claudeCodeRelation(parent, machine), childSessions: [] };
      }
    }
    return { parentSession: null, childSessions: [] };
  }
  const childSessions = [];
  for (const file of files) {
    const info = claudeCodeFileInfo(file);
    if (info.isSidechain && info.parentId === detail.id) {
      const child = await loadClaudeCodeFile(file).catch(() => null);
      if (child) childSessions.push(claudeCodeRelation(child, machine));
    }
  }
  childSessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return { parentSession: null, childSessions };
}

async function loadClaudeCodeSession(ctx, ref) {
  const { parsed, machine } = await legacyMachineForRef(ctx, ref);
  const id = parsed?.value || ref.replace(/^claude-code:/, '');
  const root = machine?.roots['claude-code'] || CLAUDE_PROJECTS_ROOT;
  const files = await walkJsonlFiles(root);
  for (const file of files) {
    const loaded = await loadClaudeCodeFile(file);
    if (loaded.id === id) {
      const cwdCandidates = machineCwdCandidates(ctx, machine);
      const detail = withLegacyMachine(inferClaudeProjectCwd(loaded, cwdCandidates), machine);
      const relations = await loadClaudeCodeRelations(detail, root, machine);
      return { ...detail, ...relations };
    }
  }
  throw new Error('Claude Code session not found');
}

async function loadOpenCodeRows(sessionId = null, dbPath = OPENCODE_DB) {
  const sessionWhere = sessionId ? `where id = ${sqlString(sessionId)}` : '';
  const sessions = await sqliteJson(dbPath, `
    select id, directory, title, model, parent_id as parentId, time_created as createdAt, time_updated as updatedAt, time_archived as archivedAt
    from session
    ${sessionWhere}
    order by time_updated desc
  `);
  if (!sessions.length) return { sessions: [], messages: [], parts: [] };
  const ids = sessions.map((session) => session.id);
  const placeholders = ids.map(sqlString).join(',');
  const messages = await sqliteJson(dbPath, `
    select id, session_id as sessionId, time_created as createdAt, time_updated as updatedAt, data
    from message
    where session_id in (${placeholders})
    order by time_created, id
  `);
  const parts = await sqliteJson(dbPath, `
    select id, message_id as messageId, session_id as sessionId, time_created as createdAt, time_updated as updatedAt, data
    from part
    where session_id in (${placeholders})
    order by time_created, id
  `);
  return {
    sessions,
    messages: messages.map((message) => ({ ...message, data: parseJson(message.data) })),
    parts: parts.map((part) => ({ ...part, data: parseJson(part.data) })),
  };
}

async function loadOpenCodeRelations(session, dbPath = OPENCODE_DB, machine = null) {
  if (!session?.id) return { parentSession: null, childSessions: [] };
  const parentRows = session.parentId ? await sqliteJson(dbPath, `
    select id, title, directory, time_created as createdAt, time_updated as updatedAt
    from session
    where id = ${sqlString(session.parentId)}
  `) : [];
  const childRows = await sqliteJson(dbPath, `
    select id, title, directory, time_created as createdAt, time_updated as updatedAt
    from session
    where parent_id = ${sqlString(session.id)}
    order by time_updated desc
  `);
  const toRelation = (row) => withLegacyMachine({
    id: row.id,
    path: opencodeRef(row.id),
    source: 'opencode',
    name: row.title,
    cwd: row.directory || '',
    createdAt: timestampFromMs(row.createdAt),
    updatedAt: timestampFromMs(row.updatedAt),
  }, machine);
  return {
    parentSession: parentRows[0] ? toRelation(parentRows[0]) : null,
    childSessions: childRows.map(toRelation),
  };
}

function summarizeOpenCodeSession(session, messages, parts) {
  const messageParts = new Map();
  for (const part of parts) {
    if (!messageParts.has(part.messageId)) messageParts.set(part.messageId, []);
    messageParts.get(part.messageId).push(part);
  }
  const userMessages = messages.filter((message) => message.data.role === 'user');
  const assistantMessages = messages.filter((message) => message.data.role === 'assistant');
  const assistantAnswerCount = assistantMessages.filter((message) => extractOpenCodeText(messageParts.get(message.id) || []).trim()).length;
  const toolCallCount = parts.filter(isOpenCodeToolPart).length;
  const usage = openCodeUsage(messages, parts);
  const modelLabel = openCodeModelLabel(session.model) || latestOpenCodeMessageModel(assistantMessages);
  return {
    id: session.id,
    source: 'opencode',
    path: opencodeRef(session.id),
    parentId: session.parentId || null,
    cwd: session.directory || '',
    name: session.title,
    modelLabel,
    firstPrompt: truncate(extractOpenCodeText(messageParts.get(userMessages[0]?.id) || [])),
    createdAt: timestampFromMs(session.createdAt),
    updatedAt: timestampFromMs(session.updatedAt),
    leafId: messages.at(-1)?.id || null,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantAnswerCount,
    assistantRawMessageCount: assistantMessages.length,
    toolMessageCount: Math.max(0, assistantMessages.length - assistantAnswerCount),
    toolResultCount: 0,
    toolCallCount,
    toolNames: Array.from(new Set(parts.filter(isOpenCodeToolPart).map((part) => part.data.tool || part.data.name || 'tool'))).sort(),
    tokens: usage.tokens,
    contextLoad: usage.contextLoad,
    archivedAt: timestampFromMs(session.archivedAt),
  };
}

// Aggregate mirror of openCodeSessionUsage: a message's parts contribute only when the
// message row itself records no usage, so payloads stored in both are counted once.
function openCodeUsageSql(sessionIds) {
  const message = openCodeTokenSql('m');
  const part = openCodeTokenSql('p');
  const columns = ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'context'];
  const select = (source) => columns.map((column) => `${source[column]} as ${column}`).join(', ');
  return `
    with usage as (
      select m.session_id as sessionId, m.time_created as createdAt, ${select(message)}
      from message m
      where m.session_id in (${sessionIds}) and ${message.total} > 0
      union all
      select p.session_id as sessionId, p.time_created as createdAt, ${select(part)}
      from part p
      left join message m on m.id = p.message_id
      where p.session_id in (${sessionIds}) and coalesce(${message.total}, 0) = 0
    )
    select
      sessionId,
      sum(input) as input,
      sum(output) as output,
      sum(cacheRead) as cacheRead,
      sum(cacheWrite) as cacheWrite,
      sum(total) as total,
      (select context from usage latest where latest.sessionId = usage.sessionId order by createdAt desc limit 1) as latestContext
    from usage
    group by sessionId
  `;
}

async function listOpenCodeSessions(ctx, machine = null) {
  const dbPath = machine?.roots.opencode || OPENCODE_DB;
  if (!await exists(dbPath)) return machine ? { sessions: [], unmappedSessions: 0 } : [];
  const workspaceRootSql = sqlString(ctx.workspaceRoot);
  const workspacePrefixSql = sqlString(`${sqlLike(ctx.workspaceRoot)}/%`);
  const workspaceWhere = machine ? '' : `and (directory = ${workspaceRootSql} or directory like ${workspacePrefixSql} escape '\\')`;
  const limitClause = machine ? '' : `limit ${OPENCODE_SESSION_LIMIT}`;
  const sessions = await sqliteJson(
    dbPath,
    `select id, parent_id as parentId, directory, title, model, time_created as createdAt, time_updated as updatedAt, time_archived as archivedAt
     from session
     where time_archived is null
       ${workspaceWhere}
     order by time_updated desc
     ${limitClause}`
  );
  if (!sessions.length) return machine ? { sessions: [], unmappedSessions: 0 } : [];
  const sessionIds = sessions.map((session) => sqlString(session.id)).join(',');
  let usageRows = [];
  let messageModelRows = [];
  try {
    usageRows = await sqliteJson(dbPath, openCodeUsageSql(sessionIds));
  } catch {
    usageRows = [];
  }
  try {
    messageModelRows = await sqliteJson(dbPath, `
      select
        session_id as sessionId,
        json_extract(data, '$.providerID') as providerID,
        coalesce(json_extract(data, '$.modelID'), json_extract(data, '$.model')) as modelID,
        json_extract(data, '$.variant') as variant,
        time_created as createdAt
      from message
      where session_id in (${sessionIds})
        and json_extract(data, '$.role') = 'assistant'
        and coalesce(json_extract(data, '$.modelID'), json_extract(data, '$.model')) is not null
      order by time_created desc
    `);
  } catch {
    messageModelRows = [];
  }
  const usageBySession = new Map();
  for (const row of usageRows) {
    if (!row.sessionId) continue;
    const usage = emptyUsage();
    usage.tokens.input = Number(row.input || 0);
    usage.tokens.output = Number(row.output || 0);
    usage.tokens.cacheRead = Number(row.cacheRead || 0);
    usage.tokens.cacheWrite = Number(row.cacheWrite || 0);
    usage.tokens.total = Number(row.total || 0);
    usage.contextLoad.latest = row.latestContext == null ? null : Number(row.latestContext);
    usageBySession.set(row.sessionId, usage);
  }
  const fallbackModelBySession = new Map();
  for (const row of messageModelRows) {
    if (!row.sessionId || fallbackModelBySession.has(row.sessionId)) continue;
    const label = modelLabelFromParts({ source: 'opencode', provider: row.providerID, model: row.modelID, variant: row.variant });
    if (label) fallbackModelBySession.set(row.sessionId, label);
  }

  const summaries = sessions.map((session) => withLegacyMachine({
    source: 'opencode',
    path: `opencode:${session.id}`,
    id: session.id,
    parentId: session.parentId || null,
    cwd: session.directory || '',
    name: session.title || '',
    modelLabel: openCodeModelLabel(session.model) || fallbackModelBySession.get(session.id) || '',
    firstPrompt: '',
    createdAt: timestampFromMs(session.createdAt),
    updatedAt: timestampFromMs(session.updatedAt),
    leafId: null,
    ...emptyListStats(),
    ...(usageBySession.get(session.id) || emptyUsage()),
    archivedAt: timestampFromMs(session.archivedAt),
  }, machine));
  const visible = summaries.filter((summary) => summary.cwd && isUnderRoot(summary.cwd, ctx.workspaceRoot));
  return machine ? { sessions: visible, unmappedSessions: summaries.length - visible.length } : visible;
}

async function loadOpenCodeSession(ctx, ref) {
  const { parsed, machine } = await legacyMachineForRef(ctx, ref);
  const sessionId = parsed?.value || ref.replace(/^opencode:/, '');
  const dbPath = machine?.roots.opencode || OPENCODE_DB;
  const { sessions, messages, parts } = await loadOpenCodeRows(sessionId, dbPath);
  const session = sessions[0];
  if (!session) throw new Error('OpenCode session not found');
  const summary = withLegacyMachine(summarizeOpenCodeSession(session, messages, parts), machine);
  const relations = await loadOpenCodeRelations(session, dbPath, machine);
  const diffs = await loadOpenCodeDiffs(session.id, machine ? machine.artifacts['opencode-data'] : OPENCODE_DATA_DIR);
  const partsByMessage = new Map();
  for (const part of parts) {
    if (!partsByMessage.has(part.messageId)) partsByMessage.set(part.messageId, []);
    partsByMessage.get(part.messageId).push(part);
  }
  const entries = messages.map((message) => ({
    id: message.id,
    type: 'message',
    timestamp: timestampFromMs(message.createdAt),
    source: 'opencode',
    message: {
      role: message.data.role,
      provider: message.data.providerID || '',
      model: message.data.modelID || message.data.model,
      variant: message.data.variant || '',
      mode: message.data.mode || '',
      content: openCodeContentBlocks(message.data, partsByMessage.get(message.id) || [], diffs, session.directory || ''),
    },
  }));
  const topicAnchors = entries
    .filter((entry) => entry.message.role === 'user')
    .map((entry, index) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      title: truncate(textFromContent(entry.message.content), 80) || `User prompt ${index + 1}`,
      depth: index === 0 ? 'first-prompt' : 'user-prompt',
    }));
  const activeEntries = openCodeModelChangeEntries(entries);
  return { ...summary, ...relations, entries, activeEntries, topicAnchors };
}

function sessionDashboardSummary(sessions) {
  const visible = sessions.filter((session) => !session.archivedAt);
  const latestUpdatedSession = visible[0] || null;
  const latestBookmarkedSession = visible.find((session) => session.metadata?.bookmarked) || null;
  const compact = (session) => session ? {
    id: session.id,
    title: session.name || session.summary || session.id,
    source: session.source,
    updatedAt: session.updatedAt,
    path: session.path,
    ref: session.ref,
    bookmarked: Boolean(session.metadata?.bookmarked),
    messageCount: session.messageCount,
  } : null;
  return { latestBookmarkedSession: compact(latestBookmarkedSession), latestUpdatedSession: compact(latestUpdatedSession) };
}

const LIST_BY_SOURCE = {
  pi: listPiSessions,
  opencode: listOpenCodeSessions,
  codex: listCodexSessions,
  'claude-code': listClaudeCodeSessions,
};

async function scanLiveSources(ctx) {
  const entries = Object.entries(LIST_BY_SOURCE).filter(([source]) => sourceEnabled(source));
  const results = await Promise.allSettled(entries.map(([source, list]) => withTimeout(list(ctx), `${source} source`, SOURCE_TIMEOUT_MS)));
  const sessions = [];
  const sourceErrors = [];
  for (const [index, result] of results.entries()) {
    const source = entries[index][0];
    if (result.status === 'fulfilled') sessions.push(...result.value);
    else sourceErrors.push(sourceError(source, result.reason));
  }
  return { sessions, sourceErrors };
}

function legacyScanEntries(ctx, legacyState) {
  return Object.values(legacyState.machines).flatMap((machine) => Object.keys(machine.roots).flatMap((source) => {
    if (!LIST_BY_SOURCE[source] || !sourceEnabled(source)) return [];
    const key = `${source}@${machine.id}`;
    return [{
      key,
      machine,
      immutable: machine.immutable,
      load: () => withTimeout(LIST_BY_SOURCE[source](ctx, machine), `${key} source`, SOURCE_TIMEOUT_MS),
    }];
  }));
}

function archiveSnapshot(ctx, legacyState) {
  const snapshot = ctx.archiveMemo.snapshot(legacyScanEntries(ctx, legacyState));
  const sessions = [];
  const sourceErrors = legacyState.errors.map((error) => ({ source: error.source, code: error.code, error: error.message }));
  const unmappedByMachine = new Map();
  for (const result of snapshot.results) {
    if (result.status === 'rejected') {
      sourceErrors.push(sourceError(result.entry.key, result.reason));
      continue;
    }
    const value = result.value;
    sessions.push(...value.sessions);
    if (value.unmappedSessions) {
      const id = result.entry.machine.id;
      unmappedByMachine.set(id, (unmappedByMachine.get(id) || 0) + value.unmappedSessions);
    }
  }
  const unmappedSessions = Object.values(legacyState.machines).map((machine) => ({
    machineId: machine.id,
    label: machine.label,
    count: unmappedByMachine.get(machine.id) || 0,
  }));
  return { sessions, sourceErrors, unmappedSessions, archivesLoading: snapshot.loading };
}

async function listSessions(ctx, { archivesOnly = false } = {}) {
  const legacyState = await ctx.legacyMachines;
  const live = archivesOnly && ctx.lastLive
    ? ctx.lastLive
    : await singleFlight(`${ctx.scanKey}\0live`, () => scanLiveSources(ctx));
  ctx.lastLive = live;
  const archives = archiveSnapshot(ctx, legacyState);
  const sessions = [...live.sessions, ...archives.sessions].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const overlay = await effectiveStore(ctx, legacyState).readForSessions(sessions);
  return {
    sessions: sessions.map((session) => ({ ...session, metadata: overlay.entries.get(sessionKey(session)) })),
    sourceErrors: [...live.sourceErrors, ...archives.sourceErrors, ...overlay.diagnostics.map((item) => ({ source: item.source, code: item.code, error: item.message }))],
    unmappedSessions: archives.unmappedSessions,
    archivesLoading: archives.archivesLoading,
    metadataError: overlay.error,
    metadataPath: ctx.metadataPath,
  };
}

async function isAllowedSessionPath(ctx, candidate) {
  const parsed = parseSessionRef(candidate);
  if (parsed?.machineId) {
    const { machines } = await ctx.legacyMachines;
    const machine = machines[parsed.machineId];
    if (!machine?.roots[parsed.source]) return false;
    if (parsed.source !== 'pi') return true;
    try {
      const [candidatePath, rootPath] = await Promise.all([realpath(parsed.value), realpath(machine.roots.pi)]);
      return isUnderRoot(candidatePath, rootPath);
    } catch {
      return false;
    }
  }
  if (isOpenCodeRef(candidate)) return true;
  if (isCodexRef(candidate)) return true;
  if (isClaudeCodeRef(candidate)) return true;
  const resolved = resolve(candidate);
  return isUnderRoot(resolved, PI_SESSION_ROOT);
}

export function createSessionBrowserHandler({ basePath = '/', cockpit = null, workspaceRoot = DEFAULT_WORKSPACE_ROOT, workspaceName = basename(workspaceRoot) || workspaceRoot, workspaceId = 'default', metadataPath = DEFAULT_METADATA_PATH, legacyMachinesPath, legacyMachineBindings, legacyMachineCwdHints } = {}) {
  const normalizedBase = normalizeBasePath(basePath);
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const ctx = {
    workspaceRoot: resolvedWorkspaceRoot,
    workspaceName,
    workspaceId,
    metadataPath: resolve(metadataPath),
    legacyMachineBindings,
    legacyMachineCwdHints,
    scanKey: `${resolvedWorkspaceRoot}\0${resolve(legacyMachinesPath || join(resolvedWorkspaceRoot, '.tools-config', 'session-browser', 'machines.json'))}\0${JSON.stringify(legacyMachineBindings ?? null)}`,
    archiveMemo: createImmutableSourceMemo(),
    lastLive: null,
    legacyMachines: loadLegacyMachines({ workspaceRoot: resolvedWorkspaceRoot, configPath: legacyMachinesPath, bindings: legacyMachineBindings }),
  };
  return async function sessionBrowserHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = stripBasePath(url.pathname, normalizedBase);
      if (pathname === null) return false;
      if (pathname === '/api/sessions') {
        const archivesOnly = url.searchParams.get('archivesOnly') === '1';
        const { sessions, sourceErrors, unmappedSessions, archivesLoading, metadataError, metadataPath } = await withTimeout(listSessions(ctx, { archivesOnly }), '/api/sessions', REQUEST_TIMEOUT_MS)
          .catch((error) => ({ sessions: [], sourceErrors: [sourceError('aggregate', error)], unmappedSessions: [], archivesLoading: false, metadataError: null, metadataPath: ctx.metadataPath }));
        sendJson(res, 200, { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, sessionRoot: PI_SESSION_ROOT, piSessionRoot: PI_SESSION_ROOT, openCodeDb: OPENCODE_DB, metadataPath, sourceErrors, unmappedSessions, archivesLoading, metadataError, sessions: sessions.map(sessionSummary) });
        return true;
      }
      if (pathname === '/api/summary') {
        const { sessions, sourceErrors, unmappedSessions, archivesLoading, metadataError, metadataPath } = await withTimeout(listSessions(ctx), '/api/summary', REQUEST_TIMEOUT_MS)
          .catch((error) => ({ sessions: [], sourceErrors: [sourceError('aggregate', error)], unmappedSessions: [], archivesLoading: false, metadataError: null, metadataPath: ctx.metadataPath }));
        sendJson(res, 200, { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, metadataPath, sourceErrors, unmappedSessions, archivesLoading, metadataError, ...sessionDashboardSummary(sessions) });
        return true;
      }
      if (pathname === '/api/session') {
        const path = url.searchParams.get('path') || url.searchParams.get('ref');
        if (!path || !await isAllowedSessionPath(ctx, path)) {
          sendJson(res, 400, { error: 'Invalid session path' });
          return true;
        }
        const { parsed: parsedRef, machine } = await legacyMachineForRef(ctx, path);
        const session = isOpenCodeRef(path)
          ? await loadOpenCodeSession(ctx, path)
          : isCodexRef(path)
            ? await loadCodexSession(ctx, path)
            : isClaudeCodeRef(path)
              ? await loadClaudeCodeSession(ctx, path)
              : withLegacyMachine(await loadSessionFile(parsedRef?.value || path, { trustFileTimes: !machine }), machine);
        if (!isUnderRoot(session.cwd, ctx.workspaceRoot)) {
          sendJson(res, 404, { error: 'Session is outside the current workspace root' });
          return true;
        }
        const legacyState = await ctx.legacyMachines;
        const overlay = await effectiveStore(ctx, legacyState).readForSessions([session]);
        sendJson(res, 200, { ...session, metadata: overlay.entries.get(sessionKey(session)), metadataError: overlay.error, sourceErrors: overlay.diagnostics });
        return true;
      }
      if (pathname === '/api/metadata/override' && req.method === 'DELETE') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const path = payload.path || payload.ref;
            if (!path || !await isAllowedSessionPath(ctx, path)) return sendJson(res, 400, { error: 'Invalid session path' });
            const legacyState = await ctx.legacyMachines;
            const updated = await effectiveStore(ctx, legacyState).reset(path);
            sendJson(res, 200, { metadataPath: ctx.metadataPath, metadata: updated });
          } catch (error) {
            sendJson(res, 400, { error: safeError(error), metadataPath: ctx.metadataPath });
          }
        });
        return true;
      }
      if (pathname === '/api/metadata' && req.method === 'PUT') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const path = payload.path || payload.ref;
            if (!path || !await isAllowedSessionPath(ctx, path)) {
              sendJson(res, 400, { error: 'Invalid session path' });
              return;
            }
            const legacyState = await ctx.legacyMachines;
            const updated = await effectiveStore(ctx, legacyState).mutate(path, payload);
            sendJson(res, 200, { metadataPath: ctx.metadataPath, metadata: updated });
          } catch (error) {
            sendJson(res, 500, { error: safeError(error), metadataPath: ctx.metadataPath });
          }
        });
        return true;
      }
      if (pathname.startsWith('/shared/')) {
        await serveStaticPath(res, SHARED_WEB_DIR, pathname.replace('/shared', '') || '/');
        return true;
      }
      if (pathname === '/') {
        let html = await readStaticText(PUBLIC_DIR, '/index.html');
        html = html.replaceAll('/shared/', `${normalizedBase}/shared/`);
        html = html.replace('<!-- __FRAMEWORK_COCKPIT_CONFIG__ -->', cockpit ? `<script>window.__FRAMEWORK_COCKPIT__ = ${JSON.stringify(cockpit)}; window.__FRAMEWORK_WORKSPACE_ID__ = ${JSON.stringify(cockpit.workspaceId || null)};</script><script src="${normalizedBase}/shared/workspace-query.js"></script>` : '');
        await sendHtml(res, html);
        return true;
      }
      await serveStaticPath(res, PUBLIC_DIR, pathname);
      return true;
    } catch (error) {
      sendJson(res, 500, { error: safeError(error), workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, sessionRoot: PI_SESSION_ROOT, openCodeDb: OPENCODE_DB });
      return true;
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(createSessionBrowserHandler()).listen(PORT, () => {
    console.log(`Session Browser: http://localhost:${PORT}`);
    console.log(`Workspace root: ${DEFAULT_WORKSPACE_ROOT}`);
    console.log(`Pi session root: ${PI_SESSION_ROOT}`);
    console.log(`OpenCode DB: ${OPENCODE_DB}`);
    console.log(`Metadata: ${DEFAULT_METADATA_PATH}`);
  });
}
