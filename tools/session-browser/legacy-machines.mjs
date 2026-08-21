import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const SOURCES = new Set(['pi', 'claude-code', 'codex', 'opencode']);

async function exists(path, inspect = stat) {
  try { await inspect(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function diagnostic(code, message, source = 'legacy-config') {
  return Object.freeze({ source, code, message });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPathPrefix(prefix, candidate) {
  const suffix = relative(prefix, candidate);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

function freezeMachine(machine) {
  return Object.freeze({
    ...machine,
    roots: Object.freeze(machine.roots),
    originalRoots: Object.freeze(machine.originalRoots),
    artifacts: Object.freeze(machine.artifacts),
    pathMap: Object.freeze(machine.pathMap.map(Object.freeze)),
  });
}

function validatePathMap(value, machineId, workspaceRoot, errors, { rejectConflicts = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(diagnostic('invalid-path-map', `Machine ${machineId} pathMap must be an array.`, `legacy@${machineId}`));
    return [];
  }

  const mappings = [];
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry) || typeof entry.from !== 'string' || !isAbsolute(entry.from) || typeof entry.to !== 'string' || !entry.to.trim()) {
      errors.push(diagnostic('invalid-path-map-entry', `Machine ${machineId} pathMap[${index}] requires an absolute from path and a non-empty to path.`, `legacy@${machineId}`));
      continue;
    }
    const from = resolve(entry.from);
    const to = entry.to === '.' ? workspaceRoot : resolve(workspaceRoot, entry.to);
    if (!isPathPrefix(workspaceRoot, to)) {
      errors.push(diagnostic('path-map-outside-workspace', `Machine ${machineId} pathMap[${index}] resolves outside the workspace: ${to}`, `legacy@${machineId}`));
      continue;
    }
    mappings.push({ from, to });
  }
  if (!rejectConflicts) return mappings.sort((left, right) => right.from.length - left.from.length);

  const byPrefix = new Map();
  for (const mapping of mappings) {
    const existing = byPrefix.get(mapping.from) || [];
    if (!existing.some(({ to }) => to === mapping.to)) existing.push(mapping);
    byPrefix.set(mapping.from, existing);
  }
  const normalized = [];
  for (const [from, entries] of byPrefix) {
    if (entries.length > 1) {
      errors.push(diagnostic('conflicting-path-mapping', `Machine ${machineId} has conflicting mappings for ${from}.`, `legacy@${machineId}`));
    } else {
      normalized.push(entries[0]);
    }
  }
  return normalized.sort((left, right) => right.from.length - left.from.length);
}

async function validateRoots(value, machineId, configDir, errors, inspectRoot) {
  if (!isPlainObject(value)) {
    errors.push(diagnostic('invalid-roots', `Machine ${machineId} roots must be an object.`, `legacy@${machineId}`));
    return {};
  }

  const roots = {};
  for (const [source, configuredPath] of Object.entries(value)) {
    const errorSource = `${source}@${machineId}`;
    if (!SOURCES.has(source)) {
      errors.push(diagnostic('unknown-source', `Machine ${machineId} declares unknown source ${source}.`, errorSource));
      continue;
    }
    if (typeof configuredPath !== 'string' || !configuredPath.trim()) {
      errors.push(diagnostic('invalid-root', `Machine ${machineId} root ${source} must be a non-empty path.`, errorSource));
      continue;
    }
    const root = resolve(configDir, configuredPath);
    try {
      if (!await exists(root, inspectRoot)) {
        errors.push(diagnostic('missing-root', `Machine ${machineId} root ${source} does not exist: ${root}`, errorSource));
        continue;
      }
      roots[source] = root;
    } catch (error) {
      errors.push(diagnostic('unreadable-root', `Machine ${machineId} root ${source} is unreadable: ${error.message}`, errorSource));
    }
  }
  return roots;
}

async function validateArtifacts(value, machineId, configDir, errors, inspectRoot) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    errors.push(diagnostic('invalid-artifacts', `Machine ${machineId} artifacts must be an object.`, `legacy@${machineId}`));
    return {};
  }
  const artifacts = {};
  for (const [name, configuredPath] of Object.entries(value)) {
    const errorSource = `${name}@${machineId}`;
    if (name !== 'opencode-data' || typeof configuredPath !== 'string' || !configuredPath.trim()) {
      errors.push(diagnostic('invalid-artifact', `Machine ${machineId} has an invalid artifact entry for ${name}.`, errorSource));
      continue;
    }
    const root = resolve(configDir, configuredPath);
    try {
      if (!await exists(root, inspectRoot)) {
        errors.push(diagnostic('missing-artifact', `Machine ${machineId} artifact ${name} does not exist: ${root}`, errorSource));
        continue;
      }
      artifacts[name] = root;
    } catch (error) {
      errors.push(diagnostic('unreadable-artifact', `Machine ${machineId} artifact ${name} is unreadable: ${error.message}`, errorSource));
    }
  }
  return artifacts;
}

function validateOriginalRoots(value, machineId, errors) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    errors.push(diagnostic('invalid-original-roots', `Machine ${machineId} originalRoots must be an object.`, `legacy@${machineId}`));
    return {};
  }
  const roots = {};
  for (const [source, configuredPath] of Object.entries(value)) {
    if (!SOURCES.has(source) || typeof configuredPath !== 'string' || !configuredPath.trim()) {
      errors.push(diagnostic('invalid-original-root', `Machine ${machineId} has an invalid originalRoots entry for ${source}.`, `legacy@${machineId}`));
      continue;
    }
    roots[source] = resolve(configuredPath);
  }
  return roots;
}

export function translateCwd(machine, cwd) {
  if (!machine || typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
  const mapping = machine.pathMap.find(({ from }) => isPathPrefix(from, cwd));
  if (!mapping) return null;
  const suffix = relative(mapping.from, cwd);
  return suffix ? join(mapping.to, suffix) : mapping.to;
}

export async function loadLegacyMachines({ configPath, workspaceRoot, inspectRoot = stat, bindings } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const workspace = resolve(workspaceRoot);
  const path = resolve(configPath || join(workspace, '.tools-config', 'session-browser', 'machines.json'));
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && bindings === undefined) return Object.freeze({ machines: Object.freeze({}), errors: Object.freeze([]) });
    const message = error instanceof SyntaxError ? `Malformed legacy machine config: ${error.message}` : `Cannot read legacy machine config: ${error.message}`;
    return Object.freeze({ machines: Object.freeze({}), errors: Object.freeze([diagnostic('invalid-config', message)]) });
  }

  const errors = [];
  if (bindings !== undefined) {
    const localConfigPath = join(workspace, '.tools-config', 'session-browser', 'machines.json');
    try {
      if (path !== resolve(localConfigPath) && await exists(localConfigPath)) {
        errors.push(diagnostic('local-config-ignored', `Shared archive mode ignores workspace-local machine config: ${localConfigPath}`));
      }
    } catch {
      // Shared inventory remains authoritative even when the ignored local path cannot be inspected.
    }
  }
  if (!isPlainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.machines)) {
    return Object.freeze({
      machines: Object.freeze({}),
      errors: Object.freeze([diagnostic('invalid-schema', 'Legacy machine config requires version 1 and a machines array.')]),
    });
  }

  const sharedMode = bindings !== undefined;
  const configDir = dirname(path);
  const inventory = new Map();
  const duplicateMachineIds = new Set();
  for (const entry of parsed.machines) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.id)) {
      errors.push(diagnostic('invalid-machine', 'Each legacy machine requires a safe, non-empty id.'));
      continue;
    }
    if (inventory.has(entry.id)) {
      errors.push(diagnostic('duplicate-machine', `Duplicate legacy machine id: ${entry.id}`, `legacy@${entry.id}`));
      duplicateMachineIds.add(entry.id);
      continue;
    }
    inventory.set(entry.id, entry);
  }
  if (sharedMode) for (const id of duplicateMachineIds) inventory.delete(id);

  const selectedBindings = new Map();
  if (sharedMode) {
    const values = Array.isArray(bindings) ? bindings : [];
    const counts = new Map();
    for (const binding of values) {
      const id = isPlainObject(binding) && typeof binding.machineId === 'string' ? binding.machineId : '';
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const binding of values) {
      const id = isPlainObject(binding) && typeof binding.machineId === 'string' ? binding.machineId : '';
      if ((counts.get(id) || 0) > 1) {
        if (!selectedBindings.has(id)) errors.push(diagnostic('duplicate-machine-binding', `Duplicate binding for machine ${id || '(missing)'}.`, `legacy@${id || 'unknown'}`));
        selectedBindings.set(id, null);
      } else if (!inventory.has(id)) {
        errors.push(diagnostic('unknown-machine-binding', `Binding refers to unknown or disabled machine ${id || '(missing)'}.`, `legacy@${id || 'unknown'}`));
      } else {
        selectedBindings.set(id, binding);
      }
    }
  }

  const machines = {};
  for (const [id, entry] of inventory) {
    const binding = sharedMode ? selectedBindings.get(id) : null;
    if (sharedMode && !binding) continue;
    const roots = await validateRoots(entry.roots, id, configDir, errors, inspectRoot);
    const pathMap = validatePathMap(sharedMode ? binding.pathMap : entry.pathMap, id, workspace, errors, { rejectConflicts: sharedMode });
    if (sharedMode && pathMap.length === 0) errors.push(diagnostic('empty-machine-binding', `Machine ${id} binding has no valid mappings.`, `legacy@${id}`));
    const originalRoots = validateOriginalRoots(entry.originalRoots, id, errors);
    const artifacts = await validateArtifacts(entry.artifacts, id, configDir, errors, inspectRoot);
    machines[id] = freezeMachine({
      id,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id,
      retiredAt: typeof entry.retiredAt === 'string' ? entry.retiredAt : null,
      immutable: entry.immutable !== false,
      roots,
      originalRoots,
      artifacts,
      pathMap,
    });
  }

  return Object.freeze({ machines: Object.freeze(machines), errors: Object.freeze(errors) });
}
