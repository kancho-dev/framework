export const CURRENT_MACHINE = 'current';

export function sessionMachine(session) {
  return session?.machineId || CURRENT_MACHINE;
}

export function machineFilterOptions(sessions) {
  const archived = new Map();
  for (const session of sessions || []) {
    if (session?.machineId) archived.set(session.machineId, session.machineLabel || session.machineId);
  }
  return [...archived].sort((a, b) => a[1].localeCompare(b[1]));
}

export function matchesMachineFilter(session, filter) {
  return !filter || filter === 'all' || sessionMachine(session) === filter;
}

export function originTooltip(session) {
  if (!session?.machineId) return session?.cwd || '';
  const original = session.originalCwd || 'original working directory unknown';
  return `${original} — ${session.machineLabel || session.machineId}`;
}

export function archivalProvenanceText(session) {
  if (!session?.machineId) return '';
  return `archived · ${session.machineLabel || session.machineId} · read-only · cannot resume`;
}

export function archivalNote(session) {
  if (!session?.machineId) return '';
  const retired = session.retiredAt ? `, retired ${session.retiredAt}` : '';
  return `Archived from ${session.machineLabel || session.machineId}${retired}. This history will not change. The native tool on this machine does not own this session and cannot resume it.`;
}

export function relationTooltip(session) {
  const name = session?.name || session?.id || 'related session';
  return `${name} · ${session?.cwd || 'working directory unknown'}`;
}
