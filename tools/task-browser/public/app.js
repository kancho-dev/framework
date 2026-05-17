const state = { tasks: [], selectedKey: null, statuses: [], priorities: [], workspaceRoot: '', metadataPath: '', selectedStatuses: new Set() };
const els = {
  refresh: document.querySelector('#refresh'), autoRefresh: document.querySelector('#auto-refresh'), filter: document.querySelector('#filter'), statusFilter: document.querySelector('#status-filter'), projectFilter: document.querySelector('#project-filter'), priorityFilter: document.querySelector('#priority-filter'), clear: document.querySelector('#clear-filters'), status: document.querySelector('#status'), board: document.querySelector('#board'), workspaceName: document.querySelector('#workspace-name'), detailPane: document.querySelector('#detail-pane'), closeDetail: document.querySelector('#close-detail'), detail: document.querySelector('#detail'), detailKey: document.querySelector('#detail-key'), detailTitle: document.querySelector('#detail-title'), detailMeta: document.querySelector('#detail-meta'), promptPreview: document.querySelector('#prompt-preview'), resumeFiles: document.querySelector('#resume-files'), detailHandoff: document.querySelector('#detail-handoff'), detailPurpose: document.querySelector('#detail-purpose'), detailSuccess: document.querySelector('#detail-success'), detailRuns: document.querySelector('#detail-runs'), copyResume: document.querySelector('#copy-resume')
};

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function metaIcon(label) {
  const icons = { status: '◉', priority: '◆', type: '▣' };
  return icons[label] || '•';
}

function metaPill(label, text, cls = '') {
  return `<span class="meta-pill ${cls}" title="${escapeHtml(label)}: ${escapeHtml(text)}"><span aria-label="${escapeHtml(label)}">${metaIcon(label)}</span><strong>${escapeHtml(text)}</strong></span>`;
}

function labelPill(text) {
  return `<span class="label-pill" title="tag: ${escapeHtml(text)}"><span aria-label="tag">⌁</span><strong>${escapeHtml(text)}</strong></span>`;
}
function selectedTask() { return state.selectedKey ? state.tasks.find((task) => task.key === state.selectedKey) : null; }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

async function load({ quiet = false } = {}) {
  if (!quiet) els.status.textContent = 'Scanning tasks…';
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const data = await res.json();
  Object.assign(state, data);
  if (state.selectedStatuses.size === 0) state.selectedStatuses = new Set(data.statuses.filter((status) => status !== 'done'));
  document.title = `${data.workspaceName} - Tasks`;
  els.workspaceName.textContent = data.workspaceName;
  renderStatusFilters();
  fillSelect(els.projectFilter, unique(data.tasks.map((task) => task.project)), 'All projects');
  fillSelect(els.priorityFilter, data.priorities, 'All priorities');
  render();
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

function render() {
  const visible = state.tasks.filter(matches);
  if (state.selectedKey && !visible.some((task) => task.key === state.selectedKey)) state.selectedKey = null;
  document.body.classList.toggle('detail-open', Boolean(state.selectedKey));
  els.status.textContent = `${visible.length} of ${state.tasks.length} tasks • metadata: ${state.metadataPath}`;
  els.board.innerHTML = state.statuses.filter((status) => state.selectedStatuses.has(status)).map((status) => renderColumn(status, visible.filter((task) => task.metadata?.status === status))).join('');
  renderDetail(selectedTask());
}

function renderColumn(status, tasks) {
  return `<section class="column"><h3>${escapeHtml(status)} <span>${tasks.length}</span></h3><div>${tasks.map(renderCard).join('') || '<p class="muted">No tasks</p>'}</div></section>`;
}

function renderCard(task) {
  const meta = task.metadata || {};
  const active = task.key === state.selectedKey ? ' active' : '';
  const tags = (meta.tags || []).slice(0, 4).map((tag) => labelPill(tag)).join('');
  return `<button class="task-card${active}" data-key="${escapeHtml(task.key)}"><div class="card-top"><span class="display-id">${escapeHtml(meta.displayId)}</span><span>${escapeHtml(task.project)}</span></div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.handoff || task.purpose || 'No handoff summary.')}</p><div class="card-meta">${metaPill('priority', meta.priority, `priority ${meta.priority}`)}${metaPill('type', meta.type, 'type')}${tags}</div></button>`;
}

function renderDetail(task) {
  els.detailPane.classList.toggle('hidden', !task);
  if (!task) return;
  const meta = task.metadata || {};
  els.detailKey.innerHTML = `<span class="display-id">${escapeHtml(meta.displayId)}</span> <span>${escapeHtml(task.key)}</span>`;
  els.detailTitle.textContent = task.title;
  els.detailMeta.innerHTML = [metaPill('status', meta.status, `status ${meta.status}`), metaPill('priority', meta.priority, `priority ${meta.priority}`), metaPill('type', meta.type, 'type'), ...(meta.tags || []).map((tag) => labelPill(tag))].join('');
  els.promptPreview.textContent = continuePrompt(task);
  els.resumeFiles.innerHTML = Object.entries(task.files).map(([label, path]) => `<li><strong>${escapeHtml(label)}</strong>: <code>${escapeHtml(path)}</code></li>`).join('');
  els.detailHandoff.textContent = task.handoff || 'No current-state summary found.';
  els.detailPurpose.textContent = task.purpose || 'No purpose section found.';
  els.detailSuccess.textContent = task.success || 'No success/acceptance section found.';
  els.detailRuns.innerHTML = renderRuns(task.runs || []);
}

function renderRuns(runs) {
  if (runs.length === 0) return '<p class="muted">No run logs found.</p>';
  return runs.map((run) => `<article class="timeline-item"><div class="timeline-dot"></div><div class="timeline-card"><strong>${escapeHtml(run.title)}</strong><p>${escapeHtml(run.goal || 'No goal section found.')}</p><span class="run-path" title="${escapeHtml(run.path)}">${escapeHtml(run.file)}</span></div></article>`).join('');
}

function continuePrompt(task) {
  return `Use task-pickup skill for task ${task.key}`;
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  els.status.textContent = 'Copied task prompt.';
}

els.board.addEventListener('click', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  state.selectedKey = card.dataset.key;
  render();
});
els.refresh.addEventListener('click', () => load().catch((error) => { els.status.textContent = error.message; }));
setInterval(() => {
  if (!els.autoRefresh.checked) return;
  load({ quiet: true }).catch((error) => { els.status.textContent = error.message; });
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
els.clear.addEventListener('click', () => { els.filter.value = ''; els.projectFilter.value = 'all'; els.priorityFilter.value = 'all'; state.selectedStatuses = new Set(state.statuses.filter((status) => status !== 'done')); renderStatusFilters(); render(); });
function closeDetail() {
  state.selectedKey = null;
  render();
}

els.closeDetail.addEventListener('click', closeDetail);
els.copyResume.addEventListener('click', () => { const task = selectedTask(); if (task) copyText(continuePrompt(task)); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.selectedKey) closeDetail();
});

load().catch((error) => { els.status.textContent = error.message; });
