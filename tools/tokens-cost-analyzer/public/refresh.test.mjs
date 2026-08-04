import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportRequestUrl, startAutomaticRefresh } from './refresh.js';

test('report request marks only manual refreshes as manual', () => {
  assert.equal(reportRequestUrl('?workspace=main', { force: true, reason: 'manual' }), 'api/report?workspace=main&refresh=1&manual=1');
  assert.equal(reportRequestUrl('?workspace=main', { force: true, reason: 'poll' }), 'api/report?workspace=main&refresh=1');
  assert.equal(reportRequestUrl('?workspace=main', { reason: 'initial' }), 'api/report?workspace=main');
});

test('automatic refresh forces report analysis on each poll', () => {
  const requests = [];
  let scheduled;
  let scheduledInterval;
  const refresh = { request: (options) => requests.push(options) };
  const setIntervalFn = (callback, intervalMs) => {
    scheduled = callback;
    scheduledInterval = intervalMs;
    return 42;
  };

  const timer = startAutomaticRefresh(refresh, 10 * 60 * 1000, setIntervalFn);
  scheduled();

  assert.equal(timer, 42);
  assert.equal(scheduledInterval, 10 * 60 * 1000);
  assert.deepEqual(requests, [{ reason: 'poll', force: true }]);
});
