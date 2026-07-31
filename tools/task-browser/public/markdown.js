import { escapeHtml } from '/shared/browser/dom.js';

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function table(lines) {
  if (lines.length < 2 || !lines[0].includes('|')) return '';
  const headers = tableCells(lines[0]);
  const markers = tableCells(lines[1]);
  if (headers.length < 2 || headers.length !== markers.length || !markers.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))) return '';
  const align = markers.map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
  const row = (values, tag) => `<tr>${headers.map((_, index) => `<${tag} class="align-${align[index]}">${inline(values[index] || '')}</${tag}>`).join('')}</tr>`;
  return `<div class="markdown-table-wrap"><table><thead>${row(headers, 'th')}</thead><tbody>${lines.slice(2).map((line) => row(tableCells(line), 'td')).join('')}</tbody></table></div>`;
}

function block(value) {
  const lines = value.split('\n');
  const renderedTable = table(lines);
  if (renderedTable) return renderedTable;
  const heading = value.match(/^(#{1,6})\s+(.+)$/);
  if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*+]\s+/, ''))}</li>`).join('')}</ul>`;
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) return `<ol>${lines.map((line) => `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
  if (lines.every((line) => /^\s*>\s?/.test(line))) return `<blockquote>${lines.map((line) => inline(line.replace(/^\s*>\s?/, ''))).join('<br>')}</blockquote>`;
  return `<p>${lines.map(inline).join('<br>')}</p>`;
}

export function renderMarkdown(text) {
  const parts = [];
  const fences = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  const addText = (value) => parts.push(...value.trim().split(/\n{2,}/).filter(Boolean).map((item) => block(item.trim())));
  for (const match of text.matchAll(fences)) {
    addText(text.slice(cursor, match.index));
    parts.push(`<pre><code>${escapeHtml(match[2].replace(/\n$/, ''))}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  addText(text.slice(cursor));
  return parts.join('');
}
