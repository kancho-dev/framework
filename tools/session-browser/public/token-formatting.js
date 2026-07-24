export function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${Math.round(number / 1000).toLocaleString()}k`;
  if (number >= 1000) return `${Math.round(number / 1000)}k`;
  return number.toLocaleString();
}

export function formatTotalTokensMillions(value) {
  if (value === null || value === undefined || value === '') return '';
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) return '';
  return `Total ${(total / 1_000_000).toFixed(2)}M`;
}

export function formatTokens(tokens) {
  const breakdown = `↓${formatCompactNumber(tokens?.input)} ↑${formatCompactNumber(tokens?.output)} R${formatCompactNumber(tokens?.cacheRead)}`;
  const total = formatTotalTokensMillions(tokens?.total);
  return total ? `${breakdown} · ${total}` : breakdown;
}
