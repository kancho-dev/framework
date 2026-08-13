import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesSavedTopicSessionFilter, savedTopicDestination, savedTopicNoteIndicator, savedTopicPromptAction, topicRows } from './saved-topics.js';

const anchors = [
  { id: 'u1', title: 'Start' },
  { id: 'u2', title: 'Continue' },
];
const savedTopics = {
  u2: { title: 'Useful continuation', note: 'Keep this' },
};

test('the shipped stylesheet hides the conditional Saved only control', async () => {
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /\.saved-topics-filter\.hidden\s*{[^}]*display:\s*none/);
});

test('Saved only shows saved anchors and falls back to all anchors when none are saved', () => {
  assert.deepEqual(topicRows(anchors, savedTopics, true).map((row) => row.id), ['u2']);
  assert.deepEqual(topicRows(anchors, {}, true).map((row) => row.id), ['u1', 'u2']);
});

test('Has saved topics composes independently with session bookmarks', () => {
  const curated = { metadata: { bookmarked: true, savedTopicCount: 2 } };
  const bookmarkOnly = { metadata: { bookmarked: true, savedTopicCount: 0 } };
  assert.equal(matchesSavedTopicSessionFilter(curated, true), true);
  assert.equal(matchesSavedTopicSessionFilter(bookmarkOnly, true), false);
  assert.equal(matchesSavedTopicSessionFilter(bookmarkOnly, false), true);
});

test('saved topics with notes use the Task Browser Steering Notes icon as visual state', () => {
  assert.equal(savedTopicNoteIndicator(savedTopics.u2).includes('viewBox="0 0 16 16"'), true);
  assert.equal(savedTopicNoteIndicator(savedTopics.u2).includes('Has note'), true);
  assert.equal(savedTopicNoteIndicator({ title: 'No note', note: '  ' }), '');
});

test('prompt cards expose explicit save and edit actions', () => {
  assert.deepEqual(savedTopicPromptAction('u1', savedTopics), { saved: false, label: 'Save' });
  assert.deepEqual(savedTopicPromptAction('u2', savedTopics), { saved: true, label: 'Edit saved' });
});

test('saved topic navigation resolves only the exact visible prompt anchor', () => {
  assert.deepEqual(savedTopicDestination(anchors, savedTopics, 'u2'), { topicId: 'u2' });
});

test('an orphaned saved entry stays counted but never receives a guessed destination', () => {
  const orphaned = { ...savedTopics, missing: { title: 'Old prompt' } };
  assert.equal(Object.keys(orphaned).length, 2);
  assert.equal(topicRows(anchors, orphaned, false).some((row) => row.id === 'missing'), false);
  assert.equal(savedTopicDestination(anchors, orphaned, 'missing'), null);
});
