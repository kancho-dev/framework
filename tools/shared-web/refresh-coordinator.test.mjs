import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshCoordinator } from './refresh-coordinator.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function coordinator(options = {}) {
  const commits = [];
  const statuses = [];
  const refresh = createRefreshCoordinator({
    fetchData: options.fetchData ?? (async () => ({ ok: true })),
    getIdentity: options.getIdentity,
    onStatus: (value) => statuses.push(value),
  });
  refresh.registerCommitUnit({ key: 'main', commit: async (value) => commits.push(value), ...options.unit });
  return { refresh, commits, statuses };
}

test('only the newest request may commit', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { refresh, commits } = coordinator({ fetchData: () => (++calls === 1 ? first.promise : second.promise) });

  const oldRequest = refresh.request({ reason: 'manual' });
  const newRequest = refresh.request({ reason: 'focus' });
  first.resolve('old');
  second.resolve('new');
  await Promise.all([oldRequest, newRequest]);

  assert.deepEqual(commits.map(({ data, reason }) => [data, reason]), [['new', 'focus']]);
});

test('timer ticks coalesce while a fetch is running and await the queued poll', async () => {
  const first = deferred();
  const poll = deferred();
  let calls = 0;
  const { refresh } = coordinator({ fetchData: async () => (++calls === 1 ? first.promise : poll.promise) });

  const running = refresh.request({ reason: 'manual' });
  const coalesced = refresh.request({ reason: 'poll' });
  assert.notEqual(coalesced, running);
  assert.equal(refresh.request({ reason: 'poll' }), coalesced);
  first.resolve('first');
  await running;
  assert.equal(calls, 2);

  let pollSettled = false;
  coalesced.then(() => { pollSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pollSettled, false);
  poll.resolve('poll');
  await coalesced;
  assert.equal(pollSettled, true);
});

test('a superseded request cannot release a poll over a newer manual refresh', async () => {
  const first = deferred();
  const manual = deferred();
  const signals = [];
  let calls = 0;
  const { refresh, commits } = coordinator({
    fetchData: ({ signal }) => {
      signals.push(signal);
      calls += 1;
      if (calls === 1) return first.promise;
      if (calls === 2) return manual.promise;
      return Promise.resolve('poll');
    },
  });

  const oldRequest = refresh.request({ reason: 'focus' });
  const queuedPoll = refresh.request({ reason: 'poll' });
  const manualRequest = refresh.request({ reason: 'manual', force: true });
  first.resolve('old');
  await oldRequest;
  assert.equal(signals[1].aborted, false);
  assert.equal(calls, 2);

  manual.resolve('manual');
  await Promise.all([manualRequest, queuedPoll]);
  assert.deepEqual(commits.map(({ data, reason }) => [data, reason]), [['manual', 'manual'], ['poll', 'poll']]);
});

test('a response cannot commit after its identity vanishes', async () => {
  const response = deferred();
  let identity = 'task:a';
  const { refresh, commits, statuses } = coordinator({ fetchData: () => response.promise, getIdentity: () => identity });

  const request = refresh.request({ reason: 'manual' });
  identity = undefined;
  response.resolve('wrong detail');
  await request;

  assert.equal(commits.length, 0);
  assert.equal(statuses.at(-1).dropped, 'identity-mismatch');
});

test('missing identity is valid for an unscoped source', async () => {
  const { refresh, commits } = coordinator();
  await refresh.request({ reason: 'initial' });
  assert.equal(commits.length, 1);
});

test('units defer and retain only the newest successful generation', async () => {
  let deferredState = true;
  let value = 0;
  const { refresh, commits } = coordinator({
    fetchData: async () => ++value,
    unit: { isDeferred: () => deferredState },
  });

  await refresh.request({ reason: 'poll' });
  await refresh.request({ reason: 'manual', force: true });
  assert.equal(commits.length, 0);
  deferredState = false;
  assert.equal(await refresh.release('main'), true);
  assert.deepEqual(commits.map(({ data, reason }) => [data, reason]), [[2, 'manual']]);
});

test('deferred data is dropped when its identity disappears', async () => {
  let deferredState = true;
  let identity = 'session:a';
  const { refresh, commits } = coordinator({ getIdentity: () => identity, unit: { isDeferred: () => deferredState } });

  await refresh.request({ reason: 'mutation' });
  identity = 'session:b';
  deferredState = false;
  assert.equal(await refresh.release('main'), false);
  assert.equal(commits.length, 0);
});

test('rejects unknown reasons before fetching', () => {
  const { refresh } = coordinator();
  assert.throws(() => refresh.request({ reason: 'background' }), /Unknown refresh reason/);
});
