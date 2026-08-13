#!/usr/bin/env node
import { resolve } from 'node:path';
import { addRelationship, appendHistoryEvent, applyOptions, applyRelationshipPatch, ARRAY_FIELDS, buildHistoryEvent, changedTaskKeys, cleanArray, discoverTask, fieldName, findWorkspaceRoot, historyPathFor, metadataPathFor, normalizeTask, readHistory, readMetadata, removeRelationship, required, resolveTask, setChildren as setChildrenRelation, setParent as setParentRelation, snapshotTasks, split, withMetadataLock, writeMetadata } from './metadata-helpers.mjs';

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') return help();
  const workspaceRoot = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
  const metadataPath = metadataPathFor(workspaceRoot);
  const execute = async () => runCommand(command, args, await context(command === 'init', workspaceRoot, metadataPath));
  return isWriteCommand(command) ? withMetadataLock(metadataPath, execute) : execute();
}

async function runCommand(command, args, ctx) {
  if (command === 'list') return print(await list(ctx, parseOptions(args)));
  if (command === 'get') return print(await getTask(ctx, required(args[0], 'task reference')));
  if (command === 'key') return console.log(resolveTask(ctx.metadata, required(args[0], 'task reference')).key);
  if (command === 'history') return print(await history(ctx, required(args[0], 'task reference'), parseOptions(args.slice(1))));
  if (command === 'init') return print(await initTask(ctx, required(args[0], 'task key'), parseOptions(args.slice(1))));
  if (command === 'set') return print(await setTask(ctx, required(args[0], 'task reference'), parseOptions(args.slice(1))));
  if (command === 'clear') return print(await clearTask(ctx, required(args[0], 'task reference'), parseOptions(args.slice(1), { flags: true })));
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

function isWriteCommand(command) {
  return !['list', 'get', 'key', 'history'].includes(command);
}

async function context(allowMissing, workspaceRoot, metadataPath) {
  const metadata = await readMetadata(metadataPath, { allowMissing });
  return { workspaceRoot, metadataPath, historyPath: historyPathFor(workspaceRoot, metadataPath), metadata };
}

async function initTask(ctx, key, opts) {
  const provenance = provenanceOptions(opts);
  const discovered = await discoverTask(ctx.workspaceRoot, key);
  const existing = ctx.metadata.tasks[key] || {};
  const beforeTasks = snapshotTasks(ctx.metadata);
  const isNew = !ctx.metadata.tasks[key]?.displayId;
  ctx.metadata.tasks[key] = normalizeTask({ ...existing, ...discovered, displayId: existing.displayId || `#${ctx.metadata.nextDisplayNumber++}` }, existing);
  applyOptions(ctx.metadata, key, opts);
  await writeWithHistory(ctx, beforeTasks, 'metadata.init', provenance);
  return { key, metadata: ctx.metadata.tasks[key], created: isNew };
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
  return rows.map(([key, t]) => ({ displayId: t.displayId, key, status: t.status, priority: t.priority, type: t.type, nextActor: t.nextActor ?? null, tags: cleanArray(t.tags) }));
}

async function setTask(ctx, ref, opts) {
  const provenance = provenanceOptions(opts);
  const { key } = resolveTask(ctx.metadata, ref);
  const beforeTasks = snapshotTasks(ctx.metadata);
  applyOptions(ctx.metadata, key, opts);
  await writeWithHistory(ctx, beforeTasks, 'metadata.set', provenance);
  return { key, metadata: ctx.metadata.tasks[key] };
}

async function clearTask(ctx, ref, opts) {
  const provenance = provenanceOptions(opts);
  const { key, task } = resolveTask(ctx.metadata, ref);
  const beforeTasks = snapshotTasks(ctx.metadata);
  for (const flag of opts._) {
    const field = fieldName(flag.replace(/^--/, ''));
    if (field === 'order' || field === 'nextActor') task[field] = null;
    else if (field === 'parent') setParentRelation(ctx.metadata, key, null);
    else if (field === 'children') setChildrenRelation(ctx.metadata, key, []);
    else if (field === 'related' || field === 'blockedBy') applyRelationshipPatch(ctx.metadata, key, { [field]: [] });
    else if (ARRAY_FIELDS.has(field)) task[field] = [];
    else throw new Error(`Cannot clear field: ${field}`);
  }
  await writeWithHistory(ctx, beforeTasks, 'metadata.clear', provenance);
  return { key, metadata: task };
}

async function setParent(ctx, ref, parentRef) {
  const { key, task } = resolveTask(ctx.metadata, ref);
  const beforeTasks = snapshotTasks(ctx.metadata);
  setParentRelation(ctx.metadata, key, parentRef ? resolveTask(ctx.metadata, parentRef).key : null);
  await writeWithHistory(ctx, beforeTasks, parentRef ? 'metadata.set-parent' : 'metadata.clear-parent', {});
  return { key, metadata: task };
}

async function arrayOp(ctx, args, field, op, relation) {
  const { values, provenance } = splitCommandArgs(args);
  const { key, task } = resolveTask(ctx.metadata, required(values[0], 'task reference'));
  const beforeTasks = snapshotTasks(ctx.metadata);
  const value = required(values[1], `${field} value`);
  if (relation) {
    if (op === 'add') addRelationship(ctx.metadata, key, field, value);
    else removeRelationship(ctx.metadata, key, field, value);
  } else {
    const current = cleanArray(task[field]);
    task[field] = op === 'add' ? cleanArray([...current, value.trim()]) : current.filter((entry) => entry !== value.trim());
  }
  await writeWithHistory(ctx, beforeTasks, `metadata.${op}-${field}`, provenance);
  return { key, metadata: task };
}

async function history(ctx, ref, opts) {
  const { key } = resolveTask(ctx.metadata, ref);
  return { key, history: await readHistory(ctx.historyPath, { taskKey: key, limit: Number(opts.limit) || 20 }) };
}

async function writeWithHistory(ctx, beforeTasks, action, provenance) {
  const events = changedTaskKeys(beforeTasks, ctx.metadata).map((key) => buildHistoryEvent({ key, task: ctx.metadata.tasks[key], before: beforeTasks[key], after: ctx.metadata.tasks[key], source: 'metadata-cli', action, actor: provenance.actor || 'agent', role: provenance.role || null, sessionTool: provenance.sessionTool || null, sessionId: provenance.sessionId || null, note: provenance.note || null })).filter(Boolean);
  await writeMetadata(ctx.metadataPath, ctx.metadata);
  for (const event of events) await appendHistoryEvent(ctx.historyPath, event);
}

function splitCommandArgs(args) {
  const values = [];
  const provenance = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (isProvenanceFlag(arg)) provenance[fieldName(arg.slice(2))] = required(args[++i], `value for ${arg}`);
    else values.push(arg);
  }
  return { values, provenance };
}

function provenanceOptions(opts) {
  const provenance = {};
  for (const key of ['actor', 'role', 'sessionTool', 'sessionId', 'note']) {
    if (opts[key] !== undefined) {
      provenance[key] = opts[key];
      delete opts[key];
    }
  }
  return provenance;
}

function isProvenanceFlag(arg) { return ['--actor', '--role', '--session-tool', '--session-id', '--note'].includes(arg); }

function parseOptions(args, { flags = false } = {}) {
  const opts = flags ? { _: [] } : {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    if (flags && !isProvenanceFlag(arg)) { opts._.push(arg); continue; }
    const name = arg.slice(2);
    if (name === 'blocked') opts.blocked = true;
    else opts[fieldName(name)] = required(args[++i], `value for --${name}`);
  }
  return opts;
}

function print(value) { console.log(JSON.stringify(value, null, 2)); }
function help() { console.log(`Usage: node metadata-cli.mjs <command> [options]
Commands: list, get, key, history, init, set, clear, add-tag, remove-tag, add-related, remove-related, add-child, remove-child, add-blocker, remove-blocker, set-parent, clear-parent
Provenance flags for write commands: --actor, --role, --session-tool, --session-id, --note`); }
