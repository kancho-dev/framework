export const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function normalizeWorkspaceId(value, label = 'workspace id') {
  const id = String(value || '').trim();
  if (!WORKSPACE_ID_PATTERN.test(id)) throw new Error(`Invalid ${label}: ${id || '(missing)'}`);
  return id;
}
