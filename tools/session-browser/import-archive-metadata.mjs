#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, sha256File, validateBundleManifest } from './archive-metadata-bundle.mjs';
import { mergeArchivedMetadata } from './archive-metadata-merge.mjs';
import { ARCHIVE_METADATA_LEDGER_VERSION, routeMetadataSnapshots } from './archive-metadata-routing.mjs';
import { createLiveSessionLookup, createOwnershipAwareResolver } from './archive-session-ownership.mjs';
import { loadLegacyMachines } from './legacy-machines.mjs';
import { isUnderRoot } from './workspace-paths.mjs';
import { normalizeWorkspaceId } from '../shared-web/workspace-identity.mjs';

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

function normalizeWorkspaces(parsed, configPath) {
  if (!Array.isArray(parsed.workspaces) || !parsed.workspaces.length) throw new Error('Workspace config must include a non-empty workspaces array');
  const ids = new Set();
  const workspaces = parsed.workspaces.map((entry) => {
    const id = normalizeWorkspaceId(entry?.id);
    if (ids.has(id)) throw new Error(`Duplicate workspace id: ${id}`);
    ids.add(id);
    if (!entry.root) throw new Error(`Missing workspace ${id} root`);
    return {
      id,
      name: String(entry.name || id),
      root: resolve(String(entry.root)),
      sessionMetadataPath: entry.sessionMetadataPath ? resolve(String(entry.sessionMetadataPath)) : null,
      sessionArchiveBindings: Array.isArray(entry.sessionArchiveBindings) ? structuredClone(entry.sessionArchiveBindings) : [],
    };
  });
  if (!parsed.sessionArchiveManifestPath) throw new Error('Workspace config must include sessionArchiveManifestPath');
  return { workspaces, manifestPath: resolve(dirname(configPath), String(parsed.sessionArchiveManifestPath)) };
}

function countSessions(metadata) {
  return Object.keys(metadata?.sessions || {}).length;
}

async function inspectBoundRoute(route, context) {
  const { bundleDirectory, manifestPath, machineId, liveSessionExists, archiveLookupCache } = context;
  const snapshotPath = resolve(bundleDirectory, route.snapshot.snapshotPath);
  if (!isUnderRoot(snapshotPath, bundleDirectory)) throw new Error('snapshot path escapes bundle directory');
  const [realBundle, realSnapshot] = await Promise.all([realpath(bundleDirectory), realpath(snapshotPath)]);
  if (!isUnderRoot(realSnapshot, realBundle)) throw new Error('snapshot symlink escapes bundle directory');
  const snapshotSha256 = await sha256File(realSnapshot);
  if (snapshotSha256 !== route.snapshot.sha256) throw new Error('snapshot checksum mismatch');
  const snapshot = await readJson(realSnapshot);
  if (!route.destination.sessionMetadataPath) throw new Error('destination workspace has no explicit sessionMetadataPath');
  const destination = await readJson(route.destination.sessionMetadataPath, { version: 3, sessions: {} });
  const destinationBytes = await readFile(route.destination.sessionMetadataPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  const state = await loadLegacyMachines({
    configPath: manifestPath,
    workspaceRoot: route.destination.root,
    bindings: route.destination.sessionArchiveBindings,
  });
  const machine = state.machines[machineId];
  if (!machine) throw new Error(`machine ${machineId} is not bound to destination workspace`);
  const merge = await mergeArchivedMetadata({
    snapshot,
    destination,
    resolveTarget: createOwnershipAwareResolver({
      machine,
      archivedWorkspace: route.snapshot,
      destinationWorkspace: route.destination,
      liveSessionExists,
      lookupCache: archiveLookupCache,
    }),
  });
  return {
    status: 'bound',
    archivedWorkspaceId: route.snapshot.workspaceId,
    destinationWorkspaceId: route.destination.id,
    route: route.route,
    snapshotPath: realSnapshot,
    snapshotSha256,
    destinationMetadataPath: route.destination.sessionMetadataPath,
    destinationSha256: destinationBytes ? sha256(destinationBytes) : null,
    destinationExists: Boolean(destinationBytes),
    canonicalized: merge.canonicalized,
    eligible: merge.eligible,
    unmatched: merge.unmatched,
    conflicts: merge.conflicts,
    counts: {
      destinationSessions: countSessions(destination),
      resultingSessions: countSessions(merge.metadata),
      eligible: merge.eligible.length,
      unmatched: merge.unmatched.length,
      conflicts: merge.conflicts.length,
    },
    changed: merge.changed,
    diagnostics: state.errors,
  };
}

export async function createArchiveMetadataDryRun({
  bundlePath,
  workspaceConfigPath,
  bindings = {},
  allowRebind = false,
  ledgerPath,
  liveRoots = {
    codex: resolve(process.env.CODEX_SESSION_ROOT || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')),
    'claude-code': resolve(process.env.CLAUDE_PROJECTS_ROOT || join(process.env.CLAUDE_HOME || join(homedir(), '.claude'), 'projects')),
    opencode: resolve(process.env.OPENCODE_DB || join(process.env.OPENCODE_DATA_DIR || join(homedir(), '.local', 'share', 'opencode'), 'opencode.db')),
  },
  liveSessionExists,
} = {}) {
  const resolvedBundlePath = resolve(bundlePath);
  const resolvedConfigPath = resolve(workspaceConfigPath);
  const rawBundle = await readJson(resolvedBundlePath);
  const validation = validateBundleManifest(rawBundle);
  const topology = normalizeWorkspaces(await readJson(resolvedConfigPath), resolvedConfigPath);
  const resolvedLedgerPath = resolve(ledgerPath || join(dirname(resolvedConfigPath), '..', 'session-browser', 'archive-metadata-imports.json'));
  const ledger = await readJson(resolvedLedgerPath, { version: ARCHIVE_METADATA_LEDGER_VERSION, records: [] });
  const routes = routeMetadataSnapshots({ bundle: validation.manifest, currentWorkspaces: topology.workspaces, bindings, ledger, allowRebind });
  const manifestBytes = await readFile(topology.manifestPath);
  const currentManifestSha256 = sha256(manifestBytes);
  const report = {
    dryRun: true,
    bundlePath: resolvedBundlePath,
    bundleSha256: await sha256File(resolvedBundlePath),
    machineId: validation.manifest.machine.id,
    archiveManifest: {
      path: topology.manifestPath,
      exportedSha256: validation.manifest.archiveManifest.sha256,
      currentSha256: currentManifestSha256,
      provenanceChanged: currentManifestSha256 !== validation.manifest.archiveManifest.sha256,
    },
    ledgerPath: resolvedLedgerPath,
    workspaces: validation.invalidWorkspaces.map((entry) => ({ status: 'invalid', archivedWorkspaceId: entry.workspaceId, reason: entry.reason })),
  };
  const lookup = liveSessionExists || createLiveSessionLookup({ roots: liveRoots });
  const archiveLookupCache = { fileIndexes: new Map(), openCodeResults: new Map() };
  for (const route of routes) {
    if (route.status !== 'bound') {
      report.workspaces.push({
        status: route.status,
        archivedWorkspaceId: route.snapshot.workspaceId,
        destinationWorkspaceId: route.destination?.id || null,
        reason: route.reason || null,
      });
      continue;
    }
    try {
      report.workspaces.push(await inspectBoundRoute(route, {
        bundleDirectory: dirname(resolvedBundlePath),
        manifestPath: topology.manifestPath,
        machineId: validation.manifest.machine.id,
        liveSessionExists: lookup,
        archiveLookupCache,
      }));
    } catch (error) {
      report.workspaces.push({
        status: 'failed',
        archivedWorkspaceId: route.snapshot.workspaceId,
        destinationWorkspaceId: route.destination.id,
        reason: error.message,
      });
    }
  }
  report.summary = Object.fromEntries(['bound', 'unbound', 'invalid', 'already-imported', 'failed'].map((status) => [status, report.workspaces.filter((entry) => entry.status === status).length]));
  report.ok = report.summary.invalid === 0 && report.summary.failed === 0;
  return report;
}

function usage() {
  return 'Usage: node import-archive-metadata.mjs --bundle <path> --workspaces <path> [--bind archived=current] [--allow-rebind] [--json]';
}

function parseArgs(argv) {
  const options = { bindings: {} };
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--bundle' && args.length) options.bundlePath = args.shift();
    else if (arg === '--workspaces' && args.length) options.workspaceConfigPath = args.shift();
    else if (arg === '--ledger' && args.length) options.ledgerPath = args.shift();
    else if (arg === '--bind' && args.length) {
      const [archived, current, extra] = args.shift().split('=');
      if (!archived || !current || extra !== undefined) throw new Error(`Invalid --bind value\n${usage()}`);
      options.bindings[archived] = current;
    } else if (arg === '--allow-rebind') options.allowRebind = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--apply') throw new Error('--apply is not available in this implementation slice');
    else throw new Error(`Unknown or incomplete option: ${arg}\n${usage()}`);
  }
  if (!options.bundlePath || !options.workspaceConfigPath) throw new Error(usage());
  return options;
}

export function printReport(report) {
  console.log(`Dry run: ${report.bundlePath}`);
  console.log(`Archive manifest provenance changed: ${report.archiveManifest.provenanceChanged ? 'yes' : 'no'}`);
  for (const entry of report.workspaces) {
    const destination = entry.destinationWorkspaceId ? ` -> ${entry.destinationWorkspaceId}` : '';
    console.log(`${entry.archivedWorkspaceId || '(invalid)'}${destination}: ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}`);
    if (entry.counts) {
      console.log(`  canonicalized archived metadata: ${entry.canonicalized ? 'yes' : 'no'}`);
      console.log(`  snapshot ${entry.snapshotSha256}; destination ${entry.destinationSha256 || '(absent)'}`);
      console.log(`  eligible ${entry.counts.eligible}, unmatched ${entry.counts.unmatched}, conflicts ${entry.counts.conflicts}, resulting sessions ${entry.counts.resultingSessions}`);
      for (const item of entry.eligible) console.log(`  MERGE ${item.sourceKey} -> ${item.targetKey}`);
      for (const item of entry.unmatched) console.log(`  UNMATCHED ${item.sourceKey}: ${item.reason}`);
      for (const item of entry.conflicts) console.log(`  CONFLICT ${item.targetKey} saved topic ${item.id}: current kept, archived value reported`);
      for (const item of entry.diagnostics) console.log(`  DIAGNOSTIC ${item.code}: ${item.message}`);
    }
  }
  console.log(`Summary: ${Object.entries(report.summary).map(([key, value]) => `${key}=${value}`).join(', ')}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await createArchiveMetadataDryRun(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Metadata import dry run failed: ${error.message}`); process.exitCode = 1; });
}
