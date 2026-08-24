export const LIMITS_REFRESH_MS = 600_000;

const REASON_TEXT = {
  'codex-unavailable': 'Codex CLI not available',
  'codex-timeout': 'provider timed out',
  'codex-request-failed': 'provider request failed',
  'claude-no-token': 'Claude Code sign-in not found',
  'claude-token-expired': 'Claude Code sign-in expired',
  'claude-auth-rejected': 'provider rejected the request',
  'claude-request-failed': 'provider request failed',
  'no-data': 'no data returned',
  'no-weekly-window': 'no weekly window reported',
  'no-five-hour-window': 'no 5 hour window reported',
  timeout: 'provider timed out',
  unreadable: 'source unreadable',
};

export function limitReasonText(reason) {
  return REASON_TEXT[reason] || 'no available source';
}

export function remainingFor(provider) {
  return provider?.status === 'ok' && typeof provider.remainingPercent === 'number' ? provider.remainingPercent : null;
}

export function expectedRemainingFor(provider, now = Date.now()) {
  if (remainingFor(provider) === null) return null;
  const resetAt = Date.parse(provider.resetsAt);
  const windowMs = provider.windowDurationMins * 60_000;
  const remainingFraction = (resetAt - now) / windowMs;
  if (!Number.isFinite(resetAt) || !Number.isFinite(windowMs) || windowMs <= 0 || remainingFraction < 0 || remainingFraction > 1) return null;
  return remainingFraction * 100;
}

export function gaugeLevel(provider, now = Date.now()) {
  const remaining = remainingFor(provider);
  if (remaining === null) return 'unknown';

  const resetAt = Date.parse(provider.resetsAt);
  const windowMs = provider.windowDurationMins * 60_000;
  const elapsedFraction = (now - (resetAt - windowMs)) / windowMs;
  if (!Number.isFinite(resetAt) || !Number.isFinite(windowMs) || windowMs <= 0 || elapsedFraction < 0 || elapsedFraction >= 1) {
    if (remaining <= 10) return 'critical';
    if (remaining <= 25) return 'low';
    return 'ok';
  }

  if (remaining <= 5) return 'critical';
  if (remaining <= 15) return 'low';
  const usedFraction = (100 - remaining) / 100;
  const paceRatio = usedFraction / Math.max(elapsedFraction, 0.05);
  if (paceRatio >= 1.5) return 'critical';
  if (paceRatio >= 1.15) return 'low';
  if (elapsedFraction >= 0.2 && paceRatio < 0.7) return 'available';
  return 'ok';
}

export function formatReset(resetsAt, now = Date.now()) {
  if (!resetsAt) return 'unknown';
  const remainingMs = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(remainingMs)) return 'unknown';
  if (remainingMs <= 0) return 'now';
  const hours = Math.floor(remainingMs / 3_600_000);
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `in ${hours}h ${Math.floor((remainingMs % 3_600_000) / 60_000)}m`;
}

export function isStale(limits, now = Date.now()) {
  if (!limits?.data) return false;
  if (limits.failed) return true;
  return now - limits.fetchedAt > (limits.data.refreshIntervalMs || LIMITS_REFRESH_MS) * 1.5;
}
