import test from 'node:test';
import assert from 'node:assert/strict';
import { clearStaleRequestedSelection } from './selection.js';

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
