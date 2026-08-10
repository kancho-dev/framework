import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSourcesConfig } from './sources-config.mjs';
import { MAX_REPORT_BYTES } from './source-fetch.mjs';
import { DEFAULT_REFRESH_MINUTES } from './sources-config.mjs';

async function outDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-sources-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('an absent sources.json yields the zero-config defaults', async (t) => {
  const dir = await outDir(t);
  assert.deepEqual(await loadSourcesConfig(dir), {
    configured: false, self: null, sources: [], staleReportAfterHours: 24, staleFetchAfterHours: 24, maxReportBytes: MAX_REPORT_BYTES,
    refreshAfterMinutes: DEFAULT_REFRESH_MINUTES, retryAfterMinutes: DEFAULT_REFRESH_MINUTES,
  });
});

test('refresh cadence is configurable, validated, and separate from the stale thresholds', async (t) => {
  const dir = await outDir(t);
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ sources: [] }));
  const defaults = await loadSourcesConfig(dir);
  assert.equal(defaults.refreshAfterMinutes, DEFAULT_REFRESH_MINUTES);
  assert.equal(defaults.retryAfterMinutes, DEFAULT_REFRESH_MINUTES);
  assert.equal(defaults.staleReportAfterHours, 24, 'cadence defaults never touch the staleness thresholds');

  // A machine that is off for weeks can back its retries off without slowing
  // successful refreshes, so the two cadences are independent.
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ refreshAfterMinutes: 2, retryAfterMinutes: 240 }));
  const config = await loadSourcesConfig(dir);
  assert.equal(config.refreshAfterMinutes, 2);
  assert.equal(config.retryAfterMinutes, 240);
  assert.equal(config.staleFetchAfterHours, 24);

  for (const bad of [0, -1, 'soon']) {
    await writeFile(join(dir, 'sources.json'), JSON.stringify({ refreshAfterMinutes: bad }));
    await assert.rejects(loadSourcesConfig(dir), /refreshAfterMinutes must be a positive number of minutes/);
  }
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ retryAfterMinutes: 0 }));
  await assert.rejects(loadSourcesConfig(dir), /retryAfterMinutes must be a positive number of minutes/);
});

test('the size cap is configurable and validated', async (t) => {
  const dir = await outDir(t);
  await writeFile(join(dir, 'sources.json'), JSON.stringify({ maxReportBytes: 1024 }));
  assert.equal((await loadSourcesConfig(dir)).maxReportBytes, 1024);

  await writeFile(join(dir, 'sources.json'), JSON.stringify({ maxReportBytes: 0 }));
  await assert.rejects(loadSourcesConfig(dir), /maxReportBytes must be a positive integer/);
});

test('a present config surfaces self, sources, and both stale thresholds', async (t) => {
  const dir = await outDir(t);
  await writeFile(join(dir, 'sources.json'), JSON.stringify({
    schemaVersion: 1,
    self: { machineId: 'workstation', root: '~' },
    staleReportAfterHours: 6,
    sources: [{ id: 'laptop', type: 'ssh' }],
  }));

  const config = await loadSourcesConfig(dir);
  assert.equal(config.configured, true);
  assert.equal(config.self.machineId, 'workstation');
  assert.equal(config.staleReportAfterHours, 6);
  assert.equal(config.staleFetchAfterHours, 24, 'each threshold defaults independently');
  assert.deepEqual(config.sources, [{ id: 'laptop', type: 'ssh' }]);
});

test('duplicate source ids fail fast', async (t) => {
  const dir = await outDir(t);
  await writeFile(join(dir, 'sources.json'), JSON.stringify({
    sources: [
      { id: 'laptop', type: 'ssh', host: 'laptop-a' },
      { id: 'laptop', type: 'ssh', host: 'laptop-b' },
    ],
  }));
  await assert.rejects(loadSourcesConfig(dir), /source ids must be unique/);
});

test('malformed configuration fails fast rather than being silently ignored', async (t) => {
  const dir = await outDir(t);
  const write = (value) => writeFile(join(dir, 'sources.json'), value);

  await write('{ not json');
  await assert.rejects(loadSourcesConfig(dir), /not valid JSON/);

  await write(JSON.stringify([]));
  await assert.rejects(loadSourcesConfig(dir), /must contain a JSON object/);

  await write(JSON.stringify({ schemaVersion: 99 }));
  await assert.rejects(loadSourcesConfig(dir), /schemaVersion 99 is not supported/);

  await write(JSON.stringify({ sources: {} }));
  await assert.rejects(loadSourcesConfig(dir), /sources must be an array/);

  await write(JSON.stringify({ staleFetchAfterHours: 0 }));
  await assert.rejects(loadSourcesConfig(dir), /staleFetchAfterHours must be a positive number/);
});
