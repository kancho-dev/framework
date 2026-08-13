import { renderMarkdown } from '/shared/browser/markdown.js';
import { escapeHtml, textFromContent, formatDate } from './formatters.js';
import { savedTopicPromptAction } from './saved-topics.js';

function roleLabel(entry) {
  if (entry.type !== 'message') return entry.type;
  return entry.message?.role || 'message';
}

function renderAssistantText(text) {
  const html = renderMarkdown(text, {
    headingOffset: 1,
    renderCodeBlock: ({ languageHtml, codeHtml }) => `
      <div class="code-block">
        <div class="code-block-header"><span>${languageHtml || 'code'}</span><button type="button" class="copy-code">Copy</button></div>
        <pre><code>${codeHtml}</code></pre>
      </div>
    `,
  });
  return html ? `<div class="assistant-block markdown-body">${html}</div>` : '';
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

export function renderEntry(entry, allEntries, { savedTopics = {} } = {}) {
  const role = roleLabel(entry);
  const timestamp = formatDate(entry.timestamp);
  if (entry.type === 'message' && role === 'toolResult') return '';

  if (entry.type === 'message' && role === 'assistant') {
    const blocks = Array.isArray(entry.message.content) ? entry.message.content : [];
    const hasText = blocks.some((block) => block.type === 'text' && block.text?.trim());
    const html = blocks.map((block, index) => {
      if (block.type === 'text') return renderAssistantText(block.text || '', `entry:${entry.id}:block:${index}`);
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
    const action = savedTopicPromptAction(entry.id, savedTopics);
    return `<section class="message user" id="entry-${escapeHtml(entry.id)}"><div class="message-head"><div class="message-role">user</div><div class="message-actions"><span class="timestamp">${escapeHtml(timestamp)}</span></div></div><div class="content">${escapeHtml(text)}</div><div class="prompt-actions"><button type="button" class="copy-user-prompt" title="Copy prompt" aria-label="Copy prompt">⧉ Copy</button><button type="button" class="save-user-topic ${action.saved ? 'active' : ''}" data-prompt-save-id="${escapeHtml(entry.id)}" title="${action.saved ? 'Edit saved topic' : 'Save topic'}">${action.saved ? '★' : '☆'} ${action.label}</button></div></section>`;
  }

  if (entry.type === 'compaction') {
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">compaction</div><details><summary>summary from ${entry.tokensBefore?.toLocaleString?.() || '?'} tokens</summary><pre>${escapeHtml(entry.summary)}</pre></details></section>`;
  }

  if (entry.type === 'branch_summary') {
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">branch summary</div><div class="content">${escapeHtml(entry.summary)}</div></section>`;
  }

  if (entry.type === 'model_change') {
    const label = entry.modelLabel || `${entry.provider ? `${entry.provider}/` : ''}${entry.modelId || ''}${entry.variant ? `:${entry.variant}` : ''}`;
    return `<section class="message system" id="entry-${escapeHtml(entry.id)}"><span class="timestamp">${escapeHtml(timestamp)}</span><div class="message-role">model</div><div>${escapeHtml(label)}</div></section>`;
  }

  return '';
}
