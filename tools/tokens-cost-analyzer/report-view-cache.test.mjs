import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReportViewCache } from './report-view-cache.mjs';

async function artifact(t, contents) {
  const root = await mkdtemp(join(tmpdir(), 'tokens-view-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'report.v1.json');
  await writeFile(path, JSON.stringify(contents));
  return path;
}

// The whole point of the cache: a second read of an unchanged artifact must not
// touch the 100 MB file again.
test('reuses the built view while the artifact is unchanged', async (t) => {
  const path = await artifact(t, { records: [{ id: 'a' }] });
  let builds = 0;
  const read = createReportViewCache();
  const build = (report) => { builds += 1; return { count: report.records.length }; };

  const first = await read(path, build);
  const second = await read(path, build);

  assert.deepEqual(first, { count: 1 });
  assert.equal(second, first, 'the cached view is returned by identity');
  assert.equal(builds, 1);
});

test('rebuilds when the artifact is rewritten', async (t) => {
  const path = await artifact(t, { records: [{ id: 'a' }] });
  const read = createReportViewCache();
  const build = (report) => ({ count: report.records.length });

  assert.deepEqual(await read(path, build), { count: 1 });
  await new Promise((done) => setTimeout(done, 10));
  await writeFile(path, JSON.stringify({ records: [{ id: 'a' }, { id: 'b' }] }));

  assert.deepEqual(await read(path, build), { count: 2 });
});

// A same-size rewrite within the same mtime tick would otherwise be invisible.
// The post-read stat check refuses to cache a view it cannot prove is settled.
test('does not cache a view read while the artifact was changing', async (t) => {
  const path = await artifact(t, { records: [{ id: 'a' }] });
  let builds = 0;
  const statImpl = async () => ({ mtimeMs: builds === 0 ? 1 : 2, size: 10 });
  const read = createReportViewCache({ statImpl });
  const build = (report) => { builds += 1; return { count: report.records.length }; };

  await read(path, build);
  await read(path, build);

  assert.equal(builds, 2, 'an unsettled read is used once, never cached');
});

test('does not serve one artifact view for a different path', async (t) => {
  const first = await artifact(t, { records: [{ id: 'a' }] });
  const second = await artifact(t, { records: [{ id: 'a' }, { id: 'b' }] });
  const read = createReportViewCache();
  const build = (report) => ({ count: report.records.length });

  assert.deepEqual(await read(first, build), { count: 1 });
  assert.deepEqual(await read(second, build), { count: 2 });
});
