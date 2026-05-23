const state = { tasks: [], selectedKey: null, statuses: [], priorities: [], workspaceRoot: '', metadataPath: '', selectedStatuses: new Set(), tagDrafts: {} };
const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
const projectColors = new Map();
const els = {
  refresh: document.querySelector('#refresh'), autoRefresh: document.querySelector('#auto-refresh'), filter: document.querySelector('#filter'), statusFilter: document.querySelector('#status-filter'), projectFilter: document.querySelector('#project-filter'), priorityFilter: document.querySelector('#priority-filter'), clear: document.querySelector('#clear-filters'), status: document.querySelector('#status'), board: document.querySelector('#board'), workspaceName: document.querySelector('#workspace-name'), detailPane: document.querySelector('#detail-pane'), closeDetail: document.querySelector('#close-detail'), detail: document.querySelector('#detail'), detailKey: document.querySelector('#detail-key'), detailTitle: document.querySelector('#detail-title'), detailMeta: document.querySelector('#detail-meta'), resumeFiles: document.querySelector('#resume-files'), detailHandoff: document.querySelector('#detail-handoff'), detailPurpose: document.querySelector('#detail-purpose'), detailNextSteps: document.querySelector('#detail-next-steps'), detailSuccess: document.querySelector('#detail-success'), detailContext: document.querySelector('#detail-context'), detailRuns: document.querySelector('#detail-runs'), detailHistory: document.querySelector('#detail-history')
};

window.FrameworkWorkspaceBadge?.set(els.workspaceName, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace' });

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function metaIcon(label) {
  const icons = { status: '◉', priority: '◆', type: '▣' };
  return icons[label] || '•';
}

function metaPill(label, text, cls = '') {
  return `<span class="meta-pill ${cls}" title="${escapeHtml(label)}: ${escapeHtml(text)}"><span aria-label="${escapeHtml(label)}">${metaIcon(label)}</span><strong>${escapeHtml(text)}</strong></span>`;
}

function editableMetaPill(label, value, options, cls = '') {
  return `<label class="meta-pill editable ${cls}" title="Edit ${escapeHtml(label)}"><span aria-label="${escapeHtml(label)}">${metaIcon(label)}</span><select name="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
}

function labelPill(text) {
  return `<span class="label-pill" title="tag: ${escapeHtml(text)}"><span aria-label="tag">⌁</span><strong>${escapeHtml(text)}</strong></span>`;
}
function projectPill(project) {
  const color = projectColor(project);
  return `<span class="project-pill" style="--project-color:${color}; --project-bg:${color}22; --project-border:${color}66" title="project: ${escapeHtml(project)}"><span aria-label="project">▰</span><strong>${escapeHtml(project)}</strong></span>`;
}
function projectColor(project) {
  if (projectColors.has(project)) return projectColors.get(project);
  const hue = hashString(project) % 360;
  const color = `hsl(${hue} 72% 68%)`;
  projectColors.set(project, color);
  return color;
}
function hashString(value) {
  return [...String(value)].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 17);
}
function selectedTask() { return state.selectedKey ? state.tasks.find((task) => task.key === state.selectedKey) : null; }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

async function load() {
  els.status.textContent = 'Scanning tasks…';
  await loadTasks({ preserveScroll: true });
}

async function loadTasks({ preserveScroll = false } = {}) {
  const boardScroll = preserveScroll ? captureBoardScroll() : null;
  const res = await fetch('api/tasks');
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const data = await res.json();
  Object.assign(state, data);
  if (state.selectedStatuses.size === 0) state.selectedStatuses = new Set(data.statuses.filter((status) => !['done', 'paused'].includes(status)));
  document.title = `${data.workspaceName} - Tasks`;
  window.FrameworkWorkspaceBadge?.set(els.workspaceName, { name: data.workspaceName, root: data.workspaceRoot, tooltipPrefix: 'Workspace' });
  renderStatusFilters();
  fillSelect(els.projectFilter, unique(data.tasks.map((task) => task.project)), 'All projects');
  fillSelect(els.priorityFilter, data.priorities, 'All priorities');
  render({ preserveScroll: boardScroll });
}

function fillSelect(select, values, label) {
  const current = select.value || 'all';
  select.innerHTML = `<option value="all">${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = values.includes(current) ? current : 'all';
}

function renderStatusFilters() {
  els.statusFilter.innerHTML = state.statuses.map((status) => `<label class="status-choice ${escapeHtml(status)}"><input type="checkbox" value="${escapeHtml(status)}" ${state.selectedStatuses.has(status) ? 'checked' : ''}> ${escapeHtml(status)}</label>`).join('');
}

function matches(task) {
  const query = els.filter.value.trim().toLowerCase();
  const metadata = task.metadata || {};
  if (!state.selectedStatuses.has(metadata.status)) return false;
  if (els.projectFilter.value !== 'all' && task.project !== els.projectFilter.value) return false;
  if (els.priorityFilter.value !== 'all' && metadata.priority !== els.priorityFilter.value) return false;
  if (!query) return true;
  const haystack = [task.key, task.project, task.slug, task.title, metadata.displayId, ...(metadata.tags || [])].join(' ').toLowerCase();
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

function render({ preserveScroll = null } = {}) {
  const boardScroll = preserveScroll === true ? captureBoardScroll() : preserveScroll;
  const focus = captureDetailFocus();
  const visible = state.tasks.filter(matches);
  if (state.selectedKey && !visible.some((task) => task.key === state.selectedKey)) state.selectedKey = null;
  document.body.classList.toggle('detail-open', Boolean(state.selectedKey));
  els.status.textContent = `${visible.length} of ${state.tasks.length} tasks • metadata: ${state.metadataPath}`;
  els.board.innerHTML = state.statuses.filter((status) => state.selectedStatuses.has(status)).map((status) => renderColumn(status, sortTasks(status, visible.filter((task) => task.metadata?.status === status)))).join('');
  renderDetail(selectedTask());
  restoreDetailFocus(focus);
  if (boardScroll) restoreBoardScroll(boardScroll);
}

function renderColumn(status, tasks) {
  return `<section class="column" data-status="${escapeHtml(status)}"><h3>${escapeHtml(status)} <span>${tasks.length}</span></h3><div class="drop-zone" data-status="${escapeHtml(status)}">${tasks.map(renderCard).join('') || '<p class="muted">No tasks</p>'}</div></section>`;
}

function sortTasks(status, tasks) {
  return [...tasks].sort((a, b) => status === 'done' ? compareDone(a, b) : compareActive(a, b));
}

function compareActive(a, b) {
  return compareNullableNumber(a.metadata?.order, b.metadata?.order, true)
    || compareNumber(priorityRank[a.metadata?.priority] ?? 99, priorityRank[b.metadata?.priority] ?? 99)
    || compareDateDesc(a.latestRunAt, b.latestRunAt)
    || compareNumber(displayNumber(b), displayNumber(a))
    || a.key.localeCompare(b.key);
}

function compareDone(a, b) {
  return compareRunPresence(a, b) || compareDateDesc(a.latestRunAt, b.latestRunAt) || compareNumber(displayNumber(b), displayNumber(a)) || a.key.localeCompare(b.key);
}

function compareNullableNumber(a, b, nullLast) {
  const aNum = Number.isFinite(a) ? a : null;
  const bNum = Number.isFinite(b) ? b : null;
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum === null && bNum !== null) return nullLast ? 1 : -1;
  if (aNum !== null && bNum === null) return nullLast ? -1 : 1;
  return 0;
}
function compareNumber(a, b) { return a === b ? 0 : a - b; }
function compareDateDesc(a, b) { return (Date.parse(b || '') || 0) - (Date.parse(a || '') || 0); }
function compareRunPresence(a, b) { return a.hasRunLogs === b.hasRunLogs ? 0 : a.hasRunLogs ? -1 : 1; }
function displayNumber(task) { return Number(String(task.metadata?.displayId || '').replace(/\D/g, '')) || 0; }

function captureBoardScroll() {
  return { left: els.board.scrollLeft, top: els.board.scrollTop, columns: columnScrollPositions() };
}

function columnScrollPositions() {
  return Object.fromEntries([...els.board.querySelectorAll('.column[data-status]')].map((column) => [column.dataset.status, column.scrollTop]));
}

function restoreBoardScroll(scroll) {
  els.board.scrollLeft = scroll.left;
  els.board.scrollTop = scroll.top;
  for (const column of els.board.querySelectorAll('.column[data-status]')) column.scrollTop = scroll.columns[column.dataset.status] || 0;
}

function renderCard(task) {
  const meta = task.metadata || {};
  const active = task.key === state.selectedKey ? ' active' : '';
  const tags = (meta.tags || []).slice(0, 4).map((tag) => labelPill(tag)).join('');
  return `<button class="task-card${active}" draggable="true" data-key="${escapeHtml(task.key)}"><div class="card-top"><span class="display-id">${escapeHtml(meta.displayId)}</span>${projectPill(task.project)}</div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.nextSteps || task.handoff || task.purpose || 'No handoff summary.')}</p><div class="card-meta">${metaPill('priority', meta.priority, `priority ${meta.priority}`)}${metaPill('type', meta.type, 'type')}${tags}</div></button>`;
}

function captureDetailFocus() {
  const active = document.activeElement;
  const form = active?.closest?.('.inline-metadata-editor');
  if (!form || active.name !== 'newTag') return null;
  return { key: form.dataset.key, name: active.name, start: active.selectionStart, end: active.selectionEnd };
}

function restoreDetailFocus(focus) {
  if (!focus || focus.key !== state.selectedKey) return;
  const input = els.detailMeta.querySelector(`[name="${CSS.escape(focus.name)}"]`);
  if (!input) return;
  input.focus();
  if (Number.isInteger(focus.start) && Number.isInteger(focus.end)) input.setSelectionRange(focus.start, focus.end);
}

function renderDetail(task) {
  els.detailPane.classList.toggle('hidden', !task);
  if (!task) return;
  const meta = task.metadata || {};
  els.detailKey.innerHTML = `<span class="display-id">${escapeHtml(meta.displayId)}</span>${projectPill(task.project)}<span>${escapeHtml(task.slug)}</span>`;
  els.detailTitle.textContent = task.title;
  const primaryMeta = [editableMetaPill('status', meta.status, state.statuses, `status ${meta.status}`), editableMetaPill('priority', meta.priority, state.priorities, `priority ${meta.priority}`), editableMetaPill('type', meta.type, typeOptions(meta.type), 'type')].join('');
  els.detailMeta.innerHTML = `<form class="inline-metadata-editor" data-key="${escapeHtml(task.key)}"><div class="meta-line primary-meta-line"><div>${primaryMeta}</div><label class="order-editor">Order <input name="order" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(meta.order ?? '')}"></label></div>${renderTagEditor(meta.tags || [])}${renderRelationsAndAction(meta, task)}</form>`;
  els.resumeFiles.innerHTML = Object.entries(task.files).map(([label, path]) => `<li><strong>${escapeHtml(label)}</strong>: <code>${escapeHtml(path)}</code></li>`).join('');
  els.detailHandoff.textContent = task.handoff || 'No current-state summary found.';
  els.detailPurpose.textContent = task.purpose || 'No purpose section found.';
  els.detailNextSteps.textContent = task.nextSteps || 'No next steps section found.';
  els.detailSuccess.textContent = task.success || 'No success/acceptance section found.';
  els.detailContext.textContent = task.context || 'No context excerpt found.';
  els.detailRuns.innerHTML = renderRuns(task.runs || []);
  els.detailHistory.innerHTML = renderHistory(task.metadataHistory || []);
}

function typeOptions(current) {
  return unique([...state.tasks.map((task) => task.metadata?.type), current, 'implementation', 'review', 'research', 'design', 'maintenance', 'release']);
}

function renderTagEditor(tags) {
  const pills = tags.map((tag) => `<span class="label-pill tag-pill"><span aria-label="tag">⌁</span><strong>${escapeHtml(tag)}</strong><button class="remove-tag" type="button" data-tag="${escapeHtml(tag)}" title="Remove tag ${escapeHtml(tag)}">×</button></span>`).join('');
  const draft = state.selectedKey ? state.tagDrafts[state.selectedKey] || '' : '';
  return `<div class="meta-line tags-line"><div class="tag-list">${pills || '<span class="muted compact">No tags</span>'}</div><div class="tag-controls"><div class="tag-add"><input name="newTag" placeholder="Add tag…" value="${escapeHtml(draft)}"><button type="submit">Add</button></div></div></div>`;
}

function renderRelationsAndAction(meta, task) {
  const items = [
    ...relationItems('blocked by', meta.blockedBy || []),
    ...relationItems('parent', meta.parent ? [meta.parent] : []),
    ...relationItems('child', meta.children || []),
    ...relationItems('related', meta.related || []),
  ].join('');
  return `<div class="meta-line relation-action-line"><div class="relation-line">${items}</div><div class="prompt-action"><button type="button" class="compact-action copy-resume">Copy task prompt</button><span class="prompt-preview">${escapeHtml(continuePrompt(task))}</span></div></div>`;
}

function relationItems(label, keys) {
  if (keys.length === 0) return [];
  const links = keys.map((key) => {
    const task = state.tasks.find((item) => item.key === key);
    const text = task?.metadata?.displayId || key;
    const action = task ? `data-related-key="${escapeHtml(key)}"` : '';
    return `<button class="relation-link" type="button" ${action} title="${escapeHtml(key)}">${escapeHtml(text)}</button>`;
  }).join('<span class="relation-separator">,</span>');
  return [`<span class="relation-pill" title="${escapeHtml(label)}"><span>${escapeHtml(label)}</span><strong>${links}</strong></span>`];
}

function renderRuns(runs) {
  if (runs.length === 0) return '<p class="muted">No run logs found.</p>';
  return runs.map((run) => `<article class="timeline-item"><div class="timeline-dot"></div><div class="timeline-card"><strong>${escapeHtml(run.title)}</strong><p>${escapeHtml(run.goal || 'No goal section found.')}</p><span class="run-path" title="${escapeHtml(run.path)}">${escapeHtml(run.file)}</span></div></article>`).join('');
}

function renderHistory(events) {
  if (events.length === 0) return '<p class="muted">No metadata history yet.</p>';
  return events.map((event) => {
    const fields = Object.keys(event.changes || {});
    const title = formatHistoryTitle(event, fields);
    const details = fields.map((field) => `<span class="history-change ${field === 'status' ? 'status-change' : ''}">${escapeHtml(field)}: <strong>${escapeHtml(formatHistoryValue(event.changes[field]?.before))}</strong> → <strong>${escapeHtml(formatHistoryValue(event.changes[field]?.after))}</strong></span>`).join('');
    return `<article class="history-item ${fields.includes('status') ? 'has-status' : ''}"><div><strong>${title}</strong><p>${details}</p><span>${escapeHtml(historyMeta(event))}</span></div></article>`;
  }).join('');
}

function formatHistoryTitle(event, fields) {
  const when = event.timestamp ? new Date(event.timestamp).toLocaleString() : 'unknown time';
  if (event.changes?.status) return `Status ${event.changes.status.before || 'unset'} → ${event.changes.status.after || 'unset'} • ${when}`;
  return `${fields.join(', ') || 'metadata'} changed • ${when}`;
}
function formatHistoryValue(value) { return Array.isArray(value) ? value.join(', ') || '[]' : value ?? 'null'; }
function historyMeta(event) { return [event.actor, event.role, event.sessionTool, event.sessionId, event.source].filter(Boolean).join(' • ') || 'unknown source'; }

function continuePrompt(task) {
  return `Use task-pickup skill for task ${task.key}`;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  els.status.textContent = 'Copied task prompt.';
}

async function saveMetadata(key, patch) {
  const res = await fetch('api/task-metadata', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, metadata: patch }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Metadata save failed: ${res.status}`);
  const task = state.tasks.find((item) => item.key === key);
  if (task) task.metadata = data.metadata;
  els.status.textContent = `Saved metadata for ${key}.`;
}

async function saveMetadataPatch(form, patch) {
  await saveMetadata(form.dataset.key, patch);
  render({ preserveScroll: true });
}

function currentTags(form) {
  return [...form.querySelectorAll('.remove-tag')].map((button) => button.dataset.tag);
}

els.board.addEventListener('click', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  state.selectedKey = card.dataset.key;
  render({ preserveScroll: true });
});
els.board.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.key);
  event.dataTransfer.effectAllowed = 'move';
});
els.board.addEventListener('dragover', (event) => {
  const zone = event.target.closest('.drop-zone');
  els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
  if (!zone) return;
  event.preventDefault();
  zone.closest('.column')?.classList.add('drop-target');
  event.dataTransfer.dropEffect = 'move';
});
els.board.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget || !els.board.contains(event.relatedTarget)) els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
});
els.board.addEventListener('drop', async (event) => {
  const zone = event.target.closest('.drop-zone');
  if (!zone) return;
  event.preventDefault();
  els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
  const key = event.dataTransfer.getData('text/plain');
  const task = state.tasks.find((item) => item.key === key);
  if (!task || task.metadata?.status === zone.dataset.status) return;
  try {
    await saveMetadata(key, { status: zone.dataset.status });
    render({ preserveScroll: true });
  } catch (error) {
    els.status.textContent = error.message;
  }
});
els.refresh.addEventListener('click', () => load().catch((error) => { els.status.textContent = error.message; }));
setInterval(() => {
  if (!els.autoRefresh.checked) return;
  loadTasks({ preserveScroll: true }).catch((error) => { els.status.textContent = error.message; });
}, 10_000);
els.filter.addEventListener('input', render);
els.statusFilter.addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  if (event.target.checked) state.selectedStatuses.add(event.target.value);
  else state.selectedStatuses.delete(event.target.value);
  render();
});
els.projectFilter.addEventListener('change', render);
els.priorityFilter.addEventListener('change', render);
els.clear.addEventListener('click', () => { els.filter.value = ''; els.projectFilter.value = 'all'; els.priorityFilter.value = 'all'; state.selectedStatuses = new Set(state.statuses.filter((status) => !['done', 'paused'].includes(status))); renderStatusFilters(); render(); });
function closeDetail() {
  state.selectedKey = null;
  render();
}

els.closeDetail.addEventListener('click', closeDetail);
els.detailMeta.addEventListener('input', (event) => {
  if (event.target.name !== 'newTag') return;
  const form = event.target.closest('.inline-metadata-editor');
  if (form) state.tagDrafts[form.dataset.key] = event.target.value;
});
els.detailMeta.addEventListener('change', (event) => {
  const form = event.target.closest('.inline-metadata-editor');
  if (!form || event.target.name === 'newTag') return;
  if (event.target.name === 'order' && !event.target.validity.valid) {
    els.status.textContent = 'Order must be a positive whole number.';
    return;
  }
  const value = event.target.name === 'order' ? event.target.value || null : event.target.value;
  saveMetadataPatch(form, { [event.target.name]: value }).catch((error) => { els.status.textContent = error.message; });
});
els.detailMeta.addEventListener('click', (event) => {
  const copy = event.target.closest('.copy-resume');
  if (copy) {
    const task = selectedTask();
    if (task) copyText(continuePrompt(task));
    return;
  }
  const relation = event.target.closest('[data-related-key]');
  if (relation) {
    state.selectedKey = relation.dataset.relatedKey;
    render({ preserveScroll: true });
    return;
  }
  const button = event.target.closest('.remove-tag');
  if (!button) return;
  const form = button.closest('.inline-metadata-editor');
  saveMetadataPatch(form, { tags: currentTags(form).filter((tag) => tag !== button.dataset.tag) }).catch((error) => { els.status.textContent = error.message; });
});
els.detailMeta.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target.closest('.inline-metadata-editor');
  const input = form.querySelector('input[name="newTag"]');
  const tag = input.value.trim();
  if (!tag) return;
  state.tagDrafts[form.dataset.key] = '';
  saveMetadataPatch(form, { tags: [...new Set([...currentTags(form), tag])] }).catch((error) => { els.status.textContent = error.message; });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.selectedKey) closeDetail();
});

load().catch((error) => { els.status.textContent = error.message; });
