import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedRemainingFor, formatReset, gaugeLevel, isStale, limitReasonText, LIMITS_REFRESH_MS, remainingFor } from './limits-format.js';

const NOW = Date.parse('2026-07-24T20:00:00.000Z');

test('reads a remaining percent only from an ok provider', () => {
  assert.equal(remainingFor({ status: 'ok', remainingPercent: 62 }), 62);
  assert.equal(remainingFor({ status: 'ok', remainingPercent: 0 }), 0);
  assert.equal(remainingFor({ status: 'unavailable', remainingPercent: null }), null);
  assert.equal(remainingFor({ status: 'unavailable', remainingPercent: 62 }), null);
  assert.equal(remainingFor(null), null);
});

test('calculates the remaining quota expected at the current point in the window', () => {
  const provider = {
    status: 'ok',
    remainingPercent: 40,
    windowDurationMins: 7 * 24 * 60,
    resetsAt: new Date(NOW + 4 * 24 * 60 * 60_000).toISOString(),
  };
  assert.ok(Math.abs(expectedRemainingFor(provider, NOW) - 57.142857) < 0.000001);
  assert.equal(expectedRemainingFor({ ...provider, resetsAt: null }, NOW), null);
  assert.equal(expectedRemainingFor({ ...provider, status: 'unavailable' }, NOW), null);
  assert.equal(expectedRemainingFor({ ...provider, resetsAt: new Date(NOW - 1).toISOString() }, NOW), null);
});

test('grades usage against elapsed reset-window pace', () => {
  const provider = (remainingPercent, elapsedFraction, overrides = {}) => ({
    status: 'ok',
    remainingPercent,
    windowDurationMins: 100,
    resetsAt: new Date(NOW + (1 - elapsedFraction) * 100 * 60_000).toISOString(),
    ...overrides,
  });

  assert.equal(gaugeLevel(provider(65, 0.5), NOW), 'ok', 'the blue boundary itself remains green');
  assert.equal(gaugeLevel(provider(40, 0.5), NOW), 'low');
  assert.equal(gaugeLevel(provider(25, 0.5), NOW), 'critical');
  assert.equal(gaugeLevel(provider(90, 0.5), NOW), 'available');
  assert.equal(gaugeLevel(provider(99, 0.1), NOW), 'ok', 'blue waits until 20% of the window has elapsed');
  assert.equal(gaugeLevel(provider(99, 0.01), NOW), 'ok', 'early-window pace does not create noisy warnings');
});

test('applies absolute safeguards and falls back when window timing is unusable', () => {
  const provider = (remainingPercent, overrides = {}) => ({ status: 'ok', remainingPercent, windowDurationMins: 10080, resetsAt: null, ...overrides });
  assert.equal(gaugeLevel(provider(15, { resetsAt: new Date(NOW + 60_000).toISOString() }), NOW), 'low');
  assert.equal(gaugeLevel(provider(5, { resetsAt: new Date(NOW + 60_000).toISOString() }), NOW), 'critical');
  assert.equal(gaugeLevel(provider(25), NOW), 'low');
  assert.equal(gaugeLevel(provider(10), NOW), 'critical');
  assert.equal(gaugeLevel(provider(80), NOW), 'ok');
  assert.equal(gaugeLevel({ status: 'unavailable', remainingPercent: null }, NOW), 'unknown');
});

test('formats reset distance and degrades unusable values to text, never silence', () => {
  assert.equal(formatReset('2026-07-27T00:00:00.000Z', NOW), 'in 2d 4h');
  assert.equal(formatReset('2026-07-24T23:30:00.000Z', NOW), 'in 3h 30m');
  assert.equal(formatReset('2026-07-24T19:00:00.000Z', NOW), 'now');
  assert.equal(formatReset(null, NOW), 'unknown');
  assert.equal(formatReset('not-a-date', NOW), 'unknown');
});

test('explains every coarse unavailable reason without echoing provider detail', () => {
  assert.equal(limitReasonText('claude-no-token'), 'Claude Code sign-in not found');
  assert.equal(limitReasonText('codex-timeout'), 'provider timed out');
  assert.equal(limitReasonText('no-weekly-window'), 'no weekly window reported');
  assert.equal(limitReasonText('no-five-hour-window'), 'no 5 hour window reported');
  assert.equal(limitReasonText('something-unmapped'), 'no available source');
  assert.equal(limitReasonText(undefined), 'no available source');
});

test('marks data stale after 1.5 refresh intervals or when a refresh fails', () => {
  const data = { refreshIntervalMs: 600_000, providers: [] };
  assert.equal(LIMITS_REFRESH_MS, 600_000);
  assert.equal(isStale({ data, failed: false, fetchedAt: NOW - 899_999 }, NOW), false);
  assert.equal(isStale({ data, failed: false, fetchedAt: NOW - 900_001 }, NOW), true);
  assert.equal(isStale({ data, failed: true, fetchedAt: NOW }, NOW), true);
  assert.equal(isStale({ data: null, failed: true, fetchedAt: 0 }, NOW), false);
});
