import { escapeHtml } from '/shared/browser/dom.js';

export { escapeHtml };

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

export function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${Math.round(number / 1000).toLocaleString()}k`;
  if (number >= 1000) return `${Math.round(number / 1000)}k`;
  return number.toLocaleString();
}

export function formatTokens(tokens) {
  return `↓${formatCompactNumber(tokens?.input)} ↑${formatCompactNumber(tokens?.output)} R${formatCompactNumber(tokens?.cacheRead)}`;
}

export function tokenPressureTotal(sessionOrTokens) {
  return Number(sessionOrTokens?.tokenPressure?.total ?? sessionOrTokens?.tokens?.total ?? sessionOrTokens?.total ?? 0);
}

export function tokenPressureLevel(sessionOrTokens) {
  const total = tokenPressureTotal(sessionOrTokens);
  if (total >= 300_000) return 'critical';
  if (total >= 150_000) return 'high';
  if (total >= 50_000) return 'medium';
  return 'low';
}

export function tokenPressurePercent(sessionOrTokens) {
  return Math.min(100, Math.max(2, Math.round((tokenPressureTotal(sessionOrTokens) / 300_000) * 100)));
}

export function tokenPressurePill(sessionOrTokens) {
  // GitHub Copilot sessions don't have token data in local files
  if (sessionOrTokens?.source === 'copilot') return '';
  const total = tokenPressureTotal(sessionOrTokens);
  return `<span class="token-pill ${tokenPressureLevel(sessionOrTokens)}" title="Recorded token pressure; excludes repeated cache-read tokens and is not a model context-window percentage">${formatCompactNumber(total)} tok</span>`;
}
