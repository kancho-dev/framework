#!/usr/bin/env node
import { cp, lstat, mkdir, readdir, rename, rm, utimes } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const DEFAULT_SOURCES = {
  pi: join(homedir(), '.pi', 'agent', 'sessions'),
  'claude-code': join(homedir(), '.claude', 'projects'),
  codex: join(homedir(), '.codex', 'sessions'),
  opencode: join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  'opencode-diffs': join(homedir(), '.local', 'share', 'opencode', 'storage', 'session_diff'),
};
const ARCHIVE_PATHS = {
  pi: join('pi', 'sessions'),
  'claude-code': join('claude', 'projects'),
  codex: join('codex', 'sessions'),
  opencode: 'opencode.db',
  'opencode-diffs': join('opencode', 'storage', 'session_diff'),
};
const ROOT_SOURCES = new Set(['pi', 'claude-code', 'codex', 'opencode']);

function validateMachineId(value) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value || '')) {
    throw new Error('Machine id must contain only letters, numbers, dots, underscores, and hyphens.');
  }
  return value;
}

async function pathStats(path) {
  const entry = await lstat(path);
  if (!entry.isDirectory()) return { files: 1, bytes: entry.size };
  let files = 0;
  let bytes = 0;
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (child.isSymbolicLink()) throw new Error(`Refusing to archive symbolic link: ${join(path, child.name)}`);
    const stats = await pathStats(join(path, child.name));
    files += stats.files;
    bytes += stats.bytes;
  }
  return { files, bytes };
}

function sqliteQuote(path) {
  return `'${path.replaceAll("'", "''")}'`;
}

function runSqlite(database, statement, command = 'sqlite3') {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [database, statement], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new Error(`OpenCode archive failed: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`OpenCode archive failed (sqlite3 exit ${code}): ${stderr.trim() || 'no details'}`));
    });
  });
}

async function copySource(source, destination, sourceName, sqliteCommand) {
  if (sourceName === 'opencode') {
    await mkdir(dirname(destination), { recursive: true });
    try {
      await runSqlite(source, `.backup ${sqliteQuote(destination)}`, sqliteCommand);
      const journalMode = await runSqlite(destination, 'PRAGMA journal_mode=DELETE;', sqliteCommand);
      if (journalMode.toLowerCase() !== 'delete') throw new Error(`OpenCode archive failed to leave WAL mode: ${journalMode || 'no journal mode returned'}`);
    } catch (error) {
      await Promise.all([
        rm(destination, { force: true }),
        rm(`${destination}-wal`, { force: true }),
        rm(`${destination}-shm`, { force: true }),
      ]);
      throw error;
    }
  } else {
    await cp(source, destination, { recursive: true, dereference: true, errorOnExist: true, force: false });
    // `cp` stamps the copy with the current time; archived history must keep the machine's own dates.
    await copyTimes(source, destination);
  }
  return pathStats(destination);
}

async function copyTimes(source, destination) {
  const entry = await lstat(source);
  if (entry.isDirectory()) {
    for (const child of await readdir(source, { withFileTypes: true })) {
      await copyTimes(join(source, child.name), join(destination, child.name));
    }
  }
  await utimes(destination, entry.atime, entry.mtime);
}

async function exists(path) {
  try { await lstat(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
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

export async function buildArchive({
  machineId,
  archiveRoot,
  sources = DEFAULT_SOURCES,
  overwrite = false,
  sqliteCommand = 'sqlite3',
  workspaceRoot,
} = {}) {
  validateMachineId(machineId);
  const workspace = resolve(workspaceRoot || process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
  const root = resolve(archiveRoot || join(workspace, '.tools-config', 'session-browser', 'archive'));
  const target = join(root, machineId);
  if (await exists(target) && !overwrite) {
    throw new Error(`Archive already exists: ${target}. Re-run with --overwrite to replace it.`);
  }

  await mkdir(root, { recursive: true });
  const staging = join(root, `.${machineId}.building-${process.pid}`);
  const previous = join(root, `.${machineId}.previous-${process.pid}`);
  await rm(staging, { recursive: true, force: true });

  for (const sourceName of Object.keys(sources)) {
    if (!ARCHIVE_PATHS[sourceName]) throw new Error(`Unknown source: ${sourceName}`);
  }

  const reports = {};
  const failures = [];
  const skipped = [];
  try {
    await mkdir(staging);
    for (const [sourceName, sourcePath] of Object.entries(sources)) {
      const source = resolve(sourcePath);
      if (!await exists(source)) {
        skipped.push({ source: sourceName, reason: `source does not exist: ${source}` });
        continue;
      }
      const destination = join(staging, ARCHIVE_PATHS[sourceName]);
      try {
        reports[sourceName] = await copySource(source, destination, sourceName, sqliteCommand);
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        failures.push({ source: sourceName, reason: error?.message || String(error) });
      }
    }

    if (Object.keys(reports).length === 0) {
      const reason = failures.length ? 'Every available source failed to archive.' : 'Every configured source is missing.';
      throw new Error(reason);
    }

    let movedPrevious = false;
    if (await exists(target)) {
      await rename(target, previous);
      movedPrevious = true;
    }
    try {
      await rename(staging, target);
    } catch (error) {
      if (movedPrevious) await rename(previous, target);
      throw error;
    }
    if (movedPrevious) await rm(previous, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    target,
    reports,
    failures,
    skipped,
    config: {
      id: machineId,
      label: machineId,
      roots: Object.fromEntries(Object.keys(reports).filter((name) => ROOT_SOURCES.has(name)).map((name) => [name, join('archive', machineId, ARCHIVE_PATHS[name])])),
      ...(reports['opencode-diffs'] ? { artifacts: { 'opencode-data': join('archive', machineId, 'opencode') } } : {}),
      pathMap: [{ from: workspace, to: '.' }],
    },
  };
}

function usage() {
  return 'Usage: node build-archive.mjs <machine-id> [--overwrite] [--archive-root <path>]';
}

function parseArgs(argv) {
  const args = [...argv];
  const machineId = args.shift();
  let overwrite = false;
  let archiveRoot;
  while (args.length) {
    const arg = args.shift();
    if (arg === '--overwrite') overwrite = true;
    else if (arg === '--archive-root' && args.length) archiveRoot = args.shift();
    else throw new Error(`Unknown or incomplete option: ${arg}\n${usage()}`);
  }
  if (!machineId) throw new Error(usage());
  return { machineId, overwrite, archiveRoot };
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function main() {
  const result = await buildArchive(parseArgs(process.argv.slice(2)));
  console.log(`Archive built: ${result.target}`);
  for (const [source, report] of Object.entries(result.reports)) {
    console.log(`${source}: ${report.files} file(s), ${formatBytes(report.bytes)}`);
  }
  for (const item of result.skipped) console.warn(`${item.source}: skipped (${item.reason})`);
  for (const item of result.failures) console.error(`${item.source}: failed (${item.reason})`);
  console.log('\nAdd this entry to .tools-config/session-browser/machines.json:');
  console.log(JSON.stringify(result.config, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`Archive build failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
