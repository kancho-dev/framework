export const LIMITS_REFRESH_MS = 300_000;

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

export function gaugeLevel(remaining) {
  if (remaining === null) return 'unknown';
  if (remaining <= 10) return 'critical';
  if (remaining <= 25) return 'low';
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
