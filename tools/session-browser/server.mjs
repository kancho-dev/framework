import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';
import { modelLabelFromParts, openCodeMessageModelParts, parseOpenCodeModel, piModelState } from '../shared-web/model-normalization.mjs';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = parsePort(process.env.PORT || '8787');
const PI_SESSION_ROOT = resolve(process.env.SESSION_ROOT || process.env.PI_SESSION_ROOT || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions'));
const OPENCODE_DATA_DIR = resolve(process.env.OPENCODE_DATA_DIR || join(homedir(), '.local', 'share', 'opencode'));
const OPENCODE_DB = resolve(process.env.OPENCODE_DB || join(OPENCODE_DATA_DIR, 'opencode.db'));
const ENABLED_SOURCES = new Set(String(process.env.SESSION_SOURCES || 'pi,opencode').split(',').map((source) => source.trim().toLowerCase()).filter(Boolean));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const DEFAULT_WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const DEFAULT_WORKSPACE_NAME = basename(DEFAULT_WORKSPACE_ROOT) || DEFAULT_WORKSPACE_ROOT;
const DEFAULT_METADATA_PATH = resolve(process.env.SESSION_BROWSER_METADATA || join(DEFAULT_WORKSPACE_ROOT, '.tools-config', 'session-browser', 'metadata.json'));
const execFileAsync = promisify(execFile);
const SOURCE_TIMEOUT_MS = Number(process.env.SESSION_SOURCE_TIMEOUT_MS || '8000');
const REQUEST_TIMEOUT_MS = Number(process.env.SESSION_REQUEST_TIMEOUT_MS || '10000');
const OPENCODE_SESSION_LIMIT = parsePositiveInteger(process.env.SESSION_BROWSER_OPENCODE_LIMIT || '500', 'SESSION_BROWSER_OPENCODE_LIMIT');

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
  if (message.includes('ENOENT') || message.includes('sqlite3')) return 'sqlite3 unavailable or OpenCode database cannot be read';
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

function isUnderRoot(candidate, root) {
  if (!candidate) return false;
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
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
    tokenPressure: { total: 0 },
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
      const pressure = input + output + cacheWrite || total;
      stats.tokenPressure.total = Math.max(stats.tokenPressure.total, pressure);
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

function summarizeSession(path, fileStat, parsed) {
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
  const updatedAt = [entryUpdatedAt, fileUpdatedAt]
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
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
    tokenPressure: stats.tokenPressure,
    modelLabel: modelState.label,
    model: modelState,
  };
}

async function loadSessionFile(path) {
  const [fileStat, content] = await Promise.all([stat(path), readFile(path, 'utf8')]);
  const parsed = parseJsonl(content);
  const summary = summarizeSession(path, fileStat, parsed);
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

async function listPiSessions(ctx) {
  const files = await walkJsonlFiles(PI_SESSION_ROOT);
  const settled = await Promise.allSettled(files.map(async (file) => loadSessionFile(file)));
  return settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((session) => isUnderRoot(session.cwd, ctx.workspaceRoot))
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function opencodeRef(sessionId) {
  return `opencode:${sessionId}`;
}

function sessionKey(sessionOrPath, source = null) {
  if (typeof sessionOrPath === 'string') {
    if (isOpenCodeRef(sessionOrPath)) return sessionOrPath;
    return `pi:${resolve(sessionOrPath)}`;
  }
  if (sessionOrPath?.source === 'opencode') return opencodeRef(sessionOrPath.id || String(sessionOrPath.path || '').replace(/^opencode:/, ''));
  return `pi:${resolve(sessionOrPath?.path || '')}`;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function metadataTags(value) {
  return normalizeTags([...(Array.isArray(value?.tags) ? value.tags : []), ...(Array.isArray(value?.labels) ? value.labels : [])]);
}

const METADATA_VERSION = 2;

function emptyMetadata() {
  return { version: METADATA_VERSION, sessions: {} };
}

async function readMetadata(ctx) {
  try {
    const parsed = JSON.parse(await readFile(ctx.metadataPath, 'utf8'));
    const sessions = parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
    const normalized = { ...emptyMetadata(), version: Math.max(Number(parsed?.version || 1), METADATA_VERSION) };
    for (const [key, value] of Object.entries(sessions)) {
      const tags = metadataTags(value);
      normalized.sessions[key] = { bookmarked: Boolean(value?.bookmarked), tags };
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

function metadataForSession(metadata, session) {
  const item = metadata.sessions[sessionKey(session)] || {};
  return { bookmarkKey: sessionKey(session), bookmarked: Boolean(item.bookmarked), tags: metadataTags(item) };
}

function attachMetadata(session, metadata) {
  return { ...session, metadata: metadataForSession(metadata, session) };
}

async function updateSessionMetadata(ctx, path, patch) {
  const key = sessionKey(path);
  const { metadata, error } = await readMetadata(ctx);
  if (error) throw new Error(error);
  const current = metadata.sessions[key] || { bookmarked: false, tags: [] };
  const patchTags = patch.tags === undefined ? patch.labels : patch.tags;
  const next = {
    bookmarked: patch.bookmarked === undefined ? Boolean(current.bookmarked) : Boolean(patch.bookmarked),
    tags: patchTags === undefined ? metadataTags(current) : normalizeTags(patchTags),
  };
  if (!next.bookmarked && next.tags.length === 0) delete metadata.sessions[key];
  else metadata.sessions[key] = next;
  await writeMetadata(ctx, metadata);
  return { key, ...next };
}

function isOpenCodeRef(ref) {
  return typeof ref === 'string' && ref.startsWith('opencode:');
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

async function loadOpenCodeDiffs(sessionId) {
  try {
    const content = await readFile(join(OPENCODE_DATA_DIR, 'storage', 'session_diff', `${sessionId}.json`), 'utf8');
    const diffs = JSON.parse(content);
    return Array.isArray(diffs) ? diffs : [];
  } catch {
    return [];
  }
}

function openCodeUsage(messages, parts) {
  const stats = emptyUsage();
  for (const item of [...messages, ...parts]) {
    const data = item.data || {};
    const tokens = data.tokens || {};
    const input = tokens.input || tokens.prompt || 0;
    const output = tokens.output || tokens.completion || 0;
    const cacheRead = tokens.cacheRead || tokens.cache_read || tokens.cache?.read || 0;
    const cacheWrite = tokens.cacheWrite || tokens.cache_write || tokens.cache?.write || 0;
    const total = tokens.total || input + output + cacheRead + cacheWrite;
    stats.tokens.input += input;
    stats.tokens.output += output;
    stats.tokens.cacheRead += cacheRead;
    stats.tokens.cacheWrite += cacheWrite;
    stats.tokens.total += total;
    stats.tokenPressure.total = Math.max(stats.tokenPressure.total, input + output + cacheWrite);
  }
  return stats;
}

async function loadOpenCodeRows(sessionId = null) {
  const sessionWhere = sessionId ? `where id = ${sqlString(sessionId)}` : '';
  const sessions = await sqliteJson(OPENCODE_DB, `
    select id, directory, title, model, parent_id as parentId, time_created as createdAt, time_updated as updatedAt, time_archived as archivedAt
    from session
    ${sessionWhere}
    order by time_updated desc
  `);
  if (!sessions.length) return { sessions: [], messages: [], parts: [] };
  const ids = sessions.map((session) => session.id);
  const placeholders = ids.map(sqlString).join(',');
  const messages = await sqliteJson(OPENCODE_DB, `
    select id, session_id as sessionId, time_created as createdAt, time_updated as updatedAt, data
    from message
    where session_id in (${placeholders})
    order by time_created, id
  `);
  const parts = await sqliteJson(OPENCODE_DB, `
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

async function loadOpenCodeRelations(session) {
  if (!session?.id) return { parentSession: null, childSessions: [] };
  const parentRows = session.parentId ? await sqliteJson(OPENCODE_DB, `
    select id, title, directory, time_created as createdAt, time_updated as updatedAt
    from session
    where id = ${sqlString(session.parentId)}
  `) : [];
  const childRows = await sqliteJson(OPENCODE_DB, `
    select id, title, directory, time_created as createdAt, time_updated as updatedAt
    from session
    where parent_id = ${sqlString(session.id)}
    order by time_updated desc
  `);
  const toRelation = (row) => ({
    id: row.id,
    path: opencodeRef(row.id),
    source: 'opencode',
    name: row.title,
    cwd: row.directory || '',
    createdAt: timestampFromMs(row.createdAt),
    updatedAt: timestampFromMs(row.updatedAt),
  });
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
    tokenPressure: usage.tokenPressure,
    archivedAt: timestampFromMs(session.archivedAt),
  };
}

async function listOpenCodeSessions(ctx) {
  if (!await exists(OPENCODE_DB)) return [];
  const workspaceRootSql = sqlString(ctx.workspaceRoot);
  const workspacePrefixSql = sqlString(`${sqlLike(ctx.workspaceRoot)}/%`);
  const sessions = await sqliteJson(
    OPENCODE_DB,
    `select id, parent_id as parentId, directory, title, model, time_created as createdAt, time_updated as updatedAt, time_archived as archivedAt
     from session
     where time_archived is null
       and (directory = ${workspaceRootSql} or directory like ${workspacePrefixSql} escape '\\')
     order by time_updated desc
     limit ${OPENCODE_SESSION_LIMIT}`
  );
  if (!sessions.length) return [];
  const sessionIds = sessions.map((session) => sqlString(session.id)).join(',');
  let messageUsageRows = [];
  let partUsageRows = [];
  let messageModelRows = [];
  try {
    messageUsageRows = await sqliteJson(OPENCODE_DB, `
      select
        session_id as sessionId,
        sum(coalesce(json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.prompt'), 0)) as input,
        sum(coalesce(json_extract(data, '$.tokens.output'), json_extract(data, '$.tokens.completion'), 0)) as output,
        sum(coalesce(json_extract(data, '$.tokens.cacheRead'), json_extract(data, '$.tokens.cache_read'), json_extract(data, '$.tokens.cache.read'), 0)) as cacheRead,
        sum(coalesce(json_extract(data, '$.tokens.cacheWrite'), json_extract(data, '$.tokens.cache_write'), json_extract(data, '$.tokens.cache.write'), 0)) as cacheWrite,
        sum(coalesce(json_extract(data, '$.tokens.total'), 0)) as explicitTotal,
        max(coalesce(json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.prompt'), 0) + coalesce(json_extract(data, '$.tokens.output'), json_extract(data, '$.tokens.completion'), 0) + coalesce(json_extract(data, '$.tokens.cacheWrite'), json_extract(data, '$.tokens.cache_write'), json_extract(data, '$.tokens.cache.write'), 0)) as pressure
      from message
      where session_id in (${sessionIds})
      group by session_id
    `);
  } catch {
    messageUsageRows = [];
  }
  try {
    partUsageRows = await sqliteJson(OPENCODE_DB, `
      select
        session_id as sessionId,
        sum(coalesce(json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.prompt'), 0)) as input,
        sum(coalesce(json_extract(data, '$.tokens.output'), json_extract(data, '$.tokens.completion'), 0)) as output,
        sum(coalesce(json_extract(data, '$.tokens.cacheRead'), json_extract(data, '$.tokens.cache_read'), json_extract(data, '$.tokens.cache.read'), 0)) as cacheRead,
        sum(coalesce(json_extract(data, '$.tokens.cacheWrite'), json_extract(data, '$.tokens.cache_write'), json_extract(data, '$.tokens.cache.write'), 0)) as cacheWrite,
        sum(coalesce(json_extract(data, '$.tokens.total'), 0)) as explicitTotal,
        max(coalesce(json_extract(data, '$.tokens.input'), json_extract(data, '$.tokens.prompt'), 0) + coalesce(json_extract(data, '$.tokens.output'), json_extract(data, '$.tokens.completion'), 0) + coalesce(json_extract(data, '$.tokens.cacheWrite'), json_extract(data, '$.tokens.cache_write'), json_extract(data, '$.tokens.cache.write'), 0)) as pressure
      from part
      where session_id in (${sessionIds})
      group by session_id
    `);
  } catch {
    partUsageRows = [];
  }
  try {
    messageModelRows = await sqliteJson(OPENCODE_DB, `
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
  for (const row of [...messageUsageRows, ...partUsageRows]) {
    const sessionId = row.sessionId;
    if (!sessionId) continue;
    if (!usageBySession.has(sessionId)) {
      usageBySession.set(sessionId, emptyUsage());
    }
    const usage = usageBySession.get(sessionId);
    const input = Number(row.input || 0);
    const output = Number(row.output || 0);
    const cacheRead = Number(row.cacheRead || 0);
    const cacheWrite = Number(row.cacheWrite || 0);
    const explicitTotal = Number(row.explicitTotal || 0);
    usage.tokens.input += input;
    usage.tokens.output += output;
    usage.tokens.cacheRead += cacheRead;
    usage.tokens.cacheWrite += cacheWrite;
    usage.tokens.total += explicitTotal || (input + output + cacheRead + cacheWrite);
    usage.tokenPressure.total = Math.max(usage.tokenPressure.total, Number(row.pressure || 0));
  }
  const fallbackModelBySession = new Map();
  for (const row of messageModelRows) {
    if (!row.sessionId || fallbackModelBySession.has(row.sessionId)) continue;
    const label = modelLabelFromParts({ source: 'opencode', provider: row.providerID, model: row.modelID, variant: row.variant });
    if (label) fallbackModelBySession.set(row.sessionId, label);
  }

  return sessions.map((session) => ({
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
  })).filter((summary) => isUnderRoot(summary.cwd, ctx.workspaceRoot));
}

async function loadOpenCodeSession(ctx, ref) {
  const sessionId = ref.replace(/^opencode:/, '');
  const { sessions, messages, parts } = await loadOpenCodeRows(sessionId);
  const session = sessions[0];
  if (!session) throw new Error('OpenCode session not found');
  const summary = summarizeOpenCodeSession(session, messages, parts);
  const relations = await loadOpenCodeRelations(session);
  const diffs = await loadOpenCodeDiffs(session.id);
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

async function listSessions(ctx) {
  const { metadata, error: metadataError } = await readMetadata(ctx);
  const results = await Promise.allSettled([
    sourceEnabled('pi')
      ? withTimeout(listPiSessions(ctx), 'pi source', SOURCE_TIMEOUT_MS)
      : [],
    sourceEnabled('opencode')
      ? withTimeout(listOpenCodeSessions(ctx), 'opencode source', SOURCE_TIMEOUT_MS)
      : [],
  ]);
  const sourceErrors = [];
  const sessions = [];
  for (const [index, result] of results.entries()) {
    const source = index === 0 ? 'pi' : 'opencode';
    if (result.status === 'fulfilled') sessions.push(...result.value);
    else sourceErrors.push(sourceError(source, result.reason));
  }
  sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return { sessions: sessions.map((session) => attachMetadata(session, metadata)), sourceErrors, metadataError, metadataPath: ctx.metadataPath };
}

function isAllowedSessionPath(ctx, candidate) {
  if (isOpenCodeRef(candidate)) return true;
  const resolved = resolve(candidate);
  return isUnderRoot(resolved, PI_SESSION_ROOT);
}

export function createSessionBrowserHandler({ basePath = '/', cockpit = null, workspaceRoot = DEFAULT_WORKSPACE_ROOT, workspaceName = basename(workspaceRoot) || workspaceRoot, metadataPath = DEFAULT_METADATA_PATH } = {}) {
  const normalizedBase = normalizeBasePath(basePath);
  const ctx = { workspaceRoot: resolve(workspaceRoot), workspaceName, metadataPath: resolve(metadataPath) };
  return async function sessionBrowserHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = stripBasePath(url.pathname, normalizedBase);
      if (pathname === null) return false;
      if (pathname === '/api/sessions') {
        const { sessions, sourceErrors, metadataError, metadataPath } = await withTimeout(listSessions(ctx), '/api/sessions', REQUEST_TIMEOUT_MS)
          .catch((error) => ({ sessions: [], sourceErrors: [sourceError('aggregate', error)], metadataError: null, metadataPath: ctx.metadataPath }));
        sendJson(res, 200, { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, sessionRoot: PI_SESSION_ROOT, piSessionRoot: PI_SESSION_ROOT, openCodeDb: OPENCODE_DB, metadataPath, sourceErrors, metadataError, sessions: sessions.map(({ entries, activeEntries, topicAnchors, ...summary }) => summary) });
        return true;
      }
      if (pathname === '/api/summary') {
        const { sessions, sourceErrors, metadataError, metadataPath } = await withTimeout(listSessions(ctx), '/api/summary', REQUEST_TIMEOUT_MS)
          .catch((error) => ({ sessions: [], sourceErrors: [sourceError('aggregate', error)], metadataError: null, metadataPath: ctx.metadataPath }));
        sendJson(res, 200, { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, metadataPath, sourceErrors, metadataError, ...sessionDashboardSummary(sessions) });
        return true;
      }
      if (pathname === '/api/session') {
        const path = url.searchParams.get('path') || url.searchParams.get('ref');
        if (!path || !isAllowedSessionPath(ctx, path)) {
          sendJson(res, 400, { error: 'Invalid session path' });
          return true;
        }
        const session = isOpenCodeRef(path) ? await loadOpenCodeSession(ctx, path) : await loadSessionFile(path);
        if (!isUnderRoot(session.cwd, ctx.workspaceRoot)) {
          sendJson(res, 404, { error: 'Session is outside the current workspace root' });
          return true;
        }
        const { metadata, error: metadataError } = await readMetadata(ctx);
        sendJson(res, 200, { ...attachMetadata(session, metadata), metadataError });
        return true;
      }
      if (pathname === '/api/metadata' && req.method === 'PUT') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const path = payload.path || payload.ref;
            if (!path || !isAllowedSessionPath(ctx, path)) {
              sendJson(res, 400, { error: 'Invalid session path' });
              return;
            }
            const updated = await updateSessionMetadata(ctx, path, payload);
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
