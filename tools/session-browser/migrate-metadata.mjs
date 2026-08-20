#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, stat, writeFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { loadLegacyMachines } from './legacy-machines.mjs';
import { normalizeMetadataEntry, remapMetadata } from './metadata-remap.mjs';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const metadataPath = resolve(process.env.SESSION_BROWSER_METADATA || join(workspaceRoot, '.tools-config', 'session-browser', 'metadata.json'));
const machinesPath = resolve(valueAfter('--machines') || join(workspaceRoot, '.tools-config', 'session-browser', 'machines.json'));

function valueAfter(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; }
function backupSuffix(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function findWorkspaceRoot(start) {
  let current = resolve(start);
  while (true) {
    if (await exists(join(current, 'AGENTS.md'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}
async function walk(root, extension = '') {
  if (!root || !await exists(root)) return [];
  const result = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (!extension || extname(path) === extension) result.push(path);
    }
  }
  return result;
}
async function idsFor(source, root) {
  if (!root) return new Set();
  if (source === 'codex') return new Set((await walk(root, '.jsonl')).map((path) => basename(path, '.jsonl')));
  if (source === 'claude-code') {
    const ids = new Set();
    for (const path of await walk(root, '.jsonl')) {
      for (const line of (await readFile(path, 'utf8')).split('\n')) {
        if (!line.includes('sessionId')) continue;
        try { const id = JSON.parse(line).sessionId; if (id) { ids.add(String(id)); break; } } catch {}
      }
    }
    return ids;
  }
  if (source === 'opencode') {
    if (!await exists(root)) return new Set();
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', root, 'SELECT id FROM session']);
    return new Set((JSON.parse(stdout || '[]')).map((row) => String(row.id)));
  }
  return new Set();
}
function liveRoot(source) {
  if (source === 'codex') return resolve(process.env.CODEX_SESSION_ROOT || join(process.env.CODEX_HOME || join(process.env.HOME, '.codex'), 'sessions'));
  if (source === 'claude-code') return resolve(process.env.CLAUDE_PROJECTS_ROOT || join(process.env.CLAUDE_HOME || join(process.env.HOME, '.claude'), 'projects'));
  if (source === 'opencode') return resolve(process.env.OPENCODE_DB || join(process.env.OPENCODE_DATA_DIR || join(process.env.HOME, '.local', 'share', 'opencode'), 'opencode.db'));
  return null;
}
export async function createLegacyResolver(machine, { liveRoots = {} } = {}) {
  const archivedIds = {};
  const currentIds = {};
  for (const source of ['codex', 'claude-code', 'opencode']) {
    archivedIds[source] = await idsFor(source, machine.roots[source]);
    currentIds[source] = await idsFor(source, liveRoots[source] || liveRoot(source));
  }
  return async (key) => {
    const separator = key.indexOf(':');
    if (separator < 1 || key.slice(0, separator).includes('@')) return null;
    const source = key.slice(0, separator);
    const ref = key.slice(separator + 1);
    if (source === 'pi') {
      const originalRoot = machine.originalRoots.pi;
      const archiveRoot = machine.roots.pi;
      if (!originalRoot || !archiveRoot) return { reason: 'pi originalRoots and archive root are required' };
      const livePath = resolve(ref);
      const suffix = relative(originalRoot, livePath);
      if (suffix.startsWith('..')) return null;
      const target = resolve(archiveRoot, suffix);
      if (!await exists(target)) return { reason: 'archived session not found' };
      if (await exists(livePath)) return { reason: 'session still resolves in the current live store' };
      return `pi@${machine.id}:${target}`;
    }
    if (!archivedIds[source]) return null;
    if (!archivedIds[source].has(ref)) return { reason: 'archived session not found' };
    if (currentIds[source].has(ref)) return { reason: 'session still resolves in the current live store' };
    return `${source}@${machine.id}:${ref}`;
  };
}
async function writeAtomically(metadata, label) {
  await mkdir(dirname(metadataPath), { recursive: true });
  const backupPath = `${metadataPath}.backup-${backupSuffix()}`;
  await copyFile(metadataPath, backupPath);
  const tmp = `${metadataPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await rename(tmp, metadataPath);
  console.log(`${label}: ${metadataPath}`);
  console.log(`Backup: ${backupPath}`);
}
async function readMetadata() {
  try { return JSON.parse(await readFile(metadataPath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') {
      const migrationHint = process.env.SESSION_BROWSER_METADATA ? '' : ' For metadata-path upgrades, see migrations/v0.14.0.md.';
      console.log(`No Session Browser metadata found at ${metadataPath}; nothing to migrate.${migrationHint}`);
      return null;
    }
    throw error;
  }
}
async function canonicalMigration(parsed) {
  const sessions = parsed?.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
  const next = { ...parsed, version: Math.max(Number(parsed?.version || 1), 3), sessions: {} };
  for (const [key, value] of Object.entries(sessions)) {
    const entry = normalizeMetadataEntry({ ...value, tags: [...(value?.tags || []), ...(value?.labels || [])] });
    if (entry.bookmarked || entry.tags.length || Object.keys(entry.savedTopics).length) next.sessions[key] = entry;
  }
  if (JSON.stringify(next) === JSON.stringify(parsed)) return console.log(`Session Browser metadata already canonical: ${metadataPath}`);
  await writeAtomically(next, 'Migrated Session Browser metadata to canonical schema');
}
async function legacyRemap(parsed, machineId) {
  const state = await loadLegacyMachines({ workspaceRoot, configPath: machinesPath });
  const machine = state.machines[machineId];
  if (!machine) throw new Error(`Legacy machine not available: ${machineId}`);
  const result = await remapMetadata(parsed, await createLegacyResolver(machine));
  for (const item of result.rewrites) console.log(`REWRITE ${item.sourceKey} -> ${item.targetKey}`);
  for (const item of result.unmatched) console.log(`UNMATCHED ${item.sourceKey}: ${item.reason}`);
  for (const item of result.conflicts) console.log(`CONFLICT ${item.targetKey} saved topic ${item.id}: kept current value`);
  console.log(`Summary: ${result.rewrites.length} rewrite(s), ${result.unmatched.length} unmatched, ${result.conflicts.length} conflict(s).`);
  if (!args.includes('--apply')) return console.log('Dry run only. Re-run with --apply to write a timestamped-backup migration.');
  if (!result.changed) return console.log('No metadata changes required; nothing written.');
  await writeAtomically(result.metadata, `Remapped metadata for archived machine ${machineId}`);
}

async function main() {
  const parsed = await readMetadata();
  if (!parsed) return;
  const machineId = valueAfter('--remap-machine');
  if (machineId) await legacyRemap(parsed, machineId);
  else await canonicalMigration(parsed);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Migration failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
