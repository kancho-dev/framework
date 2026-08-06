import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBrowserPatch,
  buildHistoryEvent,
  metadataChanges,
  normalizeMetadata,
  normalizeTask,
} from './metadata-helpers.mjs';

const baseTask = { displayId: '#1', project: 'demo', slug: 'task', path: 'projects/demo/work/task' };

test('normalizeTask preserves allowed next actors and safely clears absent or invalid values', () => {
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'operator' }).nextActor, 'operator');
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'agent' }).nextActor, 'agent');
  assert.equal(normalizeTask({ ...baseTask }).nextActor, null);
  assert.equal(normalizeTask({ ...baseTask, nextActor: 'builder' }).nextActor, null);
});

test('normalizeTask treats non-positive and non-integer order values as missing', () => {
  assert.equal(normalizeTask({ ...baseTask, order: 2 }).order, 2);
  for (const order of [0, -1, 1.5, Number.NaN]) assert.equal(normalizeTask({ ...baseTask, order }).order, null);
});

test('stored metadata normalizes absent or older invalid nextActor values to null', () => {
  const metadata = normalizeMetadata({ tasks: { absent: {}, invalid: { nextActor: 'builder' }, valid: { nextActor: 'agent' } } });
  assert.equal(metadata.tasks.absent.nextActor, null);
  assert.equal(metadata.tasks.invalid.nextActor, null);
  assert.equal(metadata.tasks.valid.nextActor, 'agent');
});

test('browser patches set and clear nextActor and reject invalid values', () => {
  assert.equal(applyBrowserPatch({}, { nextActor: 'agent' }).nextActor, 'agent');
  assert.equal(applyBrowserPatch({ nextActor: 'agent' }, { nextActor: null }).nextActor, null);
  assert.equal(applyBrowserPatch({ nextActor: 'agent' }, { nextActor: '' }).nextActor, null);
  assert.throws(() => applyBrowserPatch({}, { nextActor: 'builder' }), (error) => error.statusCode === 400 && /nextActor/.test(error.message));
});

test('history records real nextActor changes but omits no-ops', () => {
  assert.deepEqual(metadataChanges({ nextActor: null }, { nextActor: 'operator' }).nextActor, { before: null, after: 'operator' });
  assert.equal(buildHistoryEvent({ key: 'demo/task', before: { nextActor: 'agent' }, after: { nextActor: 'agent' }, source: 'test', action: 'test' }), null);
  const event = buildHistoryEvent({ key: 'demo/task', before: { nextActor: 'agent' }, after: { nextActor: null }, source: 'test', action: 'test' });
  assert.deepEqual(event.changes.nextActor, { before: 'agent', after: null });
});
