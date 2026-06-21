import { fetchJson } from '/shared/browser/api.js';
import { escapeHtml } from '/shared/browser/dom.js';
import { formatDate } from '/shared/browser/format.js';

const dashboardEl = document.querySelector('#dashboard');
const workspaceEl = document.querySelector('#workspace');
const editButton = document.querySelector('#edit-dashboard');
const saveButton = document.querySelector('#save-dashboard');
const cancelButton = document.querySelector('#cancel-dashboard');
const AUTO_REFRESH_MS = 60_000;

let widgetCatalog = {
  'task-counts': { title: 'Task states', size: 'small' },
  'priority-tasks': { title: 'Needs attention', size: 'wide' },
  'latest-bookmarked-session': { title: 'Bookmarked session', size: 'small' },
  'latest-updated-session': { title: 'Latest session', size: 'small' },
  tools: { title: 'Tools', size: 'wide' },
};
const DEFAULT_LAYOUT = [
  { id: 'task-counts', type: 'task-counts', size: 'small' },
  { id: 'priority-tasks', type: 'priority-tasks', size: 'wide' },
  { id: 'latest-bookmarked-session', type: 'latest-bookmarked-session', size: 'small' },
  { id: 'latest-updated-session', type: 'latest-updated-session', size: 'small' },
  { id: 'tools', type: 'tools', size: 'wide' },
];

let state = { layout: DEFAULT_LAYOUT, editLayout: null, editing: false, data: null };
setWorkspaceBadge({ placeholder: 'Loading workspace…' });
loadDashboard();
setInterval(() => { if (!state.editing) loadDashboard(); }, AUTO_REFRESH_MS);

editButton.addEventListener('click', () => setEditing(true));
cancelButton.addEventListener('click', () => setEditing(false));
saveButton.addEventListener('click', saveLayout);

dashboardEl.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const id = event.target.closest('[data-widget-id]')?.dataset.widgetId;
  if (!state.editing || !action) return;
  if (action === 'remove') state.editLayout = state.editLayout.filter((widget) => widget.id !== id);
  if (action === 'up') moveWidget(id, -1);
  if (action === 'down') moveWidget(id, 1);
  if (action === 'add') addWidget(event.target.closest('[data-widget-type]')?.dataset.widgetType);
  renderDashboard();
});

function workspaceQuery() {
  const params = new URLSearchParams(location.search);
  return params.toString() ? `?${params}` : '';
}

async function loadDashboard() {
  const firstLoad = !state.data;
  if (firstLoad) dashboardEl.innerHTML = '<article class="widget muted">Loading dashboard…</article>';
  try {
    const [tools, config] = await Promise.all([
      fetchJson(`api/tools${workspaceQuery()}`),
      fetchJson(`api/dashboard-config${workspaceQuery()}`),
    ]);
    widgetCatalog = catalogFromConfig(config.catalog);
    const hasTaskWidgets = config.layout.some((widget) => widget.type === 'task-counts' || widget.type === 'priority-tasks');
    const hasSessionWidgets = config.layout.some((widget) => widget.type === 'latest-bookmarked-session' || widget.type === 'latest-updated-session');
    const [taskSummary, sessionSummary] = await Promise.all([
      hasTaskWidgets ? fetchJson(`/tools/tasks/api/summary${workspaceQuery()}`) : null,
      hasSessionWidgets ? fetchJson(`/tools/sessions/api/summary${workspaceQuery()}`) : null,
    ]);
    state.layout = normalizeLayout(config.layout);
    state.data = { tools, taskSummary, sessionSummary };
    setWorkspaceBadge({ name: tools.workspaceName, root: tools.workspaceRoot, workspaces: tools.workspaces, currentWorkspace: tools.currentWorkspace });
    renderDashboard();
  } catch (error) {
    setWorkspaceBadge({ unavailable: true });
    if (firstLoad) dashboardEl.innerHTML = `<article class="widget danger"><h3>Dashboard unavailable</h3><p>${escapeHtml(error.message || 'Unknown error')}</p></article>`;
    else showRefreshNotice(error);
  }
}

function catalogFromConfig(catalog) {
  const entries = Array.isArray(catalog) ? catalog.filter((widget) => widgetCatalog[widget?.type]) : Object.values(widgetCatalog);
  return Object.fromEntries(entries.map((widget) => [widget.type, { ...widgetCatalog[widget.type], size: widget.size || widgetCatalog[widget.type].size }]));
}

function normalizeLayout(layout) {
  const fallback = Object.values(widgetCatalog).map((widget) => ({ id: widget.id || widget.type, type: widget.type, size: widget.size }));
  const valid = Array.isArray(layout) ? layout.filter((widget) => widgetCatalog[widget?.type]) : fallback;
  return valid.length ? valid.map((widget) => ({ id: widget.id || widget.type, type: widget.type, size: widgetCatalog[widget.type].size })) : fallback;
}

function setEditing(editing) {
  state.editing = editing;
  state.editLayout = editing ? state.layout.map((widget) => ({ ...widget })) : null;
  document.body.classList.toggle('editing', editing);
  editButton.hidden = editing;
  saveButton.hidden = !editing;
  cancelButton.hidden = !editing;
  renderDashboard();
}

async function saveLayout() {
  saveButton.disabled = true;
  try {
    const res = await fetch(`api/dashboard-config${workspaceQuery()}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: state.editLayout }) });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    const config = await res.json();
    state.layout = normalizeLayout(config.layout);
    setEditing(false);
  } finally {
    saveButton.disabled = false;
  }
}

function moveWidget(id, delta) {
  const from = state.editLayout.findIndex((widget) => widget.id === id);
  const to = Math.max(0, Math.min(state.editLayout.length - 1, from + delta));
  if (from < 0 || from === to) return;
  const [widget] = state.editLayout.splice(from, 1);
  state.editLayout.splice(to, 0, widget);
}

function addWidget(type) {
  const current = new Set(state.editLayout.map((widget) => widget.type));
  const selected = type && widgetCatalog[type] && !current.has(type)
    ? type
    : Object.keys(widgetCatalog).find((candidate) => !current.has(candidate));
  if (selected) state.editLayout.push({ id: selected, type: selected, size: widgetCatalog[selected].size });
}

function renderDashboard() {
  const layout = state.editing ? state.editLayout : state.layout;
  dashboardEl.innerHTML = layout.map(renderWidget).join('') + (state.editing ? renderAddCard(layout) : '');
}

function renderWidget(widget, index) {
  const content = renderWidgetContent(widget.type);
  return `<article class="widget ${escapeHtml(widget.size)} type-${escapeHtml(widget.type)}" data-widget-id="${escapeHtml(widget.id)}">
    ${state.editing ? `<div class="edit-controls"><button data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button><button data-action="down" ${index === state.editLayout.length - 1 ? 'disabled' : ''}>↓</button><button data-action="remove">×</button></div>` : ''}
    ${content}
  </article>`;
}

function renderWidgetContent(type) {
  if (!state.data) return '<p>Loading…</p>';
  if (type === 'task-counts') return renderTaskCounts(state.data.taskSummary);
  if (type === 'priority-tasks') return renderPriorityTasks(state.data.taskSummary);
  if (type === 'latest-bookmarked-session') return renderSession('Bookmarked session', state.data.sessionSummary.latestBookmarkedSession);
  if (type === 'latest-updated-session') return renderSession('Latest session', state.data.sessionSummary.latestUpdatedSession);
  if (type === 'tools') return renderTools(state.data.tools.tools || []);
  return '<p>Unknown widget.</p>';
}

function taskUrl(extra = {}) {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return `/tools/tasks/${params.toString() ? `?${params}` : ''}`;
}

function sessionUrl(session) {
  const params = new URLSearchParams(location.search);
  if (session?.path) params.set('selectSession', session.path);
  return `/tools/sessions/${params.toString() ? `?${params}` : ''}`;
}

function renderTaskCounts(summary) {
  const counts = summary.counts || {};
  const topByStatus = summary.topTasksByStatus || {};
  return `<p class="kicker">task browser summary</p><h3>Task states</h3><div class="count-row">${['active', 'blocked', 'review'].map((key) => {
    const count = counts[key] || 0;
    const inner = `<strong>${count}</strong><span>${key}</span>`;
    return count > 0 ? `<a href="${escapeHtml(taskUrl({ selectStatus: key, selectTask: topByStatus[key]?.key }))}" class="count">${inner}</a>` : `<span class="count disabled" aria-disabled="true">${inner}</span>`;
  }).join('')}</div>`;
}

function renderPriorityTasks(summary) {
  const tasks = summary.topPriorityTasks || [];
  return `<p class="kicker">recovery queue</p><h3>Needs attention</h3>${tasks.length ? `<ol class="task-list">${tasks.map((task) => `<li><a href="${escapeHtml(taskUrl({ selectTask: task.key }))}"><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.status)} · ${escapeHtml(task.priority)}</span></a></li>`).join('')}</ol>` : '<p class="empty">No active, blocked, or review tasks found.</p>'}`;
}

function renderSession(title, session) {
  return `<p class="kicker">session browser summary</p><h3>${escapeHtml(title)}</h3>${session ? `<p>${escapeHtml(session.title)}</p><p class="detail">${escapeHtml(session.source || 'session')} · ${escapeHtml(formatDate(session.updatedAt))}</p><a class="ghost" href="${escapeHtml(sessionUrl(session))}">Open session</a>` : '<p class="empty">No matching session found.</p>'}`;
}

function renderTools(tools) {
  return `<div class="tools-widget" style="--tool-count:${tools.length || 1}"><div><p class="kicker">mounted tools</p><h3>Tools</h3><div class="mini-tools">${tools.map((tool) => `<a class="mini-tool" href="${escapeHtml(tool.route)}"><img src="${escapeHtml(tool.icon)}" alt=""><span>${escapeHtml(tool.title)}</span></a>`).join('')}</div></div>${renderOrbitGraphic()}</div>`;
}

function renderOrbitGraphic() {
  return `<div class="widget-orbit" aria-hidden="true"><div class="radar"><div class="radar-ring ring-one"></div><div class="radar-ring ring-two"></div><div class="radar-sweep"></div><div class="orbit-card primary"><img src="icon.svg" alt="">Cockpit</div><span class="tool-dot dot-one"><img src="icons/task-browser.svg" alt=""></span><span class="tool-dot dot-two"><img src="icons/session-browser.svg" alt=""></span></div></div>`;
}

function renderAddCard(layout) {
  const visible = new Set(layout.map((widget) => widget.type));
  const available = Object.entries(widgetCatalog).filter(([type]) => !visible.has(type));
  return `<article class="widget add-widget"><p class="kicker">widget catalog</p><h3>Add widget</h3>${available.length ? `<div class="widget-catalog">${available.map(([type, widget]) => `<button type="button" data-action="add" data-widget-type="${escapeHtml(type)}"><strong>${escapeHtml(widget.title)}</strong><span>${escapeHtml(widget.size)}</span></button>`).join('')}</div>` : '<p>All available widgets are visible.</p>'}</article>`;
}

function showRefreshNotice(error) {
  const notice = document.querySelector('#refresh-notice');
  if (!notice) return;
  notice.textContent = `Refresh failed: ${error.message || 'Unknown error'}`;
  notice.hidden = false;
  clearTimeout(showRefreshNotice.timer);
  showRefreshNotice.timer = setTimeout(() => { notice.hidden = true; }, 5000);
}

function setWorkspaceBadge(options) {
  window.FrameworkWorkspaceBadge?.set(workspaceEl, { tooltipPrefix: 'Workspace', ...options });
}

