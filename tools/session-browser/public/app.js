import { escapeHtml, formatDate, shortPath, formatTokens, tokenPressureLevel, tokenPressurePercent, tokenPressurePill } from './formatters.js';
import { restoreCommand, copyRestoreCommand, copyAndFlash } from './copy-restore.js';
import { renderEntry } from './entry-rendering.js';
import { fetchSessionDetail, fetchSessions, putMetadata } from './api.js';
import { sessionBrowserScope } from '/shared/browser/session-links.js';

const state = { sessions: [], selectedPath: null, selectedTopicId: null, selectedDetail: null, browseMode: true, sourceFilter: 'all', cwdFilter: 'all', sortMode: 'updated-desc', bookmarkFilter: false, tagFilter: 'all', sourceErrors: [], metadataError: null };

const els = {
  refresh: document.querySelector('#refresh'),
  autoRefresh: document.querySelector('#auto-refresh'),
  filter: document.querySelector('#filter'),
  sourceFilter: document.querySelector('#source-filter'),
  cwdFilter: document.querySelector('#cwd-filter'),
  sortMode: document.querySelector('#sort-mode'),
  bookmarkFilter: document.querySelector('#bookmark-filter'),
  tagFilter: document.querySelector('#tag-filter'),
  clearFilters: document.querySelector('#clear-filters'),
  status: document.querySelector('#status'),
  workspaceName: document.querySelector('#workspace-name'),
  sessions: document.querySelector('#sessions'),
  empty: document.querySelector('#empty'),
  reader: document.querySelector('#reader'),
  readerTitle: document.querySelector('#reader-title'),
  readerRelations: document.querySelector('#reader-relations'),
  readerMeta: document.querySelector('#reader-meta'),
  showTools: document.querySelector('#show-tools'),
  copyRestore: document.querySelector('#copy-restore'),
  bookmarkSelected: document.querySelector('#bookmark-selected'),
  tagEditor: document.querySelector('#tag-editor'),
  tagInput: document.querySelector('#tag-input'),
  addTag: document.querySelector('#add-tag'),
  jumpTop: document.querySelector('#jump-top'),
  jumpBottom: document.querySelector('#jump-bottom'),
  topics: document.querySelector('#topics'),
  messages: document.querySelector('#messages'),
};






function workspaceDisplayName() {
  return state.workspaceName || window.FrameworkWorkspaceBadge?.workspaceNameFromPath(state.workspaceRoot, 'workspace') || 'workspace';
}

function pathParts(value) {
  return String(value || '').split('/').filter(Boolean);
}

function pathBasename(value) {
  return pathParts(value).at(-1) || '';
}

function relativePath(candidate, root) {
  const current = String(candidate || '').replace(/\/+$/, '');
  const base = String(root || '').replace(/\/+$/, '');
  if (!current || !base) return '';
  if (current === base) return '.';
  return current.startsWith(`${base}/`) ? current.slice(base.length + 1) : '';
}

function originPill(session) {
  if (!session?.cwd) return '';
  const workspaceName = workspaceDisplayName();
  const relative = relativePath(session.cwd, state.workspaceRoot);
  if (relative === '.') return '';
  const label = relative ? `${workspaceName}/${relative}` : pathBasename(session.cwd);
  if (!label) return '';
  return `<span class="origin-pill" title="${escapeHtml(session.cwd)}">${escapeHtml(label)}</span>`;
}

function originRow(session) {
  const pill = originPill(session);
  return pill ? `<span class="origin-row">${pill}</span>` : '';
}

window.FrameworkWorkspaceBadge?.set(els.workspaceName, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace' });

function updateDocumentTitle() {
  if (state.workspaceName) document.title = `${state.workspaceName} - Sessions`;
}

function continuityScope() { return sessionBrowserScope(state.workspaceRoot, location.pathname); }
function continuityKey() { return `framework.session-browser.selectedPath:${continuityScope()}`; }
function topicContinuityKey(path = state.selectedPath) { return `framework.session-browser.selectedTopic:${continuityScope()}:${path || 'none'}`; }
function filtersContinuityKey() { return `framework.session-browser.filters:${continuityScope()}`; }
function requestedParams() { return new URLSearchParams(location.search); }
function requestedSelection() {
  const params = requestedParams();
  return params.get('selectSession') || params.get('session');
}
function requestedTopic() {
  const params = requestedParams();
  return params.get('selectTopic') || params.get('topic');
}
function restoreSelectedPath() {
  if (state.selectedPath) return;
  const requested = requestedSelection();
  if (requested && state.sessions.some((session) => session.path === requested)) {
    state.selectedPath = requested;
    state.selectedTopicId = requestedTopic();
    persistSelectedPath();
    return;
  }
  const path = localStorage.getItem(continuityKey());
  if (path && state.sessions.some((session) => session.path === path)) state.selectedPath = path;
}
function restoreSelectedTopic(detail = state.selectedDetail) {
  if (!detail || state.selectedTopicId) return;
  const topicId = localStorage.getItem(topicContinuityKey(detail.path));
  if (topicId && detail.topicAnchors?.some((anchor) => anchor.id === topicId)) state.selectedTopicId = topicId;
}
function persistSelectedPath() {
  if (state.selectedPath) localStorage.setItem(continuityKey(), state.selectedPath);
  else localStorage.removeItem(continuityKey());
}
function persistSelectedTopic() {
  if (state.selectedPath && state.selectedTopicId) localStorage.setItem(topicContinuityKey(), state.selectedTopicId);
  else if (state.selectedPath) localStorage.removeItem(topicContinuityKey());
}
function clearSelectedTopic(path = state.selectedPath) {
  if (path) localStorage.removeItem(topicContinuityKey(path));
  if (!path || path === state.selectedPath) state.selectedTopicId = null;
}
function restoreFilterState() {
  const raw = localStorage.getItem(filtersContinuityKey());
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  els.filter.value = saved.query || '';
  els.bookmarkFilter.checked = Boolean(saved.bookmarkFilter);
  state.bookmarkFilter = els.bookmarkFilter.checked;
  state.sourceFilter = saved.sourceFilter || 'all';
  state.cwdFilter = saved.cwdFilter || 'all';
  state.tagFilter = saved.tagFilter || 'all';
  state.sortMode = saved.sortMode || 'updated-desc';
}
function persistFilterState() {
  localStorage.setItem(filtersContinuityKey(), JSON.stringify({
    query: els.filter.value,
    bookmarkFilter: state.bookmarkFilter,
    sourceFilter: state.sourceFilter,
    cwdFilter: state.cwdFilter,
    tagFilter: state.tagFilter,
    sortMode: state.sortMode,
  }));
}
function applyFilterControlValues() {
  els.bookmarkFilter.checked = state.bookmarkFilter;
  els.sourceFilter.value = state.sourceFilter;
  els.cwdFilter.value = state.cwdFilter;
  els.cwdFilter.title = state.cwdFilter === 'all' ? 'All work dirs' : state.cwdFilter;
  els.tagFilter.value = state.tagFilter;
  els.sortMode.value = state.sortMode;
  window.FrameworkSelect?.refreshAll?.();
}

function sessionTags(session) {
  return session?.metadata?.tags || [];
}

function isBookmarked(session) {
  return Boolean(session?.metadata?.bookmarked);
}

function matches(session, query) {
  if (state.sourceFilter !== 'all' && session.source !== state.sourceFilter) return false;
  if (state.cwdFilter !== 'all' && (session.cwd || '') !== state.cwdFilter) return false;
  if (state.bookmarkFilter && !isBookmarked(session)) return false;
  if (state.tagFilter !== 'all' && !sessionTags(session).includes(state.tagFilter)) return false;
  if (!query.trim()) return true;
  const haystack = [session.id, session.name, session.cwd, session.firstPrompt, session.path, sessionTags(session).join(' ')].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

function sourceLabel(source) {
  if (source === 'pi') return 'Pi';
  if (source === 'opencode') return 'OpenCode';
  if (source === 'codex') return 'Codex';
  return source || 'unknown';
}

function sortTimestamp(session, field) {
  const value = field === 'created' ? session.createdAt : session.updatedAt;
  return value ? new Date(value).getTime() : 0;
}

function sortSessions(sessions) {
  const [field, direction] = state.sortMode.split('-');
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const byTime = (sortTimestamp(a, field) - sortTimestamp(b, field)) * multiplier;
    if (byTime) return byTime;
    return String(a.name || a.firstPrompt || a.id).localeCompare(String(b.name || b.firstPrompt || b.id));
  });
}

function updateReaderHeaderHeight() {
  const header = document.querySelector('.reader-header');
  if (!header) return;
  document.documentElement.style.setProperty('--reader-header-height', `${Math.ceil(header.getBoundingClientRect().height + 18)}px`);
}

function setBrowseMode(enabled) {
  state.browseMode = enabled;
  document.body.classList.toggle('browse-mode', enabled);
}

function renderTagPills(tags) {
  if (!tags?.length) return '';
  return `<div class="tag-row">${tags.map((tag) => `<span class="tag-pill" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function scrollSelectedSessionCardIntoView() {
  if (!state.selectedPath) return;
  const card = Array.from(els.sessions.querySelectorAll('.session-card')).find((node) => node.dataset.path === state.selectedPath);
  card?.scrollIntoView({ block: 'nearest' });
}

function scrollSelectedTopicLinkIntoView() {
  if (!state.selectedTopicId) return;
  const link = Array.from(els.topics.querySelectorAll('a[data-topic-id]')).find((node) => node.dataset.topicId === state.selectedTopicId);
  const container = link?.closest('.topics');
  if (!link || !container) return;
  const linkRect = link.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  container.scrollTop += linkRect.top - containerRect.top - (container.clientHeight / 2) + (linkRect.height / 2);
}

function scheduleSelectedTopicLinkScroll() {
  requestAnimationFrame(() => {
    updateReaderHeaderHeight();
    requestAnimationFrame(scrollSelectedTopicLinkIntoView);
  });
}

function renderSessions() {
  const query = els.filter.value;
  const sessions = sortSessions(state.sessions.filter((session) => matches(session, query)));
  const errorText = [
    ...(state.sourceErrors || []).map((item) => `${sourceLabel(item.source)} unavailable${item.error ? `: ${item.error}` : ''}`),
    state.metadataError || '',
  ].filter(Boolean).length ? ` · ${[...(state.sourceErrors || []).map((item) => `${sourceLabel(item.source)} unavailable${item.error ? `: ${item.error}` : ''}`), state.metadataError || ''].filter(Boolean).join(', ')}` : '';
  window.FrameworkWorkspaceBadge?.set(els.workspaceName, { name: state.workspaceName, root: state.workspaceRoot, tooltipPrefix: 'Workspace' });
  els.status.textContent = `${sessions.length} of ${state.sessions.length} sessions · ${workspaceDisplayName()}${errorText}`;
  els.sessions.innerHTML = sessions.map((session) => `
    <li>
      <button class="session-card ${session.path === state.selectedPath ? 'active' : ''} ${isBookmarked(session) ? 'bookmarked' : ''}" data-path="${escapeHtml(session.path)}">
        <div class="card-top"><span class="card-badges">${isBookmarked(session) ? '<span class="bookmark-mark on">★</span>' : ''}<span class="badge">${escapeHtml(sourceLabel(session.source))}</span> ${tokenPressurePill(session)}</span><span class="card-times"><span>Updated: ${escapeHtml(formatDate(session.updatedAt))}</span><span>Created: ${escapeHtml(formatDate(session.createdAt))}</span></span></div>
        ${originRow(session)}
        <div class="prompt">${escapeHtml(session.name || session.firstPrompt || '(no user prompt found)')}</div>
        ${session.parentId ? '<div class="relation-line"><span class="relation-badge">child session</span></div>' : ''}
        ${renderTagPills(sessionTags(session))}
        <div class="token-bar ${tokenPressureLevel(session)}"><span style="width: ${tokenPressurePercent(session)}%"></span></div>
      </button>
    </li>
  `).join('');
}

function relationButton(session, label) {
  return `<button type="button" class="relation-link" data-path="${escapeHtml(session.path)}" title="${escapeHtml(session.name || session.id)}">${escapeHtml(label)} ${escapeHtml(session.name || session.id)}</button>`;
}

function renderRelations(detail) {
  const links = [];
  if (detail.parentSession) links.push(relationButton(detail.parentSession, 'Parent:'));
  for (const child of detail.childSessions || []) links.push(relationButton(child, 'Child:'));
  els.readerRelations.classList.toggle('hidden', links.length === 0);
  els.readerRelations.innerHTML = links.join('');
}

function allTags() {
  return Array.from(new Set(state.sessions.flatMap((session) => sessionTags(session)))).sort((a, b) => a.localeCompare(b));
}

function renderTagFilter() {
  const tags = allTags();
  const current = state.tagFilter;
  els.tagFilter.innerHTML = ['all', ...tags].map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag === 'all' ? 'All tags' : tag)}</option>`).join('');
  els.tagFilter.value = tags.includes(current) ? current : 'all';
  state.tagFilter = els.tagFilter.value;
}

function renderSourceFilter() {
  const sources = Array.from(new Set(state.sessions.map((session) => session.source))).sort();
  const current = state.sourceFilter;
  els.sourceFilter.innerHTML = ['all', ...sources].map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source === 'all' ? 'All sources' : sourceLabel(source))}</option>`).join('');
  els.sourceFilter.value = sources.includes(current) ? current : 'all';
  state.sourceFilter = els.sourceFilter.value;
}

function renderCwdFilter() {
  const cwds = Array.from(new Set(state.sessions.map((session) => session.cwd).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const current = state.cwdFilter;
  els.cwdFilter.innerHTML = ['all', ...cwds].map((cwd) => `<option value="${escapeHtml(cwd)}">${escapeHtml(cwd === 'all' ? 'All work dirs' : shortPath(cwd, 88))}</option>`).join('');
  els.cwdFilter.value = cwds.includes(current) ? current : 'all';
  state.cwdFilter = els.cwdFilter.value;
  els.cwdFilter.title = state.cwdFilter === 'all' ? 'All work dirs' : state.cwdFilter;
}

function scrollSelectedTopicIntoView() {
  if (!state.selectedTopicId) return;
  const target = document.querySelector(`#entry-${CSS.escape(state.selectedTopicId)}`);
  const pane = document.querySelector('.reader-pane');
  if (!target || !pane) return;
  updateReaderHeaderHeight();
  const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-header-height')) || 190;
  const paneTop = pane.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  pane.scrollTo({ top: Math.max(0, pane.scrollTop + targetTop - paneTop - headerHeight - 12) });
}

function captureTableScrollPositions() {
  return Array.from(els.messages.querySelectorAll('.markdown-table-wrap')).map((node, index) => [node.dataset.tableKey || `index:${index}`, node.scrollLeft]);
}

function restoreTableScrollPositions(positions) {
  if (!positions?.length) return;
  const byKey = new Map(positions);
  for (const [index, node] of Array.from(els.messages.querySelectorAll('.markdown-table-wrap')).entries()) {
    const key = node.dataset.tableKey || `index:${index}`;
    const scrollLeft = byKey.get(key);
    if (scrollLeft) node.scrollLeft = scrollLeft;
  }
}

function renderSelectedDetail({ scrollTopic = true } = {}) {
  const detail = state.selectedDetail;
  if (!detail) return;
  const command = restoreCommand(detail);
  els.copyRestore.classList.toggle('hidden', !command);
  els.copyRestore.title = command ? `Copy command: ${command}` : '';
  els.bookmarkSelected.textContent = isBookmarked(detail) ? '★ Bookmarked' : '☆ Bookmark';
  els.bookmarkSelected.classList.toggle('active', isBookmarked(detail));
  els.readerTitle.textContent = detail.name || detail.firstPrompt || detail.id;
  renderRelations(detail);
  const primaryMeta = [
    `<span class="badge">${escapeHtml(sourceLabel(detail.source))}</span>`,
    tokenPressurePill(detail),
    `<span><strong>Created:</strong> ${escapeHtml(formatDate(detail.createdAt))}</span>`,
    `<span><strong>Updated:</strong> ${escapeHtml(formatDate(detail.updatedAt))}</span>`,
  ];
  const secondaryMeta = [
    ['Cwd:', shortPath(detail.cwd)],
    ['Model:', detail.modelLabel || 'unknown'],
    ['Messages:', `${detail.userMessageCount} user, ${detail.assistantMessageCount} assistant`],
    ['Tool Messages:', detail.toolMessageCount || detail.toolCallCount],
    ['Tool Calls:', detail.toolCallCount],
    ['Tokens:', formatTokens(detail.tokens)],
  ];
  els.readerMeta.innerHTML = `<div class="meta-row primary">${primaryMeta.join('')}</div><div class="meta-row secondary">${secondaryMeta.map(([label, value]) => `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`).join('')}</div>`;
  renderTagEditor(detail);
  restoreSelectedTopic(detail);
  els.topics.innerHTML = detail.topicAnchors.map((anchor) => `
    <li><a class="${anchor.id === state.selectedTopicId ? 'active' : ''}" href="#entry-${escapeHtml(anchor.id)}" data-topic-id="${escapeHtml(anchor.id)}">${anchor.depth === 'first-prompt' ? '★ ' : ''}${escapeHtml(anchor.title)}</a></li>
  `).join('');
  scheduleSelectedTopicLinkScroll();
  const openDetails = new Set(Array.from(els.messages.querySelectorAll('details[data-detail-key][open]')).map((node) => node.dataset.detailKey));
  const tableScrollPositions = captureTableScrollPositions();
  els.messages.classList.toggle('hide-tools', !els.showTools.checked);
  els.messages.innerHTML = detail.activeEntries.map((entry) => renderEntry(entry, detail.entries)).join('');
  for (const node of els.messages.querySelectorAll('details[data-detail-key]')) {
    if (openDetails.has(node.dataset.detailKey)) node.open = true;
  }
  restoreTableScrollPositions(tableScrollPositions);
  if (scrollTopic) requestAnimationFrame(scrollSelectedTopicIntoView);
}

function renderTagEditor(detail) {
  els.tagEditor.innerHTML = sessionTags(detail).map((tag) => `
    <span class="editable-tag">${escapeHtml(tag)} <button type="button" class="remove-tag" data-tag="${escapeHtml(tag)}">×</button></span>
  `).join('') || '<span class="no-tags">No tags yet</span>';
}

function syncMetadata(path, metadata) {
  for (const session of state.sessions) {
    if (session.path === path) session.metadata = metadata;
  }
  if (state.selectedDetail?.path === path) state.selectedDetail.metadata = metadata;
  renderTagFilter();
  renderSessions();
  if (state.selectedDetail?.path === path) renderSelectedDetail({ scrollTopic: false });
}

async function saveMetadata(path, patch) {
  const metadata = await putMetadata(path, patch);
  syncMetadata(path, metadata);
}

function updateSelectedSummary(detail) {
  const index = state.sessions.findIndex((session) => session.path === detail.path);
  if (index >= 0) {
    const { entries, activeEntries, topicAnchors, ...summary } = detail;
    state.sessions[index] = summary;
    renderSessions();
  }
}

async function selectSession(path, options = {}) {
  if (state.selectedPath !== path) clearSelectedTopic(state.selectedPath);
  state.selectedPath = path;
  if (options.topicId) state.selectedTopicId = options.topicId;
  persistSelectedPath();
  setBrowseMode(false);
  renderSessions();
  requestAnimationFrame(scrollSelectedSessionCardIntoView);
  els.empty.classList.add('hidden');
  els.reader.classList.remove('hidden');
  els.readerTitle.textContent = 'Loading…';
  els.readerMeta.textContent = '';
  els.readerRelations.innerHTML = '';
  els.readerRelations.classList.add('hidden');
  els.messages.innerHTML = '';
  els.topics.innerHTML = '';

  const detail = await fetchSessionDetail(path);
  state.selectedDetail = detail;
  if (state.selectedTopicId && !detail.topicAnchors?.some((anchor) => anchor.id === state.selectedTopicId)) state.selectedTopicId = null;
  updateSelectedSummary(detail);
  renderSelectedDetail();
  persistSelectedTopic();
  requestAnimationFrame(updateReaderHeaderHeight);
}

function hasReaderTextSelection() {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  const pane = document.querySelector('.reader-pane');
  return Boolean(pane && selection.rangeCount && pane.contains(selection.anchorNode) && pane.contains(selection.focusNode));
}

async function reloadSelectedSession({ scrollSelected = true } = {}) {
  if (!state.selectedPath || hasReaderTextSelection()) return;
  const detail = await fetchSessionDetail(state.selectedPath);
  state.selectedDetail = detail;
  if (state.selectedTopicId && !detail.topicAnchors?.some((anchor) => anchor.id === state.selectedTopicId)) state.selectedTopicId = null;
  updateSelectedSummary(detail);
  if (scrollSelected) requestAnimationFrame(scrollSelectedSessionCardIntoView);
  renderSelectedDetail({ scrollTopic: false });
  persistSelectedTopic();
}

async function loadSessions({ reloadSelected = false, scrollSelected = true } = {}) {
  els.status.textContent = 'Loading sessions…';
  const data = await fetchSessions();
  state.sessions = data.sessions;
  state.sessionRoot = data.sessionRoot;
  state.sourceErrors = data.sourceErrors || [];
  state.workspaceRoot = data.workspaceRoot;
  state.workspaceName = data.workspaceName;
  updateDocumentTitle();
  state.metadataError = data.metadataError || null;
  state.metadataPath = data.metadataPath;
  restoreFilterState();
  renderSourceFilter();
  renderCwdFilter();
  renderTagFilter();
  applyFilterControlValues();
  restoreSelectedPath();
  renderSessions();
  if (scrollSelected) requestAnimationFrame(scrollSelectedSessionCardIntoView);
  if (state.selectedPath && !state.sessions.some((session) => session.path === state.selectedPath)) {
    clearSelectedTopic();
    state.selectedPath = null;
    state.selectedDetail = null;
    persistSelectedPath();
  }
  if (reloadSelected && state.selectedPath) await reloadSelectedSession({ scrollSelected });
}

let autoRefreshTimer;
function setAutoRefresh(enabled) {
  clearInterval(autoRefreshTimer);
  if (enabled) {
    autoRefreshTimer = setInterval(() => {
      loadSessions({ reloadSelected: true, scrollSelected: false }).catch((error) => { els.status.textContent = error.message; });
    }, 10_000);
  }
}

els.refresh.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  loadSessions({ reloadSelected: true }).catch((error) => { els.status.textContent = error.message; });
});
els.autoRefresh.addEventListener('change', () => setAutoRefresh(els.autoRefresh.checked));
els.filter.addEventListener('focus', () => setBrowseMode(true));
els.filter.addEventListener('input', () => {
  persistFilterState();
  renderSessions();
});
els.bookmarkFilter.addEventListener('change', () => {
  state.bookmarkFilter = els.bookmarkFilter.checked;
  persistFilterState();
  renderSessions();
});
els.tagFilter.addEventListener('change', () => {
  state.tagFilter = els.tagFilter.value;
  persistFilterState();
  renderSessions();
});
els.sourceFilter.addEventListener('change', () => {
  state.sourceFilter = els.sourceFilter.value;
  persistFilterState();
  renderSessions();
});
els.cwdFilter.addEventListener('change', () => {
  state.cwdFilter = els.cwdFilter.value;
  els.cwdFilter.title = state.cwdFilter === 'all' ? 'All work dirs' : state.cwdFilter;
  persistFilterState();
  renderSessions();
});
els.sortMode.addEventListener('change', () => {
  state.sortMode = els.sortMode.value;
  persistFilterState();
  renderSessions();
});
els.clearFilters.addEventListener('click', () => {
  els.filter.value = '';
  state.bookmarkFilter = false;
  state.sourceFilter = 'all';
  state.cwdFilter = 'all';
  state.tagFilter = 'all';
  state.sortMode = 'updated-desc';
  applyFilterControlValues();
  persistFilterState();
  renderSessions();
});
els.showTools.addEventListener('change', () => {
  renderSelectedDetail({ scrollTopic: false });
  requestAnimationFrame(updateReaderHeaderHeight);
});
els.bookmarkSelected.addEventListener('click', async () => {
  if (!state.selectedDetail) return;
  await saveMetadata(state.selectedDetail.path, { bookmarked: !isBookmarked(state.selectedDetail) });
});
els.addTag.addEventListener('click', async () => {
  if (!state.selectedDetail) return;
  const tag = els.tagInput.value.trim();
  if (!tag) return;
  await saveMetadata(state.selectedDetail.path, { tags: [...sessionTags(state.selectedDetail), tag] });
  els.tagInput.value = '';
});
els.tagInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (els.tagInput.getAttribute('aria-expanded') === 'true') return;
  event.preventDefault();
  els.addTag.click();
});
els.tagEditor.addEventListener('click', async (event) => {
  const button = event.target.closest('.remove-tag');
  if (!button || !state.selectedDetail) return;
  await saveMetadata(state.selectedDetail.path, { tags: sessionTags(state.selectedDetail).filter((tag) => tag !== button.dataset.tag) });
});
els.copyRestore.addEventListener('click', async () => {
  const command = state.selectedDetail ? restoreCommand(state.selectedDetail) : '';
  if (!command) return;
  await copyRestoreCommand(state.selectedDetail, els.copyRestore);
});
els.jumpTop.addEventListener('click', () => {
  document.querySelector('.reader-pane').scrollTo({ top: 0, behavior: 'smooth' });
});
els.jumpBottom.addEventListener('click', () => {
  const pane = document.querySelector('.reader-pane');
  pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' });
});
els.sessions.addEventListener('click', (event) => {
  const tag = event.target.closest('.tag-pill');
  if (tag) {
    event.stopPropagation();
    state.tagFilter = tag.dataset.tag;
    els.tagFilter.value = state.tagFilter;
    persistFilterState();
    renderSessions();
    return;
  }
  const card = event.target.closest('.session-card');
  if (card) selectSession(card.dataset.path).catch((error) => { els.readerTitle.textContent = error.message; });
});
els.topics.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-topic-id]');
  if (!link) return;
  event.preventDefault();
  state.selectedTopicId = link.dataset.topicId;
  persistSelectedTopic();
  renderSelectedDetail();
});

els.messages.addEventListener('click', async (event) => {
  const copyCode = event.target.closest('.copy-code');
  if (copyCode) {
    const code = copyCode.closest('.code-block')?.querySelector('code')?.textContent || '';
    await copyAndFlash(code, copyCode);
    return;
  }
  const copyPrompt = event.target.closest('.copy-user-prompt');
  if (copyPrompt) {
    const prompt = copyPrompt.closest('.message.user')?.querySelector('.content')?.textContent || '';
    await copyAndFlash(prompt, copyPrompt);
  }
});

els.readerRelations.addEventListener('click', (event) => {
  const link = event.target.closest('.relation-link');
  if (link) selectSession(link.dataset.path).catch((error) => { els.readerTitle.textContent = error.message; });
});
document.querySelector('.reader-pane').addEventListener('click', () => {
  if (state.selectedDetail && state.browseMode) setBrowseMode(false);
});

window.addEventListener('resize', updateReaderHeaderHeight);
window.FrameworkAutocomplete?.attach(els.tagInput, { options: () => allTags(), maxVisible: 12 });
for (const select of [els.tagFilter, els.sourceFilter, els.cwdFilter, els.sortMode]) {
  window.FrameworkSelect?.attach(select, { maxVisible: 12 });
}
setBrowseMode(true);
updateReaderHeaderHeight();
setAutoRefresh(els.autoRefresh.checked);
loadSessions()
  .then(() => {
    if (state.selectedPath) return selectSession(state.selectedPath);
  })
  .catch((error) => { els.status.textContent = error.message; });
