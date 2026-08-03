export function startAutomaticRefresh(refresh, intervalMs, setIntervalFn = setInterval) {
  return setIntervalFn(() => refresh.request({ reason: 'poll', force: true }), intervalMs);
}
