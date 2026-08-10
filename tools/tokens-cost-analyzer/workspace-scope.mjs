import { homedir, hostname } from 'node:os';
import { basename, resolve, sep } from 'node:path';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function parseSelfConfig(self, { workspaceRoot, home = homedir(), host = hostname() } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const root = resolveExpanded(self?.root || workspaceRoot, home);
  const machineId = validateId(self?.machineId || slug(host), 'self.machineId');
  const catchAllId = validateId(self?.catchAllId || slug(basename(root)), 'self.catchAllId');
  const workspaces = (self?.workspaces || []).map((workspace, index) => {
    const workspaceRoot = resolveExpanded(workspace?.root, home);
    if (!isUnderRoot(workspaceRoot, root)) throw new Error(`self.workspaces[${index}].root must be within self.root`);
    return { id: validateId(workspace?.id, `self.workspaces[${index}].id`), root: workspaceRoot };
  });
  const ids = [catchAllId, ...workspaces.map(({ id }) => id)];
  if (new Set(ids).size !== ids.length) throw new Error('workspace ids must be unique');
  return { machineId, root, catchAllId, workspaces: workspaces.sort(mostSpecificFirst) };
}

export const SCAN_SCOPE_FILE = 'scan-scope.json';

/**
 * The local, never-exported record of what a scan attributed against. The
 * catch-all is listed first because it is a workspace like any other here;
 * The deep-link reader matches a record's `workspaceId` against these ids.
 */
export function scanScope(scopes) {
  return {
    machineId: scopes.machineId,
    workspaces: [{ id: scopes.catchAllId, root: scopes.root }, ...scopes.workspaces.map(({ id, root }) => ({ id, root }))],
  };
}

export function attributeWorkspace(directory, scopes) {
  if (!directory || !scopes?.root || !isUnderRoot(directory, scopes.root)) return null;
  return scopes.workspaces.find((workspace) => isUnderRoot(directory, workspace.root))?.id || scopes.catchAllId;
}

export function attributePiWorkspace(encodedDirectory, scopes) {
  if (!encodedDirectory || !scopes?.root || !piNameMatches(encodedDirectory, scopes.root)) return null;
  return scopes.workspaces.find((workspace) => piNameMatches(encodedDirectory, workspace.root))?.id || scopes.catchAllId;
}

export function encodePiWorkspace(path) {
  return `-${resolve(path).replaceAll(sep, '-')}--`;
}

function piNameMatches(directoryName, root) {
  // Pi's slash-to-hyphen encoding cannot distinguish a child path from a
  // hyphen-prefixed sibling. Prefer the child reading so nested Pi sessions
  // remain attributable; path-based adapters do not have this ambiguity.
  const encoded = encodePiWorkspace(root);
  const prefix = encoded.slice(0, -2);
  return directoryName === encoded || directoryName.startsWith(`${prefix}-`);
}

function isUnderRoot(candidate, root) {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

function resolveExpanded(path, home) {
  if (!path || typeof path !== 'string') throw new Error('workspace root is required');
  if (path === '~') return resolve(home);
  if (path.startsWith('~/')) return resolve(home, path.slice(2));
  return resolve(path);
}

function slug(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9._-]+$/g, '');
  return normalized.slice(0, 64) || 'local';
}
function validateId(value, field) {
  if (!ID_PATTERN.test(value || '')) throw new Error(`${field} is invalid`);
  return value;
}
function mostSpecificFirst(a, b) { return b.root.length - a.root.length || a.id.localeCompare(b.id); }
