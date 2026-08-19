import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDerivationCache } from './derivation-cache.mjs';
import { COST_ESTIMATOR_VERSION } from './cost-estimator.mjs';
import { DERIVATION_SEMANTICS_VERSION, derivationContextFingerprint } from './derivation-semantics.mjs';

const scopes = [{ id: 'framework', root: '/w/fw' }];

// The defect this guards: before `derivationSemanticsVersion` participated, an adapter change with
// no package-version bump produced an identical fingerprint, so every warm shard survived it.
// Verified to fail against the pre-fix composition, as does the staleness test below.
test('the semantics version participates in the context fingerprint', () => {
  const base = derivationContextFingerprint({ scopes });
  assert.notEqual(base, derivationContextFingerprint({ scopes, derivationSemanticsVersion: DERIVATION_SEMANTICS_VERSION + 1 }));
  assert.notEqual(base, derivationContextFingerprint({ scopes, costEstimatorVersion: COST_ESTIMATOR_VERSION + 1 }));
  assert.equal(base, derivationContextFingerprint({ scopes }), 'composition is deterministic');
  assert.notEqual(base, derivationContextFingerprint({ scopes: [{ id: 'other', root: '/w/o' }] }), 'scopes still participate');
});

async function shardFixture(t) {
  const outDir = await mkdtemp(join(tmpdir(), 'derivation-semantics-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const path = join(outDir, 'session.jsonl');
  await writeFile(path, '{"one":1}');
  return { outDir, path };
}

function cacheFor(outDir, derivationSemanticsVersion) {
  return createDerivationCache({
    outDir,
    generatorVersion: '1.0.0',
    pricingFingerprint: 'sha256:pricing',
    contextFingerprint: derivationContextFingerprint({ scopes, derivationSemanticsVersion }),
  });
}

const derived = (value) => ({
  derive: async () => [{ cost: value }],
  nativeIdOf: () => 'native-1',
  restoreNativeId: (record, id) => { record.nativeId = id; },
});

// ENGINEERING rule 6: this fails against pre-fix code. Before the change the semantics version was
// absent from the fingerprint, both calls composed the same context, and the second call reused the
// stale shard — returning `reused: true` with the OLD value, which is the silent staleness itself.
test('changing derivation semantics invalidates a warm shard rather than serving stale records', async (t) => {
  const { outDir, path } = await shardFixture(t);

  const first = await cacheFor(outDir, DERIVATION_SEMANTICS_VERSION)({ source: 'pi', path, ...derived('old') });
  assert.equal(first.reused, false, 'a cold shard is derived');
  assert.deepEqual(first.records, [{ cost: 'old' }]);

  const afterChange = await cacheFor(outDir, DERIVATION_SEMANTICS_VERSION + 1)({ source: 'pi', path, ...derived('new') });
  assert.equal(afterChange.reused, false, 'the shard must miss once derivation semantics change');
  assert.deepEqual(afterChange.records, [{ cost: 'new' }], 'the new semantics produce the new value');
});

// The fix must not turn the cache off — that would trade silent staleness for a permanent
// re-derivation on every run.
test('an unchanged semantics version still reuses a warm shard', async (t) => {
  const { outDir, path } = await shardFixture(t);

  await cacheFor(outDir, DERIVATION_SEMANTICS_VERSION)({ source: 'pi', path, ...derived('old') });
  const again = await cacheFor(outDir, DERIVATION_SEMANTICS_VERSION)({
    source: 'pi',
    path,
    ...derived('must-not-run'),
    derive: async () => assert.fail('derive must not run for a matching shard'),
  });

  assert.equal(again.reused, true);
  // The cached value is served, with the native id restored onto it as the cache contract requires.
  assert.deepEqual(again.records, [{ cost: 'old', nativeId: 'native-1' }]);
});
