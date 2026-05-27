import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendHistoryEvent, applyBrowserPatch, applyRelationshipPatch, buildHistoryEvent, changedTaskKeys, deriveBlocks, findWorkspaceRoot, historyPathFor, metadataPathFor, readHistory, readMetadata, snapshotTasks, STATUSES, syncMetadataTasks, writeMetadata } from './metadata-helpers.mjs';
import { exists, normalizeBasePath, readStaticText, safeError, sendHtml, sendJson, serveStaticPath, stripBasePath } from '../shared-web/http.mjs';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const PORT = parsePort(process.env.PORT || '8788');
const DEFAULT_WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const DEFAULT_METADATA_PATH = metadataPathFor(DEFAULT_WORKSPACE_ROOT);
const DEFAULT_HISTORY_PATH = historyPathFor(DEFAULT_WORKSPACE_ROOT, DEFAULT_METADATA_PATH);

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
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
      const [taskText, handoffText, contextText, runs, handoffStat] = await Promise.all([
        readFile(taskPath, 'utf8').catch(() => ''),
        readFile(handoffPath, 'utf8').catch(() => ''),
        readFile(join(taskDir, 'CONTEXT.md'), 'utf8').catch(() => ''),
        summarizeRuns(ctx, join(taskDir, 'runs')),
        stat(handoffPath).catch(() => null),
      ]);
      tasks.push(summarizeTask(ctx, projectEntry.name, taskEntry.name, taskDir, taskText, handoffText, contextText, runs, handoffStat));
    }
  }
  return tasks.sort((a, b) => a.key.localeCompare(b.key));
}

async function safeReadDir(path) {
  try { return await readdir(path, { withFileTypes: true }); } catch { return []; }
}

function summarizeTask(ctx, project, slug, taskDir, taskText, handoffText, contextText, runs, handoffStat) {
  const relPath = relativePath(ctx, taskDir);
  const title = firstHeading(taskText) || slug;
  const latestRunAt = runTimestamp(runs[0]?.file) || handoffStat?.mtime?.toISOString() || null;
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
    hasRunLogs: runs.length > 0,
    runs,
    files: {
      task: `${relPath}/TASK.md`,
      handoff: `${relPath}/HANDOFF.md`,
      context: `${relPath}/CONTEXT.md`,
      runs: `${relPath}/runs/`,
    },
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
  const entries = (await safeReadDir(runsDir)).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
  return Promise.all(entries.map(async (entry) => {
    const path = join(runsDir, entry.name);
    const text = await readFile(path, 'utf8').catch(() => '');
    return {
      file: entry.name,
      path: relativePath(ctx, path),
      title: runTitle(entry.name, firstHeading(text)),
      goal: compact(sectionText(text, 'Goal') || sectionText(text, 'Purpose') || '', 360),
    };
  }));
}

async function syncMetadata(ctx, discovered) {
  const metadata = syncMetadataTasks(await readMetadata(ctx.metadataPath, { allowMissing: true }), discovered, { inferType });
  await writeMetadata(ctx.metadataPath, metadata);
  return metadata;
}

function runTitle(fileName, heading) {
  const stem = fileName.replace(/\.md$/, '');
  const match = stem.match(/^(\d{4}-\d{2}-\d{2})-(\d{4})-(.+)$/);
  if (!match) return heading || fileName;
  const [, date, time, slug] = match;
  const label = slug.split('-').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  return `${date} ${time.slice(0, 2)}:${time.slice(2)} — ${label}`;
}

function runTimestamp(fileName) {
  const match = String(fileName || '').match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-/);
  return match ? `${match[1]}T${match[2]}:${match[3]}:00.000Z` : null;
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
  const history = await readHistory(ctx.historyPath, { limit: 1000 });
  const historyByTask = new Map();
  for (const event of history) {
    if (!historyByTask.has(event.taskKey)) historyByTask.set(event.taskKey, []);
    if (historyByTask.get(event.taskKey).length < 8) historyByTask.get(event.taskKey).push(event);
  }
  const tasks = discovered.map((task) => ({ ...task, metadata: { ...metadata.tasks[task.key], blocks: deriveBlocks(metadata, task.key) }, metadataHistory: historyByTask.get(task.key) || [] }));
  const missing = Object.entries(metadata.tasks).filter(([, value]) => value.missing).map(([key, value]) => ({ key, metadata: value }));
  return { workspaceRoot: ctx.workspaceRoot, workspaceName: ctx.workspaceName, metadataPath: ctx.metadataPath, statuses: STATUSES, priorities: PRIORITIES, tasks, missing };
}

async function updateTaskMetadata(ctx, key, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('Invalid metadata patch'), { statusCode: 400 });
  const discovered = await discoverTasks(ctx);
  if (!discovered.some((task) => task.key === key)) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  const metadata = await syncMetadata(ctx, discovered);
  const beforeTasks = snapshotTasks(metadata);
  const current = metadata.tasks[key] || {};
  metadata.tasks[key] = applyBrowserPatch(current, patch);
  applyRelationshipPatch(metadata, key, patch);
  const events = changedTaskKeys(beforeTasks, metadata).map((taskKey) => buildHistoryEvent({ key: taskKey, task: metadata.tasks[taskKey], before: beforeTasks[taskKey], after: metadata.tasks[taskKey], actor: 'operator', source: 'browser', action: 'metadata.patch' })).filter(Boolean);
  await writeMetadata(ctx.metadataPath, metadata);
  for (const event of events) await appendHistoryEvent(ctx.historyPath, event);
  return { ...metadata.tasks[key], blocks: deriveBlocks(metadata, key) };
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
