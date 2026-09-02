import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingTags, matchesTagFilter, syncTagFilterControl, validTagFilter } from './tag-filter.js';

test('matchingTags narrows tags case-insensitively and sorts the choices', () => {
  assert.deepEqual(matchingTags(['Release', 'needs-review', 'reviewed'], 'REVIEW'), ['needs-review', 'reviewed']);
  assert.deepEqual(matchingTags(['release', 'needs-review', 'reviewed'], 'needs view'), ['needs-review']);
});

test('matchingTags returns all choices for empty input and none for no match', () => {
  assert.deepEqual(matchingTags(['zeta', 'Alpha', 'Alpha'], ''), ['Alpha', 'zeta']);
  assert.deepEqual(matchingTags(['Alpha'], 'missing'), []);
});

test('selected and cleared tag filters retain existing filtering behavior', () => {
  assert.equal(validTagFilter(['release', 'review'], 'review'), 'review');
  assert.equal(matchesTagFilter(['review'], 'review'), true);
  assert.equal(matchesTagFilter(['release'], 'review'), false);
  assert.equal(validTagFilter(['release'], 'missing'), 'all');
  assert.equal(matchesTagFilter([], 'all'), true);
});

test('list refresh control sync preserves a focused query with no selected tag', () => {
  const input = { value: 'rev', title: '' };

  syncTagFilterControl(input, 'all', { preserveQuery: true });
  syncTagFilterControl(input, 'all', { preserveQuery: true });

  assert.equal(input.value, 'rev');
  assert.equal(input.title, 'All tags');
});

test('control sync renders selected and explicitly cleared tag values', () => {
  const input = { value: 'draft', title: '' };
  syncTagFilterControl(input, 'review');
  assert.deepEqual(input, { value: 'review', title: 'Filtering by review' });
  syncTagFilterControl(input, 'all');
  assert.deepEqual(input, { value: '', title: 'All tags' });
});
