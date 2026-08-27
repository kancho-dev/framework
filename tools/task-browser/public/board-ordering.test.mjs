import test from 'node:test';
import assert from 'node:assert/strict';
import { planBoardMove, sortForBoardOrder } from './board-ordering.js';
import { sortTasks } from './task-utils.js';

const task = (key, status, order, displayId = '#1') => ({ key, metadata: { status, order, displayId } });

function patches(tasks, key, status, index) {
  return Object.fromEntries(planBoardMove(tasks, { key, status, index }).map(({ key: taskKey, metadata }) => [taskKey, metadata]));
}

test('sorts positive integer orders first and resolves equal, missing, and invalid values deterministically', () => {
  const tasks = [task('z', 'active', null, '#4'), task('b', 'active', 2, '#3'), task('a', 'active', 2, '#2'), task('x', 'active', -1, '#1')];
  assert.deepEqual([...tasks].sort(sortForBoardOrder).map(({ key }) => key), ['b', 'a', 'z', 'x']);
});

test('newer display IDs win equal explicit-order ties before priority', () => {
  const olderUrgent = { ...task('older', 'planned', 1, '#8'), metadata: { ...task('older', 'planned', 1, '#8').metadata, priority: 'urgent' } };
  const newerNormal = { ...task('newer', 'planned', 1, '#9'), metadata: { ...task('newer', 'planned', 1, '#9').metadata, priority: 'normal' } };
  assert.deepEqual([olderUrgent, newerNormal].sort(sortForBoardOrder).map(({ key }) => key), ['newer', 'older']);
});

test('active board rendering and placement share invalid-order semantics', () => {
  const tasks = [task('zero', 'active', 0, '#1'), task('negative', 'active', -2, '#2'), task('float', 'active', 1.5, '#3'), task('valid', 'active', 2, '#4')];
  const expected = [...tasks].sort(sortForBoardOrder).map(({ key }) => key);
  assert.deepEqual(sortTasks('active', tasks).map(({ key }) => key), expected);
  assert.deepEqual(expected, ['valid', 'float', 'negative', 'zero']);
});

test('done destinations never produce an ordering plan', () => {
  assert.throws(() => planBoardMove([task('a', 'active', 1)], { key: 'a', status: 'done', index: 0 }), /does not support ordering/);
});

test('uses a sparse neighbor gap with only the moved task changed', () => {
  const tasks = [task('a', 'active', 10, '#1'), task('b', 'active', 20, '#2'), task('m', 'planned', 3, '#3')];
  assert.deepEqual(patches(tasks, 'm', 'active', 1), { m: { status: 'active', order: 11 } });
});

test('renumbers the shortest dense side at first, middle, and last positions', () => {
  const dense = [task('a', 'active', 1, '#1'), task('b', 'active', 2, '#2'), task('c', 'active', 4, '#3'), task('m', 'planned', 9, '#4')];
  assert.deepEqual(patches(dense, 'm', 'active', 1), { m: { status: 'active', order: 2 }, b: { order: 3 } });
  assert.deepEqual(patches(dense, 'm', 'active', 0), { m: { status: 'active', order: 1 }, a: { order: 2 }, b: { order: 3 } });
  assert.deepEqual(patches(dense, 'm', 'active', 3), { m: { status: 'active', order: 5 } });
});

test('same-column move and single-card destination are deterministic', () => {
  const tasks = [task('a', 'active', 1, '#1'), task('b', 'active', 2, '#2'), task('c', 'active', 3, '#3'), task('m', 'planned', null, '#4')];
  assert.deepEqual(patches(tasks, 'c', 'active', 0), { c: { order: 1 }, a: { order: 2 }, b: { order: 3 } });
  assert.deepEqual(patches([task('m', 'planned', null)], 'm', 'review', 0), { m: { status: 'review', order: 1 } });
});

test('rejects unknown tasks and impossible destination indexes', () => {
  assert.throws(() => planBoardMove([], { key: 'missing', status: 'active', index: 0 }), /Unknown task/);
  assert.throws(() => planBoardMove([task('a', 'active', 1)], { key: 'a', status: 'active', index: 2 }), /Invalid destination index/);
});
