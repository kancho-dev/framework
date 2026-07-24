import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeGauge, codexGauge, selectCodexWeeklyWindow, subscriptionLimits, WEEKLY_WINDOW_MINS } from './subscription-limits.mjs';

const ASOF = '2026-07-24T20:00:00.000Z';
const RESET_SECONDS = 1_784_000_000;

function codexResponse(windows) {
  return { rateLimits: windows };
}

test('selects the weekly Codex window by duration, not by primary position', () => {
  const response = codexResponse({
    primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: RESET_SECONDS },
    secondary: { usedPercent: 25, windowDurationMins: WEEKLY_WINDOW_MINS, resetsAt: RESET_SECONDS },
  });
  assert.equal(selectCodexWeeklyWindow(response).usedPercent, 25);
  assert.equal(codexGauge(response, ASOF).remainingPercent, 75);
});

test('falls back to per-limit-id Codex snapshots when the default snapshot has no weekly window', () => {
  const response = {
    rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } },
    rateLimitsByLimitId: { codex: { primary: { usedPercent: 40, windowDurationMins: WEEKLY_WINDOW_MINS } } },
  };
  assert.equal(codexGauge(response, ASOF).remainingPercent, 60);
});

test('reports Codex unavailable when no weekly window is present or usable', () => {
  const missing = codexResponse({ primary: { usedPercent: 10, windowDurationMins: 300 } });
  assert.deepEqual(
    [codexGauge(missing, ASOF).status, codexGauge(missing, ASOF).reason],
    ['unavailable', 'no-weekly-window'],
  );
  const nullWindow = codexResponse({ primary: null, secondary: null });
  assert.equal(codexGauge(nullWindow, ASOF).status, 'unavailable');
  assert.equal(codexGauge(null, ASOF).reason, 'no-data');
  const nullPercent = codexResponse({ primary: { usedPercent: null, windowDurationMins: WEEKLY_WINDOW_MINS } });
  assert.equal(codexGauge(nullPercent, ASOF).status, 'unavailable');
});

test('never reports a null Codex window as fully remaining', () => {
  assert.notEqual(codexGauge(codexResponse({}), ASOF).remainingPercent, 100);
  assert.equal(codexGauge(codexResponse({}), ASOF).remainingPercent, null);
});

test('converts Codex reset seconds to ISO and omits absent resets', () => {
  const withReset = codexResponse({ primary: { usedPercent: 5, windowDurationMins: WEEKLY_WINDOW_MINS, resetsAt: RESET_SECONDS } });
  assert.equal(codexGauge(withReset, ASOF).resetsAt, new Date(RESET_SECONDS * 1000).toISOString());
  const withoutReset = codexResponse({ primary: { usedPercent: 5, windowDurationMins: WEEKLY_WINDOW_MINS, resetsAt: null } });
  assert.equal(codexGauge(withoutReset, ASOF).resetsAt, null);
});

test('reads the Claude seven-day window and keeps provider-reported provenance', () => {
  const usage = {
    five_hour: { utilization: 99, resets_at: '2026-07-24T22:00:00Z' },
    seven_day: { utilization: 62.4, resets_at: '2026-07-29T09:30:00Z' },
  };
  const result = claudeGauge(usage, ASOF);
  assert.equal(result.remainingPercent, 38);
  assert.equal(result.resetsAt, '2026-07-29T09:30:00.000Z');
  assert.equal(result.source, 'provider-reported');
  assert.equal(result.windowLabel, 'Weekly (7 day)');
});

test('reports Claude unavailable for missing, null, or unparsable weekly data', () => {
  assert.equal(claudeGauge({ five_hour: { utilization: 10 } }, ASOF).reason, 'no-weekly-window');
  assert.equal(claudeGauge({ seven_day: { utilization: null } }, ASOF).status, 'unavailable');
  assert.equal(claudeGauge(null, ASOF).reason, 'no-data');
  assert.equal(claudeGauge({ seven_day: { utilization: 20, resets_at: 'not-a-date' } }, ASOF).resetsAt, null);
});

test('clamps out-of-range utilization for display only', () => {
  assert.equal(claudeGauge({ seven_day: { utilization: 140 } }, ASOF).remainingPercent, 0);
  assert.equal(claudeGauge({ seven_day: { utilization: -20 } }, ASOF).remainingPercent, 100);
});

test('providers fail independently and carry a coarse reason', async () => {
  const summary = await subscriptionLimits({
    readCodex: async () => { throw new Error('codex-timeout'); },
    readClaude: async () => ({ seven_day: { utilization: 30, resets_at: '2026-07-29T09:30:00Z' } }),
    now: () => new Date(ASOF),
  });
  const [codex, claude] = summary.providers;
  assert.equal(codex.status, 'unavailable');
  assert.equal(codex.reason, 'codex-timeout');
  assert.equal(claude.status, 'ok');
  assert.equal(claude.remainingPercent, 70);
  assert.equal(summary.asOf, ASOF);
});

test('reduces unknown failures to a coarse reason without leaking provider detail', async () => {
  const summary = await subscriptionLimits({
    readCodex: async () => { throw new Error('Bearer sk-secret-token leaked in message'); },
    readClaude: async () => { throw new Error('claude-no-token'); },
    now: () => new Date(ASOF),
  });
  const serialized = JSON.stringify(summary);
  assert.equal(summary.providers[0].reason, 'unreadable');
  assert.equal(summary.providers[1].reason, 'claude-no-token');
  assert.ok(!serialized.includes('sk-secret-token'));
  assert.ok(!serialized.includes('Bearer'));
});

test('stamps every provider with the same as-of time so staleness is comparable', async () => {
  const summary = await subscriptionLimits({
    readCodex: async () => ({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: WEEKLY_WINDOW_MINS } } }),
    readClaude: async () => ({ seven_day: { utilization: 10 } }),
    now: () => new Date(ASOF),
  });
  assert.deepEqual(summary.providers.map((provider) => provider.asOf), [ASOF, ASOF]);
  assert.equal(summary.refreshIntervalMs, 300_000);
});
