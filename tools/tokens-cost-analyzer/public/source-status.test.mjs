import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyRefreshing, createSourceStatusPoller } from './source-status.js';

// A hand-driven clock: nothing here should depend on real time, and a poller
// that only worked against `setTimeout` would be untestable in exactly the way
// An optimistic client-side timer would be untrustworthy.
function clock() {
  const pending = [];
  return {
    schedule: (fn) => { pending.push(fn); return pending.length; },
    cancel: (id) => { pending[id - 1] = null; },
    scheduled: () => pending.filter(Boolean).length,
    async run() {
      const due = pending.filter(Boolean);
      pending.length = 0;
      for (const fn of due) await fn();
    },
  };
}

const refreshing = (id, flag) => ({ id, refreshing: flag });

test('polling starts only when the server says a source is in flight', () => {
  const time = clock();
  const poller = createSourceStatusPoller({ fetchStatus: async () => ({ sources: [] }), schedule: time.schedule, cancel: time.cancel });

  poller.sync([refreshing('laptop', false)]);
  assert.equal(time.scheduled(), 0, 'a quiet dashboard polls nothing at all');

  poller.sync([refreshing('laptop', false), refreshing('desktop', true)]);
  assert.equal(time.scheduled(), 1);

  // Repeated renders while the same flight is running must not stack pollers.
  poller.sync([refreshing('desktop', true)]);
  assert.equal(time.scheduled(), 1, 'one poll in flight, however often the page re-renders');
});

test('polling continues while a flight lasts and asks for the report once when it ends', async () => {
  const time = clock();
  const seen = [];
  let settled = 0;
  const responses = [
    { sources: [refreshing('laptop', true)] },
    { sources: [refreshing('laptop', true)] },
    { sources: [refreshing('laptop', false)] },
  ];
  const poller = createSourceStatusPoller({
    fetchStatus: async () => responses.shift(),
    onUpdate: (sources) => seen.push(sources.map((source) => source.refreshing)),
    onSettled: () => { settled += 1; },
    schedule: time.schedule,
    cancel: time.cancel,
  });

  poller.sync([refreshing('laptop', true)]);
  await time.run();
  await time.run();
  assert.equal(settled, 0, 'nothing is fetched while the flight is still running');

  await time.run();
  assert.equal(settled, 1, 'the full report is requested exactly once, on the settled edge');
  assert.equal(time.scheduled(), 0, 'and polling stops rather than idling against the server');
  assert.deepEqual(seen, [[true], [true], [false]], 'every poll result reaches the renderer');

  // The settled edge fires once, not once per subsequent render.
  poller.sync([refreshing('laptop', false)]);
  assert.equal(settled, 1);
});

test('a failed poll keeps watching, and a failed report request does not spin', async () => {
  const time = clock();
  const errors = [];
  let attempts = 0;
  const poller = createSourceStatusPoller({
    fetchStatus: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('network hiccup');
      return { sources: [refreshing('laptop', false)] };
    },
    onSettled: () => { throw new Error('report request failed'); },
    onError: (error) => errors.push(error.message),
    schedule: time.schedule,
    cancel: time.cancel,
  });

  poller.sync([refreshing('laptop', true)]);
  await time.run();
  assert.deepEqual(errors, ['network hiccup']);
  assert.equal(time.scheduled(), 1, 'a dropped poll must not strand the row on Refreshing…');

  await time.run();
  assert.deepEqual(errors, ['network hiccup', 'report request failed']);
  assert.equal(time.scheduled(), 0, 'a refused report request is not retried every second');
});

test('a source without the flag is never treated as in flight', () => {
  assert.equal(anyRefreshing([]), false);
  assert.equal(anyRefreshing([{ id: 'laptop' }]), false, 'absent is not refreshing');
  assert.equal(anyRefreshing([{ id: 'laptop', refreshing: 'yes' }]), false, 'only the real boolean counts');
  assert.equal(anyRefreshing([{ id: 'laptop', refreshing: true }]), true);
});
