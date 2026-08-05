import { fetchJson } from '/shared/browser/api.js';
import { createDailyUsageHeatmap } from '/shared/browser/daily-usage-heatmap.js';
import { escapeHtml } from '/shared/browser/dom.js';
import { formatDate, formatToolTitle } from '/shared/browser/format.js';
import { createRefreshCoordinator } from '/shared/refresh-coordinator.mjs';
import { expectedRemainingFor, formatReset, gaugeLevel, isStale, limitReasonText, LIMITS_REFRESH_MS, remainingFor } from './limits-format.js';

const dashboardEl = document.querySelector('#dashboard');
const workspaceEl = document.querySelector('#workspace');
const editButton = document.querySelector('#edit-dashboard');
const saveButton = document.querySelector('#save-dashboard');
const cancelButton = document.querySelector('#cancel-dashboard');
const AUTO_REFRESH_MS = 60_000;
const DAILY_USAGE_REFRESH_MS = 10 * 60_000;
const dailyUsageHeatmap = createDailyUsageHeatmap({ showYearSwitcher: false });

let widgetCatalog = {
  'task-counts': { title: 'Task states', size: 'small' },
  'priority-tasks': { title: 'Needs attention', size: 'wide' },
  'latest-bookmarked-session': { title: 'Bookmarked session', size: 'small' },
  'latest-updated-session': { title: 'Latest session', size: 'small' },
  'subscription-limits': { title: 'Subscription limits', size: 'wide' },
  'daily-usage': { title: 'Daily token usage', size: 'wide' },
  tools: { title: 'Tools', size: 'wide' },
};
const DEFAULT_LAYOUT = [
  { id: 'task-counts', type: 'task-counts', size: 'small' },
  { id: 'priority-tasks', type: 'priority-tasks', size: 'wide' },
  { id: 'latest-bookmarked-session', type: 'latest-bookmarked-session', size: 'small' },
  { id: 'latest-updated-session', type: 'latest-updated-session', size: 'small' },
  { id: 'subscription-limits', type: 'subscription-limits', size: 'wide' },
  { id: 'tools', type: 'tools', size: 'wide' },
];
let state = { layout: DEFAULT_LAYOUT, editLayout: null, editing: false, data: null, limits: { data: null, loading: false, failed: false, fetchedAt: 0 }, dailyUsage: { data: null, loading: false, failed: false } };
let pendingDashboardError = null;
let dashboardRevision = 0;
setWorkspaceBadge({ placeholder: 'Loading workspace…' });

const dashboardRefresh = createRefreshCoordinator({
  fetchData: fetchDashboard,
  getIdentity: () => dashboardRevision,
  onStatus: ({ phase, error }) => {
    if (phase === 'loading' && !state.data) dashboardEl.innerHTML = '<article class="widget muted">Loading dashboard…</article>';
    if (phase === 'error') {
      if (state.editing) {
        pendingDashboardError = error;
        return;
      }
      setWorkspaceBadge({ unavailable: true });
      if (!state.data) dashboardEl.innerHTML = `<article class="widget danger"><h3>Dashboard unavailable</h3><p>${escapeHtml(error.message || 'Unknown error')}</p></article>`;
      else showRefreshNotice(error);
    }
  },
});
dashboardRefresh.registerCommitUnit({ key: 'dashboard', isDeferred: () => state.editing, commit: commitDashboard });

const limitsRefresh = createRefreshCoordinator({
  fetchData: fetchLimits,
  onStatus: ({ phase }) => {
    if (phase === 'loading' || phase === 'refreshing') state.limits = { ...state.limits, loading: true };
    if (phase === 'error') state.limits = { ...state.limits, loading: false, failed: true };
    if (!state.editing && limitsVisible()) renderDashboard();
  },
});
limitsRefresh.registerCommitUnit({ key: 'limits', isDeferred: () => state.editing, commit: commitLimits });

const dailyUsageRefresh = createRefreshCoordinator({
  fetchData: fetchDailyUsage,
  onStatus: ({ phase }) => {
    if (phase === 'loading' || phase === 'refreshing') state.dailyUsage = { ...state.dailyUsage, loading: true };
    if (phase === 'error') state.dailyUsage = { ...state.dailyUsage, loading: false, failed: true };
    if (!state.editing && dailyUsageVisible()) renderDashboard();
  },
});
dailyUsageRefresh.registerCommitUnit({ key: 'daily-usage', isDeferred: () => state.editing, commit: commitDailyUsage });

dashboardRefresh.request({ reason: 'initial' });
dashboardRefresh.startPolling(AUTO_REFRESH_MS);

editButton.addEventListener('click', () => setEditing(true));
cancelButton.addEventListener('click', () => setEditing(false));
saveButton.addEventListener('click', saveLayout);

window.addEventListener('focus', () => {
  if (!state.editing && limitsVisible() && Date.now() - state.limits.fetchedAt >= LIMITS_REFRESH_MS) loadLimits();
});
setInterval(() => { if (limitsVisible()) limitsRefresh.request({ reason: 'poll' }); }, LIMITS_REFRESH_MS);
setInterval(() => { if (dailyUsageVisible()) dailyUsageRefresh.request({ reason: 'poll', force: true }); }, DAILY_USAGE_REFRESH_MS);

dashboardEl.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  const id = event.target.closest('[data-widget-id]')?.dataset.widgetId;
  if (action === 'refresh-limits' && !state.editing) return loadLimits({ force: true });
  if (!state.editing || !action) return;
  if (action === 'remove') state.editLayout = state.editLayout.filter((widget) => widget.id !== id);
  if (action === 'up') moveWidget(id, -1);
  if (action === 'down') moveWidget(id, 1);
  if (action === 'add') {
    try { await addWidget(event.target.closest('[data-widget-type]')?.dataset.widgetType); }
    catch (error) { showRefreshNotice(error); }
  }
  renderDashboard();
});

function workspaceQuery() {
  const params = new URLSearchParams(location.search);
  return params.toString() ? `?${params}` : '';
}

async function fetchDashboard({ signal }) {
  const [tools, config] = await Promise.all([
    fetchJson(`api/tools${workspaceQuery()}`, { signal }),
    fetchJson(`api/dashboard-config${workspaceQuery()}`, { signal }),
  ]);
  const hasTaskWidgets = config.layout.some((widget) => widget.type === 'task-counts' || widget.type === 'priority-tasks');
  const hasSessionWidgets = config.layout.some((widget) => widget.type === 'latest-bookmarked-session' || widget.type === 'latest-updated-session');
  const [taskSummary, sessionSummary] = await Promise.all([
    hasTaskWidgets ? fetchJson(`/tools/tasks/api/summary${workspaceQuery()}`, { signal }) : null,
    hasSessionWidgets ? fetchJson(`/tools/sessions/api/summary${workspaceQuery()}`, { signal }) : null,
  ]);
  return { tools, config, taskSummary, sessionSummary };
}

function commitDashboard({ data: { tools, config, taskSummary, sessionSummary } }) {
  pendingDashboardError = null;
  widgetCatalog = catalogFromConfig(config.catalog);
  state.layout = normalizeLayout(config.layout);
  state.data = { tools, taskSummary, sessionSummary };
  document.title = formatToolTitle(tools.workspaceName, 'Cockpit');
  setWorkspaceBadge({ name: tools.workspaceName, root: tools.workspaceRoot, workspaces: tools.workspaces, currentWorkspace: tools.currentWorkspace });
  renderDashboard();
  if (limitsVisible() && !state.limits.data) limitsRefresh.request({ reason: 'initial' });
  if (dailyUsageVisible() && !state.dailyUsage.data) dailyUsageRefresh.request({ reason: 'initial' });
}

function limitsVisible() {
  return state.layout.some((widget) => widget.type === 'subscription-limits');
}

function dailyUsageVisible() {
  return state.layout.some((widget) => widget.type === 'daily-usage');
}

function fetchDailyUsage({ signal, force }) {
  const params = new URLSearchParams(location.search);
  if (force) params.set('refresh', '1');
  return fetchJson(`/tools/tokens-cost-analyzer/api/daily-usage${params.size ? `?${params}` : ''}`, { signal });
}

function commitDailyUsage({ data }) {
  state.dailyUsage = { data, loading: false, failed: false };
  renderDashboard();
}

function loadLimits({ force = false } = {}) {
  return limitsRefresh.request({ reason: force ? 'manual' : 'poll', force });
}

function fetchLimits({ signal, force }) {
  return fetchJson(`api/subscription-limits${force ? '?refresh=1' : ''}`, { signal });
}

function commitLimits({ data }) {
  state.limits = { data, loading: false, failed: false, fetchedAt: Date.now() };
  renderDashboard();
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
  if (!editing) {
    dashboardRefresh.release('dashboard');
    limitsRefresh.release('limits');
    dailyUsageRefresh.release('daily-usage');
    if (pendingDashboardError) {
      showRefreshNotice(pendingDashboardError);
      pendingDashboardError = null;
    }
  }
}

async function saveLayout() {
  saveButton.disabled = true;
  try {
    const res = await fetch(`api/dashboard-config${workspaceQuery()}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: state.editLayout }) });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    const config = await res.json();
    dashboardRevision += 1;
    state.layout = normalizeLayout(config.layout);
    setEditing(false);
    dashboardRefresh.request({ reason: 'mutation' });
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

async function addWidget(type) {
  const current = new Set(state.editLayout.map((widget) => widget.type));
  const selected = type && widgetCatalog[type] && !current.has(type)
    ? type
    : Object.keys(widgetCatalog).find((candidate) => !current.has(candidate));
  if (!selected) return;
  if ((selected === 'task-counts' || selected === 'priority-tasks') && !state.data.taskSummary) {
    state.data.taskSummary = await fetchJson(`/tools/tasks/api/summary${workspaceQuery()}`);
  }
  if ((selected === 'latest-bookmarked-session' || selected === 'latest-updated-session') && !state.data.sessionSummary) {
    state.data.sessionSummary = await fetchJson(`/tools/sessions/api/summary${workspaceQuery()}`);
  }
  if (selected === 'daily-usage' && !state.dailyUsage.data) dailyUsageRefresh.request({ reason: 'initial' });
  if (state.editing && !state.editLayout.some((widget) => widget.type === selected)) {
    state.editLayout.push({ id: selected, type: selected, size: widgetCatalog[selected].size });
  }
}

function renderDashboard() {
  const layout = state.editing ? state.editLayout : state.layout;
  dashboardEl.innerHTML = layout.map(renderWidget).join('') + (state.editing ? renderAddCard(layout) : '');
  const dailyRoot = dashboardEl.querySelector('.daily-usage-component');
  if (dailyRoot && state.dailyUsage.data?.daily?.length) dailyUsageHeatmap.render(dailyRoot, state.dailyUsage.data.daily);
  requestAnimationFrame(updateOverflowTooltips);
}

function updateOverflowTooltips() {
  for (const title of dashboardEl.querySelectorAll('.task-list strong[data-full-title]')) {
    if (title.scrollWidth > title.clientWidth) title.title = title.dataset.fullTitle;
    else title.removeAttribute('title');
  }
}

window.addEventListener('resize', updateOverflowTooltips);

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
  if (type === 'subscription-limits') return renderSubscriptionLimits(state.limits);
  if (type === 'daily-usage') return renderDailyUsage(state.dailyUsage);
  if (type === 'tools') return renderTools(state.data.tools.tools || []);
  return '<p>Unknown widget.</p>';
}

function renderDailyUsage(usage) {
  const analyzerHref = `/tools/tokens-cost-analyzer/${workspaceQuery()}`;
  const header = `<p class="kicker">tokens / cost analyzer</p><h3><a class="widget-title-link" href="${escapeHtml(analyzerHref)}">Daily token usage</a></h3>`;
  if (!usage.data) return `${header}<p class="empty">${usage.loading ? 'Loading daily usage…' : 'Daily usage unavailable.'}</p>`;
  const generated = `<p class="daily-usage-generated">Generated ${escapeHtml(formatDate(usage.data.generatedAt))}${usage.loading ? ' · refreshing…' : ''}${usage.failed ? ' · refresh failed; showing previous data' : ''}</p>`;
  if (!Array.isArray(usage.data.daily) || usage.data.daily.length === 0) return `${header}${generated}<p class="empty">No token usage recorded for this workspace yet.</p>`;
  return `${header}${generated}<div class="daily-usage-component"></div>`;
}

function renderSubscriptionLimits(limits) {
  const header = `<div class="limits-head"><div><p class="kicker">subscription usage limits</p><h3>Subscription limits</h3></div>
    <button type="button" class="limits-refresh" data-action="refresh-limits" aria-label="Refresh subscription limits"${limits.loading ? ' disabled' : ''}>${refreshIcon()}</button></div>`;
  if (!limits.data) return `${header}<p class="empty">${limits.loading ? 'Loading limits…' : 'Subscription limits unavailable.'}</p>`;
  return `${header}<div class="limit-gauges${isStale(limits) ? ' stale' : ''}">${limits.data.providers.map(renderLimitGauge).join('')}</div>`;
}

function renderLimitGauge(provider) {
  const remaining = remainingFor(provider);
  const level = gaugeLevel(provider);
  const value = remaining === null ? '—' : `${remaining}%`;
  const title = `${provider.label} · ${provider.windowLabel}`;
  const summary = remaining === null
    ? `unavailable — ${escapeHtml(limitReasonText(provider.reason))}`
    : `${remaining}% left`;
  const expectedRemaining = expectedRemainingFor(provider);
  const paceDelta = expectedRemaining === null ? null : expectedRemaining - remaining;
  const paceDirection = paceDelta > 0.5 ? 'over' : paceDelta < -0.5 ? 'under' : 'on';
  const pace = paceDelta === null
    ? null
    : `target ${Math.round(expectedRemaining)}% left · ${Math.abs(Math.round(paceDelta))} pp ${paceDirection} pace`;
  const paceMetrics = paceDelta === null ? '' : `<span class="gauge-metrics"><span>target <b>${Math.round(expectedRemaining)}%</b> left</span><span><b>${Math.abs(Math.round(paceDelta))} pp</b> ${paceDirection} pace</span></span>`;
  const reset = remaining === null ? null : formatReset(provider.resetsAt);
  const detail = remaining === null
    ? '<span class="gauge-detail">No provider-reported value</span>'
    : `<span class="gauge-reset">resets <b>${escapeHtml(reset)}</b></span>`;
  return `<div class="limit-gauge level-${level}" data-provider="${escapeHtml(provider.id)}">
    <span class="gauge-ring" style="--pct:${remaining === null ? 0 : remaining}" role="img" aria-label="${escapeHtml(title)}: ${summary}${pace ? `; ${pace}` : ''}"><span>${escapeHtml(value)}</span></span>
    <div class="gauge-text"><strong>${escapeHtml(title)}</strong>${remaining === null ? `<span class="gauge-summary">${summary}</span>` : ''}${paceMetrics}${detail}
      <span class="gauge-detail">as of ${escapeHtml(formatDate(provider.asOf))}${provider.source ? ' · provider-reported' : ''}</span></div>
  </div>`;
}

function refreshIcon() {
  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2v3h-3"/></svg>';
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
  const nextActors = summary?.nextActors || {};
  const counts = nextActors.counts || {};
  const operatorCount = counts.operator || 0;
  const agentCount = counts.agent || 0;
  const tasks = Array.isArray(nextActors.operatorTasks) ? nextActors.operatorTasks : [];
  const operatorSummary = operatorCount
    ? `<div class="attention-count"><div><strong>${operatorCount}</strong>${actorIcon('operator')}</div><span>${operatorCount === 1 ? 'task needs you' : 'tasks need you'}</span></div>`
    : `<div class="attention-count calm"><div><strong>0</strong>${actorIcon('operator')}</div><span>No tasks need you</span></div>`;
  const taskList = tasks.length
    ? `<ol class="task-list">${tasks.map((task) => `<li><a href="${escapeHtml(taskUrl({ selectTask: task.key }))}"><strong data-full-title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</strong><span>${escapeHtml(task.status)} · ${escapeHtml(task.priority)}</span></a></li>`).join('')}</ol>`
    : '<p class="empty attention-empty">You are clear for now.</p>';
  return `<p class="kicker">operator attention</p><h3>Needs attention</h3><div class="attention-layout"><div>${operatorSummary}<p class="agent-ready">${actorIcon('agent')}<span><strong>${agentCount}</strong> ready for Agent</span></p></div>${taskList}</div>`;
}

function actorIcon(actor) {
  const label = actor === 'operator' ? 'Operator' : 'Agent';
  const icon = actor === 'operator'
    ? '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="2.5"/><path d="M3.5 14c.2-3 1.7-4.5 4.5-4.5s4.3 1.5 4.5 4.5z"/></svg>'
    : '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="4" width="10" height="8" rx="2"/><path d="M8 1.5V4M1.5 7.5H3m10 0h1.5M6 10.25h4"/><circle cx="6" cy="7.5" r=".8"/><circle cx="10" cy="7.5" r=".8"/></svg>';
  return `<span class="actor-icon ${actor}" role="img" aria-label="${label}" title="${label}">${icon}</span>`;
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
