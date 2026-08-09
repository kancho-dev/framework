import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDerivationCache, DERIVATION_CACHE_DIRNAME } from './derivation-cache.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tokens-derivation-cache-'));
  t.after(async () => (await import('node:fs/promises')).rm(root, { recursive: true, force: true }));
  const source = join(root, 'session.jsonl');
  await writeFile(source, 'first');
  return { root, source };
}

function cache(root, overrides = {}) {
  return createDerivationCache({ outDir: root, generatorVersion: '1', pricingFingerprint: 'price-a', ...overrides });
}

async function derive(deriveFile, source, value, calls) {
  return deriveFile({ source: 'pi', path: source, derive: async () => { calls.count += 1; return [{ value }]; }, nativeIdOf: () => 'native-1', restoreNativeId: (record, id) => { record.restoredId = id; } });
}

test('reuses an unchanged file shard and restores out-of-band native identity', async (t) => {
  const { root, source } = await fixture(t);
  const calls = { count: 0 };
  await derive(cache(root), source, 'cold', calls);
  const warm = await derive(cache(root), source, 'ignored', calls);
  assert.equal(calls.count, 1);
  assert.equal(warm.reused, true);
  assert.deepEqual(warm.records, [{ value: 'cold', restoredId: 'native-1' }]);
});

test('source, pricing, and generator changes each invalidate the shard', async (t) => {
  const { root, source } = await fixture(t);
  const calls = { count: 0 };
  await derive(cache(root), source, 'initial', calls);
  await writeFile(source, 'changed-size');
  assert.equal((await derive(cache(root), source, 'source-change', calls)).records[0].value, 'source-change');
  assert.equal((await derive(cache(root, { pricingFingerprint: 'price-b' }), source, 'pricing-change', calls)).records[0].value, 'pricing-change');
  assert.equal((await derive(cache(root, { generatorVersion: '2', pricingFingerprint: 'price-b' }), source, 'schema-change', calls)).records[0].value, 'schema-change');
  assert.equal(calls.count, 4);
});

test('watermark and attribution-context changes invalidate non-file shards', async (t) => {
  const { root, source } = await fixture(t);
  const calls = { count: 0 };
  const first = cache(root, { contextFingerprint: 'scope-a' });
  await first({ source: 'opencode', path: source, changeSignal: '10', derive: async () => { calls.count += 1; return [{ value: 'initial' }]; }, nativeIdOf: () => null, restoreNativeId: () => {} });
  const warm = await first({ source: 'opencode', path: source, changeSignal: '10', derive: async () => { calls.count += 1; return [{ value: 'ignored' }]; }, nativeIdOf: () => null, restoreNativeId: () => {} });
  assert.equal(warm.reused, true);
  const moved = await first({ source: 'opencode', path: source, changeSignal: '11', derive: async () => { calls.count += 1; return [{ value: 'watermark' }]; }, nativeIdOf: () => null, restoreNativeId: () => {} });
  assert.equal(moved.records[0].value, 'watermark');
  const rescoped = cache(root, { contextFingerprint: 'scope-b' });
  assert.equal((await rescoped({ source: 'opencode', path: source, changeSignal: '11', derive: async () => { calls.count += 1; return [{ value: 'rescoped' }]; }, nativeIdOf: () => null, restoreNativeId: () => {} })).records[0].value, 'rescoped');
  assert.equal(calls.count, 3);
});

test('a corrupt shard falls back to derivation and self-heals', async (t) => {
  const { root, source } = await fixture(t);
  const calls = { count: 0 };
  await derive(cache(root), source, 'initial', calls);
  const shardDir = join(root, DERIVATION_CACHE_DIRNAME, 'pi');
  const [name] = await readdir(shardDir);
  await writeFile(join(shardDir, name), '{broken');
  assert.equal((await derive(cache(root), source, 'healed', calls)).records[0].value, 'healed');
  JSON.parse(await readFile(join(shardDir, name), 'utf8'));
});

test('an unchanged warm run does not rewrite its shard', async (t) => {
  const { root, source } = await fixture(t);
  const calls = { count: 0 };
  await derive(cache(root), source, 'initial', calls);
  const shardDir = join(root, DERIVATION_CACHE_DIRNAME, 'pi');
  const [name] = await readdir(shardDir);
  const before = (await stat(join(shardDir, name))).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await derive(cache(root), source, 'ignored', calls);
  assert.equal((await stat(join(shardDir, name))).mtimeMs, before);
});
