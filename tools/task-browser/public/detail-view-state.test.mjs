import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDetailViewState, restoreDetailViewState } from './detail-view-state.js';

test('detail refresh preserves drawer scroll and Steering Notes textarea state', () => {
  const textarea = { style: { height: '184px' }, scrollTop: 37 };
  const pane = { scrollTop: 412 };
  const root = { querySelector: (selector) => selector === 'textarea[name="steeringNotes"]' ? textarea : null };
  const captured = captureDetailViewState({ key: 'demo/task', pane, steeringRoot: root });

  pane.scrollTop = 0;
  textarea.style.height = '';
  textarea.scrollTop = 0;
  restoreDetailViewState(captured, { key: 'demo/task', pane, steeringRoot: root });

  assert.equal(pane.scrollTop, 412);
  assert.equal(textarea.style.height, '184px');
  assert.equal(textarea.scrollTop, 37);
});

test('detail refresh state is not transferred to another task', () => {
  const textarea = { style: { height: '' }, scrollTop: 0 };
  const pane = { scrollTop: 0 };
  const root = { querySelector: () => textarea };
  const captured = { key: 'demo/first', drawerScrollTop: 412, textareaHeight: '184px', textareaScrollTop: 37 };

  assert.equal(restoreDetailViewState(captured, { key: 'demo/second', pane, steeringRoot: root }), false);
  assert.equal(pane.scrollTop, 0);
  assert.equal(textarea.style.height, '');
});
