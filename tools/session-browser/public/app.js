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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n');
}

function formatDate(value) {
  if (!value) return 'unknown';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortPath(value, max = 72) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}

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

function continuityScope() { return state.workspaceRoot || location.pathname; }
function continuityKey() { return `framework.session-browser.selectedPath:${continuityScope()}`; }
function topicContinuityKey(path = state.selectedPath) { return `framework.session-browser.selectedTopic:${continuityScope()}:${path || 'none'}`; }
function filtersContinuityKey() { return `framework.session-browser.filters:${continuityScope()}`; }
function requestedSelection() {
  const params = new URLSearchParams(location.search);
  return params.get('selectSession') || params.get('session');
}
function restoreSelectedPath() {
  if (state.selectedPath) return;
  const requested = requestedSelection();
  if (requested && state.sessions.some((session) => session.path === requested)) {
    state.selectedPath = requested;
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

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${Math.round(number / 1000).toLocaleString()}k`;
  if (number >= 1000) return `${Math.round(number / 1000)}k`;
  return number.toLocaleString();
}

function formatTokens(tokens) {
  return `↓${formatCompactNumber(tokens?.input)} ↑${formatCompactNumber(tokens?.output)} R${formatCompactNumber(tokens?.cacheRead)}`;
}

function tokenPressureTotal(sessionOrTokens) {
  return Number(sessionOrTokens?.tokenPressure?.total ?? sessionOrTokens?.tokens?.total ?? sessionOrTokens?.total ?? 0);
}

function tokenPressureLevel(sessionOrTokens) {
  const total = tokenPressureTotal(sessionOrTokens);
  if (total >= 300_000) return 'critical';
  if (total >= 150_000) return 'high';
  if (total >= 50_000) return 'medium';
  return 'low';
}

function tokenPressurePercent(sessionOrTokens) {
  return Math.min(100, Math.max(2, Math.round((tokenPressureTotal(sessionOrTokens) / 300_000) * 100)));
}

function tokenPressurePill(sessionOrTokens) {
  const total = tokenPressureTotal(sessionOrTokens);
  return `<span class="token-pill ${tokenPressureLevel(sessionOrTokens)}" title="Recorded token pressure; excludes repeated cache-read tokens and is not a model context-window percentage">${formatCompactNumber(total)} tok</span>`;
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function flashButton(button, label = 'Copied') {
  const previous = button.textContent;
  button.textContent = label;
  setTimeout(() => { button.textContent = previous; }, 1400);
}

function restoreCommand(detail) {
  if (detail.source === 'pi') return `pi --session ${shellQuote(detail.path)}`;
  if (detail.source === 'opencode') return `opencode --session ${shellQuote(detail.id)} ${shellQuote(detail.cwd || '.')}`;
  return '';
}

function renderTagPills(tags) {
  if (!tags?.length) return '';
  return `<div class="tag-row">${tags.map((tag) => `<span class="tag-pill" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('')}</div>`;
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

function roleLabel(entry) {
  if (entry.type !== 'message') return entry.type;
  return entry.message?.role || 'message';
}

function renderMarkdownInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|\W)_([^_\n]+)_/g, '$1<em>$2</em>');
  return html;
}

function renderMarkdownBlock(block) {
  const lines = block.split('\n');
  if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(block)) return '<hr>';
  const heading = block.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const level = Math.min(6, heading[1].length + 1);
    return `<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`;
  }
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderMarkdownInline(line.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return `<ol>${lines.map((line) => `<li>${renderMarkdownInline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
  }
  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    return `<blockquote>${lines.map((line) => renderMarkdownInline(line.replace(/^\s*>\s?/, ''))).join('<br>')}</blockquote>`;
  }
  return `<p>${lines.map(renderMarkdownInline).join('<br>')}</p>`;
}

function renderMarkdown(text) {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => renderMarkdownBlock(block.trim()))
    .join('');
}

function renderAssistantText(text) {
  const parts = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const markdown = renderMarkdown(text.slice(lastIndex, match.index));
      if (markdown) parts.push(`<div class="assistant-block markdown-body">${markdown}</div>`);
    }
    const language = match[1].trim();
    const code = match[2].replace(/\n$/, '');
    parts.push(`
      <div class="code-block">
        <div class="code-block-header"><span>${escapeHtml(language || 'code')}</span><button type="button" class="copy-code">Copy</button></div>
        <pre><code>${escapeHtml(code)}</code></pre>
      </div>
    `);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    const markdown = renderMarkdown(text.slice(lastIndex));
    if (markdown) parts.push(`<div class="assistant-block markdown-body">${markdown}</div>`);
  }
  return parts.join('');
}

function renderToolResult(entries, toolCallId) {
  return entries.find((entry) => entry?.type === 'message' && entry.message?.role === 'toolResult' && entry.message?.toolCallId === toolCallId)?.message;
}

function renderDiffText(diff) {
  return escapeHtml(diff).split('\n').map((line) => {
    const cls = line.startsWith('+') && !line.startsWith('+++')
      ? 'diff-added'
      : line.startsWith('-') && !line.startsWith('---')
        ? 'diff-removed'
        : 'diff-context';
    return `<div class="${cls}">${line || ' '}</div>`;
  }).join('');
}

function renderOldNewDiff(oldText = '', newText = '') {
  const oldLines = String(oldText).split('\n').map((line) => `<div class="diff-removed">− ${escapeHtml(line || ' ')}</div>`).join('');
  const newLines = String(newText).split('\n').map((line) => `<div class="diff-added">+ ${escapeHtml(line || ' ')}</div>`).join('');
  return `${oldLines}${newLines}`;
}

function detailKeyAttr(key) {
  return ` data-detail-key="${escapeHtml(key)}"`;
}

function renderToolExpandedContent(call, result, resultText) {
  const args = call.arguments || {};
  const keyBase = `tool:${call.id || call.name}`;
  if (call.name === 'todowrite') {
    const todosHtml = renderTodos(call.result || args.input || args.todos || '');
    if (todosHtml) return `<details${detailKeyAttr(`${keyBase}:todos`)}><summary>todos</summary>${todosHtml}</details>`;
  }
  if (call.name === 'write' && typeof args.content === 'string') {
    return `<details${detailKeyAttr(`${keyBase}:write`)}><summary>written content</summary><pre>${escapeHtml(args.content)}</pre>${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
  }
  if (call.name === 'edit') {
    const diff = result?.details?.diff;
    if (typeof diff === 'string' && diff.trim()) {
      return `<details${detailKeyAttr(`${keyBase}:diff`)}><summary>diff</summary><div class="diff">${renderDiffText(diff)}</div>${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
    }
    const oldText = typeof args.oldText === 'string' ? args.oldText : undefined;
    const newText = typeof args.newText === 'string' ? args.newText : undefined;
    const edits = Array.isArray(args.edits) ? args.edits : [];
    const editHtml = edits.length
      ? edits.map((edit, index) => `<h4>edit ${index + 1}</h4><div class="diff">${renderOldNewDiff(edit.oldText || '', edit.newText || '')}</div>`).join('')
      : `<div class="diff">${renderOldNewDiff(oldText || '', newText || '')}</div>`;
    return `<details${detailKeyAttr(`${keyBase}:edit`)}><summary>edit content</summary>${editHtml}${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
  }
  const diffHtml = Array.isArray(call.diffs) && call.diffs.length ? renderDiffSummary(call.diffs, `${keyBase}:diffs`) : '';
  return `${resultText ? `<details${detailKeyAttr(`${keyBase}:result`)}><summary>result ${result?.isError ? '<span class="error">error</span>' : ''}</summary><pre>${escapeHtml(resultText)}</pre></details>` : ''}${diffHtml}`;
}

function parseMaybeJson(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTodos(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.todos)) return parsed.todos;
  return null;
}

function renderTodos(value) {
  const todos = normalizeTodos(value);
  if (!todos?.length) return '';
  return `<ol class="todo-list">${todos.map((todo) => {
    const status = String(todo.status || 'pending');
    const label = status === 'completed' ? 'DONE' : status === 'in_progress' ? 'NOW' : 'TODO';
    return `<li class="todo-item ${escapeHtml(status)}"><span class="todo-status">${escapeHtml(label)}</span><span class="todo-priority">${escapeHtml(todo.priority || 'normal')}</span><span>${escapeHtml(todo.content || '')}</span></li>`;
  }).join('')}</ol>`;
}

function renderDiffSummary(diffs, detailKey = 'diff-summary') {
  const additions = diffs.reduce((sum, diff) => sum + (diff.additions || 0), 0);
  const deletions = diffs.reduce((sum, diff) => sum + (diff.deletions || 0), 0);
  const fileCount = new Set(diffs.map((diff) => diff.file)).size;
  return `<details class="patch-block"${detailKeyAttr(detailKey)}><summary>diff · ${fileCount} ${fileCount === 1 ? 'file' : 'files'} · +${additions}/-${deletions}</summary>${renderDiffBodies(diffs)}</details>`;
}

function renderDiffBodies(diffs) {
  return diffs.map((diff) => `
    <h4>${escapeHtml(diff.status || 'modified')} · ${escapeHtml(diff.file || 'unknown file')} · +${diff.additions || 0}/-${diff.deletions || 0}</h4>
    <div class="diff">${renderDiffText(diff.patch || '')}</div>
  `).join('');
}

function renderToolCall(call, entries) {
  const result = renderToolResult(entries, call.id);
  const resultText = (call.result || textFromContent(result?.content)).trim();
  const title = call.name === 'bash'
    ? `$ ${call.arguments?.command || 'bash'}`
    : `${call.name}${call.arguments?.path || call.arguments?.file_path ? ` · ${call.arguments.path || call.arguments.file_path}` : ''}`;

  return `
    <div class="tool-call">
      <div class="tool-title">${escapeHtml(title)}</div>
      ${renderToolExpandedContent(call, result, resultText)}
    </div>
  `;
}

function renderPatchBlock(block) {
  const diffs = Array.isArray(block.diffs) ? block.diffs : [];
  const files = block.files || diffs.map((diff) => diff.file);
  const title = files.length === 1 ? files[0] : `${files.length || diffs.length} files`;
  const body = diffs.length
    ? renderDiffBodies(diffs)
    : `<pre>${escapeHtml(files.join('\n') || 'Patch details unavailable')}</pre>`;
  return `<details class="patch-block"${detailKeyAttr(`patch:${block.id || files.join('|') || title}`)}><summary>patch · ${escapeHtml(title)}</summary>${body}</details>`;
}

function modeBadge(mode) {
  return mode ? `<span class="mode-badge">${escapeHtml(mode)}</span>` : '';
}

function renderEntry(entry, allEntries) {
  const role = roleLabel(entry);
  const timestamp = formatDate(entry.timestamp);
  if (entry.type === 'message' && role === 'toolResult') return '';

  if (entry.type === 'message' && role === 'assistant') {
    const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
    const hasText = blocks.some((block) => block.type === 'text' && block.text?.trim());
    const html = blocks.map((block) => {
      if (block.type === 'text') return renderAssistantText(block.text || '');
      if (block.type === 'thinking') return `<details class="thinking"${detailKeyAttr(`thinking:${entry.id}`)}><summary>thinking</summary><pre>${escapeHtml(block.thinking)}</pre></details>`;
      if (block.type === 'toolCall') return renderToolCall(block, allEntries);
      if (block.type === 'patch') return renderPatchBlock(block);
      return '';
    }).join('');
    const kind = hasText ? 'assistant' : 'tool-message';
    const label = hasText ? 'assistant' : 'tool';
    return `<section class="message ${kind}" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">${label}${modeBadge(entry.message.mode)}</div>${html}</section>`;
  }

  if (entry.type === 'message' && role === 'user') {
    const text = textFromContent(entry.message.content);
    return `<section class="message user" id="entry-${escapeHtml(entry.id)}"><button type="button" class="copy-user-prompt" title="Copy prompt" aria-label="Copy prompt">⧉</button><div class="message-head"><div class="message-role">user</div><div class="message-actions"><span class="timestamp">${escapeHtml(timestamp)}</span></div></div><div class="content">${escapeHtml(text)}</div></section>`;
  }

  if (entry.type === 'compaction') {
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">compaction</div><details><summary>summary from ${entry.tokensBefore?.toLocaleString?.() || '?'} tokens</summary><pre>${escapeHtml(entry.summary)}</pre></details></section>`;
  }

  if (entry.type === 'branch_summary') {
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">branch summary</div><div class="content">${escapeHtml(entry.summary)}</div></section>`;
  }

  if (entry.type === 'model_change') {
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">model</div><div>${escapeHtml(entry.provider)}/${escapeHtml(entry.modelId)}</div></section>`;
  }

  return '';
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
  const openDetails = new Set(Array.from(els.messages.querySelectorAll('details[data-detail-key][open]')).map((node) => node.dataset.detailKey));
  els.messages.classList.toggle('hide-tools', !els.showTools.checked);
  els.messages.innerHTML = detail.activeEntries.map((entry) => renderEntry(entry, detail.entries)).join('');
  for (const node of els.messages.querySelectorAll('details[data-detail-key]')) {
    if (openDetails.has(node.dataset.detailKey)) node.open = true;
  }
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
  const res = await fetch('api/metadata', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, ...patch }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save metadata');
  syncMetadata(path, data.metadata);
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
  els.empty.classList.add('hidden');
  els.reader.classList.remove('hidden');
  els.readerTitle.textContent = 'Loading…';
  els.readerMeta.textContent = '';
  els.readerRelations.innerHTML = '';
  els.readerRelations.classList.add('hidden');
  els.messages.innerHTML = '';
  els.topics.innerHTML = '';

  const res = await fetch(`api/session?path=${encodeURIComponent(path)}`);
  const detail = await res.json();
  if (!res.ok) throw new Error(detail.error || 'Failed to load session');
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

async function reloadSelectedSession() {
  if (!state.selectedPath || hasReaderTextSelection()) return;
  const res = await fetch(`api/session?path=${encodeURIComponent(state.selectedPath)}`);
  const detail = await res.json();
  if (!res.ok) throw new Error(detail.error || 'Failed to reload selected session');
  state.selectedDetail = detail;
  if (state.selectedTopicId && !detail.topicAnchors?.some((anchor) => anchor.id === state.selectedTopicId)) state.selectedTopicId = null;
  updateSelectedSummary(detail);
  renderSelectedDetail({ scrollTopic: false });
  persistSelectedTopic();
}

async function loadSessions({ reloadSelected = false } = {}) {
  els.status.textContent = 'Loading sessions…';
  const res = await fetch('api/sessions');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sessions');
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
  if (state.selectedPath && !state.sessions.some((session) => session.path === state.selectedPath)) {
    clearSelectedTopic();
    state.selectedPath = null;
    state.selectedDetail = null;
    persistSelectedPath();
  }
  if (reloadSelected && state.selectedPath) await reloadSelectedSession();
}

let autoRefreshTimer;
function setAutoRefresh(enabled) {
  clearInterval(autoRefreshTimer);
  if (enabled) {
    autoRefreshTimer = setInterval(() => {
      loadSessions({ reloadSelected: true }).catch((error) => { els.status.textContent = error.message; });
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
  if (event.key === 'Enter') {
    event.preventDefault();
    els.addTag.click();
  }
});
els.tagEditor.addEventListener('click', async (event) => {
  const button = event.target.closest('.remove-tag');
  if (!button || !state.selectedDetail) return;
  await saveMetadata(state.selectedDetail.path, { tags: sessionTags(state.selectedDetail).filter((tag) => tag !== button.dataset.tag) });
});
els.copyRestore.addEventListener('click', async () => {
  const command = state.selectedDetail ? restoreCommand(state.selectedDetail) : '';
  if (!command) return;
  await copyText(command);
  flashButton(els.copyRestore);
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
    await copyText(code);
    flashButton(copyCode);
    return;
  }
  const copyPrompt = event.target.closest('.copy-user-prompt');
  if (copyPrompt) {
    const prompt = copyPrompt.closest('.message.user')?.querySelector('.content')?.textContent || '';
    await copyText(prompt);
    flashButton(copyPrompt);
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
