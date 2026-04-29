const state = { sessions: [], selectedPath: null, selectedDetail: null, browseMode: true, sourceFilter: 'all', sortMode: 'updated-desc', sourceErrors: [] };

const els = {
  refresh: document.querySelector('#refresh'),
  autoRefresh: document.querySelector('#auto-refresh'),
  filter: document.querySelector('#filter'),
  sourceFilter: document.querySelector('#source-filter'),
  sortMode: document.querySelector('#sort-mode'),
  status: document.querySelector('#status'),
  sessions: document.querySelector('#sessions'),
  empty: document.querySelector('#empty'),
  reader: document.querySelector('#reader'),
  readerSource: document.querySelector('#reader-source'),
  readerTitle: document.querySelector('#reader-title'),
  readerRelations: document.querySelector('#reader-relations'),
  readerMeta: document.querySelector('#reader-meta'),
  showTools: document.querySelector('#show-tools'),
  copyRestore: document.querySelector('#copy-restore'),
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

function matches(session, query) {
  if (state.sourceFilter !== 'all' && session.source !== state.sourceFilter) return false;
  if (!query.trim()) return true;
  const haystack = [session.id, session.name, session.cwd, session.firstPrompt, session.path].join(' ').toLowerCase();
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

function renderSessions() {
  const query = els.filter.value;
  const sessions = sortSessions(state.sessions.filter((session) => matches(session, query)));
  const errorText = state.sourceErrors.length ? ` · ${state.sourceErrors.map((item) => `${sourceLabel(item.source)} unavailable${item.error ? `: ${item.error}` : ''}`).join(', ')}` : '';
  els.status.textContent = `${sessions.length} of ${state.sessions.length} sessions · workspace ${state.workspaceRoot || ''}${errorText}`;
  els.sessions.innerHTML = sessions.map((session) => `
    <li>
      <button class="session-card ${session.path === state.selectedPath ? 'active' : ''}" data-path="${escapeHtml(session.path)}">
        <div class="card-top"><span class="card-badges"><span class="badge">${escapeHtml(sourceLabel(session.source))}</span> ${tokenPressurePill(session)}</span><span class="card-updated">Updated ${escapeHtml(formatDate(session.updatedAt))}</span></div>
        <div class="prompt">${escapeHtml(session.name || session.firstPrompt || '(no user prompt found)')}</div>
        ${session.parentId ? '<div class="relation-line"><span class="relation-badge">child session</span></div>' : ''}
        <div class="cwd">${escapeHtml(shortPath(session.cwd || '(unknown cwd)'))}</div>
        <div class="time-pair">Created ${escapeHtml(formatDate(session.createdAt))}</div>
        <div class="counts">${session.userMessageCount} user · ${session.assistantMessageCount} assistant · ${session.toolMessageCount || session.toolCallCount} tool</div>
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

function renderSourceFilter() {
  const sources = Array.from(new Set(state.sessions.map((session) => session.source))).sort();
  const current = state.sourceFilter;
  els.sourceFilter.innerHTML = ['all', ...sources].map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source === 'all' ? 'All sources' : sourceLabel(source))}</option>`).join('');
  els.sourceFilter.value = sources.includes(current) ? current : 'all';
  state.sourceFilter = els.sourceFilter.value;
}

function roleLabel(entry) {
  if (entry.type !== 'message') return entry.type;
  return entry.message?.role || 'message';
}

function renderAssistantText(text) {
  const parts = [];
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(`<div class="assistant-block content">${escapeHtml(text.slice(lastIndex, match.index))}</div>`);
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
    parts.push(`<div class="assistant-block content">${escapeHtml(text.slice(lastIndex))}</div>`);
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

function renderToolExpandedContent(call, result, resultText) {
  const args = call.arguments || {};
  if (call.name === 'todowrite') {
    const todosHtml = renderTodos(call.result || args.input || args.todos || '');
    if (todosHtml) return `<details><summary>todos</summary>${todosHtml}</details>`;
  }
  if (call.name === 'write' && typeof args.content === 'string') {
    return `<details><summary>written content</summary><pre>${escapeHtml(args.content)}</pre>${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
  }
  if (call.name === 'edit') {
    const diff = result?.details?.diff;
    if (typeof diff === 'string' && diff.trim()) {
      return `<details><summary>diff</summary><div class="diff">${renderDiffText(diff)}</div>${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
    }
    const oldText = typeof args.oldText === 'string' ? args.oldText : undefined;
    const newText = typeof args.newText === 'string' ? args.newText : undefined;
    const edits = Array.isArray(args.edits) ? args.edits : [];
    const editHtml = edits.length
      ? edits.map((edit, index) => `<h4>edit ${index + 1}</h4><div class="diff">${renderOldNewDiff(edit.oldText || '', edit.newText || '')}</div>`).join('')
      : `<div class="diff">${renderOldNewDiff(oldText || '', newText || '')}</div>`;
    return `<details><summary>edit content</summary>${editHtml}${resultText ? `<pre>${escapeHtml(resultText)}</pre>` : ''}</details>`;
  }
  const diffHtml = Array.isArray(call.diffs) && call.diffs.length ? renderDiffSummary(call.diffs) : '';
  return `${resultText ? `<details><summary>result ${result?.isError ? '<span class="error">error</span>' : ''}</summary><pre>${escapeHtml(resultText)}</pre></details>` : ''}${diffHtml}`;
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

function renderDiffSummary(diffs) {
  const additions = diffs.reduce((sum, diff) => sum + (diff.additions || 0), 0);
  const deletions = diffs.reduce((sum, diff) => sum + (diff.deletions || 0), 0);
  const fileCount = new Set(diffs.map((diff) => diff.file)).size;
  return `<details class="patch-block"><summary>diff · ${fileCount} ${fileCount === 1 ? 'file' : 'files'} · +${additions}/-${deletions}</summary>${renderDiffBodies(diffs)}</details>`;
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
  return `<details class="patch-block"><summary>patch · ${escapeHtml(title)}</summary>${body}</details>`;
}

function modeBadge(mode) {
  return mode ? `<span class="mode-badge">${escapeHtml(mode)}</span>` : '';
}

function renderEntry(entry, allEntries) {
  const role = roleLabel(entry);
  const timestamp = formatTime(entry.timestamp);
  if (entry.type === 'message' && role === 'toolResult') return '';

  if (entry.type === 'message' && role === 'assistant') {
    const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
    const hasText = blocks.some((block) => block.type === 'text' && block.text?.trim());
    const html = blocks.map((block) => {
      if (block.type === 'text') return renderAssistantText(block.text || '');
      if (block.type === 'thinking') return `<details class="thinking"><summary>thinking</summary><pre>${escapeHtml(block.thinking)}</pre></details>`;
      if (block.type === 'toolCall') return renderToolCall(block, allEntries);
      if (block.type === 'patch') return renderPatchBlock(block);
      return '';
    }).join('');
    const kind = hasText ? 'assistant' : 'tool-message';
    const label = hasText ? 'assistant' : 'tool';
    return `<section class="message ${kind}" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">${label}${modeBadge(entry.message.mode)}</div>${html}</section>`;
  }

  if (entry.type === 'message' && role === 'user') {
    return `<section class="message user" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">user</div><div class="content">${escapeHtml(textFromContent(entry.message.content))}</div></section>`;
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

function renderSelectedDetail() {
  const detail = state.selectedDetail;
  if (!detail) return;
  els.readerSource.textContent = `${sourceLabel(detail.source)} session`;
  const command = restoreCommand(detail);
  els.copyRestore.classList.toggle('hidden', !command);
  els.copyRestore.title = command ? `Copy command: ${command}` : '';
  els.readerTitle.innerHTML = `${escapeHtml(detail.name || detail.firstPrompt || detail.id)} ${tokenPressurePill(detail)}`;
  renderRelations(detail);
  const metaItems = [
    `Created: ${formatDate(detail.createdAt)}`,
    `Updated: ${formatDate(detail.updatedAt)}`,
    `Cwd: ${shortPath(detail.cwd)}`,
    `Messages: ${detail.userMessageCount} user, ${detail.assistantMessageCount} assistant`,
    `Tool Messages: ${detail.toolMessageCount || detail.toolCallCount}`,
    `Tool Calls: ${detail.toolCallCount}`,
    `Token pressure: ${formatCompactNumber(tokenPressureTotal(detail))} recorded`,
    `Tokens: ${formatTokens(detail.tokens)}`,
  ];
  els.readerMeta.innerHTML = metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('');
  els.topics.innerHTML = detail.topicAnchors.map((anchor) => `
    <li><a href="#entry-${escapeHtml(anchor.id)}">${anchor.depth === 'first-prompt' ? '★ ' : ''}${escapeHtml(anchor.title)}</a></li>
  `).join('');
  els.messages.classList.toggle('hide-tools', !els.showTools.checked);
  els.messages.innerHTML = detail.activeEntries.map((entry) => renderEntry(entry, detail.entries)).join('');
}

function updateSelectedSummary(detail) {
  const index = state.sessions.findIndex((session) => session.path === detail.path);
  if (index >= 0) {
    const { entries, activeEntries, topicAnchors, ...summary } = detail;
    state.sessions[index] = summary;
    renderSessions();
  }
}

async function selectSession(path) {
  state.selectedPath = path;
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

  const res = await fetch(`/api/session?path=${encodeURIComponent(path)}`);
  const detail = await res.json();
  if (!res.ok) throw new Error(detail.error || 'Failed to load session');
  state.selectedDetail = detail;
  updateSelectedSummary(detail);
  renderSelectedDetail();
  requestAnimationFrame(updateReaderHeaderHeight);
}

async function reloadSelectedSession() {
  if (!state.selectedPath) return;
  const res = await fetch(`/api/session?path=${encodeURIComponent(state.selectedPath)}`);
  const detail = await res.json();
  if (!res.ok) throw new Error(detail.error || 'Failed to reload selected session');
  state.selectedDetail = detail;
  updateSelectedSummary(detail);
  renderSelectedDetail();
}

async function loadSessions({ reloadSelected = false } = {}) {
  els.status.textContent = 'Loading sessions…';
  const res = await fetch('/api/sessions');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sessions');
  state.sessions = data.sessions;
  state.sessionRoot = data.sessionRoot;
  state.sourceErrors = data.sourceErrors || [];
  state.workspaceRoot = data.workspaceRoot;
  renderSourceFilter();
  renderSessions();
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
els.filter.addEventListener('input', renderSessions);
els.sourceFilter.addEventListener('change', () => {
  state.sourceFilter = els.sourceFilter.value;
  renderSessions();
});
els.sortMode.addEventListener('change', () => {
  state.sortMode = els.sortMode.value;
  renderSessions();
});
els.showTools.addEventListener('change', () => {
  renderSelectedDetail();
  requestAnimationFrame(updateReaderHeaderHeight);
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
  const card = event.target.closest('.session-card');
  if (card) selectSession(card.dataset.path).catch((error) => { els.readerTitle.textContent = error.message; });
});
els.messages.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-code');
  if (!button) return;
  const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
  await copyText(code);
  flashButton(button);
});

els.readerRelations.addEventListener('click', (event) => {
  const link = event.target.closest('.relation-link');
  if (link) selectSession(link.dataset.path).catch((error) => { els.readerTitle.textContent = error.message; });
});
document.querySelector('.reader-pane').addEventListener('click', () => {
  if (state.selectedDetail && state.browseMode) setBrowseMode(false);
});

window.addEventListener('resize', updateReaderHeaderHeight);
setBrowseMode(true);
updateReaderHeaderHeight();
setAutoRefresh(els.autoRefresh.checked);
loadSessions().catch((error) => { els.status.textContent = error.message; });
