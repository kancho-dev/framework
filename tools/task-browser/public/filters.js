import { escapeHtml } from '/shared/browser/dom.js';
import { els } from './dom-elements.js';
import { state, filtersContinuityKey } from './state.js';

export function restoreFilters() {
  const raw = localStorage.getItem(filtersContinuityKey());
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  if (!saved) return;
  if (typeof saved.query === 'string') els.filter.value = saved.query;
  if (Array.isArray(saved.statuses)) {
    const validStatuses = saved.statuses.filter((status) => state.statuses.includes(status));
    if (validStatuses.length) state.selectedStatuses = new Set(validStatuses);
  }
  if (state.tasks.some((task) => task.project === saved.project)) els.projectFilter.value = saved.project;
  if (state.priorities.includes(saved.priority)) els.priorityFilter.value = saved.priority;
}

export function persistFilters() {
  localStorage.setItem(filtersContinuityKey(), JSON.stringify({
    query: els.filter.value,
    statuses: [...state.selectedStatuses],
    project: els.projectFilter.value,
    priority: els.priorityFilter.value,
  }));
}

export function resetFilters() {
  els.filter.value = '';
  els.projectFilter.value = 'all';
  els.priorityFilter.value = 'all';
  window.FrameworkSelect?.refreshAll?.();
  state.selectedStatuses = new Set(state.statuses.filter((status) => !['done', 'paused'].includes(status)));
  persistFilters();
  renderStatusFilters();
}

export function renderStatusFilters() {
  els.statusFilter.innerHTML = state.statuses.map((status) => `<label class="status-choice ${escapeHtml(status)}"><input type="checkbox" value="${escapeHtml(status)}" ${state.selectedStatuses.has(status) ? 'checked' : ''}> ${escapeHtml(status)}</label>`).join('');
}

export function matches(task) {
  const query = els.filter.value.trim().toLowerCase();
  const metadata = task.metadata || {};
  if (!state.selectedStatuses.has(metadata.status)) return false;
  if (els.projectFilter.value !== 'all' && task.project !== els.projectFilter.value) return false;
  if (els.priorityFilter.value !== 'all' && metadata.priority !== els.priorityFilter.value) return false;
  if (!query) return true;
  const haystack = [task.key, task.project, task.slug, task.title, metadata.displayId, ...(metadata.tags || [])].join(' ').toLowerCase();
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

export function fillSelect(select, values, label) {
  const current = select.value || 'all';
  select.innerHTML = `<option value="all">${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = values.includes(current) ? current : 'all';
  window.FrameworkSelect?.refreshAll?.();
}
