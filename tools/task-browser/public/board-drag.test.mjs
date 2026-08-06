import test from 'node:test';
import assert from 'node:assert/strict';
import { boardDropMode, columnDragScrollDelta, hasOrderingFilters, insertionIndex, shouldClearDropFeedback } from './board-drag.js';

test('only search, project, and priority filters constrain drag ordering', () => {
  assert.equal(hasOrderingFilters({ query: '', project: 'all', priority: 'all' }), false);
  assert.equal(hasOrderingFilters({ query: ' task ', project: 'all', priority: 'all' }), true);
  assert.equal(hasOrderingFilters({ query: '', project: 'demo', priority: 'all' }), true);
  assert.equal(hasOrderingFilters({ query: '', project: 'all', priority: 'high' }), true);
});

test('filtered drops disable same-column ordering but preserve cross-column status moves', () => {
  assert.equal(boardDropMode({ filtered: true, sourceStatus: 'active', destinationStatus: 'active' }), 'disabled');
  assert.equal(boardDropMode({ filtered: true, sourceStatus: 'active', destinationStatus: 'review' }), 'status-only');
  assert.equal(boardDropMode({ filtered: false, sourceStatus: 'active', destinationStatus: 'active' }), 'reorder');
  assert.equal(boardDropMode({ filtered: false, sourceStatus: 'active', destinationStatus: 'done' }), 'status-only');
  assert.equal(boardDropMode({ filtered: false, sourceStatus: 'done', destinationStatus: 'done' }), 'disabled');
  assert.equal(boardDropMode({ filtered: false, sourceStatus: 'done', destinationStatus: 'active' }), 'reorder');
});

test('does not clear insertion feedback for bubbled child dragleave with a null related target', () => {
  assert.equal(shouldClearDropFeedback({ eventTargetIsBoard: false, relatedTargetInside: false }), false);
  assert.equal(shouldClearDropFeedback({ eventTargetIsBoard: true, relatedTargetInside: true }), false);
  assert.equal(shouldClearDropFeedback({ eventTargetIsBoard: true, relatedTargetInside: false }), true);
});

test('scrolls a drag destination near its edges and remains still in the middle', () => {
  assert.equal(columnDragScrollDelta({ pointerY: 101, top: 100, bottom: 500 }), -20);
  assert.equal(columnDragScrollDelta({ pointerY: 150, top: 100, bottom: 500 }), -5);
  assert.equal(columnDragScrollDelta({ pointerY: 300, top: 100, bottom: 500 }), 0);
  assert.equal(columnDragScrollDelta({ pointerY: 450, top: 100, bottom: 500 }), 5);
  assert.equal(columnDragScrollDelta({ pointerY: 499, top: 100, bottom: 500 }), 20);
});

test('calculates first, between, and last insertion indexes while excluding the dragged card', () => {
  const cards = [
    { key: 'a', top: 0, height: 40 },
    { key: 'b', top: 48, height: 40 },
    { key: 'c', top: 96, height: 40 },
  ];
  assert.equal(insertionIndex(cards, 5, 'b'), 0);
  assert.equal(insertionIndex(cards, 50, 'b'), 1);
  assert.equal(insertionIndex(cards, 200, 'b'), 2);
});
