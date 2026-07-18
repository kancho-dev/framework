import test from 'node:test';
import assert from 'node:assert/strict';
import { editSteeringDraft, isSteeringNotesInput, pendingSteeringIndicator, savedSteeringDraft, steeringDisclosureOpen, syncSteeringDraft } from './steering-notes.js';

test('dirty Steering Notes drafts survive refresh and detect remote changes', () => {
  const drafts = {};
  const task = { key: 'demo/task', steeringNotes: { content: 'saved', revision: 'one' } };
  let draft = syncSteeringDraft(drafts, task);
  drafts[task.key] = editSteeringDraft(draft, 'local draft');
  draft = syncSteeringDraft(drafts, { ...task, steeringNotes: { content: 'saved', revision: 'one' } });
  assert.equal(draft.content, 'local draft');
  assert.equal(draft.state, 'dirty');
  draft = syncSteeringDraft(drafts, { ...task, steeringNotes: { content: '', revision: 'two' } });
  assert.equal(draft.content, 'local draft');
  assert.equal(draft.state, 'conflict');
});

test('empty Steering Notes collapse by default while pending notes and dirty drafts stay open', () => {
  assert.equal(steeringDisclosureOpen({ pending: false, dirty: false }), false);
  assert.equal(steeringDisclosureOpen({ pending: true, dirty: false }), true);
  assert.equal(steeringDisclosureOpen({ preference: false, pending: false, dirty: true }), true);
  assert.equal(steeringDisclosureOpen({ preference: true, pending: false, dirty: false }), true);
});

test('Steering Notes input is refresh-sensitive so typing is not interrupted', () => {
  assert.equal(isSteeringNotesInput('steeringNotes'), true);
  assert.equal(isSteeringNotesInput('newTag'), false);
});

test('pending indicator renders only when needed and has an accessible note icon', () => {
  assert.equal(pendingSteeringIndicator(false), '');
  assert.match(pendingSteeringIndicator(true), /aria-label="Steering Notes pending"/);
  assert.match(pendingSteeringIndicator(true), /<svg[^>]+aria-hidden="true"/);
});

test('clean drafts follow saved and cleared server state', () => {
  const drafts = {};
  const task = { key: 'demo/task', steeringNotes: { content: 'pending', revision: 'one' } };
  assert.equal(syncSteeringDraft(drafts, task).state, 'saved');
  drafts[task.key] = savedSteeringDraft({ content: '', revision: 'two' });
  assert.equal(syncSteeringDraft(drafts, { ...task, steeringNotes: { content: '', revision: 'two' } }).state, 'cleared');
});
