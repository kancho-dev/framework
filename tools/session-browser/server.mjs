import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = parsePort(process.env.PORT || '8787');
const PI_SESSION_ROOT = resolve(process.env.SESSION_ROOT || process.env.PI_SESSION_ROOT || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions'));
const OPENCODE_DATA_DIR = resolve(process.env.OPENCODE_DATA_DIR || join(homedir(), '.local', 'share', 'opencode'));
const OPENCODE_DB = resolve(process.env.OPENCODE_DB || join(OPENCODE_DATA_DIR, 'opencode.db'));
const ENABLED_SOURCES = new Set(String(process.env.SESSION_SOURCES || 'pi,opencode').split(',').map((source) => source.trim().toLowerCase()).filter(Boolean));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const METADATA_PATH = resolve(process.env.SESSION_BROWSER_METADATA || join(TOOL_DIR, '.cache', 'metadata.json'));
const execFileAsync = promisify(execFile);
const SOURCE_TIMEOUT_MS = Number(process.env.SESSION_SOURCE_TIMEOUT_MS || '8000');
const REQUEST_TIMEOUT_MS = Number(process.env.SESSION_REQUEST_TIMEOUT_MS || '10000');

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
]);

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function safeSourceError(error) {
  const message = safeError(error);
  if (message.includes('ENOENT') || message.includes('sqlite3')) return 'sqlite3 unavailable or OpenCode database cannot be read';
  if (message.includes('no such table')) return 'unexpected OpenCode database schema';
  return message.split('\n')[0].slice(0, 220);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

function collectStats(entries) {
  const stats = {
    assistantAnswerCount: 0,
    toolMessageCount: 0,
    toolCallCount: 0,
    toolNames: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tokenPressure: { total: 0 },
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
  };
}

async function loadSessionFile(path) {
  const [fileStat, content] = await Promise.all([stat(path), readFile(path, 'utf8')]);
  const parsed = parseJsonl(content);
  const summary = summarizeSession(path, fileStat, parsed);
  const entries = parsed.filter((entry) => entry?.type !== 'session');
  const activeEntries = buildActiveEntries(entries, summary.leafId);
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

async function listPiSessions() {
  const files = await walkJsonlFiles(PI_SESSION_ROOT);
  const settled = await Promise.allSettled(files.map(async (file) => loadSessionFile(file)));
  return settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((session) => isUnderRoot(session.cwd, WORKSPACE_ROOT))
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

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return Array.from(new Set(labels.map((label) => String(label || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function emptyMetadata() {
  return { version: 1, sessions: {} };
}

async function readMetadata() {
  try {
    const parsed = JSON.parse(await readFile(METADATA_PATH, 'utf8'));
    const sessions = parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
    const normalized = emptyMetadata();
    for (const [key, value] of Object.entries(sessions)) {
      normalized.sessions[key] = { bookmarked: Boolean(value?.bookmarked), labels: normalizeLabels(value?.labels) };
    }
    return { metadata: normalized, error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { metadata: emptyMetadata(), error: null };
    return { metadata: emptyMetadata(), error: `Metadata unavailable: ${safeError(error)}` };
  }
}

async function writeMetadata(metadata) {
  await mkdir(dirname(METADATA_PATH), { recursive: true });
  const tmp = `${METADATA_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(tmp, METADATA_PATH);
}

function metadataForSession(metadata, session) {
  const item = metadata.sessions[sessionKey(session)] || {};
  return { bookmarkKey: sessionKey(session), bookmarked: Boolean(item.bookmarked), labels: normalizeLabels(item.labels) };
}

function attachMetadata(session, metadata) {
  return { ...session, metadata: metadataForSession(metadata, session) };
}

async function updateSessionMetadata(path, patch) {
  const key = sessionKey(path);
  const { metadata, error } = await readMetadata();
  if (error) throw new Error(error);
  const current = metadata.sessions[key] || { bookmarked: false, labels: [] };
  const next = {
    bookmarked: patch.bookmarked === undefined ? Boolean(current.bookmarked) : Boolean(patch.bookmarked),
    labels: patch.labels === undefined ? normalizeLabels(current.labels) : normalizeLabels(patch.labels),
  };
  if (!next.bookmarked && next.labels.length === 0) delete metadata.sessions[key];
  else metadata.sessions[key] = next;
  await writeMetadata(metadata);
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
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
  const stats = {
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tokenPressure: { total: 0 },
  };
  for (const item of [...messages, ...parts]) {
    const data = item.data || {};
    const tokens = data.tokens || {};
    const input = tokens.input || tokens.prompt || 0;
    const output = tokens.output || tokens.completion || 0;
    const cacheRead = tokens.cacheRead || tokens.cache_read || 0;
    const cacheWrite = tokens.cacheWrite || tokens.cache_write || 0;
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
  const sessionWhere = sessionId ? `where s.id = ${sqlString(sessionId)}` : '';
  let sessions;
  try {
    sessions = await sqliteJson(OPENCODE_DB, `
      select s.id, s.directory, s.title, s.parent_id as parentId, s.time_created as createdAt, s.time_updated as updatedAt, s.time_archived as archivedAt, p.worktree
      from session s
      left join project p on p.id = s.project_id
      ${sessionWhere}
      order by s.time_updated desc
    `);
  } catch (error) {
    if (!safeError(error).includes('no such table: project')) throw error;
    sessions = await sqliteJson(OPENCODE_DB, `
      select s.id, s.directory, s.title, s.parent_id as parentId, s.time_created as createdAt, s.time_updated as updatedAt, s.time_archived as archivedAt, null as worktree
      from session s
      ${sessionWhere}
      order by s.time_updated desc
    `);
  }
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
  return {
    id: session.id,
    source: 'opencode',
    path: opencodeRef(session.id),
    parentId: session.parentId || null,
    cwd: session.directory || session.worktree || '',
    name: session.title,
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

async function listOpenCodeSessions() {
  if (!await exists(OPENCODE_DB)) return [];
  const sessions = await sqliteJson(
    OPENCODE_DB,
    `select id, parent_id as parentId, directory, title, time_created as createdAt, time_updated as updatedAt, time_archived as archivedAt
     from session
     where time_archived is null
     order by time_updated desc
     limit 200`
  );
  return sessions.map((session) => ({
    source: 'opencode',
    path: `opencode:${session.id}`,
    id: session.id,
    parentId: session.parentId || null,
    cwd: session.directory || '',
    name: session.title || '',
    firstPrompt: '',
    createdAt: timestampFromMs(session.createdAt),
    updatedAt: timestampFromMs(session.updatedAt),
    leafId: null,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    assistantRawMessageCount: 0,
    toolMessageCount: 0,
    toolResultCount: 0,
    toolCallCount: 0,
    toolNames: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tokenPressure: { total: 0 },
    archivedAt: timestampFromMs(session.archivedAt),
  })).filter((summary) => isUnderRoot(summary.cwd, WORKSPACE_ROOT));
}

async function loadOpenCodeSession(ref) {
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
      model: message.data.modelID || message.data.model,
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
  return { ...summary, ...relations, entries, activeEntries: entries, topicAnchors };
}

async function listSessions() {
  const { metadata, error: metadataError } = await readMetadata();
  const results = await Promise.allSettled([
    sourceEnabled('pi')
      ? withTimeout(listPiSessions(), 'pi source', SOURCE_TIMEOUT_MS)
      : [],
    sourceEnabled('opencode')
      ? withTimeout(listOpenCodeSessions(), 'opencode source', SOURCE_TIMEOUT_MS)
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
  return { sessions: sessions.map((session) => attachMetadata(session, metadata)), sourceErrors, metadataError, metadataPath: METADATA_PATH };
}

function isAllowedSessionPath(candidate) {
  if (isOpenCodeRef(candidate)) return true;
  const resolved = resolve(candidate);
  return isUnderRoot(resolved, PI_SESSION_ROOT);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = resolve(PUBLIC_DIR, `.${pathname}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}/`) && filePath !== PUBLIC_DIR) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  createReadStream(filePath)
    .on('error', () => res.writeHead(404).end('Not found'))
    .on('open', () => res.writeHead(200, { 'content-type': mime.get(extname(filePath)) || 'application/octet-stream', 'cache-control': 'no-store' }))
    .pipe(res);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/sessions') {
      const { sessions, sourceErrors, metadataError, metadataPath } = await withTimeout(listSessions(), '/api/sessions', REQUEST_TIMEOUT_MS)
        .catch((error) => ({ sessions: [], sourceErrors: [sourceError('aggregate', error)], metadataError: null, metadataPath: METADATA_PATH }));
      sendJson(res, 200, { workspaceRoot: WORKSPACE_ROOT, sessionRoot: PI_SESSION_ROOT, piSessionRoot: PI_SESSION_ROOT, openCodeDb: OPENCODE_DB, metadataPath, sourceErrors, metadataError, sessions: sessions.map(({ entries, activeEntries, topicAnchors, ...summary }) => summary) });
      return;
    }
    if (url.pathname === '/api/session') {
      const path = url.searchParams.get('path') || url.searchParams.get('ref');
      if (!path || !isAllowedSessionPath(path)) {
        sendJson(res, 400, { error: 'Invalid session path' });
        return;
      }
      const session = isOpenCodeRef(path) ? await loadOpenCodeSession(path) : await loadSessionFile(path);
      if (!isUnderRoot(session.cwd, WORKSPACE_ROOT)) {
        sendJson(res, 404, { error: 'Session is outside the current workspace root' });
        return;
      }
      const { metadata, error: metadataError } = await readMetadata();
      sendJson(res, 200, { ...attachMetadata(session, metadata), metadataError });
      return;
    }
    if (url.pathname === '/api/metadata' && req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const path = payload.path || payload.ref;
          if (!path || !isAllowedSessionPath(path)) {
            sendJson(res, 400, { error: 'Invalid session path' });
            return;
          }
          const updated = await updateSessionMetadata(path, payload);
          sendJson(res, 200, { metadataPath: METADATA_PATH, metadata: updated });
        } catch (error) {
          sendJson(res, 500, { error: safeError(error), metadataPath: METADATA_PATH });
        }
      });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: safeError(error), workspaceRoot: WORKSPACE_ROOT, sessionRoot: PI_SESSION_ROOT, openCodeDb: OPENCODE_DB });
  }
}).listen(PORT, () => {
  console.log(`Session Browser: http://localhost:${PORT}`);
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`Pi session root: ${PI_SESSION_ROOT}`);
  console.log(`OpenCode DB: ${OPENCODE_DB}`);
  console.log(`Metadata: ${METADATA_PATH}`);
});
