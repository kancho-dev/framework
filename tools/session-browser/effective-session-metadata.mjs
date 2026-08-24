import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { validateBundleManifest, sha256 } from './archive-metadata-bundle.mjs';
import { createOwnershipAwareResolver } from './archive-session-ownership.mjs';
import { hasContent, normalizeMetadataEntry, object } from './metadata-remap.mjs';
import { METADATA_VERSION } from './metadata-schema.mjs';
import { parseSessionRef, sessionKey } from './session-ref.mjs';

const MAX_OWNERSHIP_DIAGNOSTICS = 5;

const writeQueues = new Map();

function serialize(path, operation) {
  const previous = writeQueues.get(path) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  writeQueues.set(path, current);
  return current.finally(() => { if (writeQueues.get(path) === current) writeQueues.delete(path); });
}

function normalizedEntry(value = {}) {
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.map((tag) => String(tag || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right))
    : [];
  const topics = value.savedTopics && typeof value.savedTopics === 'object' && !Array.isArray(value.savedTopics) ? value.savedTopics : {};
  const savedTopics = Object.fromEntries(Object.entries(topics).flatMap(([entryId, topic]) => {
    const id = String(entryId || '').trim();
    if (!id) return [];
    return [[id, {
      title: String(topic?.title || '').trim().slice(0, 240),
      note: String(topic?.note || '').trim().slice(0, 1000),
      prompt: String(topic?.prompt || '').trim().slice(0, 1000),
      timestamp: String(topic?.timestamp || '').trim(),
    }]];
  }));
  return { bookmarked: Boolean(value.bookmarked), tags, savedTopics };
}

function presented(key, value, provenance, canReset = false) {
  const entry = normalizedEntry(value);
  return { bookmarkKey: key, ...entry, savedTopicCount: Object.keys(entry.savedTopics).length, provenance, canReset };
}

function canonicalizeArchivedMetadata(snapshot) {
  const input = object(snapshot);
  const sessions = {};
  for (const [key, value] of Object.entries(object(input.sessions))) {
    const entry = normalizeMetadataEntry({
      ...object(value),
      tags: [...(Array.isArray(value?.tags) ? value.tags : []), ...(Array.isArray(value?.labels) ? value.labels : [])],
    });
    if (hasContent(entry)) sessions[key] = entry;
  }
  return { ...input, version: Math.max(Number(input.version || 1), METADATA_VERSION), sessions };
}

function diagnostic(code, machineId, workspaceId, message) {
  return Object.freeze({ source: `archive-metadata@${machineId || 'unknown'}`, code, machineId: machineId || null, workspaceId, message });
}

function contained(path, root) {
  const suffix = relative(root, path);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function readVerifiedSnapshot({ binding, machine, workspace, read = readFile, resolveRealPath = realpath }) {
  const bundleBytes = await read(binding.metadataBundlePath);
  const validation = validateBundleManifest(JSON.parse(bundleBytes.toString('utf8')));
  const bundle = validation.manifest;
  if (bundle.machine.id !== binding.machineId) throw Object.assign(new Error('Bundle machine does not match its binding.'), { code: 'machine-mismatch' });
  const archivedWorkspaceId = binding.archivedWorkspaceId || workspace.id;
  const invalidClaims = validation.invalidWorkspaces.filter((entry) => entry.workspaceId === archivedWorkspaceId);
  const matches = bundle.workspaces.filter((entry) => entry.workspaceId === archivedWorkspaceId);
  if (invalidClaims.some((entry) => entry.reason.includes('duplicate workspaceId')) || matches.length > 1) {
    throw Object.assign(new Error('Bundle has ambiguous workspace claims.'), { code: 'ambiguous-archive-metadata' });
  }
  if (invalidClaims.length) throw Object.assign(new Error('The selected workspace bundle entry is invalid.'), { code: 'invalid-bundle' });
  if (matches.length !== 1) throw Object.assign(new Error('Bundle has no snapshot for the bound workspace.'), { code: 'missing-workspace-snapshot' });
  const entry = matches[0];
  const bundleRoot = await resolveRealPath(dirname(binding.metadataBundlePath));
  const snapshotPath = resolve(bundleRoot, entry.snapshotPath);
  const realSnapshot = await resolveRealPath(snapshotPath);
  if (!contained(realSnapshot, bundleRoot)) throw Object.assign(new Error('Snapshot resolves outside the bundle directory.'), { code: 'invalid-bundle' });
  const bytes = await read(realSnapshot);
  if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) throw Object.assign(new Error('Snapshot checksum or size does not match the bundle.'), { code: 'snapshot-checksum-mismatch' });
  let snapshot;
  try { snapshot = JSON.parse(bytes.toString('utf8')); }
  catch { throw Object.assign(new Error('Snapshot is not valid JSON.'), { code: 'invalid-snapshot' }); }
  return { entry, snapshot: canonicalizeArchivedMetadata(snapshot) };
}

export async function loadArchiveMetadataIndex({ workspace, machines, sessionArchiveBindings, liveSessionExists, openCodeLookup, readSessionFile } = {}) {
  if (!workspace?.id || !workspace?.root) throw new Error('workspace id and root are required');
  const diagnostics = [];
  const claims = new Map();
  const bindings = Array.isArray(sessionArchiveBindings) ? sessionArchiveBindings : [];

  for (const binding of bindings) {
    const machineId = binding?.machineId;
    const machine = machines?.[machineId];
    if (!machine || !binding?.metadataBundlePath) {
      diagnostics.push(diagnostic(machine ? 'missing-bundle' : 'workspace-unbound', machineId, workspace.id, machine ? 'Binding has no metadata bundle path.' : 'Binding has no selected archive machine.'));
      continue;
    }
    try {
      const { entry, snapshot } = await readVerifiedSnapshot({ binding, machine, workspace });
      const snapshotEntries = Object.entries(snapshot.sessions);
      const missingPiRoot = !machine.originalRoots?.pi
        ? snapshotEntries.filter(([sourceKey]) => {
          const parsed = parseSessionRef(sourceKey);
          return parsed?.source === 'pi' && !parsed.machineId;
        })
        : [];
      if (missingPiRoot.length) {
        diagnostics.push(diagnostic('missing-original-root', machineId, workspace.id, `Machine ${machineId} requires originalRoots.pi to resolve ${missingPiRoot.length} unnamespaced Pi metadata entr${missingPiRoot.length === 1 ? 'y' : 'ies'}.`));
      }
      const missingKeys = new Set(missingPiRoot.map(([sourceKey]) => sourceKey));
      const resolveTarget = createOwnershipAwareResolver({ machine, archivedWorkspace: entry, destinationWorkspace: workspace, liveSessionExists, openCodeLookup, readSessionFile });
      let rejected = 0;
      for (const [sourceKey, value] of snapshotEntries) {
        if (missingKeys.has(sourceKey)) continue;
        const resolution = await resolveTarget(sourceKey);
        if (!resolution?.targetKey) {
          rejected += 1;
          if (rejected <= MAX_OWNERSHIP_DIAGNOSTICS) diagnostics.push(diagnostic('ownership-rejected', machineId, workspace.id, `Snapshot entry ${sourceKey} was rejected: ${resolution?.reason || 'not eligible'}.`));
          continue;
        }
        const existing = claims.get(resolution.targetKey) || [];
        existing.push({ machineId, sourceKey, entry: value });
        claims.set(resolution.targetKey, existing);
      }
      if (rejected > MAX_OWNERSHIP_DIAGNOSTICS) diagnostics.push(diagnostic('ownership-rejected-summary', machineId, workspace.id, `${rejected - MAX_OWNERSHIP_DIAGNOSTICS} additional snapshot entries were rejected.`));
    } catch (error) {
      const code = error?.code || (error?.code === 'ENOENT' ? 'missing-bundle' : 'invalid-bundle');
      diagnostics.push(diagnostic(code === 'ENOENT' ? 'missing-bundle' : code, machineId, workspace.id, error.message));
    }
  }

  const entries = new Map();
  for (const [targetKey, values] of [...claims].sort(([left], [right]) => left.localeCompare(right))) {
    if (values.length !== 1) {
      diagnostics.push(diagnostic('ambiguous-archive-metadata', values[0]?.machineId, workspace.id, `Multiple archive metadata entries claim ${targetKey}.`));
      continue;
    }
    entries.set(targetKey, { ...values[0].entry, provenance: { source: 'archive', machineId: values[0].machineId, workspaceId: workspace.id } });
  }
  return { entries, diagnostics: diagnostics.sort((left, right) => `${left.machineId}\0${left.message}`.localeCompare(`${right.machineId}\0${right.message}`)) };
}

export function createEffectiveMetadataStore({ workspace, machines, sessionArchiveBindings, metadataPath, readLive, writeLive, isAllowed = async () => true } = {}) {
  if (typeof readLive !== 'function' || typeof writeLive !== 'function') throw new Error('readLive and writeLive are required');
  let cachedArchive = null;
  const archive = async () => {
    if (cachedArchive) return cachedArchive;
    const result = await loadArchiveMetadataIndex({ workspace, machines, sessionArchiveBindings });
    if (result.diagnostics.length === 0) cachedArchive = result;
    return result;
  };
  const effective = (key, live, archived) => {
    if (Object.hasOwn(live.sessions, key)) return presented(key, live.sessions[key], { source: 'live' }, archived.has(key));
    if (archived.has(key)) return presented(key, archived.get(key), archived.get(key).provenance, false);
    return presented(key, {}, { source: 'empty' }, false);
  };
  return Object.freeze({
    async readForSessions(sessions) {
      const [{ metadata, error }, archived] = await Promise.all([readLive(), archive()]);
      const entries = new Map(sessions.map((session) => {
        const key = sessionKey(session);
        return [key, effective(key, metadata, archived.entries)];
      }));
      return { entries, diagnostics: archived.diagnostics, error };
    },
    async mutate(session, patch) {
      if (!await isAllowed(session)) throw new Error('Invalid session path');
      const key = sessionKey(session);
      return serialize(metadataPath, async () => {
        const [{ metadata, error }, archived] = await Promise.all([readLive(), archive()]);
        if (error) throw new Error(error);
        const base = effective(key, metadata, archived.entries);
        const patchTags = patch.tags === undefined ? patch.labels : patch.tags;
        const next = normalizedEntry({
          bookmarked: patch.bookmarked === undefined ? base.bookmarked : patch.bookmarked,
          tags: patchTags === undefined ? base.tags : patchTags,
          savedTopics: patch.savedTopics === undefined ? base.savedTopics : patch.savedTopics,
        });
        if (archived.entries.has(key) || next.bookmarked || next.tags.length || Object.keys(next.savedTopics).length) metadata.sessions[key] = next;
        else delete metadata.sessions[key];
        await writeLive(metadata);
        return presented(key, next, { source: 'live' }, archived.entries.has(key));
      });
    },
    async reset(session) {
      if (!await isAllowed(session)) throw new Error('Invalid session path');
      const key = sessionKey(session);
      return serialize(metadataPath, async () => {
        const [{ metadata, error }, archived] = await Promise.all([readLive(), archive()]);
        if (error) throw new Error(error);
        if (!archived.entries.has(key)) throw new Error('Session has no eligible archived metadata default');
        delete metadata.sessions[key];
        await writeLive(metadata);
        return presented(key, archived.entries.get(key), archived.entries.get(key).provenance, false);
      });
    },
  });
}
