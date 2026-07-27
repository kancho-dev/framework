import { escapeHtml } from '/shared/browser/dom.js';
export { escapeHtml };
export { formatCompactNumber, formatTokens } from './token-formatting.js';
export { contextLoadLevel, contextLoadPercent, contextLoadPill, formatContextLoad } from './context-formatting.js';

export function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block?.type === 'text').map((block) => block.text || '').join('\n');
}

export function formatDate(value) {
  if (!value) return 'unknown';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortPath(value, max = 72) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}
