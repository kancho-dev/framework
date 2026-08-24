import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskBrowserHandler } from '../task-browser/server.mjs';
import { createSessionBrowserHandler } from '../session-browser/server.mjs';
import { createTokensCostAnalyzerHandler } from '../tokens-cost-analyzer/server.mjs';
import { exists, readStaticText, safeError, sendHtml, sendJson, serveStaticPath } from '../shared-web/http.mjs';
import { normalizeWorkspaceId } from '../shared-web/workspace-identity.mjs';
import { createSubscriptionLimitsReader } from './subscription-limits.mjs';

const baseToolNav = [
  { id: 'task-browser', title: 'Task Browser', shortTitle: 'Tasks', route: '/tools/tasks/', icon: '/tools/tasks/icon.svg' },
  { id: 'session-browser', title: 'Session Browser', shortTitle: 'Sessions', route: '/tools/sessions/', icon: '/tools/sessions/icon.svg' },
  { id: 'tokens-cost-analyzer', title: 'Tokens / Cost Analyzer', shortTitle: 'Costs', route: '/tools/tokens-cost-analyzer/', icon: '/tools/tokens-cost-analyzer/icon.svg' },
];

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(TOOL_DIR, 'public');
const SHARED_WEB_DIR = join(TOOL_DIR, '..', 'shared-web');
const TOOL_PUBLIC_DIRS = new Map([
  ['task-browser', join(TOOL_DIR, '..', 'task-browser', 'public')],
  ['session-browser', join(TOOL_DIR, '..', 'session-browser', 'public')],
  ['tokens-cost-analyzer', join(TOOL_DIR, '..', 'tokens-cost-analyzer', 'public')],
]);
const TOOL_ASSET_EXTENSIONS = new Set(['.js', '.css', '.svg', '.png', '.ico', '.webp', '.woff', '.woff2', '.map']);
const PORT = parsePort(process.env.TOOL_ORCHESTRATOR_PORT || process.env.PORT || '8789');
const WORKSPACE_ROOT = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const DEFAULT_WORKSPACE_CONFIG_PATH = join(WORKSPACE_ROOT, '.tools-config', 'tool-orchestrator', 'workspaces.json');
const WORKSPACE_CONFIG_PATH = process.env.TOOL_ORCHESTRATOR_WORKSPACES_CONFIG || (await exists(DEFAULT_WORKSPACE_CONFIG_PATH) ? DEFAULT_WORKSPACE_CONFIG_PATH : '');
const workspaceConfig = await loadWorkspaceConfig();
const legacyMachineCwdHints = archiveMachineCwdHints(workspaceConfig.workspaces);
const handlers = new Map(workspaceConfig.workspaces.map((workspace) => [workspace.id, createWorkspaceHandlers(workspace, legacyMachineCwdHints)]));

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

async function loadWorkspaceConfig() {
  if (!WORKSPACE_CONFIG_PATH) return defaultWorkspaceConfig();
  const parsed = JSON.parse(await readFile(resolve(WORKSPACE_CONFIG_PATH), 'utf8'));
  if (!Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) throw new Error('Workspace config must include a non-empty workspaces array');
  const ids = new Set();
  const configPath = resolve(WORKSPACE_CONFIG_PATH);
  const sessionArchiveManifestPath = parsed.sessionArchiveManifestPath
    ? resolve(dirname(configPath), requiredString(parsed.sessionArchiveManifestPath, 'sessionArchiveManifestPath'))
    : null;
  const workspaces = parsed.workspaces.map((entry) => normalizeWorkspace(entry, ids, sessionArchiveManifestPath, dirname(configPath)));
  const fallbackId = workspaces.find((workspace) => workspace.root === WORKSPACE_ROOT)?.id || workspaces[0].id;
  const defaultWorkspace = parsed.defaultWorkspace && ids.has(parsed.defaultWorkspace) ? parsed.defaultWorkspace : fallbackId;
  return { defaultWorkspace, workspaces, configured: true, path: resolve(WORKSPACE_CONFIG_PATH) };
}

function defaultWorkspaceConfig() {
  const id = 'default';
  return {
    defaultWorkspace: id,
    configured: false,
    path: null,
    workspaces: [{ id, name: basename(WORKSPACE_ROOT) || WORKSPACE_ROOT, root: WORKSPACE_ROOT, tools: {} }],
  };
}

function normalizeArchiveBindings(value, configDir, workspaceId) {
  if (!Array.isArray(value)) return [];
  return value.map((binding, index) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error(`workspace ${workspaceId} sessionArchiveBindings[${index}] must be an object`);
    const machineId = requiredString(binding.machineId, `workspace ${workspaceId} sessionArchiveBindings[${index}].machineId`);
    const metadataBundlePath = binding.metadataBundlePath
      ? resolve(configDir, requiredString(binding.metadataBundlePath, `workspace ${workspaceId} sessionArchiveBindings[${index}].metadataBundlePath`))
      : null;
    const archivedWorkspaceId = binding.archivedWorkspaceId ? normalizeWorkspaceId(binding.archivedWorkspaceId) : null;
    return { ...structuredClone(binding), machineId, ...(metadataBundlePath ? { metadataBundlePath } : {}), ...(archivedWorkspaceId ? { archivedWorkspaceId } : {}) };
  });
}

function archiveMachineCwdHints(workspaces) {
  const hints = {};
  for (const workspace of workspaces) for (const binding of workspace.sessionArchiveBindings || []) {
    const values = hints[binding.machineId] ||= new Set();
    for (const mapping of binding.pathMap || []) if (typeof mapping?.from === 'string') values.add(resolve(mapping.from));
  }
  return Object.fromEntries(Object.entries(hints).map(([machineId, values]) => [machineId, [...values]]));
}

function normalizeWorkspace(entry, ids, sessionArchiveManifestPath = null, configDir = process.cwd()) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Workspace entries must be objects');
  const id = normalizeWorkspaceId(entry.id);
  if (ids.has(id)) throw new Error(`Duplicate workspace id: ${id}`);
  ids.add(id);
  const root = resolve(requiredString(entry.root, `workspace ${id} root`));
  const tools = entry.tools && typeof entry.tools === 'object' && !Array.isArray(entry.tools) ? entry.tools : {};
  return {
    id,
    name: String(entry.name || basename(root) || id),
    root,
    taskMetadataPath: entry.taskMetadataPath ? resolve(String(entry.taskMetadataPath)) : null,
    taskHistoryPath: entry.taskHistoryPath ? resolve(String(entry.taskHistoryPath)) : null,
    sessionMetadataPath: entry.sessionMetadataPath ? resolve(String(entry.sessionMetadataPath)) : null,
    sessionArchiveManifestPath,
    sessionArchiveBindings: sessionArchiveManifestPath ? normalizeArchiveBindings(entry.sessionArchiveBindings, configDir, id) : null,
    tokensCostAnalyzerOutputPath: entry.tokensCostAnalyzerOutputPath ? resolve(String(entry.tokensCostAnalyzerOutputPath)) : null,
    tools: Object.fromEntries(Object.entries(tools).map(([key, value]) => [key, value !== false])),
  };
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value;
}

function selectedWorkspace(url) {
  const requested = url.searchParams.get('workspace');
  return workspaceConfig.workspaces.find((workspace) => workspace.id === requested) || workspaceConfig.workspaces.find((workspace) => workspace.id === workspaceConfig.defaultWorkspace) || workspaceConfig.workspaces[0];
}

function workspaceQuery(workspace) {
  return workspaceConfig.configured ? `?workspace=${encodeURIComponent(workspace.id)}` : '';
}

function routeFor(route, workspace) {
  return `${route}${workspaceQuery(workspace)}`;
}

function toolEnabled(workspace, toolId) {
  if (toolId === 'tokens-cost-analyzer') return workspace.tools?.[toolId] === true;
  return workspace.tools?.[toolId] !== false;
}

function navFor(workspace) {
  return baseToolNav
    .filter((tool) => toolEnabled(workspace, tool.id))
    .map((tool) => ({ ...tool, route: routeFor(tool.route, workspace), icon: tool.icon.startsWith('/tools/') ? routeFor(tool.icon, workspace) : tool.icon }));
}

function dashboardConfigPath(workspace) {
  return join(workspace.root, '.tools-config', 'tool-orchestrator', 'dashboard.json');
}

const readSubscriptionLimits = createSubscriptionLimitsReader();

const widgetCatalog = {
  'task-counts': { id: 'task-counts', type: 'task-counts', size: 'small', tool: 'task-browser' },
  'priority-tasks': { id: 'priority-tasks', type: 'priority-tasks', size: 'wide', tool: 'task-browser' },
  'latest-bookmarked-session': { id: 'latest-bookmarked-session', type: 'latest-bookmarked-session', size: 'small', tool: 'session-browser' },
  'latest-updated-session': { id: 'latest-updated-session', type: 'latest-updated-session', size: 'small', tool: 'session-browser' },
  'subscription-limits': { id: 'subscription-limits', type: 'subscription-limits', size: 'wide' },
  'daily-usage': { id: 'daily-usage', type: 'daily-usage', size: 'wide', tool: 'tokens-cost-analyzer', default: false },
  tools: { id: 'tools', type: 'tools', size: 'wide' },
};

function availableWidgets(workspace) {
  const enabledToolCount = navFor(workspace).length;
  return Object.values(widgetCatalog)
    .filter((widget) => !widget.tool || toolEnabled(workspace, widget.tool))
    .map((widget) => widget.type === 'tools' ? { ...widget, size: enabledToolCount <= 1 ? 'small' : 'wide' } : widget);
}

function defaultDashboardLayout(workspace) {
  const available = availableWidgets(workspace).filter((widget) => widget.default !== false);
  return available.some((widget) => widget.type === 'tools') ? available : [widgetCatalog.tools];
}

const widgetTypes = new Set(Object.keys(widgetCatalog));

async function readDashboardConfig(workspace) {
  const path = dashboardConfigPath(workspace);
  const catalog = availableWidgets(workspace);
  if (!(await exists(path))) return { source: 'default', path, catalog, layout: defaultDashboardLayout(workspace) };
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return { source: 'workspace', path, catalog, layout: normalizeDashboardLayout(workspace, parsed.layout) };
}

function normalizeDashboardLayout(workspace, layout) {
  if (!Array.isArray(layout)) throw Object.assign(new Error('Dashboard layout must be an array'), { statusCode: 400 });
  const availableTypes = new Set(availableWidgets(workspace).map((widget) => widget.type));
  const normalized = layout.filter((widget) => widgetTypes.has(widget?.type) && availableTypes.has(widget.type)).map((widget) => ({
    id: String(widget.id || widget.type),
    type: widget.type,
    size: widgetCatalog[widget.type].size,
  }));
  return normalized.length ? normalized : defaultDashboardLayout(workspace);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.reduce((total, chunk) => total + chunk.length, 0) > 64_000) throw Object.assign(new Error('Request too large'), { statusCode: 413 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

async function writeDashboardConfig(workspace, body) {
  const path = dashboardConfigPath(workspace);
  const config = { version: 1, workspaceId: workspace.id, layout: normalizeDashboardLayout(workspace, body.layout) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { source: 'workspace', path, catalog: availableWidgets(workspace), layout: config.layout };
}

function cockpitConfig(workspace, current = 'home') {
  return {
    enabled: true,
    home: `/${workspaceQuery(workspace)}`,
    icon: '/icon.svg',
    current,
    workspaceId: workspace.id,
    currentWorkspace: publicWorkspace(workspace),
    workspaces: workspaceConfig.workspaces.map(publicWorkspace),
    tools: navFor(workspace),
  };
}

async function serveCockpitPage(res, workspace) {
  const html = await readStaticText(PUBLIC_DIR, '/index.html');
  const config = JSON.stringify(cockpitConfig(workspace)).replaceAll('<', '\\u003c');
  return sendHtml(res, html.replace('<!-- __FRAMEWORK_COCKPIT_CONFIG__ -->', `<script>window.__FRAMEWORK_COCKPIT__ = ${config};</script>`));
}

function createWorkspaceHandlers(workspace, legacyMachineCwdHints) {
  return {
    'task-browser': createTaskBrowserHandler({
      basePath: '/tools/tasks',
      workspaceRoot: workspace.root,
      workspaceName: workspace.name,
      ...(workspace.taskMetadataPath ? { metadataPath: workspace.taskMetadataPath } : {}),
      ...(workspace.taskHistoryPath ? { historyPath: workspace.taskHistoryPath } : {}),
      cockpit: cockpitConfig(workspace, 'task-browser'),
    }),
    'session-browser': createSessionBrowserHandler({
      basePath: '/tools/sessions',
      workspaceRoot: workspace.root,
      workspaceName: workspace.name,
      workspaceId: workspace.id,
      ...(workspace.sessionMetadataPath ? { metadataPath: workspace.sessionMetadataPath } : {}),
      ...(workspace.sessionArchiveManifestPath ? {
        legacyMachinesPath: workspace.sessionArchiveManifestPath,
        legacyMachineBindings: workspace.sessionArchiveBindings,
        legacyMachineCwdHints,
      } : {}),
      cockpit: cockpitConfig(workspace, 'session-browser'),
    }),
    'tokens-cost-analyzer': createTokensCostAnalyzerHandler({
      basePath: '/tools/tokens-cost-analyzer',
      workspaceRoot: workspace.root,
      ...(workspace.tokensCostAnalyzerOutputPath ? { outputDir: workspace.tokensCostAnalyzerOutputPath } : {}),
      cockpit: cockpitConfig(workspace, 'tokens-cost-analyzer'),
    }),
  };
}

async function toolStatuses(workspace) {
  const taskRoot = join(workspace.root, 'projects');
  const statusTools = [
    {
      id: 'task-browser',
      title: 'Task Browser',
      route: routeFor('/tools/tasks/', workspace),
      api: routeFor('/tools/tasks/api/tasks', workspace),
      icon: 'icons/task-browser.svg',
      description: 'Review task state, handoffs, runs, and metadata.',
      action: 'Open tasks',
    },
    {
      id: 'session-browser',
      title: 'Session Browser',
      route: routeFor('/tools/sessions/', workspace),
      api: routeFor('/tools/sessions/api/sessions', workspace),
      icon: 'icons/session-browser.svg',
      description: 'Search recent local agent sessions for context.',
      action: 'Open sessions',
    },
    {
      id: 'tokens-cost-analyzer',
      title: 'Tokens / Cost Analyzer',
      route: routeFor('/tools/tokens-cost-analyzer/', workspace),
      api: routeFor('/tools/tokens-cost-analyzer/api/report', workspace),
      icon: routeFor('/tools/tokens-cost-analyzer/icon.svg', workspace),
      description: 'Visualize local token usage, cost confidence, and subscription spend.',
      action: 'Open costs',
    },
  ].filter((tool) => toolEnabled(workspace, tool.id));
  const statuses = await Promise.all(statusTools.map(async (tool) => {
    if (tool.id === 'task-browser') {
      const ready = await exists(taskRoot);
      return { ...tool, status: ready ? 'ready' : 'warning', detail: ready ? 'Tasks available from this workspace.' : 'No projects directory found under workspace root.' };
    }
    if (tool.id === 'session-browser') return { ...tool, status: 'ready', detail: 'Session sources are checked on open.' };
    if (tool.id === 'tokens-cost-analyzer') return { ...tool, status: 'ready', detail: 'Local token/cost analysis runs on open or refresh.' };
    return { ...tool, status: 'unknown', detail: 'No status check configured.' };
  }));
  return {
    workspaceRoot: workspace.root,
    workspaceName: workspace.name,
    currentWorkspace: publicWorkspace(workspace),
    workspaces: workspaceConfig.workspaces.map(publicWorkspace),
    multiWorkspaceConfigured: workspaceConfig.configured,
    configPath: workspaceConfig.path,
    localOnly: true,
    tools: statuses,
  };
}

function publicWorkspace(workspace) {
  return { id: workspace.id, name: workspace.name, root: workspace.root, tools: workspace.tools || {} };
}

async function routeToMountedToolAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  for (const tool of baseToolNav) {
    const basePath = tool.route.slice(0, -1);
    if (!pathname.startsWith(`${basePath}/`)) continue;
    const rawAssetPath = pathname.slice(basePath.length);
    let assetPath;
    try { assetPath = decodeURIComponent(rawAssetPath); }
    catch { sendJson(res, 400, { error: 'Invalid asset path' }); return true; }
    if (assetPath.startsWith('/shared/')) {
      await serveStaticPath(res, SHARED_WEB_DIR, rawAssetPath.slice('/shared'.length));
      return true;
    }
    if (!TOOL_ASSET_EXTENSIONS.has(extname(assetPath).toLowerCase())) return false;
    await serveStaticPath(res, TOOL_PUBLIC_DIRS.get(tool.id), rawAssetPath);
    return true;
  }
  return false;
}

async function routeToMountedTool(req, res, workspace) {
  const workspaceHandlers = handlers.get(workspace.id);
  for (const tool of baseToolNav) {
    if (!toolEnabled(workspace, tool.id)) continue;
    if (req.url === tool.route.slice(0, -1)) {
      res.writeHead(302, { location: routeFor(tool.route, workspace) });
      res.end();
      return true;
    }
    const handled = await workspaceHandlers[tool.id](req, res);
    if (handled) return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const workspace = selectedWorkspace(url);
    if (url.pathname === '/' || url.pathname === '/index.html') return serveCockpitPage(res, workspace);
    if (url.pathname === '/api/tools') return sendJson(res, 200, await toolStatuses(workspace));
    if (url.pathname === '/api/dashboard-config' && req.method === 'GET') return sendJson(res, 200, await readDashboardConfig(workspace));
    if (url.pathname === '/api/dashboard-config' && req.method === 'PUT') return sendJson(res, 200, await writeDashboardConfig(workspace, await readJsonBody(req)));
    if (url.pathname === '/api/subscription-limits') return sendJson(res, 200, await readSubscriptionLimits({ force: url.searchParams.get('refresh') === '1' }));
    if (url.pathname.startsWith('/shared/')) return serveStaticPath(res, SHARED_WEB_DIR, url.pathname.replace('/shared', '') || '/');
    if (await routeToMountedToolAsset(req, res)) return;
    if (await routeToMountedTool(req, res, workspace)) return;
    await serveStaticPath(res, PUBLIC_DIR, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: safeError(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Framework Cockpit: http://localhost:${PORT}`);
  console.log(`Default workspace root: ${WORKSPACE_ROOT}`);
  if (workspaceConfig.path) console.log(`Workspace config: ${workspaceConfig.path}`);
  console.log('Local-only tool shell; standalone Task Browser, Session Browser, and Tokens / Cost Analyzer remain available.');
});
