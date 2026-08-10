import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshStatus, reportRequestUrl, startAutomaticRefresh, statusRequestUrl } from './refresh.js';

test('report request marks only manual refreshes as manual', () => {
  assert.equal(reportRequestUrl('?workspace=main', { force: true, reason: 'manual' }), 'api/report?workspace=main&refresh=1&manual=1');
  assert.equal(reportRequestUrl('?workspace=main', { force: true, reason: 'poll' }), 'api/report?workspace=main&refresh=1');
  assert.equal(reportRequestUrl('?workspace=main', { reason: 'initial' }), 'api/report?workspace=main');
});

test('terminal refresh phases clear transient status text', () => {
  assert.deepEqual(refreshStatus('loading'), { visible: true, text: 'Loading analysis…' });
  assert.deepEqual(refreshStatus('refreshing'), { visible: true, text: 'Refreshing…' });
  assert.deepEqual(refreshStatus('committed'), { visible: false, text: '' });
  assert.deepEqual(refreshStatus('update-ready'), { visible: false, text: '' });
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

// A status URL that could carry `refresh` would turn a polling tab into
// a fetch loop against every configured machine.
test('the status request carries the workspace and can never force a refresh', () => {
  assert.equal(statusRequestUrl('?workspace=main'), 'api/sources/status?workspace=main');
  assert.equal(statusRequestUrl(''), 'api/sources/status');
  assert.equal(statusRequestUrl('?workspace=main&refresh=1&manual=1'), 'api/sources/status?workspace=main');
});
