import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMetadataEntries, remapMetadata } from './metadata-remap.mjs';

test('merge is additive and keeps current saved-topic conflicts', () => {
  const current = { bookmarked: false, tags: ['current'], savedTopics: { same: { note: 'current' } } };
  const archived = { bookmarked: true, tags: ['archived'], savedTopics: { same: { note: 'archived' }, old: { note: 'old' } } };
  const result = mergeMetadataEntries(current, archived);
  assert.deepEqual(result.entry, {
    bookmarked: true,
    tags: ['archived', 'current'],
    savedTopics: { same: { note: 'current' }, old: { note: 'old' } },
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].id, 'same');
});

test('verified remap preserves unmatched keys and merges into an existing target', async () => {
  const source = 'pi:/old/a.jsonl';
  const target = 'pi@old-machine:/archive/a.jsonl';
  const input = { version: 3, sessions: {
    [source]: { bookmarked: true, tags: ['archive'], savedTopics: { topic: { note: 'archive' } } },
    [target]: { bookmarked: false, tags: ['current'], savedTopics: { topic: { note: 'current' } } },
    'codex:missing': { bookmarked: true, tags: [], savedTopics: {} },
  } };
  const result = await remapMetadata(input, async (key) => key === source ? target : key === 'codex:missing' ? { reason: 'not found' } : null);
  assert.equal(result.changed, true);
  assert.equal(result.rewrites.length, 1);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.metadata.sessions[source], undefined);
  assert.deepEqual(result.metadata.sessions[target].tags, ['archive', 'current']);
  assert.equal(result.metadata.sessions[target].savedTopics.topic.note, 'current');
  assert.equal(result.metadata.sessions['codex:missing'].bookmarked, true);
});

test('reusing a completed remap is idempotent', async () => {
  const metadata = { version: 3, sessions: { 'pi@old-machine:/archive/a.jsonl': { bookmarked: true, tags: [], savedTopics: {} } } };
  const result = await remapMetadata(metadata, async () => null);
  assert.equal(result.changed, false);
  assert.equal(result.rewrites.length, 0);
  assert.deepEqual(result.metadata.sessions, metadata.sessions);
});
