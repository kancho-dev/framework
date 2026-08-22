import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { codexSessionIdFromFile } from './codex-session.mjs';
import { formatSessionRef, parseSessionRef } from './session-ref.mjs';
import { translateCwd } from './legacy-machines.mjs';
import { isUnderRoot } from './workspace-paths.mjs';

const execFileAsync = promisify(execFile);

function parseJsonl(content) {
  const values = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try { values.push(JSON.parse(line)); } catch {}
  }
  return values;
}

async function walkJsonl(root) {
  if (!root) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    }
  }
  return files;
}

function codexIdentity(file, entries) {
  const meta = entries.find((entry) => entry?.type === 'session_meta')?.payload || {};
  const contexts = entries.filter((entry) => entry?.type === 'turn_context').map((entry) => entry.payload || {});
  return { id: String(meta.session_id || meta.id || codexSessionIdFromFile(file)), cwd: meta.cwd || contexts.findLast((entry) => entry.cwd)?.cwd || '' };
}

function claudeIdentity(file, entries) {
  const inSubagents = basename(dirname(file)) === 'subagents' && basename(file).startsWith('agent-');
  if (!inSubagents) return { id: basename(file, '.jsonl'), cwd: entries.find((entry) => entry?.cwd)?.cwd || '' };
  const parentFromPath = basename(dirname(dirname(file)));
  const parent = entries.find((entry) => entry?.sessionId)?.sessionId || parentFromPath;
  return { id: `${parent}/${basename(file, '.jsonl')}`, cwd: entries.find((entry) => entry?.cwd)?.cwd || '' };
}

async function buildFileSessionIndex(root, source, readSessionFile = readFile) {
  const index = new Map();
  for (const file of await walkJsonl(root)) {
    const entries = parseJsonl(await readSessionFile(file, 'utf8'));
    const identity = source === 'codex' ? codexIdentity(file, entries) : claudeIdentity(file, entries);
    const matches = index.get(identity.id) || [];
    matches.push({ ...identity, file });
    index.set(identity.id, matches);
  }
  return index;
}

async function defaultOpenCodeLookup(database, id) {
  const escaped = String(id).replaceAll("'", "''");
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', database, `SELECT id, directory AS cwd FROM session WHERE id = '${escaped}'`]);
  return JSON.parse(stdout || '[]');
}

async function piSession(machine, parsed) {
  const archiveRoot = machine.roots?.pi;
  if (!archiveRoot) return [];
  let file;
  if (parsed.machineId) {
    file = resolve(parsed.value);
    if (!isUnderRoot(file, archiveRoot)) return [];
  } else {
    const originalRoot = machine.originalRoots?.pi;
    if (!originalRoot) return [];
    const original = resolve(parsed.value);
    const suffix = relative(originalRoot, original);
    if (suffix.startsWith('..') || isAbsolute(suffix)) return [];
    file = resolve(archiveRoot, suffix);
  }
  try {
    const entries = parseJsonl(await readFile(file, 'utf8'));
    const header = entries.find((entry) => entry?.type === 'session');
    return header ? [{ id: header.id || basename(file, '.jsonl'), cwd: header.cwd || '', file }] : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function createLiveSessionLookup({ roots = {}, openCodeLookup = defaultOpenCodeLookup, readSessionFile = readFile } = {}) {
  const fileIndexes = new Map();
  const openCodeResults = new Map();
  const matchesFor = (source, value) => {
    if (!fileIndexes.has(source)) fileIndexes.set(source, buildFileSessionIndex(roots[source], source, readSessionFile));
    return fileIndexes.get(source).then((index) => index.get(value) || []);
  };
  return async (source, value) => {
    if (source === 'pi') {
      try { await access(resolve(value)); return true; } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    }
    if (source === 'codex' || source === 'claude-code') return (await matchesFor(source, value)).length > 0;
    if (source === 'opencode' && roots.opencode) {
      if (!openCodeResults.has(value)) openCodeResults.set(value, openCodeLookup(roots.opencode, value));
      return (await openCodeResults.get(value)).length > 0;
    }
    return false;
  };
}

export function createOwnershipAwareResolver({
  machine,
  archivedWorkspace,
  destinationWorkspace,
  liveSessionExists = async () => false,
  openCodeLookup = defaultOpenCodeLookup,
  readSessionFile = readFile,
  lookupCache = { fileIndexes: new Map(), openCodeResults: new Map() },
} = {}) {
  if (!machine?.id) throw new Error('machine is required');
  if (!archivedWorkspace?.oldRoot) throw new Error('archivedWorkspace.oldRoot is required');
  if (!destinationWorkspace?.root) throw new Error('destinationWorkspace.root is required');

  const matchesFor = (source, value) => {
    const root = machine.roots?.[source];
    const cacheKey = `${source}\0${root || ''}`;
    if (!lookupCache.fileIndexes.has(cacheKey)) lookupCache.fileIndexes.set(cacheKey, buildFileSessionIndex(root, source, readSessionFile));
    return lookupCache.fileIndexes.get(cacheKey).then((index) => index.get(value) || []);
  };

  return async (sourceKey) => {
    const parsed = parseSessionRef(sourceKey);
    if (!parsed) return { reason: 'unsupported session key' };
    if (parsed.machineId && parsed.machineId !== machine.id) return { reason: 'session key names another machine' };
    if (!parsed.machineId && await liveSessionExists(parsed.source, parsed.value)) return { reason: 'session still resolves in the current live store' };

    let matches;
    if (parsed.source === 'pi') matches = await piSession(machine, parsed);
    else if (parsed.source === 'codex' || parsed.source === 'claude-code') {
      matches = await matchesFor(parsed.source, parsed.value);
    } else if (parsed.source === 'opencode') {
      if (!machine.roots?.opencode) matches = [];
      else {
        const cacheKey = `${machine.roots.opencode}\0${parsed.value}`;
        if (!lookupCache.openCodeResults.has(cacheKey)) lookupCache.openCodeResults.set(cacheKey, openCodeLookup(machine.roots.opencode, parsed.value));
        matches = await lookupCache.openCodeResults.get(cacheKey);
      }
    }
    if (!matches?.length) return { reason: 'archived session not found' };
    if (matches.length > 1) return { reason: 'ambiguous archived session id' };
    const cwd = matches[0].cwd;
    if (!cwd || !isUnderRoot(cwd, archivedWorkspace.oldRoot)) return { reason: 'archived session is outside snapshot workspace ownership' };
    const translatedCwd = translateCwd(machine, cwd);
    if (!translatedCwd) return { reason: 'archived session cwd has no destination mapping' };
    if (!isUnderRoot(translatedCwd, destinationWorkspace.root)) return { reason: 'translated session cwd is outside destination workspace' };
    return {
      targetKey: formatSessionRef(parsed.source, parsed.source === 'pi' ? matches[0].file : parsed.value, machine.id),
      cwd,
      translatedCwd,
    };
  };
}
