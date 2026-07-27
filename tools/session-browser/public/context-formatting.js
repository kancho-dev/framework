import { formatCompactNumber } from './token-formatting.js';

export function contextLoadLevel(session) {
  const latest = session?.contextLoad?.latest;
  if (latest == null) return 'unknown';
  if (latest >= 150_000) return 'critical';
  if (latest >= 100_000) return 'medium';
  return 'low';
}

export function contextLoadPercent(session) {
  const latest = session?.contextLoad?.latest;
  const ceiling = Number(session?.contextLoad?.preferredCeiling || 0);
  if (latest == null || ceiling <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((latest / ceiling) * 100)));
}

export function formatContextLoad(contextLoad) {
  if (contextLoad?.latest == null) return 'unknown';
  return `${formatCompactNumber(contextLoad.latest)} / ${formatCompactNumber(contextLoad.preferredCeiling)} preferred`;
}

export function contextLoadPill(session) {
  const latest = session?.contextLoad?.latest;
  const ceiling = session?.contextLoad?.preferredCeiling;
  if (latest == null) {
    return '<span class="token-pill unknown" title="Latest context load is unavailable">ctx ?</span>';
  }
  const title = `Latest recorded context load; includes cached input. Preferred ceiling: ${formatCompactNumber(ceiling)}`;
  return `<span class="token-pill ${contextLoadLevel(session)}" title="${title}">${formatCompactNumber(latest)} ctx</span>`;
}
