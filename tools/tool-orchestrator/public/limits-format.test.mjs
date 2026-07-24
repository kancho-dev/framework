import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReset, gaugeLevel, isStale, limitReasonText, remainingFor } from './limits-format.js';

const NOW = Date.parse('2026-07-24T20:00:00.000Z');

test('reads a remaining percent only from an ok provider', () => {
  assert.equal(remainingFor({ status: 'ok', remainingPercent: 62 }), 62);
  assert.equal(remainingFor({ status: 'ok', remainingPercent: 0 }), 0);
  assert.equal(remainingFor({ status: 'unavailable', remainingPercent: null }), null);
  assert.equal(remainingFor({ status: 'unavailable', remainingPercent: 62 }), null);
  assert.equal(remainingFor(null), null);
});

test('grades urgency by remaining percent and keeps unknown distinct from empty', () => {
  assert.equal(gaugeLevel(80), 'ok');
  assert.equal(gaugeLevel(26), 'ok');
  assert.equal(gaugeLevel(25), 'low');
  assert.equal(gaugeLevel(11), 'low');
  assert.equal(gaugeLevel(10), 'critical');
  assert.equal(gaugeLevel(0), 'critical');
  assert.equal(gaugeLevel(null), 'unknown');
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
  assert.equal(limitReasonText('something-unmapped'), 'no available source');
  assert.equal(limitReasonText(undefined), 'no available source');
});

test('marks data stale after the refresh interval lapses or a refresh fails', () => {
  const data = { refreshIntervalMs: 300_000, providers: [] };
  assert.equal(isStale({ data, failed: false, fetchedAt: NOW - 60_000 }, NOW), false);
  assert.equal(isStale({ data, failed: false, fetchedAt: NOW - 600_000 }, NOW), true);
  assert.equal(isStale({ data, failed: true, fetchedAt: NOW }, NOW), true);
  assert.equal(isStale({ data: null, failed: true, fetchedAt: 0 }, NOW), false);
});
