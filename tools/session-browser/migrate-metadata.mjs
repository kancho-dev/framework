#!/usr/bin/env node
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const legacyMetadataPath = join(TOOL_DIR, '.cache', 'metadata.json');
const workspaceRoot = resolve(process.env.WORKSPACE_ROOT || await findWorkspaceRoot(process.cwd()));
const metadataPath = resolve(process.env.SESSION_BROWSER_METADATA || join(workspaceRoot, '.tools-config', 'session-browser', 'metadata.json'));

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((tag) => String(tag || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

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

async function main() {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const migrationHint = process.env.SESSION_BROWSER_METADATA ? '' : ' For metadata-path upgrades, see migrations/v0.14.0.md.';
      console.log(`No Session Browser metadata found at ${metadataPath}; nothing to migrate.${migrationHint}`);
      return;
    }
    throw error;
  }

  const sessions = parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {};
  let changed = false;
  let migrated = 0;
  const next = { ...parsed, version: Math.max(Number(parsed?.version || 1), 3), sessions: {} };

  for (const [key, value] of Object.entries(sessions)) {
    const tags = normalizeTags([...(Array.isArray(value?.tags) ? value.tags : []), ...(Array.isArray(value?.labels) ? value.labels : [])]);
    const entry = { bookmarked: Boolean(value?.bookmarked), tags, ...(value?.savedTopics ? { savedTopics: value.savedTopics } : {}) };
    if (value?.labels !== undefined || JSON.stringify(value?.tags || []) !== JSON.stringify(tags) || value?.bookmarked !== entry.bookmarked) {
      changed = true;
      if (value?.labels !== undefined) migrated += 1;
    }
    if (entry.bookmarked || entry.tags.length > 0 || Object.keys(entry.savedTopics || {}).length > 0) next.sessions[key] = entry;
    else changed = true;
  }

  if (!changed) {
    console.log(`Session Browser metadata already uses canonical tags: ${metadataPath}`);
    return;
  }

  await mkdir(dirname(metadataPath), { recursive: true });
  const backupPath = `${metadataPath}.backup-${backupSuffix()}`;
  await copyFile(metadataPath, backupPath);
  const tmp = `${metadataPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(tmp, metadataPath);
  console.log(`Migrated Session Browser metadata labels to tags: ${metadataPath}`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Sessions with legacy labels migrated: ${migrated}`);
}

main().catch((error) => {
  console.error(`Migration failed: ${error?.message || error}`);
  process.exit(1);
});
