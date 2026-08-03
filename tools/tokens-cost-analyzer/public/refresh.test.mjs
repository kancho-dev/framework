import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAutomaticRefresh } from './refresh.js';

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
