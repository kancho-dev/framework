import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const PORT = parsePort(process.env.PORT || '8788');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const METADATA_PATH = resolve(process.env.TASK_BROWSER_METADATA || join(WORKSPACE_ROOT, '.task-browser', 'tasks.json'));

const STATUSES = ['planned', 'active', 'blocked', 'review', 'paused', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml; charset=utf-8']]);

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${value}`);
  return port;
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
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

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Unknown error';
}

async function discoverTasks() {
  const projectsDir = join(WORKSPACE_ROOT, 'projects');
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
        summarizeRuns(join(taskDir, 'runs')),
        stat(handoffPath).catch(() => null),
      ]);
      tasks.push(summarizeTask(projectEntry.name, taskEntry.name, taskDir, taskText, handoffText, contextText, runs, handoffStat));
    }
  }
  return tasks.sort((a, b) => a.key.localeCompare(b.key));
}

async function safeReadDir(path) {
  try { return await readdir(path, { withFileTypes: true }); } catch { return []; }
}

function summarizeTask(project, slug, taskDir, taskText, handoffText, contextText, runs, handoffStat) {
  const relPath = relativePath(taskDir);
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

function relativePath(path) {
  return resolve(path).replace(`${WORKSPACE_ROOT}/`, '');
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

async function summarizeRuns(runsDir) {
  const entries = (await safeReadDir(runsDir)).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).sort((a, b) => b.name.localeCompare(a.name));
  return Promise.all(entries.map(async (entry) => {
    const path = join(runsDir, entry.name);
    const text = await readFile(path, 'utf8').catch(() => '');
    return {
      file: entry.name,
      path: relativePath(path),
      title: runTitle(entry.name, firstHeading(text)),
      goal: compact(sectionText(text, 'Goal') || sectionText(text, 'Purpose') || '', 360),
    };
  }));
}

async function readMetadata() {
  try {
    const parsed = JSON.parse(await readFile(METADATA_PATH, 'utf8'));
    return normalizeMetadata(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, nextDisplayNumber: 1, tasks: {} };
    throw error;
  }
}

function normalizeMetadata(metadata) {
  return {
    version: 1,
    nextDisplayNumber: Number.isInteger(metadata?.nextDisplayNumber) ? metadata.nextDisplayNumber : 1,
    tasks: metadata?.tasks && typeof metadata.tasks === 'object' ? metadata.tasks : {},
  };
}

async function syncMetadata(discovered) {
  const metadata = await readMetadata();
  const nowKeys = new Set(discovered.map((task) => task.key));
  for (const task of discovered) {
    const existing = metadata.tasks[task.key] || {};
    metadata.tasks[task.key] = {
      displayId: existing.displayId || `#${metadata.nextDisplayNumber++}`,
      project: task.project,
      slug: task.slug,
      path: task.path,
      status: valid(existing.status, STATUSES, 'planned'),
      priority: valid(existing.priority, PRIORITIES, 'normal'),
      type: typeof existing.type === 'string' && existing.type ? existing.type : inferType(task),
      blockedBy: arrayOfStrings(existing.blockedBy),
      parent: typeof existing.parent === 'string' ? existing.parent : null,
      children: arrayOfStrings(existing.children),
      related: arrayOfStrings(existing.related),
      tags: arrayOfStrings(existing.tags),
      order: Number.isFinite(existing.order) ? existing.order : null,
    };
  }
  for (const [key, task] of Object.entries(metadata.tasks)) {
    if (!nowKeys.has(key)) task.missing = true;
    else delete task.missing;
  }
  await writeMetadata(metadata);
  return metadata;
}

function valid(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))] : [];
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

async function writeMetadata(metadata) {
  await mkdir(dirname(METADATA_PATH), { recursive: true });
  const temp = `${METADATA_PATH}.tmp`;
  await writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(temp, METADATA_PATH);
}

async function taskPayload() {
  const discovered = await discoverTasks();
  const metadata = await syncMetadata(discovered);
  const tasks = discovered.map((task) => ({ ...task, metadata: metadata.tasks[task.key] }));
  const missing = Object.entries(metadata.tasks).filter(([, value]) => value.missing).map(([key, value]) => ({ key, metadata: value }));
  return { workspaceRoot: WORKSPACE_ROOT, workspaceName: basename(WORKSPACE_ROOT), metadataPath: METADATA_PATH, statuses: STATUSES, priorities: PRIORITIES, tasks, missing };
}

async function updateTaskMetadata(key, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('Invalid metadata patch'), { statusCode: 400 });
  const discovered = await discoverTasks();
  if (!discovered.some((task) => task.key === key)) throw Object.assign(new Error('Unknown task'), { statusCode: 404 });
  const metadata = await syncMetadata(discovered);
  const current = metadata.tasks[key] || {};
  const next = { ...current };
  if ('status' in patch) next.status = valid(patch.status, STATUSES, current.status || 'planned');
  if ('priority' in patch) next.priority = valid(patch.priority, PRIORITIES, current.priority || 'normal');
  if ('type' in patch) next.type = typeof patch.type === 'string' && patch.type.trim() ? patch.type.trim() : current.type;
  if ('tags' in patch) next.tags = arrayOfStrings(patch.tags);
  if ('order' in patch) next.order = patch.order === null || patch.order === '' ? null : Number(patch.order);
  if (!Number.isFinite(next.order)) next.order = null;
  metadata.tasks[key] = next;
  await writeMetadata(metadata);
  return next;
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/tasks') return sendJson(res, 200, await taskPayload());
    if (url.pathname === '/api/task-metadata' && req.method === 'PATCH') {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'Invalid request body' });
      if (typeof body.key !== 'string' || !body.key) return sendJson(res, 400, { error: 'Missing task key' });
      return sendJson(res, 200, { metadata: await updateTaskMetadata(body.key, body.metadata) });
    }
    const filePath = url.pathname === '/' ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, decodeURIComponent(url.pathname));
    const resolved = resolve(filePath);
    if (!resolved.startsWith(`${PUBLIC_DIR}/`) && resolved !== join(PUBLIC_DIR, 'index.html')) return sendJson(res, 403, { error: 'Forbidden' });
    if (!(await exists(resolved))) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': mime.get(extname(resolved)) || 'application/octet-stream' });
    createReadStream(resolved).pipe(res);
  } catch (error) {
    sendJson(res, error?.statusCode || 500, { error: safeError(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Task Browser listening at http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_ROOT}`);
  console.log(`Metadata: ${METADATA_PATH}`);
});
