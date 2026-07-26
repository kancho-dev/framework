export function formatToolTitle(workspaceName, toolName) {
  const shortWorkspaceName = String(workspaceName || '').replace(/\s+Workspace$/i, '').trim();
  return [shortWorkspaceName, toolName].filter(Boolean).join(' ');
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : 'unknown time';
}

export const formatDate = formatDateTime;

export function formatTokens(value) {
  return new Intl.NumberFormat(undefined, {
    notation: Number(value) > 999999 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

export function money(value, currency) {
  return value == null ? 'unknown' : new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function shortMoney(value) {
  return Number(value) >= 1000 ? `${Math.round(value / 1000)}k` : Number(value).toFixed(0);
}
