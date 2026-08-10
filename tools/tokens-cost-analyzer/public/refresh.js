export function reportRequestUrl(search, { force = false, reason } = {}) {
  const params = new URLSearchParams(search);
  if (force) params.set('refresh', '1');
  if (reason === 'manual') params.set('manual', '1');
  return `api/report${params.size ? `?${params}` : ''}`;
}

/**
 * Carries the page's query (the Cockpit's `workspace`, above all) and
 * never `refresh` or `manual`: this endpoint reports flights, and a status URL
 * that could carry a force flag would be one typo away from turning an idle tab
 * into a fetch loop against every configured machine.
 */
export function statusRequestUrl(search) {
  const params = new URLSearchParams(search);
  params.delete('refresh');
  params.delete('manual');
  return `api/sources/status${params.size ? `?${params}` : ''}`;
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
