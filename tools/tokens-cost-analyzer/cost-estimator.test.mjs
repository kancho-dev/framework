import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCost } from './cost-estimator.mjs';

const base = { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 };
const price = {
  ...base,
  tiers: [{ inputTokensAbove: 272_000, input: 2, output: 9, cacheRead: 0.2, cacheWrite: 2.5 }],
};

function tokens(input, output = 1_000, cacheRead = 0, cacheWrite = 0) {
  return Object.fromEntries(Object.entries({ input, output, cacheRead, cacheWrite })
    .map(([field, value]) => [field, { value, class: value == null ? 'unknown' : 'recorded' }]));
}

test('uses base rates below and exactly at the tier threshold', () => {
  assert.equal(estimateCost(tokens(271_000), price).cost, 0.277);
  assert.equal(estimateCost(tokens(272_000), price).cost, 0.278);
});

test('reprices the entire request above the threshold', () => {
  const result = estimateCost(tokens(272_001, 1_000), price);
  assert.deepEqual(result, { cost: 0.553002, class: 'estimated', warnings: [] });
});

test('includes cache reads and writes when selecting a tier', () => {
  const result = estimateCost(tokens(200_000, 1_000, 70_000, 2_001), price);
  assert.equal(result.cost, 0.428003);
  assert.equal(result.class, 'estimated');
});

test('selects the highest matching tier regardless of order', () => {
  const multiTier = {
    ...base,
    tiers: [
      { inputTokensAbove: 500_000, input: 3, output: 12, cacheRead: 0.3, cacheWrite: 3.75 },
      price.tiers[0],
    ],
  };
  assert.equal(estimateCost(tokens(600_000), multiTier).cost, 1.812);
});

test('uses base rates and warns for malformed tiers', () => {
  const malformed = { ...price, tiers: [{ ...price.tiers[0], output: -1 }] };
  const result = estimateCost(tokens(300_000), malformed);
  assert.equal(result.cost, 0.306);
  assert.equal(result.class, 'estimated-partial');
  assert.deepEqual(result.warnings, ['unsupported tiered pricing; estimate uses base rates']);
});

test('treats an adapter-omitted threshold field as zero', () => {
  const result = estimateCost(tokens(500_000, 2_000, 100_000, null), price, { omittedTokenWarnings: ['cacheWrite'] });
  assert.deepEqual(result, { cost: 1.038, class: 'estimated', warnings: [] });
});

test('uses base rates and warns when a threshold field is genuinely unknown', () => {
  const result = estimateCost(tokens(null, 1_000, 300_000), price);
  assert.equal(result.cost, 0.036);
  assert.deepEqual(result.warnings, ['unknown tier threshold tokens; estimate uses base rates', 'unknown input tokens']);
});
