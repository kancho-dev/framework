import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRequestedSelection } from './selection.js';

test('closing task details removes task and status selection parameters', () => {
  const url = new URL('http://localhost:4173/?selectTask=project%2Ftask&task=legacy&selectStatus=active&status=planned&project=agent-framework#board');

  clearRequestedSelection(url);

  assert.equal(url.searchParams.has('selectTask'), false);
  assert.equal(url.searchParams.has('task'), false);
  assert.equal(url.searchParams.has('selectStatus'), false);
  assert.equal(url.searchParams.has('status'), false);
  assert.equal(url.searchParams.get('project'), 'agent-framework');
  assert.equal(url.hash, '#board');
});
