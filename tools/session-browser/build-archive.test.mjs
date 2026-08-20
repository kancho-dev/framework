import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArchive } from './build-archive.mjs';

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-archive-'));
  const sources = {
    pi: join(root, 'live', 'pi'),
    'claude-code': join(root, 'live', 'claude'),
    codex: join(root, 'live', 'codex'),
    opencode: join(root, 'live', 'opencode.db'),
    'opencode-diffs': join(root, 'live', 'storage', 'session_diff'),
  };
  await Promise.all([sources.pi, sources['claude-code'], sources.codex, sources['opencode-diffs']].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(sources.pi, 'one.jsonl'), 'pi\n');
  await writeFile(join(sources['claude-code'], 'one.jsonl'), 'claude\n');
  await writeFile(join(sources.codex, 'one.jsonl'), 'codex\n');
  await writeFile(sources.opencode, 'database fixture\n');
  await writeFile(join(sources['opencode-diffs'], 'session-id.json'), '[]\n');

  const fakeSqlite = join(root, 'sqlite3');
  await writeFile(fakeSqlite, `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[3];
if (command.startsWith('.backup ')) {
  const quoted = command.slice('.backup '.length);
  const destination = quoted.slice(1, -1).replaceAll("''", "'");
  fs.copyFileSync(process.argv[2], destination);
} else if (command === 'PRAGMA journal_mode=DELETE;') {
  process.stdout.write('delete\\n');
} else {
  process.exitCode = 1;
}
`);
  await chmod(fakeSqlite, 0o755);
  return { root, sources, fakeSqlite };
}

test('builds the configured archive layout and reports counts', async () => {
  const { root, sources, fakeSqlite } = await fixture();
  const archiveRoot = join(root, 'archive');
  const result = await buildArchive({ machineId: 'old-linux', archiveRoot, sources, sqliteCommand: fakeSqlite });

  assert.equal(await readFile(join(result.target, 'pi', 'sessions', 'one.jsonl'), 'utf8'), 'pi\n');
  assert.equal(await readFile(join(result.target, 'claude', 'projects', 'one.jsonl'), 'utf8'), 'claude\n');
  assert.equal(await readFile(join(result.target, 'codex', 'sessions', 'one.jsonl'), 'utf8'), 'codex\n');
  assert.equal(await readFile(join(result.target, 'opencode.db'), 'utf8'), 'database fixture\n');
  assert.equal(await readFile(join(result.target, 'opencode', 'storage', 'session_diff', 'session-id.json'), 'utf8'), '[]\n');
  assert.deepEqual(Object.fromEntries(Object.entries(result.reports).map(([name, value]) => [name, value.files])), {
    pi: 1, 'claude-code': 1, codex: 1, opencode: 1, 'opencode-diffs': 1,
  });
  assert.equal(result.config.roots.pi, 'archive/old-linux/pi/sessions');
  assert.equal(result.config.artifacts['opencode-data'], 'archive/old-linux/opencode');
});

test('copied session files keep the source machine own timestamps', async () => {
  const { root, sources, fakeSqlite } = await fixture();
  const piFile = join(sources.pi, 'one.jsonl');
  const original = new Date('2026-04-01T10:00:00.000Z');
  await utimes(piFile, original, original);
  await utimes(sources.pi, original, original);

  const result = await buildArchive({ machineId: 'old-linux', archiveRoot: join(root, 'archive'), sources, sqliteCommand: fakeSqlite });

  const copied = await stat(join(result.target, 'pi', 'sessions', 'one.jsonl'));
  const copiedDir = await stat(join(result.target, 'pi', 'sessions'));
  assert.equal(copied.mtime.toISOString(), original.toISOString());
  assert.equal(copiedDir.mtime.toISOString(), original.toISOString());
});

test('dereferences store symlinks so the archive does not depend on the live store', async () => {
  const { root, sources, fakeSqlite } = await fixture();
  const external = join(root, 'linked-session.jsonl');
  await writeFile(external, 'linked\n');
  await symlink(external, join(sources['claude-code'], 'linked.jsonl'));

  const result = await buildArchive({ machineId: 'old-linux', archiveRoot: join(root, 'archive'), sources, sqliteCommand: fakeSqlite });
  assert.equal(await readFile(join(result.target, 'claude', 'projects', 'linked.jsonl'), 'utf8'), 'linked\n');
});

test('refuses to modify an existing archive without overwrite', async () => {
  const { root, sources, fakeSqlite } = await fixture();
  const archiveRoot = join(root, 'archive');
  const first = await buildArchive({ machineId: 'old-linux', archiveRoot, sources, sqliteCommand: fakeSqlite });
  await writeFile(join(first.target, 'sentinel'), 'keep');

  await assert.rejects(
    buildArchive({ machineId: 'old-linux', archiveRoot, sources, sqliteCommand: fakeSqlite }),
    /Archive already exists/,
  );
  assert.equal(await readFile(join(first.target, 'sentinel'), 'utf8'), 'keep');
});

test('sqlite failure publishes completed JSONL sources without a partial database', async () => {
  const { root, sources } = await fixture();
  const result = await buildArchive({
    machineId: 'old-linux',
    archiveRoot: join(root, 'archive'),
    sources,
    sqliteCommand: join(root, 'missing-sqlite3'),
  });

  assert.deepEqual(result.failures.map(({ source }) => source), ['opencode']);
  assert.deepEqual(Object.keys(result.config.roots), ['pi', 'claude-code', 'codex']);
  assert.equal(await readFile(join(result.target, 'pi', 'sessions', 'one.jsonl'), 'utf8'), 'pi\n');
  await assert.rejects(access(join(result.target, 'opencode.db')));
});

test('failed journal normalization removes orphan OpenCode sidecars', async () => {
  const { root, sources } = await fixture();
  const failingSqlite = join(root, 'sqlite3-normalization-failure');
  await writeFile(failingSqlite, `#!/usr/bin/env node
const fs = require('node:fs');
const command = process.argv[3];
if (command.startsWith('.backup ')) {
  const destination = command.slice('.backup '.length + 1, -1);
  fs.copyFileSync(process.argv[2], destination);
  fs.writeFileSync(destination + '-wal', 'orphan');
  fs.writeFileSync(destination + '-shm', 'orphan');
} else process.exitCode = 1;
`);
  await chmod(failingSqlite, 0o755);
  const result = await buildArchive({
    machineId: 'failed-normalization',
    archiveRoot: join(root, 'archive'),
    sources: { pi: sources.pi, opencode: sources.opencode },
    sqliteCommand: failingSqlite,
  });
  const archivedDb = join(result.target, 'opencode.db');

  assert.deepEqual(result.failures.map(({ source }) => source), ['opencode']);
  await assert.rejects(access(archivedDb));
  await assert.rejects(access(`${archivedDb}-wal`));
  await assert.rejects(access(`${archivedDb}-shm`));
});

test('missing sources are skipped, but an entirely empty archive is rejected', async () => {
  const { root, sources, fakeSqlite } = await fixture();
  const missing = join(root, 'not-installed');
  sources.opencode = missing;
  const result = await buildArchive({ machineId: 'partial', archiveRoot: join(root, 'archive'), sources, sqliteCommand: fakeSqlite });
  assert.deepEqual(result.skipped.map(({ source }) => source), ['opencode']);
  assert.equal(result.config.roots.opencode, undefined);

  await assert.rejects(
    buildArchive({ machineId: 'empty', archiveRoot: join(root, 'archive'), sources: { pi: missing } }),
    /Every configured source is missing/,
  );
  await assert.rejects(access(join(root, 'archive', 'empty')));
});

test('real sqlite backup includes rows from an active WAL database', async (t) => {
  try { await execFileAsync('sqlite3', ['-version']); } catch { t.skip('sqlite3 is unavailable'); return; }
  const { root, sources } = await fixture();
  const database = sources.opencode;
  await writeFile(database, '');
  const sqlite = spawn('sqlite3', [database], { stdio: ['pipe', 'pipe', 'pipe'] });
  const ready = new Promise((resolvePromise, reject) => {
    let output = '';
    sqlite.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('READY')) resolvePromise();
    });
    sqlite.once('error', reject);
    sqlite.once('exit', (code) => { if (code) reject(new Error(`sqlite3 exited ${code}`)); });
  });
  sqlite.stdin.write("PRAGMA journal_mode=WAL;\nPRAGMA wal_autocheckpoint=0;\nCREATE TABLE sessions(id INTEGER);\nINSERT INTO sessions VALUES (1),(2),(3);\nSELECT 'READY';\n");
  await ready;

  try {
    const result = await buildArchive({ machineId: 'wal-source', archiveRoot: join(root, 'archive'), sources });
    const archivedDb = join(result.target, 'opencode.db');
    const { stdout } = await execFileAsync('sqlite3', [archivedDb, 'SELECT count(*), journal_mode FROM sessions, pragma_journal_mode;']);
    assert.equal(stdout.trim(), '3|delete');
    await execFileAsync('sqlite3', ['-readonly', archivedDb, 'SELECT count(*) FROM sessions;']);
    await assert.rejects(access(`${archivedDb}-wal`));
    await assert.rejects(access(`${archivedDb}-shm`));
  } finally {
    sqlite.stdin.end('.exit\n');
  }
});
