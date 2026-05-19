#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const STATUSES = ['planned', 'active', 'blocked', 'review', 'paused', 'done'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const ARRAY_FIELDS = new Set(['tags', 'blockedBy', 'children', 'related']);
const RELATION_FIELDS = new Set(['blockedBy', 'children', 'related']);

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') return help();
  const ctx = await context(command === 'init');
  if (command === 'list') return print(await list(ctx, parseOptions(args)));
  if (command === 'get') return print(await getTask(ctx, required(args[0], 'task reference')));
  if (command === 'key') return console.log(resolveTask(ctx.metadata, required(args[0], 'task reference')).key);
  if (command === 'init') return print(await initTask(ctx, required(args[0], 'task key'), parseOptions(args.slice(1))));
  if (command === 'set') return print(await setTask(ctx, required(args[0], 'task reference'), parseOptions(args.slice(1))));
  if (command === 'clear') return print(await clearTask(ctx, required(args[0], 'task reference'), args.slice(1)));
  if (command === 'add-tag') return print(await arrayOp(ctx, args, 'tags', 'add', false));
  if (command === 'remove-tag') return print(await arrayOp(ctx, args, 'tags', 'remove', false));
  if (command === 'add-related') return print(await arrayOp(ctx, args, 'related', 'add', true));
  if (command === 'remove-related') return print(await arrayOp(ctx, args, 'related', 'remove', true));
  if (command === 'add-child') return print(await arrayOp(ctx, args, 'children', 'add', true));
  if (command === 'remove-child') return print(await arrayOp(ctx, args, 'children', 'remove', true));
  if (command === 'add-blocker') return print(await arrayOp(ctx, args, 'blockedBy', 'add', true));
  if (command === 'remove-blocker') return print(await arrayOp(ctx, args, 'blockedBy', 'remove', true));
  if (command === 'set-parent') return print(await setParent(ctx, required(args[0], 'task reference'), required(args[1], 'parent reference')));
  if (command === 'clear-parent') return print(await setParent(ctx, required(args[0], 'task reference'), null));
  throw new Error(`Unknown command: ${command}`);
}

async function context(allowMissing = false) {
  const workspaceRoot = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
  const metadataPath = resolve(process.env.TASK_BROWSER_METADATA || join(workspaceRoot, '.task-browser', 'tasks.json'));
  const metadata = await readMetadata(metadataPath, allowMissing);
  return { workspaceRoot, metadataPath, metadata };
}

async function readMetadata(path, allowMissing = false) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return {
      ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
      version: 1,
      nextDisplayNumber: Number.isInteger(parsed?.nextDisplayNumber) ? parsed.nextDisplayNumber : 1,
      tasks: parsed?.tasks && typeof parsed.tasks === 'object' && !Array.isArray(parsed.tasks) ? parsed.tasks : {},
    };
  } catch (error) {
    if (error.code === 'ENOENT' && allowMissing) return { version: 1, nextDisplayNumber: 1, tasks: {} };
    if (error.code === 'ENOENT') throw new Error(`Missing metadata file: ${path}. Open/run task-browser first, run init for an existing task, or set TASK_BROWSER_METADATA.`);
    throw error;
  }
}

async function writeMetadata(ctx) {
  await mkdir(dirname(ctx.metadataPath), { recursive: true });
  const temp = `${ctx.metadataPath}.tmp`;
  await writeFile(temp, `${JSON.stringify(ctx.metadata, null, 2)}\n`);
  await rename(temp, ctx.metadataPath);
}

async function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (await exists(join(current, 'AGENTS.md'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }

async function discoverTask(workspaceRoot, key) {
  if (!/^[^/]+\/[^/]+$/.test(key)) throw new Error(`Task key must look like project/slug: ${key}`);
  const [project, slug] = key.split('/');
  const dir = join(workspaceRoot, 'projects', project, 'work', slug);
  if (!(await exists(join(dir, 'TASK.md')))) throw new Error(`No tracked task exists for key: ${key}`);
  return { key, project, slug, path: `projects/${project}/work/${slug}` };
}

function resolveTask(metadata, ref) {
  if (metadata.tasks[ref]) return { key: ref, task: metadata.tasks[ref] };
  const found = Object.entries(metadata.tasks).filter(([, task]) => task.displayId === ref);
  if (found.length === 1) return { key: found[0][0], task: found[0][1] };
  if (found.length > 1) throw new Error(`Ambiguous display ID: ${ref}`);
  throw new Error(`Unknown task reference: ${ref}`);
}

function resolveRelation(metadata, ref) {
  return resolveTask(metadata, ref).key;
}

async function initTask(ctx, key, opts) {
  const discovered = await discoverTask(ctx.workspaceRoot, key);
  const existing = ctx.metadata.tasks[key] || {};
  const isNew = !ctx.metadata.tasks[key]?.displayId;
  ctx.metadata.tasks[key] = normalizeTask({ ...existing, ...discovered, displayId: existing.displayId || `#${ctx.metadata.nextDisplayNumber++}` }, existing);
  applyOptions(ctx.metadata, key, opts);
  await writeMetadata(ctx);
  return { key, metadata: ctx.metadata.tasks[key], created: isNew };
}

function normalizeTask(task, existing = {}) {
  return {
    ...existing,
    displayId: task.displayId,
    project: task.project,
    slug: task.slug,
    path: task.path,
    status: STATUSES.includes(task.status) ? task.status : 'planned',
    priority: PRIORITIES.includes(task.priority) ? task.priority : 'normal',
    type: typeof task.type === 'string' && task.type.trim() ? task.type.trim() : 'implementation',
    blockedBy: cleanArray(task.blockedBy),
    parent: typeof task.parent === 'string' && task.parent.trim() ? task.parent.trim() : null,
    children: cleanArray(task.children),
    related: cleanArray(task.related),
    tags: cleanArray(task.tags),
    order: Number.isInteger(task.order) ? task.order : null,
  };
}

async function getTask(ctx, ref) {
  const { key, task } = resolveTask(ctx.metadata, ref);
  return { key, metadata: task };
}

async function list(ctx, opts) {
  let rows = Object.entries(ctx.metadata.tasks);
  if (opts.status) rows = rows.filter(([, t]) => split(opts.status).includes(t.status));
  if (opts.priority) rows = rows.filter(([, t]) => split(opts.priority).includes(t.priority));
  if (opts.blocked) rows = rows.filter(([, t]) => cleanArray(t.blockedBy).length > 0);
  return rows.map(([key, t]) => ({ displayId: t.displayId, key, status: t.status, priority: t.priority, type: t.type, tags: cleanArray(t.tags) }));
}

async function setTask(ctx, ref, opts) {
  const { key } = resolveTask(ctx.metadata, ref);
  applyOptions(ctx.metadata, key, opts);
  await writeMetadata(ctx);
  return { key, metadata: ctx.metadata.tasks[key] };
}

function applyOptions(metadata, key, opts) {
  const task = metadata.tasks[key];
  for (const [name, value] of Object.entries(opts)) {
    const field = fieldName(name);
    if (['displayId', 'project', 'slug', 'path'].includes(field)) throw new Error(`Identity field is not mutable: ${field}`);
    if (field === 'status') task.status = requireOne(value, STATUSES, 'status');
    else if (field === 'priority') task.priority = requireOne(value, PRIORITIES, 'priority');
    else if (field === 'type') task.type = String(value).trim() || fail('type must be non-empty');
    else if (field === 'order') task.order = parseOrder(value);
    else if (field === 'parent') task.parent = resolveRelation(metadata, value);
    else if (ARRAY_FIELDS.has(field)) task[field] = RELATION_FIELDS.has(field) ? split(value).map((v) => resolveRelation(metadata, v)) : split(value);
    else throw new Error(`Unknown field: ${name}`);
  }
}

async function clearTask(ctx, ref, flags) {
  const { key, task } = resolveTask(ctx.metadata, ref);
  for (const flag of flags) {
    const field = fieldName(flag.replace(/^--/, ''));
    if (field === 'order' || field === 'parent') task[field] = null;
    else if (ARRAY_FIELDS.has(field)) task[field] = [];
    else throw new Error(`Cannot clear field: ${field}`);
  }
  await writeMetadata(ctx);
  return { key, metadata: task };
}

async function setParent(ctx, ref, parentRef) {
  const { key, task } = resolveTask(ctx.metadata, ref);
  task.parent = parentRef ? resolveRelation(ctx.metadata, parentRef) : null;
  await writeMetadata(ctx);
  return { key, metadata: task };
}

async function arrayOp(ctx, args, field, op, relation) {
  const { key, task } = resolveTask(ctx.metadata, required(args[0], 'task reference'));
  const value = required(args[1], `${field} value`);
  const item = relation ? resolveRelation(ctx.metadata, value) : value.trim();
  const current = cleanArray(task[field]);
  task[field] = op === 'add' ? cleanArray([...current, item]) : current.filter((entry) => entry !== item);
  await writeMetadata(ctx);
  return { key, metadata: task };
}

function parseOptions(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'blocked') opts.blocked = true;
    else opts[name] = required(args[++i], `value for --${name}`);
  }
  return opts;
}
function fieldName(name) { return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function split(value) { return cleanArray(String(value).split(',')); }
function cleanArray(value) { return Array.isArray(value) ? [...new Set(value.map((v) => String(v).trim()).filter(Boolean))] : []; }
function parseOrder(value) { if (value === null || value === '') return null; const n = Number(value); if (!Number.isInteger(n)) throw new Error('order must be an integer'); return n; }
function requireOne(value, allowed, name) { if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`); return value; }
function required(value, name) { if (!value) throw new Error(`Missing ${name}`); return value; }
function fail(message) { throw new Error(message); }
function print(value) { console.log(JSON.stringify(value, null, 2)); }
function help() { console.log(`Usage: node metadata-cli.mjs <command> [options]
Commands: list, get, key, init, set, clear, add-tag, remove-tag, add-related, remove-related, add-child, remove-child, add-blocker, remove-blocker, set-parent, clear-parent`); }
