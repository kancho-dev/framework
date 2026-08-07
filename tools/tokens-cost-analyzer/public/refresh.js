export function reportRequestUrl(search, { force = false, reason } = {}) {
  const params = new URLSearchParams(search);
  if (force) params.set('refresh', '1');
  if (reason === 'manual') params.set('manual', '1');
  return `api/report${params.size ? `?${params}` : ''}`;
}

export function refreshStatus(phase, error) {
  if (phase === 'loading') return { visible: true, text: 'Loading analysis…' };
  if (phase === 'refreshing') return { visible: true, text: 'Refreshing…' };
  if (phase === 'error') return { visible: true, text: `Error: ${error?.message || 'Refresh failed'}` };
  return { visible: false, text: '' };
}

export function startAutomaticRefresh(refresh, intervalMs, setIntervalFn = setInterval) {
  return setIntervalFn(() => refresh.request({ reason: 'poll', force: true }), intervalMs);
}
