import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  applyBrowserPatch,
  buildHistoryEvent,
  metadataChanges,
  metadataTemporaryPath,
  normalizeMetadata,
  normalizeTask,
  readMetadata,
  syncMetadataTasks,
  withMetadataLock,
  writeMetadata,
} from './metadata-helpers.mjs';

const execFileAsync = promisify(execFile);
const helpersPath = fileURLToPath(new URL('./metadata-helpers.mjs', import.meta.url));
const baseTask = { displayId: '#1', project: 'demo', slug: 'task', path: 'projects/demo/work/task' };

test('normalizeTask preserves allowed next actors and safely clears absent or invalid values', () => {
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'operator' }).nextActor, 'operator');
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'agent' }).nextActor, 'agent');
  assert.equal(normalizeTask({ ...baseTask }).nextActor, null);
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'builder' }).nextActor, null);
});

test('normalizeTask treats non-positive and non-integer order values as missing', () => {
  assert.equal(normalizeTask({ ...baseTask, order: 2 }).order, 2);
  for (const order of [0, -1, 1.5, Number.NaN]) assert.equal(normalizeTask({ ...baseTask, order }).order, null);
});

test('newly discovered planned tasks start at order one without changing existing tasks', () => {
  const metadata = { nextDisplayNumber: 2, tasks: {
    'demo/existing': { ...baseTask, slug: 'existing', status: 'planned', order: null },
  } };
  syncMetadataTasks(metadata, [
    { key: 'demo/existing', project: 'demo', slug: 'existing', path: 'projects/demo/work/existing' },
    { key: 'demo/new', project: 'demo', slug: 'new', path: 'projects/demo/work/new' },
  ]);
  assert.equal(metadata.tasks['demo/existing'].order, null);
  assert.equal(metadata.tasks['demo/new'].status, 'planned');
  assert.equal(metadata.tasks['demo/new'].order, 1);
});

test('stored metadata normalizes absent or older invalid nextActor values to null', () => {
  const metadata = normalizeMetadata({ tasks: { absent: {}, invalid: { nextActor: 'builder' }, valid: { nextActor: 'agent' } } });
  assert.equal(metadata.tasks.absent.nextActor, null);
  assert.equal(metadata.tasks.invalid.nextActor, null);
  assert.equal(metadata.tasks.valid.nextActor, 'agent');
});

test('browser patches set and clear nextActor and reject invalid values', () => {
  assert.equal(applyBrowserPatch({}, { nextActor: 'agent' }).nextActor, 'agent');
  assert.equal(applyBrowserPatch({ nextActor: 'agent' }, { nextActor: null }).nextActor, null);
  assert.equal(applyBrowserPatch({ nextActor: 'agent' }, { nextActor: '' }).nextActor, null);
  assert.throws(() => applyBrowserPatch({}, { nextActor: 'builder' }), (error) => error.statusCode === 400 && /nextActor/.test(error.message));
});

test('history records real nextActor changes but omits no-ops', () => {
  assert.deepEqual(metadataChanges({ nextActor: null }, { nextActor: 'operator' }).nextActor, { before: null, after: 'operator' });
  assert.equal(buildHistoryEvent({ key: 'demo/task', before: { nextActor: 'agent' }, after: { nextActor: 'agent' }, source: 'test', action: 'test' }), null);
  const event = buildHistoryEvent({ key: 'demo/task', before: { nextActor: 'agent' }, after: { nextActor: null }, source: 'test', action: 'test' });
  assert.deepEqual(event.changes.nextActor, { before: 'agent', after: null });
});

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'task-metadata-write-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('metadata writes use an exclusive per-write temporary path', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'tasks.json');
    const first = metadataTemporaryPath(target);
    const second = metadataTemporaryPath(target);
    assert.notEqual(first, second);
    assert.match(first, new RegExp(`\\.${process.pid}\\.[^.]+\\.tmp$`));
    await writeMetadata(target, { version: 1, tasks: {} });
    assert.deepEqual(await readdir(dir), ['tasks.json']);
  });
});

test('metadata lock recovers an abandoned owner and times out behind a live owner', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'tasks.json');
    const lockPath = `${target}.lock`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.abandoned.json'), JSON.stringify({ pid: 999_999_999, token: 'abandoned' }));
    assert.equal(await withMetadataLock(target, () => 'recovered'), 'recovered');

    let release;
    let acquired;
    const acquiredPromise = new Promise((resolve) => { acquired = resolve; });
    const held = withMetadataLock(target, () => new Promise((resolve) => { release = resolve; acquired(); }));
    await acquiredPromise;
    await assert.rejects(
      withMetadataLock(target, () => {}, { timeoutMs: 20, retryMs: 5 }),
      /Timed out waiting for metadata lock/,
    );
    release();
    await held;
  });
});

test('an abandoned-lock reclaimer cannot steal a live successor lock', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'tasks.json');
    const lockPath = `${target}.lock`;
    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.abandoned.json'), JSON.stringify({ pid: 999_999_999, token: 'abandoned' }));

    let continueReclaim;
    let reclaimObserved;
    let pauseReclaim = true;
    const reclaimPaused = new Promise((resolve) => { reclaimObserved = resolve; });
    let activeHolders = 0;
    let maximumHolders = 0;
    const enter = () => { activeHolders += 1; maximumHolders = Math.max(maximumHolders, activeHolders); };
    const leave = () => { activeHolders -= 1; };
    const staleReclaimer = withMetadataLock(target, () => { enter(); leave(); return 'stale-entered'; }, {
      retryMs: 5,
      beforeReclaim: () => {
        if (!pauseReclaim) return;
        pauseReclaim = false;
        return new Promise((resolve) => {
          continueReclaim = resolve;
          reclaimObserved();
        });
      },
    });
    await reclaimPaused;

    let releaseSuccessor;
    let successorEntered;
    const successorActive = new Promise((resolve) => { successorEntered = resolve; });
    const successor = withMetadataLock(target, () => new Promise((resolve) => {
      enter();
      releaseSuccessor = () => { leave(); resolve(); };
      successorEntered();
    }));
    await successorActive;
    continueReclaim();
    const fourthWriter = withMetadataLock(target, async () => { enter(); leave(); return 'fourth-entered'; });
    await new Promise((resolve) => setTimeout(resolve, 30));

    let staleSettled = false;
    let fourthSettled = false;
    staleReclaimer.finally(() => { staleSettled = true; });
    fourthWriter.finally(() => { fourthSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(staleSettled, false, 'stale reclaimer waits instead of entering beside the successor');
    assert.equal(fourthSettled, false, 'an additional writer also waits behind the successor');
    assert.equal(maximumHolders, 1);
    releaseSuccessor();
    await successor;
    assert.equal(await staleReclaimer, 'stale-entered');
    assert.equal(await fourthWriter, 'fourth-entered');
    assert.equal(maximumHolders, 1);
  });
});

test('two processes serialize metadata read-modify-write transactions without losing updates', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'tasks.json');
    const worker = join(dir, 'worker.mjs');
    await writeMetadata(target, { version: 1, nextDisplayNumber: 1, counter: 0, tasks: {} });
    await writeFile(worker, `
      import { readMetadata, withMetadataLock, writeMetadata } from ${JSON.stringify(helpersPath)};
      const target = process.argv[2];
      for (let index = 0; index < 25; index += 1) {
        await withMetadataLock(target, async () => {
          const metadata = await readMetadata(target);
          metadata.counter = (metadata.counter || 0) + 1;
          await new Promise((resolve) => setTimeout(resolve, 2));
          await writeMetadata(target, metadata);
        });
      }
    `);

    await Promise.all([
      execFileAsync(process.execPath, [worker, target]),
      execFileAsync(process.execPath, [worker, target]),
    ]);

    assert.equal((await readMetadata(target)).counter, 50);
    assert.deepEqual((await readdir(dir)).sort(), ['tasks.json', 'worker.mjs']);
  });
});
