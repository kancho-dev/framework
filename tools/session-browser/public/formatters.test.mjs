import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTokens, formatTotalTokensMillions } from './token-formatting.js';

test('formats valid token totals in millions with stable precision', () => {
  assert.equal(formatTotalTokensMillions(0), 'Total 0.00M');
  assert.equal(formatTotalTokensMillions(500_000), 'Total 0.50M');
  assert.equal(formatTotalTokensMillions(1_234_567), 'Total 1.23M');
  assert.equal(formatTotalTokensMillions(12_345_678), 'Total 12.35M');
});

test('omits absent or invalid token totals', () => {
  for (const value of [undefined, null, '', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatTotalTokensMillions(value), '');
  }
});

test('keeps the existing breakdown and appends a labeled total', () => {
  assert.equal(
    formatTokens({ input: 1_200, output: 340, cacheRead: 5_600, total: 7_140 }),
    '↓1k ↑340 R6k · Total 0.01M',
  );
  assert.equal(formatTokens({ input: 1_200, output: 340, cacheRead: 5_600 }), '↓1k ↑340 R6k');
});
