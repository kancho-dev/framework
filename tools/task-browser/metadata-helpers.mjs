import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const STATUSES = ['planned', 'active', 'blocked', 'review', 'paused', 'done'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const NEXT_ACTORS = ['operator', 'agent'];
export const ARRAY_FIELDS = new Set(['tags', 'blockedBy', 'children', 'related']);
export const RELATION_FIELDS = new Set(['blockedBy', 'children', 'related']);
export const IDENTITY_FIELDS = new Set(['displayId', 'project', 'slug', 'path']);
export const HISTORY_FIELDS = ['status', 'priority', 'type', 'nextActor', 'tags', 'order', 'parent', 'children', 'blockedBy', 'related'];
export const RELATIONSHIP_FIELDS = new Set(['parent', 'children', 'blockedBy', 'related']);

export async function exists(path) { try { await stat(path); return true; } catch { return false; } }

export async function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (await exists(join(current, 'AGENTS.md'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function metadataPathFor(workspaceRoot) {
  return resolve(process.env.TASK_BROWSER_METADATA || join(workspaceRoot, '.tools-config', 'task-browser', 'tasks.json'));
}

export function historyPathFor(workspaceRoot, metadataPath = metadataPathFor(workspaceRoot)) {
  return resolve(process.env.TASK_BROWSER_HISTORY || join(dirname(metadataPath), 'task-history.jsonl'));
}

export async function readMetadata(path, { allowMissing = false } = {}) {
  try {
    return normalizeMetadata(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { version: 1, nextDisplayNumber: 1, tasks: {} };
    if (error.code === 'ENOENT') throw new Error(`Missing metadata file: ${path}. Open/run task-browser first, run init for an existing task, or set TASK_BROWSER_METADATA. For metadata-path upgrades, see migrations/v0.14.0.md.`);
    throw error;
  }
}

export function normalizeMetadata(parsed) {
  const tasks = parsed?.tasks && typeof parsed.tasks === 'object' && !Array.isArray(parsed.tasks)
    ? Object.fromEntries(Object.entries(parsed.tasks).map(([key, task]) => [key, normalizeStoredNextActor(task)]))
    : {};
  return {
    ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
    version: 1,
    nextDisplayNumber: Number.isInteger(parsed?.nextDisplayNumber) ? parsed.nextDisplayNumber : 1,
    tasks,
  };
}

function normalizeStoredNextActor(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
  return { ...task, nextActor: NEXT_ACTORS.includes(task.nextActor) ? task.nextActor : null };
}

export function metadataTemporaryPath(path) {
  return `${path}.${process.pid}.${randomUUID()}.tmp`;
}

export async function writeMetadata(path, metadata) {
  await mkdir(dirname(path), { recursive: true });
  const temp = metadataTemporaryPath(path);
  try {
    await writeFile(temp, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function withMetadataLock(path, action, { timeoutMs = 5000, retryMs = 20, staleMs = 30_000, beforeReclaim = null } = {}) {
  const lockPath = `${path}.lock`;
  const token = randomUUID();
  const ownerPath = join(lockPath, `owner.${token}.json`);
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(path), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      await writeLockOwner(ownerPath, token);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await rm(lockPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      if (await reclaimAbandonedLock(lockPath, ownerPath, token, staleMs, beforeReclaim)) break;
      if (Date.now() >= deadline) {
        const owner = await findLockOwner(lockPath);
        throw new Error(`Timed out waiting for metadata lock: ${lockPath}${owner?.pid ? ` (owner pid ${owner.pid})` : ''}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
    }
  }

  try {
    return await action();
  } finally {
    const owner = await readLockOwner(ownerPath);
    if (owner?.token === token) await rm(lockPath, { recursive: true, force: true });
  }
}

async function reclaimAbandonedLock(lockPath, ownerPath, token, staleMs, beforeReclaim) {
  const owner = await findLockOwner(lockPath);
  if (owner?.transition || (owner?.pid && processExists(owner.pid))) return false;
  if (!owner) {
    const info = await stat(lockPath).catch(() => null);
    if (!info || Date.now() - info.mtimeMs < staleMs) return false;
    return claimOwnerlessLock(lockPath, ownerPath, token);
  }
  if (beforeReclaim) await beforeReclaim();
  const stealingPath = join(lockPath, 'owner.stealing');
  try { await rename(owner.path, stealingPath); }
  catch (error) { if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(error.code)) return false; throw error; }
  await writeLockOwner(ownerPath, token);
  await rm(stealingPath, { force: true });
  return true;
}

async function claimOwnerlessLock(lockPath, ownerPath, token) {
  const claimingPath = join(lockPath, 'owner.claiming');
  try { await writeFile(claimingPath, token, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try { await writeLockOwner(ownerPath, token); }
  finally { await rm(claimingPath, { force: true }); }
  return true;
}

async function writeLockOwner(path, token) {
  await writeFile(path, JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }), { flag: 'wx' });
}

async function findLockOwner(lockPath) {
  const names = await readdir(lockPath).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  if (names.includes('owner.stealing') || names.includes('owner.claiming')) return { transition: true };
  const name = names.find((entry) => /^owner\.[^.]+\.json$/.test(entry));
  if (!name) return null;
  const path = join(lockPath, name);
  const owner = await readLockOwner(path);
  return owner ? { ...owner, path } : null;
}

async function readLockOwner(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function metadataChanges(before = {}, after = {}) {
  const changes = {};
  for (const field of HISTORY_FIELDS) {
    const oldValue = normalizeHistoryValue(field, before[field]);
    const newValue = normalizeHistoryValue(field, after[field]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[field] = { before: oldValue, after: newValue };
  }
  return changes;
}

export function hasChanges(changes) { return Object.keys(changes || {}).length > 0; }

export async function appendHistoryEvent(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export function buildHistoryEvent({ key, task, before, after, actor = 'agent', role = null, sessionTool = null, sessionId = null, source, action, note = null }) {
  const changes = metadataChanges(before, after);
  if (!hasChanges(changes)) return null;
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    taskKey: key,
    taskDisplayId: task?.displayId || after?.displayId || before?.displayId || null,
    actor,
    role: role || null,
    sessionTool: sessionTool || null,
    sessionId: sessionId || null,
    source,
    action,
    changes,
    note: note || null,
  };
}

export async function readHistory(path, { taskKey = null, limit = 20 } = {}) {
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!taskKey || event.taskKey === taskKey) rows.push(event);
    } catch {}
  }
  return rows.slice(-limit).reverse();
}

function normalizeHistoryValue(field, value) {
  if (ARRAY_FIELDS.has(field)) return cleanArray(value);
  if (field === 'order') return normalizeOrder(value);
  if (field === 'parent') return typeof value === 'string' && value.trim() ? value.trim() : null;
  if (value === undefined) return null;
  return value;
}

export async function discoverTask(workspaceRoot, key) {
  if (!/^[^/]+\/[^/]+$/.test(key)) throw new Error(`Task key must look like project/slug: ${key}`);
  const [project, slug] = key.split('/');
  const dir = join(workspaceRoot, 'projects', project, 'work', slug);
  if (!(await exists(join(dir, 'TASK.md')))) throw new Error(`No tracked task exists for key: ${key}`);
  return { key, project, slug, path: `projects/${project}/work/${slug}` };
}

export function normalizeTask(task, existing = {}, { inferType } = {}) {
  return {
    ...existing,
    displayId: task.displayId,
    project: task.project,
    slug: task.slug,
    path: task.path,
    status: STATUSES.includes(task.status) ? task.status : 'planned',
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'normal',
    type: typeof task.type === 'string' && task.type.trim() ? task.type.trim() : inferType?.(task) || 'implementation',
    nextActor: NEXT_ACTORS.includes(task.nextActor) ? task.nextActor : null,
    blockedBy: cleanArray(task.blockedBy),
    parent: typeof task.parent === 'string' && task.parent.trim() ? task.parent.trim() : null,
    children: cleanArray(task.children),
    related: cleanArray(task.related),
    tags: cleanArray(task.tags),
    order: normalizeOrder(task.order),
  };
}

export function applyInitialPlannedOrder(task, isNew) {
  if (isNew && task.status === 'planned' && task.order === null) task.order = 1;
  return task;
}

export function syncMetadataTasks(metadata, discovered, { inferType } = {}) {
  const nowKeys = new Set(discovered.map((task) => task.key));
  for (const task of discovered) {
    const existing = metadata.tasks[task.key] || {};
    const isNew = !existing.displayId;
    metadata.tasks[task.key] = applyInitialPlannedOrder(
      normalizeTask({ ...existing, ...task, displayId: existing.displayId || `#${metadata.nextDisplayNumber++}` }, existing, { inferType }),
      isNew,
    );
  }
  for (const [key, task] of Object.entries(metadata.tasks)) {
    if (!nowKeys.has(key)) task.missing = true;
    else delete task.missing;
  }
  return metadata;
}

export function resolveTask(metadata, ref) {
  if (metadata.tasks[ref]) return { key: ref, task: metadata.tasks[ref] };
  const found = Object.entries(metadata.tasks).filter(([, task]) => task.displayId === ref);
  if (found.length === 1) return { key: found[0][0], task: found[0][1] };
  if (found.length > 1) throw new Error(`Ambiguous display ID: ${ref}`);
  throw new Error(`Unknown task reference: ${ref}`);
}

export function resolveRelation(metadata, ref) { return resolveTask(metadata, ref).key; }

export function snapshotTasks(metadata) {
  return Object.fromEntries(Object.entries(metadata.tasks).map(([key, task]) => [key, { ...task, blockedBy: cleanArray(task.blockedBy), children: cleanArray(task.children), related: cleanArray(task.related) }]));
}

export function changedTaskKeys(beforeTasks, metadata) {
  return Object.keys(metadata.tasks).filter((key) => hasChanges(metadataChanges(beforeTasks[key] || {}, metadata.tasks[key] || {})));
}

export function deriveBlocks(metadata, key) {
  return Object.entries(metadata.tasks).filter(([, task]) => cleanArray(task.blockedBy).includes(key)).map(([taskKey]) => taskKey).sort();
}

export function applyOptions(metadata, key, opts) {
  const task = metadata.tasks[key];
  const relationPatch = {};
  for (const [name, value] of Object.entries(opts)) {
    const field = fieldName(name);
    if (IDENTITY_FIELDS.has(field)) throw new Error(`Identity field is not mutable: ${field}`);
    if (field === 'status') task.status = requireOne(value, STATUSES, 'status');
    else if (field === 'priority') task.priority = requireOne(value, PRIORITIES, 'priority');
    else if (field === 'type') task.type = String(value).trim() || fail('type must be non-empty');
    else if (field === 'nextActor') task.nextActor = requireOne(value, NEXT_ACTORS, 'nextActor');
    else if (field === 'order') task.order = parseOrder(value);
    else if (RELATIONSHIP_FIELDS.has(field)) relationPatch[field] = value;
    else if (field === 'tags') task.tags = split(value);
    else throw new Error(`Unknown field: ${name}`);
  }
  applyRelationshipPatch(metadata, key, relationPatch);
}

export function applyRelationshipPatch(metadata, key, patch = {}) {
  if (!metadata.tasks[key]) throw new Error(`Unknown task reference: ${key}`);
  if ('parent' in patch) setParent(metadata, key, patch.parent ? resolveRelation(metadata, patch.parent) : null);
  if ('children' in patch) setChildren(metadata, key, relationList(metadata, patch.children, 'children'));
  if ('blockedBy' in patch) setDirectionalList(metadata, key, 'blockedBy', relationList(metadata, patch.blockedBy, 'blockedBy'));
  if ('related' in patch) setRelated(metadata, key, relationList(metadata, patch.related, 'related'));
}

export function addRelationship(metadata, key, field, ref) {
  const otherKey = resolveRelation(metadata, ref);
  if (field === 'children') return setParent(metadata, otherKey, key);
  if (field === 'related') return addRelated(metadata, key, otherKey);
  if (field === 'blockedBy') return addDirectional(metadata, key, 'blockedBy', otherKey);
  throw new Error(`Cannot add relationship field: ${field}`);
}

export function removeRelationship(metadata, key, field, ref) {
  const otherKey = resolveRelation(metadata, ref);
  if (field === 'children') return metadata.tasks[otherKey]?.parent === key ? setParent(metadata, otherKey, null) : removeFromArray(metadata.tasks[key], 'children', otherKey);
  if (field === 'related') return removeRelated(metadata, key, otherKey);
  if (field === 'blockedBy') return removeDirectional(metadata, key, 'blockedBy', otherKey);
  throw new Error(`Cannot remove relationship field: ${field}`);
}

export function setParent(metadata, childKey, parentKey) {
  if (parentKey && childKey === parentKey) throw new Error('A task cannot be its own parent');
  if (parentKey) ensureNoAncestorCycle(metadata, childKey, parentKey);
  const child = metadata.tasks[childKey];
  const oldParent = child.parent;
  if (oldParent && metadata.tasks[oldParent]) removeFromArray(metadata.tasks[oldParent], 'children', childKey);
  child.parent = parentKey || null;
  if (parentKey) addToArray(metadata.tasks[parentKey], 'children', childKey);
}

export function setChildren(metadata, parentKey, childKeys) {
  for (const childKey of cleanArray(childKeys)) {
    if (!metadata.tasks[childKey]) throw new Error(`Unknown task reference: ${childKey}`);
    if (childKey === parentKey) throw new Error('A task cannot be its own child');
  }
  const next = new Set(cleanArray(childKeys));
  for (const childKey of cleanArray(metadata.tasks[parentKey].children)) {
    if (next.has(childKey)) continue;
    if (metadata.tasks[childKey]?.parent === parentKey) setParent(metadata, childKey, null);
    else removeFromArray(metadata.tasks[parentKey], 'children', childKey);
  }
  for (const childKey of next) setParent(metadata, childKey, parentKey);
}

function setRelated(metadata, key, relatedKeys) {
  const next = new Set(cleanArray(relatedKeys));
  if (next.has(key)) throw new Error('A task cannot be related to itself');
  for (const otherKey of next) addRelated(metadata, key, otherKey);
  for (const oldKey of cleanArray(metadata.tasks[key].related)) if (!next.has(oldKey)) removeRelated(metadata, key, oldKey);
}

function addRelated(metadata, key, otherKey) {
  if (key === otherKey) throw new Error('A task cannot be related to itself');
  addToArray(metadata.tasks[key], 'related', otherKey);
  addToArray(metadata.tasks[otherKey], 'related', key);
}

function removeRelated(metadata, key, otherKey) {
  removeFromArray(metadata.tasks[key], 'related', otherKey);
  if (metadata.tasks[otherKey]) removeFromArray(metadata.tasks[otherKey], 'related', key);
}

function setDirectionalList(metadata, key, field, values) {
  metadata.tasks[key][field] = cleanArray(values);
}
function addDirectional(metadata, key, field, otherKey) { addToArray(metadata.tasks[key], field, otherKey); }
function removeDirectional(metadata, key, field, otherKey) { removeFromArray(metadata.tasks[key], field, otherKey); }
function addToArray(task, field, value) { task[field] = cleanArray([...(task[field] || []), value]); }
function removeFromArray(task, field, value) { task[field] = cleanArray(task[field]).filter((entry) => entry !== value); }
function relationList(metadata, value, name) {
  const values = Array.isArray(value) ? value : split(value);
  return cleanArray(values).map((ref) => resolveRelation(metadata, ref)).filter((ref) => ref || fail(`${name} contains an empty reference`));
}
function ensureNoAncestorCycle(metadata, childKey, parentKey) {
  let current = parentKey;
  const seen = new Set([childKey]);
  while (current) {
    if (seen.has(current)) throw new Error('Parent relationship would create a cycle');
    seen.add(current);
    current = metadata.tasks[current]?.parent || null;
  }
}

export function applyBrowserPatch(current, patch) {
  const next = { ...current };
  if ('status' in patch) next.status = valid(patch.status, STATUSES, current.status || 'planned');
  if ('priority' in patch) next.priority = valid(patch.priority, PRIORITIES, current.priority || 'normal');
  if ('type' in patch) next.type = typeof patch.type === 'string' && patch.type.trim() ? patch.type.trim() : current.type;
  if ('nextActor' in patch) next.nextActor = normalizeNextActorPatch(patch.nextActor);
  if ('tags' in patch) next.tags = cleanArray(patch.tags);
  if ('order' in patch) next.order = parseOrder(patch.order);
  return next;
}

export function normalizeNextActorPatch(value) {
  if (value === null || value === '') return null;
  if (NEXT_ACTORS.includes(value)) return value;
  throw Object.assign(new Error(`nextActor must be one of: ${NEXT_ACTORS.join(', ')}, or null`), { statusCode: 400 });
}

export function fieldName(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
export function split(value) { return cleanArray(String(value).split(',')); }
export function cleanArray(value) { return Array.isArray(value) ? [...new Set(value.map((v) => String(v).trim()).filter(Boolean))] : []; }
function normalizeOrder(value) { return Number.isInteger(value) && value > 0 ? value : null; }

export function parseOrder(value) { if (value === null || value === '') return null; const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new Error('order must be a positive integer'); return n; }
export function valid(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
export function requireOne(value, allowed, name) { if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`); return value; }
export function required(value, name) { if (!value) throw new Error(`Missing ${name}`); return value; }
export function fail(message) { throw new Error(message); }
