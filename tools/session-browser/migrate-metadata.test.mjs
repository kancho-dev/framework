import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLegacyResolver } from './migrate-metadata.mjs';

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-metadata-remap-'));
  const livePi = join(root, 'live-pi');
  const archivePi = join(root, 'archive-pi');
  const archiveCodex = join(root, 'archive-codex');
  const liveCodex = join(root, 'live-codex');
  await Promise.all([livePi, archivePi, archiveCodex, liveCodex].map((path) => mkdir(path, { recursive: true })));
  return { root, livePi, archivePi, archiveCodex, liveCodex };
}

test('pi remap protects a session that still resolves in the live store', async () => {
  const paths = await fixture();
  const name = 'session.jsonl';
  await writeFile(join(paths.livePi, name), '{}\n');
  await writeFile(join(paths.archivePi, name), '{}\n');
  const resolver = await createLegacyResolver({
    id: 'old-machine',
    roots: { pi: paths.archivePi },
    originalRoots: { pi: paths.livePi },
  }, { liveRoots: { codex: join(paths.root, 'none'), 'claude-code': join(paths.root, 'none'), opencode: join(paths.root, 'none.db') } });
  assert.deepEqual(await resolver(`pi:${join(paths.livePi, name)}`), { reason: 'session still resolves in the current live store' });
});

test('id remap requires an archive match and protects an id still in the live store', async () => {
  const paths = await fixture();
  await writeFile(join(paths.archiveCodex, 'same-id.jsonl'), '{}\n');
  await writeFile(join(paths.liveCodex, 'same-id.jsonl'), '{}\n');
  await writeFile(join(paths.archiveCodex, 'archived-only.jsonl'), '{}\n');
  const resolver = await createLegacyResolver({
    id: 'old-machine',
    roots: { codex: paths.archiveCodex },
    originalRoots: {},
  }, { liveRoots: { codex: paths.liveCodex, 'claude-code': join(paths.root, 'none'), opencode: join(paths.root, 'none.db') } });
  assert.deepEqual(await resolver('codex:same-id'), { reason: 'session still resolves in the current live store' });
  assert.equal(await resolver('codex:archived-only'), 'codex@old-machine:archived-only');
  assert.deepEqual(await resolver('codex:missing'), { reason: 'archived session not found' });
});

test('apply rewrites atomically after creating a timestamped backup', async () => {
  const paths = await fixture();
  const oldRoot = join(paths.root, 'retired-pi');
  const metadataPath = join(paths.root, 'metadata.json');
  const machinesPath = join(paths.root, 'machines.json');
  await writeFile(join(paths.archivePi, 'archived.jsonl'), '{}\n');
  const original = { version: 3, sessions: { [`pi:${join(oldRoot, 'archived.jsonl')}`]: { bookmarked: true, tags: ['old'], savedTopics: {} } } };
  await writeFile(metadataPath, `${JSON.stringify(original)}\n`);
  await writeFile(machinesPath, JSON.stringify({ version: 1, machines: [{
    id: 'retired', roots: { pi: paths.archivePi }, originalRoots: { pi: oldRoot }, pathMap: [],
  }] }));

  await execFileAsync(process.execPath, ['migrate-metadata.mjs', '--remap-machine', 'retired', '--machines', machinesPath, '--apply'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, SESSION_BROWSER_METADATA: metadataPath, WORKSPACE_ROOT: paths.root },
  });

  const rewritten = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(rewritten.sessions[`pi@retired:${join(paths.archivePi, 'archived.jsonl')}`].bookmarked, true);
  const backups = (await readdir(paths.root)).filter((name) => name.startsWith('metadata.json.backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(paths.root, backups[0]), 'utf8')), original);
});
