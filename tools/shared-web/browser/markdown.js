import { escapeHtml } from './dom.js';

function renderInline(value) {
  const tokens = [];
  const preserve = (html) => {
    const token = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  };

  let html = escapeHtml(String(value ?? ''));
  html = html.replace(/`([^`]+)`/g, (_, code) => preserve(`<code>${code}</code>`));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => preserve(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`));
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|\W)_([^_\n]+)_/g, '$1<em>$2</em>');
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function splitTableRow(line) {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  let inCode = false;
  for (const char of value) {
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(line) {
  const cells = splitTableRow(line);
  if (cells.length < 2) return null;
  const alignments = cells.map((cell) => {
    const marker = cell.replace(/\s+/g, '');
    if (!/^:?-{3,}:?$/.test(marker)) return null;
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center';
    return marker.endsWith(':') ? 'right' : 'left';
  });
  return alignments.includes(null) ? null : alignments;
}

function renderTable(lines, start) {
  if (start + 1 >= lines.length || !lines[start].includes('|')) return null;
  const headers = splitTableRow(lines[start]);
  const alignments = tableAlignments(lines[start + 1]);
  if (!alignments || headers.length !== alignments.length) return null;
  const body = [];
  let cursor = start + 2;
  while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes('|')) {
    body.push(splitTableRow(lines[cursor]));
    cursor += 1;
  }
  const row = (cells, tag) => `<tr>${headers.map((_, index) => `<${tag} class="align-${alignments[index]}">${renderInline(cells[index] || '')}</${tag}>`).join('')}</tr>`;
  const tbody = body.length ? `<tbody>${body.map((cells) => row(cells, 'td')).join('')}</tbody>` : '';
  return { html: `<div class="markdown-table-wrap"><table><thead>${row(headers, 'th')}</thead>${tbody}</table></div>`, cursor };
}

function isBlockStart(lines, index) {
  const line = lines[index] || '';
  const next = lines[index + 1] || '';
  return /^\s*$/.test(line)
    || /^\s*```/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || (line.includes('|') && tableAlignments(next));
}

function listItem(line) {
  const match = (line || '').match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  return {
    indent: match[1].length,
    ordered: /^\d/.test(match[2]),
    content: match[3],
  };
}

function renderList(lines, start) {
  const first = listItem(lines[start]);
  const items = [];
  let cursor = start;

  while (cursor < lines.length) {
    const current = listItem(lines[cursor]);
    if (!current || current.indent !== first.indent || current.ordered !== first.ordered) break;
    let itemHtml = renderInline(current.content);
    cursor += 1;

    while (cursor < lines.length) {
      const child = listItem(lines[cursor]);
      if (child?.indent > first.indent) {
        const nested = renderList(lines, cursor);
        itemHtml += nested.html;
        cursor = nested.cursor;
        continue;
      }
      if (/^\s{2,}\S/.test(lines[cursor]) && !isBlockStart(lines, cursor)) {
        itemHtml += ` ${renderInline(lines[cursor].trim())}`;
        cursor += 1;
        continue;
      }
      break;
    }
    items.push(`<li>${itemHtml}</li>`);

    if (first.ordered && /^\s*$/.test(lines[cursor] || '')) {
      const next = listItem(lines[cursor + 1]);
      if (next?.ordered && next.indent === first.indent) cursor += 1;
    }
  }

  const tag = first.ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, cursor };
}

/**
 * Render the workspace's safe, bounded Markdown subset.
 * Options are presentation adapters; output remains derived only from the input arguments.
 */
export function renderMarkdown(markdown, options = {}) {
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';
  const headingOffset = Math.max(0, Math.min(5, Number(options.headingOffset) || 0));
  const renderCodeBlock = options.renderCodeBlock || (({ codeHtml }) => `<pre><code>${codeHtml}</code></pre>`);
  const lines = text.split('\n');
  const parts = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line.trim()) {
      cursor += 1;
      continue;
    }

    const fence = line.match(/^([ \t]*)```([^`]*)$/);
    if (fence) {
      const codeLines = [];
      const fenceIndent = fence[1].length;
      cursor += 1;
      while (cursor < lines.length && !/^[ \t]*```\s*$/.test(lines[cursor])) {
        codeLines.push(lines[cursor++].replace(new RegExp(`^[ \\t]{0,${fenceIndent}}`), ''));
      }
      if (cursor < lines.length) cursor += 1;
      parts.push(renderCodeBlock({
        languageHtml: escapeHtml(fence[2].trim()),
        codeHtml: escapeHtml(codeLines.join('\n')),
      }));
      continue;
    }

    const renderedTable = renderTable(lines, cursor);
    if (renderedTable) {
      parts.push(renderedTable.html);
      cursor = renderedTable.cursor;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingOffset);
      parts.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      cursor += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      parts.push('<hr>');
      cursor += 1;
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const list = renderList(lines, cursor);
      parts.push(list.html);
      cursor = list.cursor;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) quote.push(lines[cursor++].replace(/^\s*>\s?/, ''));
      parts.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }

    const prose = [line.trim()];
    cursor += 1;
    while (cursor < lines.length && lines[cursor].trim() && !isBlockStart(lines, cursor)) prose.push(lines[cursor++].trim());
    parts.push(`<p>${prose.map(renderInline).join('<br>')}</p>`);
  }

  return parts.join('');
}
