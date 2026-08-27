import { createServer } from 'node:http';
import { constants as fsConstants } from 'node:fs';
import { open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendHistoryEvent, applyBrowserPatch, applyRelationshipPatch, buildHistoryEvent, changedTaskKeys, deriveBlocks, findWorkspaceRoot, historyPathFor, metadataPathFor, readHistory, readMetadata, snapshotTasks, STATUSES, syncMetadataTasks, withMetadataLock, writeMetadata } from './metadata-helpers.mjs';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';
import { planBoardMove } from './public/board-ordering.js';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const PORT = parsePort(process.env.PORT || '8788');
const DEFAULT_WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const DEFAULT_METADATA_PATH = metadataPathFor(DEFAULT_WORKSPACE_ROOT);
const DEFAULT_HISTORY_PATH = historyPathFor(DEFAULT_WORKSPACE_ROOT, DEFAULT_METADATA_PATH);

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STEERING_NOTES_MAX_BYTES = 16_000;
const PREVIEW_MAX_BYTES = 1_000_000;
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${value}`);
  return port;
}

async function discoverTasks(ctx) {
  const projectsDir = join(ctx.workspaceRoot, 'projects');
  const projects = await safeReadDir(projectsDir);
  const tasks = [];
  for (const projectEntry of projects.filter((entry) => entry.isDirectory())) {
    const workDir = join(projectsDir, projectEntry.name, 'work');
    const workEntries = await safeReadDir(workDir);
    for (const taskEntry of workEntries.filter((entry) => entry.isDirectory())) {
      const taskDir = join(workDir, taskEntry.name);
      const taskPath = join(taskDir, 'TASK.md');
      if (!(await exists(taskPath))) continue;
      const handoffPath = join(taskDir, 'HANDOFF.md');
      const [taskText, handoffText, contextText, steeringNotes, runs, artifacts] = await Promise.all([
        readFile(taskPath, 'utf8').catch(() => ''),
        readFile(handoffPath, 'utf8').catch(() => ''),
        readFile(join(taskDir, 'CONTEXT.md'), 'utf8').catch(() => ''),
        readSteeringNotes(taskDir),
        summarizeRuns(ctx, join(taskDir, 'runs')),
        inventoryTaskFiles(taskDir),
      ]);
      tasks.push(summarizeTask(ctx, projectEntry.name, taskEntry.name, taskDir, taskText, handoffText, contextText, steeringNotes, runs, artifacts));
    }
  }
  return tasks.sort((a, b) => a.key.localeCompare(b.key));
}

async function safeReadDir(path) {
  try { return await readdir(path, { withFileTypes: true }); } catch { return []; }
}

function steeringNotesRevision(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function readSteeringNotes(taskDir) {
  const content = await readFile(join(taskDir, 'NOTES.md'), 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  return { content, revision: steeringNotesRevision(content) };
}

async function replaceSteeringNotes(taskDir, content) {
  const target = join(taskDir, 'NOTES.md');
  if (content === '') {
    await unlink(target).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    return;
  }
  const temporary = join(taskDir, `.NOTES.md.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { await rename(temporary, target); }
  catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function updateSteeringNotes(ctx, key, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.content !== 'string' || typeof body.revision !== 'string') {
    throw Object.assign(new Error('Invalid Steering Notes payload'), { statusCode: 400 });
  }
  if (Buffer.byteLength(body.content, 'utf8') > STEERING_NOTES_MAX_BYTES) throw Object.assign(new Error('Steering Notes payload is too large'), { statusCode: 413 });
  const task = (await discoverTasks(ctx)).find((item) => item.key === key);
  if (!task) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  const taskDir = resolve(ctx.workspaceRoot, task.path);
  const expectedDir = resolve(ctx.workspaceRoot, 'projects', task.project, 'work', task.slug);
  if (taskDir !== expectedDir || !taskDir.startsWith(`${resolve(ctx.workspaceRoot, 'projects')}/`)) throw Object.assign(new Error('Unsafe task path'), { statusCode: 400 });
  const current = await readSteeringNotes(taskDir);
  if (current.revision !== body.revision) throw Object.assign(new Error('Steering Notes changed or were consumed; refresh before saving'), { statusCode: 409 });
  await replaceSteeringNotes(taskDir, body.content);
  return readSteeringNotes(taskDir);
}

function summarizeTask(ctx, project, slug, taskDir, taskText, handoffText, contextText, steeringNotes, runs, artifacts) {
  const relPath = relativePath(ctx, taskDir);
  const title = firstHeading(taskText) || slug;
  const latestRunAt = runs[0]?.runAt || null;
  return {
    key: `${project}/${slug}`,
    project,
    slug,
    path: relPath,
    title,
    purpose: sectionText(taskText, 'Purpose'),
    success: sectionText(taskText, 'Success Criteria') || sectionText(taskText, 'Acceptance Criteria'),
    nextSteps: sectionText(handoffText, 'Next Action') || sectionText(handoffText, 'Next Steps'),
    handoff: sectionText(handoffText, 'Current State') || excerpt(handoffText, 900),
    context: excerpt(contextText.replace(/^# .+$/m, '').trim(), 900),
    latestRunAt,
    steeringNotes,
    hasPendingSteeringNotes: Boolean(steeringNotes.content.trim()),
    hasRunLogs: runs.length > 0,
    runs,
    artifacts,
  };
}

function relativePath(ctx, path) {
  return resolve(path).replace(`${ctx.workspaceRoot}/`, '');
}

function firstHeading(text) {
  return text.split(/\r?\n/).find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim();
}

function sectionText(text, heading) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'im');
  return excerpt((text.match(pattern)?.[1] || '').trim(), 1400);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerpt(text, max) {
  const clean = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function compact(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

async function summarizeRuns(ctx, runsDir) {
  const entries = (await safeReadDir(runsDir)).filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  const runs = await Promise.all(entries.map(async (entry) => {
    const path = join(runsDir, entry.name);
    return {
      file: entry.name,
      path: relativePath(ctx, path),
      title: runTitle(entry.name, await readFirstHeading(path)),
      runAt: runTimestamp(entry.name),
    };
  }));
  return runs.sort((a, b) => (Date.parse(b.runAt || '') || 0) - (Date.parse(a.runAt || '') || 0) || b.file.localeCompare(a.file));
}

async function readFirstHeading(path) {
  const handle = await open(path, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return firstHeading(buffer.subarray(0, bytesRead).toString('utf8')) || '';
  } finally {
    await handle.close();
  }
}

async function inventoryTaskFiles(taskDir) {
  const entries = (await safeReadDir(taskDir)).filter((entry) => entry.isFile() && entry.name !== 'NOTES.md');
  return entries.map((entry) => ({ name: entry.name, path: entry.name, previewable: entry.name.toLowerCase().endsWith('.md') }))
    .sort((a, b) => Number(b.previewable) - Number(a.previewable) || a.name.localeCompare(b.name));
}

async function selectedTaskDir(ctx, key) {
  const match = String(key || '').match(/^([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
  if (!match || ['.', '..'].includes(match[1]) || ['.', '..'].includes(match[2])) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  const expected = resolve(ctx.workspaceRoot, 'projects', match[1], 'work', match[2]);
  const actual = await realpath(expected).catch(() => null);
  if (!actual || actual !== expected || !(await exists(join(expected, 'TASK.md')))) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  return expected;
}

async function readTaskPreview(ctx, key, requestedPath, run = false) {
  if (typeof requestedPath !== 'string' || !requestedPath || basename(requestedPath) !== requestedPath || !requestedPath.toLowerCase().endsWith('.md')) {
    throw Object.assign(new Error('Only task-local Markdown files can be previewed'), { statusCode: 400 });
  }
  const taskDir = await selectedTaskDir(ctx, key);
  const parent = run ? join(taskDir, 'runs') : taskDir;
  const target = resolve(parent, requestedPath);
  if (dirname(target) !== parent) throw Object.assign(new Error('Unsafe file path'), { statusCode: 400 });
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('File not found'), { statusCode: 404 });
    if (error?.code === 'ELOOP') throw Object.assign(new Error('Unsafe file path'), { statusCode: 400 });
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw Object.assign(new Error('File not found'), { statusCode: 404 });
    if (info.size > PREVIEW_MAX_BYTES) throw Object.assign(new Error('File is too large to preview'), { statusCode: 413 });
    return { name: requestedPath, path: run ? `runs/${requestedPath}` : requestedPath, content: await handle.readFile('utf8') };
  } finally {
    await handle.close();
  }
}

async function syncMetadata(ctx, discovered) {
  return withMetadataLock(ctx.metadataPath, () => syncMetadataUnlocked(ctx, discovered));
}

async function syncMetadataUnlocked(ctx, discovered) {
  const metadata = syncMetadataTasks(await readMetadata(ctx.metadataPath, { allowMissing: true }), discovered, { inferType });
  await writeMetadata(ctx.metadataPath, metadata);
  return metadata;
}

function runTitle(fileName, heading) {
  if (heading) return heading;
  const stem = fileName.replace(/\.md$/, '');
  const match = stem.match(/^(\d{4}-\d{2}-\d{2})-(\d{4})-(.+)$/);
  if (!match) return fileName;
  const [, date, time, slug] = match;
  const label = slug.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  return `${date} ${time.slice(0, 2)}:${time.slice(2)} — ${label}`;
}

export function runTimestamp(fileName) {
  const name = String(fileName || '');
  let match = name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})?(?:-|\.md$)/);
  if (!match) match = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|\.md$)/);
  if (match) return validRunTimestamp(match.slice(1));
  match = name.match(/^(\d{4})-(\d{2})-(\d{2})-.+\.md$/);
  return match ? validRunTimestamp([...match.slice(1), '00', '00', '00']) : null;
}

export function latestDoneTransition(history = []) {
  return history.reduce((latest, event) => {
    const status = event?.changes?.status;
    const timestamp = status?.after === 'done' && status?.before !== 'done' && Number.isFinite(Date.parse(event.timestamp)) ? event.timestamp : null;
    return timestamp && (!latest || Date.parse(timestamp) > Date.parse(latest)) ? timestamp : latest;
  }, null);
}

function validRunTimestamp([year, month, day, hour, minute, second = '00']) {
  const parts = [year, month, day, hour, minute, second].map(Number);
  const timestamp = new Date(Date.UTC(...parts.slice(0, 3).map((value, index) => index === 1 ? value - 1 : value), ...parts.slice(3)));
  const actual = [timestamp.getUTCFullYear(), timestamp.getUTCMonth() + 1, timestamp.getUTCDate(), timestamp.getUTCHours(), timestamp.getUTCMinutes(), timestamp.getUTCSeconds()];
  return actual.every((value, index) => value === parts[index]) ? timestamp.toISOString() : null;
}

function inferType(task) {
  const text = `${task.slug} ${task.title}`.toLowerCase();
  if (text.includes('review')) return 'review';
  if (text.includes('comparison') || text.includes('research')) return 'research';
  if (text.includes('release')) return 'release';
  if (text.includes('design') || text.includes('model')) return 'design';
  if (text.includes('maintenance')) return 'maintenance';
  return 'implementation';
}

async function taskPayload(ctx) {
  const discovered = await discoverTasks(ctx);
  const metadata = await syncMetadata(ctx, discovered);
  const history = await readHistory(ctx.historyPath, { limit: Number.MAX_SAFE_INTEGER });
  const historyByTask = new Map();
  for (const event of history) {
    if (!historyByTask.has(event.taskKey)) historyByTask.set(event.taskKey, []);
    historyByTask.get(event.taskKey).push(event);
  }
  const tasks = discovered.map((task) => {
    const taskHistory = historyByTask.get(task.key) || [];
    const latestRunAt = task.latestRunAt || (metadata.tasks[task.key]?.status === 'done' ? latestDoneTransition(taskHistory) : null);
    return { ...task, latestRunAt, metadata: { ...metadata.tasks[task.key], blocks: deriveBlocks(metadata, task.key) }, metadataHistory: taskHistory.slice(0, 8) };
  });
  const missing = Object.entries(metadata.tasks).filter(([, value]) => value.missing).map(([key, value]) => ({ key, metadata: value }));
  return { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, metadataPath: ctx.metadataPath, statuses: STATUSES, priorities: PRIORITIES, tasks, missing };
}

function taskDashboardSummary(discovered, metadata) {
  const tasks = discovered.map((task, index) => ({ ...task, metadata: { ...metadata.tasks[task.key], blocks: deriveBlocks(metadata, task.key) }, index }));
  const counts = { active: 0, blocked: 0, review: 0 };
  for (const task of tasks) {
    if (task.metadata.status === 'active') counts.active += 1;
    if (task.metadata.status === 'blocked') counts.blocked += 1;
    if (task.metadata.status === 'review') counts.review += 1;
  }
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const statusRank = { blocked: 0, review: 1, active: 2 };
  const sortedAttentionTasks = tasks
    .filter((task) => ['blocked', 'review', 'active'].includes(task.metadata.status))
    .sort((a, b) => (statusRank[a.metadata.status] - statusRank[b.metadata.status])
      || ((priorityRank[a.metadata.priority] ?? 4) - (priorityRank[b.metadata.priority] ?? 4))
      || (a.index - b.index)
      || a.title.localeCompare(b.title)
      || a.key.localeCompare(b.key));
  const compactTask = (task) => task ? ({
    key: task.key,
    title: task.title,
    status: task.metadata.status || 'unknown',
    priority: task.metadata.priority || 'normal',
    path: task.path,
    nextSteps: task.nextSteps,
  }) : null;
  const topPriorityTasks = sortedAttentionTasks.slice(0, 3).map(compactTask);
  const topTasksByStatus = Object.fromEntries(['active', 'blocked', 'review'].map((status) => [status, compactTask(sortedAttentionTasks.find((task) => task.metadata.status === status))]));
  const actionableStatuses = new Set(['planned', 'active', 'blocked', 'review']);
  const nextActorTasks = tasks
    .filter((task) => actionableStatuses.has(task.metadata.status) && ['operator', 'agent'].includes(task.metadata.nextActor))
    .sort((a, b) => (statusRank[a.metadata.status] ?? 3) - (statusRank[b.metadata.status] ?? 3)
      || ((priorityRank[a.metadata.priority] ?? 4) - (priorityRank[b.metadata.priority] ?? 4))
      || ((a.metadata.order ?? Number.MAX_SAFE_INTEGER) - (b.metadata.order ?? Number.MAX_SAFE_INTEGER))
      || (a.index - b.index)
      || a.title.localeCompare(b.title)
      || a.key.localeCompare(b.key));
  const nextActorCounts = { operator: 0, agent: 0 };
  for (const task of nextActorTasks) nextActorCounts[task.metadata.nextActor] += 1;
  const nextActors = {
    counts: nextActorCounts,
    operatorTasks: nextActorTasks.filter((task) => task.metadata.nextActor === 'operator').slice(0, 3).map(compactTask),
  };
  return { counts, topPriorityTasks, topTasksByStatus, nextActors };
}

async function taskSummaryPayload(ctx) {
  const discovered = await discoverTasks(ctx);
  const metadata = await syncMetadata(ctx, discovered);
  return { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, ...taskDashboardSummary(discovered, metadata) };
}

async function updateTaskMetadata(ctx, key, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('Invalid metadata patch'), { statusCode: 400 });
  const discovered = await discoverTasks(ctx);
  if (!discovered.some((task) => task.key === key)) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  return withMetadataLock(ctx.metadataPath, async () => {
    const metadata = await syncMetadataUnlocked(ctx, discovered);
    const beforeTasks = snapshotTasks(metadata);
    const current = metadata.tasks[key] || {};
    metadata.tasks[key] = applyBrowserPatch(current, patch);
    applyRelationshipPatch(metadata, key, patch);
    const events = changedTaskKeys(beforeTasks, metadata).map((taskKey) => buildHistoryEvent({ key: taskKey, task: metadata.tasks[taskKey], before: beforeTasks[taskKey], after: metadata.tasks[taskKey], actor: 'operator', source: 'browser', action: 'metadata.patch' })).filter(Boolean);
    await writeMetadata(ctx.metadataPath, metadata);
    for (const event of events) await appendHistoryEvent(ctx.historyPath, event);
    return { ...metadata.tasks[key], blocks: deriveBlocks(metadata, key) };
  });
}

async function moveTaskOnBoard(ctx, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Object.assign(new Error('Invalid board move'), { statusCode: 400 });
  if (typeof request.key !== 'string' || !request.key) throw Object.assign(new Error('Missing task key'), { statusCode: 400 });
  if (!STATUSES.includes(request.status)) throw Object.assign(new Error('Invalid destination status'), { statusCode: 400 });
  if (!Number.isInteger(request.index) || request.index < 0) throw Object.assign(new Error('Invalid destination index'), { statusCode: 400 });
  const discovered = await discoverTasks(ctx);
  return withMetadataLock(ctx.metadataPath, async () => {
    const metadata = syncMetadataTasks(await readMetadata(ctx.metadataPath, { allowMissing: true }), discovered, { inferType });
    const beforeTasks = snapshotTasks(metadata);
    let plan;
    try {
      plan = planBoardMove(discovered.map((task) => ({ ...task, metadata: metadata.tasks[task.key] })), request);
    } catch (error) {
      throw Object.assign(error, { statusCode: /Unknown task/.test(error.message) ? 404 : 400 });
    }
    for (const change of plan) metadata.tasks[change.key] = applyBrowserPatch(metadata.tasks[change.key], change.metadata);
    const events = changedTaskKeys(beforeTasks, metadata).map((taskKey) => buildHistoryEvent({ key: taskKey, task: metadata.tasks[taskKey], before: beforeTasks[taskKey], after: metadata.tasks[taskKey], actor: 'operator', source: 'browser', action: 'board.move' })).filter(Boolean);
    await writeMetadata(ctx.metadataPath, metadata);
    for (const event of events) await appendHistoryEvent(ctx.historyPath, event);
    return { changes: plan.map(({ key }) => ({ key, metadata: { ...metadata.tasks[key], blocks: deriveBlocks(metadata, key) } })) };
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.reduce((total, chunk) => total + chunk.length, 0) > 64_000) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
  }
}

export function createTaskBrowserHandler({ basePath = '/', cockpit = null, workspaceRoot = DEFAULT_WORKSPACE_ROOT, workspaceName = basename(workspaceRoot), metadataPath = metadataPathFor(workspaceRoot), historyPath = historyPathFor(workspaceRoot, metadataPath) } = {}) {
  const normalizedBase = normalizeBasePath(basePath);
  const ctx = { workspaceRoot: resolve(workspaceRoot), workspaceName, metadataPath: resolve(metadataPath), historyPath: resolve(historyPath) };
  return async function taskBrowserHandler(req, res) {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = stripBasePath(url.pathname, normalizedBase);
      if (pathname === null) return false;
      if (pathname === '/api/tasks') {
        sendJson(res, 200, await taskPayload(ctx));
        return true;
      }
      if (pathname === '/api/summary') {
        sendJson(res, 200, await taskSummaryPayload(ctx));
        return true;
      }
      if (pathname === '/api/task-file' && req.method === 'GET') {
        sendJson(res, 200, await readTaskPreview(ctx, url.searchParams.get('key'), url.searchParams.get('path')));
        return true;
      }
      if (pathname === '/api/run-file' && req.method === 'GET') {
        sendJson(res, 200, await readTaskPreview(ctx, url.searchParams.get('key'), url.searchParams.get('path'), true));
        return true;
      }
      if (pathname === '/api/steering-notes' && req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.key !== 'string' || !body.key) {
          sendJson(res, 400, { error: 'Missing task key' });
          return true;
        }
        sendJson(res, 200, { steeringNotes: await updateSteeringNotes(ctx, body.key, body) });
        return true;
      }
      if (pathname === '/api/task-metadata' && req.method === 'PATCH') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          sendJson(res, 400, { error: 'Invalid request body' });
          return true;
        }
        if (typeof body.key !== 'string' || !body.key) {
          sendJson(res, 400, { error: 'Missing task key' });
          return true;
        }
        sendJson(res, 200, { metadata: await updateTaskMetadata(ctx, body.key, body.metadata) });
        return true;
      }
      if (pathname === '/api/board-move' && req.method === 'POST') {
        sendJson(res, 200, await moveTaskOnBoard(ctx, await readJsonBody(req)));
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
      sendJson(res, error?.statusCode || 500, { error: safeError(error) });
      return true;
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(createTaskBrowserHandler());
  server.listen(PORT, () => {
    console.log(`Task Browser listening at http://localhost:${PORT}`);
    console.log(`Workspace: ${DEFAULT_WORKSPACE_ROOT}`);
    console.log(`Metadata: ${DEFAULT_METADATA_PATH}`);
  });
}
