import test from 'node:test';
import assert from 'node:assert/strict';
import { clearStaleRequestedSelection, nearestScrollTop } from './selection.js';

test('revealing an already visible card leaves scroll position unchanged', () => {
  let scrollTop = 240;

  for (let count = 0; count < 10; count += 1) {
    scrollTop = nearestScrollTop(scrollTop, 100, 500, 180, 260);
  }

  assert.equal(scrollTop, 240);
});

test('revealing a card above the viewport scrolls only enough to expose it', () => {
  assert.equal(nearestScrollTop(240, 100, 500, 60, 140), 200);
});

test('revealing a card below the viewport scrolls only enough to expose it', () => {
  assert.equal(nearestScrollTop(240, 100, 500, 480, 540), 280);
});

test('selecting another session clears stale session and topic deep-link parameters', () => {
  const url = new URL('http://localhost/sessions?selectSession=first&session=legacy&selectTopic=topic-1&topic=legacy-topic&workspace=main#reader');

  const changed = clearStaleRequestedSelection(url, 'second');

  assert.equal(changed, true);
  for (const param of ['selectSession', 'session', 'selectTopic', 'topic']) assert.equal(url.searchParams.has(param), false);
  assert.equal(url.searchParams.get('workspace'), 'main');
  assert.equal(url.hash, '#reader');
});

test('loading or reselecting the requested session preserves its deep link', () => {
  const url = new URL('http://localhost/sessions?selectSession=first&selectTopic=topic-1');

  const changed = clearStaleRequestedSelection(url, 'first');

  assert.equal(changed, false);
  assert.equal(url.searchParams.get('selectSession'), 'first');
  assert.equal(url.searchParams.get('selectTopic'), 'topic-1');
});
