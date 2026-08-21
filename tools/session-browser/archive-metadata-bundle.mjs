import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { normalizeWorkspaceId, WORKSPACE_ID_PATTERN } from '../shared-web/workspace-identity.mjs';
import { emptyMetadata } from './metadata-schema.mjs';

export const ARCHIVE_METADATA_BUNDLE_VERSION = 1;
export const EMPTY_METADATA_SNAPSHOT = `${JSON.stringify(emptyMetadata(), null, 2)}\n`;

const HEX_SHA256 = /^[a-f0-9]{64}$/;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path) {
  return sha256(await readFile(path));
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function validateSnapshotPath(value, field) {
  requiredString(value, field);
  const normalized = posix.normalize(value.replaceAll('\\', '/'));
  if (isAbsolute(value) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${field} must stay beneath the bundle directory`);
  }
  return value;
}

function validateWorkspace(entry, index) {
  const field = `workspaces[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${field} must be an object`);
  requiredString(entry.workspaceId, `${field}.workspaceId`);
  if (!WORKSPACE_ID_PATTERN.test(entry.workspaceId)) throw new Error(`${field}.workspaceId is invalid`);
  requiredString(entry.workspaceLabel, `${field}.workspaceLabel`);
  requiredString(entry.oldRoot, `${field}.oldRoot`);
  if (!isAbsolute(entry.oldRoot)) throw new Error(`${field}.oldRoot must be absolute`);
  if (entry.sourceMetadataPath !== null && !isAbsolute(requiredString(entry.sourceMetadataPath, `${field}.sourceMetadataPath`))) {
    throw new Error(`${field}.sourceMetadataPath must be absolute or null`);
  }
  validateSnapshotPath(entry.snapshotPath, `${field}.snapshotPath`);
  if (!HEX_SHA256.test(entry.sha256 || '')) throw new Error(`${field}.sha256 must be a lowercase SHA-256 hex digest`);
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error(`${field}.bytes must be a non-negative integer`);
  if (Number.isNaN(Date.parse(entry.exportedAt))) throw new Error(`${field}.exportedAt must be an ISO timestamp`);
  if (entry.absentSource !== undefined && typeof entry.absentSource !== 'boolean') throw new Error(`${field}.absentSource must be boolean`);
  return entry;
}

export function validateBundleManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Bundle manifest must be an object');
  if (input.version !== ARCHIVE_METADATA_BUNDLE_VERSION) throw new Error(`Unsupported metadata bundle version: ${input.version}`);
  if (!input.machine || typeof input.machine !== 'object') throw new Error('machine must be an object');
  requiredString(input.machine.id, 'machine.id');
  requiredString(input.machine.label, 'machine.label');
  if (Number.isNaN(Date.parse(input.exportedAt))) throw new Error('exportedAt must be an ISO timestamp');
  if (!input.archiveManifest || typeof input.archiveManifest !== 'object') throw new Error('archiveManifest must be an object');
  requiredString(input.archiveManifest.path, 'archiveManifest.path');
  if (!HEX_SHA256.test(input.archiveManifest.sha256 || '')) throw new Error('archiveManifest.sha256 must be a lowercase SHA-256 hex digest');
  if (!Array.isArray(input.workspaces)) throw new Error('workspaces must be an array');

  const workspaces = [];
  const invalidWorkspaces = [];
  const ids = new Set();
  for (const [index, entry] of input.workspaces.entries()) {
    try {
      validateWorkspace(entry, index);
      if (ids.has(entry.workspaceId)) throw new Error(`duplicate workspaceId: ${entry.workspaceId}`);
      ids.add(entry.workspaceId);
      workspaces.push(entry);
    } catch (error) {
      invalidWorkspaces.push({ index, workspaceId: entry?.workspaceId || null, reason: error.message });
    }
  }
  return { manifest: { ...input, workspaces }, invalidWorkspaces };
}

function snapshotPathFor(workspaceId) {
  return posix.join('workspaces', normalizeWorkspaceId(workspaceId), 'metadata.json');
}

export async function planMetadataBundleExport({ machine, archiveManifest, workspaces, exportedAt = new Date().toISOString() }) {
  requiredString(machine?.id, 'machine.id');
  requiredString(machine?.label, 'machine.label');
  requiredString(archiveManifest?.path, 'archiveManifest.path');
  if (!HEX_SHA256.test(archiveManifest?.sha256 || '')) throw new Error('archiveManifest.sha256 must be a lowercase SHA-256 hex digest');
  if (!Array.isArray(workspaces)) throw new Error('workspaces must be an array');

  const snapshots = new Map();
  const entries = [];
  const ids = new Set();
  for (const workspace of workspaces) {
    const workspaceId = requiredString(workspace?.id, 'workspace.id');
    if (ids.has(workspaceId)) throw new Error(`Duplicate workspace id: ${workspaceId}`);
    ids.add(workspaceId);
    const snapshotPath = snapshotPathFor(workspaceId);
    const sourceMetadataPath = workspace.sessionMetadataPath ? resolve(workspace.sessionMetadataPath) : null;
    let bytes;
    let absentSource = false;
    if (!sourceMetadataPath) {
      bytes = Buffer.from(EMPTY_METADATA_SNAPSHOT);
      absentSource = true;
    } else {
      try {
        bytes = await readFile(sourceMetadataPath);
        JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw new Error(`Cannot export metadata for workspace ${workspaceId}: ${error.message}`);
        bytes = Buffer.from(EMPTY_METADATA_SNAPSHOT);
        absentSource = true;
      }
    }
    snapshots.set(snapshotPath, bytes);
    entries.push({
      workspaceId,
      workspaceLabel: requiredString(workspace.name || workspace.label || workspaceId, `workspace ${workspaceId} label`),
      oldRoot: resolve(requiredString(workspace.root, `workspace ${workspaceId} root`)),
      sourceMetadataPath,
      snapshotPath,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
      exportedAt,
      ...(absentSource ? { absentSource: true } : {}),
    });
  }

  const bundle = { version: ARCHIVE_METADATA_BUNDLE_VERSION, machine: { id: machine.id, label: machine.label }, exportedAt, archiveManifest: { path: archiveManifest.path, sha256: archiveManifest.sha256 }, workspaces: entries };
  const validation = validateBundleManifest(bundle);
  if (validation.invalidWorkspaces.length) throw new Error(validation.invalidWorkspaces.map((item) => item.reason).join('; '));
  return { bundle, snapshots, diagnostics: entries.filter((entry) => entry.absentSource).map((entry) => ({ workspaceId: entry.workspaceId, reason: 'absentSource' })) };
}

export async function writeMetadataBundle(plan, metadataDirectory) {
  const paths = new Set();
  for (const entry of plan.bundle.workspaces) {
    const collisionKey = entry.snapshotPath.toLocaleLowerCase('en-US');
    if (paths.has(collisionKey)) throw new Error(`Snapshot paths collide on a case-insensitive filesystem: ${entry.snapshotPath}`);
    paths.add(collisionKey);
  }

  const workspaces = [];
  for (const entry of plan.bundle.workspaces) {
    const destination = join(metadataDirectory, entry.snapshotPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, plan.snapshots.get(entry.snapshotPath), { flag: 'wx' });
    workspaces.push({
      ...entry,
      sha256: await sha256File(destination),
      bytes: (await readFile(destination)).byteLength,
    });
  }
  const bundle = { ...plan.bundle, workspaces };
  const validation = validateBundleManifest(bundle);
  if (validation.invalidWorkspaces.length) throw new Error(validation.invalidWorkspaces.map((item) => item.reason).join('; '));
  const bundlePath = join(metadataDirectory, 'bundle.json');
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx' });
  return { bundle, bundlePath, sha256: await sha256File(bundlePath) };
}
