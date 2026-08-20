import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSingleFlight, createSummaryCache, RACY_WINDOW_MS } from './summary-cache.mjs';

const dir = await mkdtemp(join(tmpdir(), 'summary-cache-'));
const file = (name) => join(dir, name);

// Both directions of the freshness contract are pinned by controlling mtime
// rather than by hoping the filesystem clock moves between adjacent writes.
const settle = (path) => utimes(path, new Date(), new Date(Date.now() - 60_000));
const touchNow = (path) => utimes(path, new Date(), new Date());

test('unchanged settled files are summarized once', async () => {
  const path = file('stable.jsonl');
  await writeFile(path, 'one\n');
  await settle(path);
  const cache = createSummaryCache();
  let loads = 0;
  const load = async (target) => { loads += 1; return { path: target }; };

  assert.deepEqual(await cache.summarize(path, load), { path });
  assert.deepEqual(await cache.summarize(path, load), { path });
  assert.equal(loads, 1);
});

test('the same file can cache summaries under distinct provenance', async () => {
  const cache = createSummaryCache();
  const path = file('provenance.jsonl');
  await writeFile(path, 'one\n');
  await settle(path);
  let liveLoads = 0;
  let archiveLoads = 0;

  assert.equal(await cache.summarize(path, async () => `live-${++liveLoads}`, { provenance: 'live' }), 'live-1');
  assert.equal(await cache.summarize(path, async () => `archive-${++archiveLoads}`, { provenance: 'archive' }), 'archive-1');
  assert.equal(await cache.summarize(path, async () => `live-${++liveLoads}`, { provenance: 'live' }), 'live-1');
  assert.equal(await cache.summarize(path, async () => `archive-${++archiveLoads}`, { provenance: 'archive' }), 'archive-1');
});

test('changed content invalidates the cached summary', async () => {
  const path = file('changing.jsonl');
  await writeFile(path, 'first\n');
  await settle(path);
  const cache = createSummaryCache();
  const load = async (target) => ({ content: await readFile(target, 'utf8') });

  const before = await cache.summarize(path, load);
  await writeFile(path, 'second\n');
  await settle(path);
  const after = await cache.summarize(path, load);

  assert.equal(before.content, 'first\n');
  assert.equal(after.content, 'second\n');
});

test('a same-size rewrite inside the race window is still detected', async () => {
  const path = file('same-size.jsonl');
  await writeFile(path, 'aaaa\n');
  await touchNow(path);
  const cache = createSummaryCache();
  let loads = 0;
  const load = async (target) => { loads += 1; return readFile(target, 'utf8'); };

  assert.equal(await cache.summarize(path, load), 'aaaa\n');
  await writeFile(path, 'bbbb\n');
  await touchNow(path);
  assert.equal(await cache.summarize(path, load), 'bbbb\n');
  assert.equal(loads, 2);
});

test('a file that stops changing becomes cacheable again', async () => {
  const path = file('settling.jsonl');
  await writeFile(path, 'live\n');
  await touchNow(path);
  const cache = createSummaryCache();
  let loads = 0;
  const load = async () => { loads += 1; return loads; };

  await cache.summarize(path, load);
  await settle(path);
  await cache.summarize(path, load);
  await cache.summarize(path, load);

  assert.equal(loads, 2);
});

test('the race window is wide enough to cover coarse timestamp granularity', () => {
  assert.ok(RACY_WINDOW_MS >= 10);
});

test('pruning drops files that no longer exist', async () => {
  const kept = file('kept.jsonl');
  const gone = file('gone.jsonl');
  await writeFile(kept, 'k\n');
  await writeFile(gone, 'g\n');
  const cache = createSummaryCache();
  const load = async (target) => target;

  await cache.summarize(kept, load);
  await cache.summarize(gone, load);
  assert.equal(cache.size, 2);

  cache.prune([kept]);
  assert.equal(cache.size, 1);
});

test('a failed load is not cached', async () => {
  const path = file('broken.jsonl');
  await writeFile(path, 'x\n');
  const cache = createSummaryCache();
  let calls = 0;
  const load = async () => { calls += 1; throw new Error('unreadable'); };

  await assert.rejects(cache.summarize(path, load));
  await assert.rejects(cache.summarize(path, load));
  assert.equal(calls, 2);
  assert.equal(cache.size, 0);
});

test('overlapping callers share one in-flight run', async () => {
  const singleFlight = createSingleFlight();
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const work = async () => { runs += 1; await gate; return runs; };

  const first = singleFlight('scan', work);
  const second = singleFlight('scan', work);
  release();

  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(runs, 1);
});

test('a later call runs again once the previous one settled', async () => {
  const singleFlight = createSingleFlight();
  let runs = 0;
  const work = async () => { runs += 1; return runs; };

  assert.equal(await singleFlight('scan', work), 1);
  assert.equal(await singleFlight('scan', work), 2);
});

test('a rejected run does not poison the key', async () => {
  const singleFlight = createSingleFlight();
  await assert.rejects(singleFlight('scan', async () => { throw new Error('failed'); }));
  assert.equal(await singleFlight('scan', async () => 'recovered'), 'recovered');
});

test('different keys do not share a run', async () => {
  const singleFlight = createSingleFlight();
  let runs = 0;
  const work = async () => { runs += 1; return runs; };

  await Promise.all([singleFlight('a', work), singleFlight('b', work)]);
  assert.equal(runs, 2);
});
