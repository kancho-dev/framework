export function sessionStatusView({ visibleCount, totalCount, workspaceName, archivesLoading = false, unmappedSessions = [], errors = [] }) {
  const loading = archivesLoading ? ' · loading archived sessions…' : '';
  const notices = [
    ...unmappedSessions
      .filter(({ count }) => count)
      .map(({ label, machineId, count }) => `${label || machineId}: ${count} archived session${count === 1 ? '' : 's'} from other workspaces (not shown)`),
    ...errors.filter(Boolean),
  ];
  return {
    primary: `${visibleCount} of ${totalCount} sessions · ${workspaceName}${loading}`,
    notices,
    noticeSummary: `${notices.length} archive notice${notices.length === 1 ? '' : 's'}`,
  };
}
