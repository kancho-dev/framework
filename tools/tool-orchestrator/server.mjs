import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskBrowserHandler } from '../task-browser/server.mjs';
import { createSessionBrowserHandler } from '../session-browser/server.mjs';
import { exists, safeError, sendJson, serveStaticPath } from '../shared-web/http.mjs';

const toolNav = [
  { id: 'task-browser', title: 'Task Browser', shortTitle: 'Tasks', route: '/tools/tasks/', icon: '/tools/tasks/icon.svg' },
  { id: 'session-browser', title: 'Session Browser', shortTitle: 'Sessions', route: '/tools/sessions/', icon: '/tools/sessions/icon.svg' },
];

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const PORT = parsePort(process.env.TOOL_ORCHESTRATOR_PORT || process.env.PORT || '8789');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));

const tools = [
  {
    id: 'task-browser',
    title: 'Task Browser',
    route: '/tools/tasks/',
    api: '/tools/tasks/api/tasks',
    icon: 'icons/task-browser.svg',
    description: 'Review task state, handoffs, runs, and metadata.',
    action: 'Open tasks',
    handler: createTaskBrowserHandler({ basePath: '/tools/tasks', cockpit: { enabled: true, home: '/', current: 'task-browser', tools: toolNav } }),
  },
  {
    id: 'session-browser',
    title: 'Session Browser',
    route: '/tools/sessions/',
    api: '/tools/sessions/api/sessions',
    icon: 'icons/session-browser.svg',
    description: 'Search recent local agent sessions for context.',
    action: 'Open sessions',
    handler: createSessionBrowserHandler({ basePath: '/tools/sessions', cockpit: { enabled: true, home: '/', current: 'session-browser', tools: toolNav } }),
  },
];

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${value}`);
  return port;
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

async function toolStatuses() {
  const taskRoot = join(WORKSPACE_ROOT, 'projects');
  const statuses = await Promise.all(tools.map(async (tool) => {
    if (tool.id === 'task-browser') {
      return { ...publicTool(tool), status: await exists(taskRoot) ? 'ready' : 'warning', detail: await exists(taskRoot) ? 'Tasks available from this workspace.' : 'No projects directory found under workspace root.' };
    }
    if (tool.id === 'session-browser') {
      return { ...publicTool(tool), status: 'ready', detail: 'Session sources are checked on open.' };
    }
    return { ...publicTool(tool), status: 'unknown', detail: 'No status check configured.' };
  }));
  return { workspaceRoot: WORKSPACE_ROOT, localOnly: true, tools: statuses };
}

function publicTool(tool) {
  const { handler, ...rest } = tool;
  return rest;
}

async function routeToMountedTool(req, res) {
  for (const tool of tools) {
    if (req.url === tool.route.slice(0, -1)) {
      res.writeHead(302, { location: tool.route });
      res.end();
      return true;
    }
    const handled = await tool.handler(req, res);
    if (handled) return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/api/tools') return sendJson(res, 200, await toolStatuses());
    if (url.pathname.startsWith('/shared/')) return serveStaticPath(res, join(TOOL_DIR, '..', 'shared-web'), url.pathname.replace('/shared', '') || '/');
    if (await routeToMountedTool(req, res)) return;
    await serveStaticPath(res, PUBLIC_DIR, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: safeError(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Framework Cockpit: http://localhost:${PORT}`);
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
  console.log('Local-only tool shell; standalone Task Browser and Session Browser remain available.');
});
