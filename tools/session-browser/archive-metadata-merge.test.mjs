import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeArchivedMetadata, mergeArchivedMetadata } from './archive-metadata-merge.mjs';

const archivedKey = 'codex:legacy-id';
const targetKey = 'codex@old-linux:legacy-id';

test('canonicalizes legacy labels into tags in memory without mutating the snapshot', () => {
  const snapshot = {
    version: 2,
    sessions: { [archivedKey]: { bookmarked: false, labels: ['legacy', 'shared'], tags: ['shared', 'tag'], savedTopics: {} } },
  };
  const original = JSON.stringify(snapshot);
  const result = canonicalizeArchivedMetadata(snapshot);

  assert.equal(result.canonicalized, true);
  assert.equal(result.metadata.version, 3);
  assert.deepEqual(result.metadata.sessions[archivedKey].tags, ['legacy', 'shared', 'tag']);
  assert.equal(result.metadata.sessions[archivedKey].labels, undefined);
  assert.equal(JSON.stringify(snapshot), original);
});

test('cross-file merge admits only eligible entries including same-key namespaced entries', async () => {
  const sameKey = 'pi@old-linux:/archive/one.jsonl';
  const missingKey = 'opencode:missing';
  const snapshot = {
    version: 3,
    sessions: {
      [archivedKey]: { bookmarked: true, tags: ['archive'], savedTopics: {} },
      [sameKey]: { bookmarked: false, tags: ['same-key'], savedTopics: {} },
      [missingKey]: { bookmarked: true, tags: ['must-not-copy'], savedTopics: {} },
    },
  };
  const destination = { version: 3, sessions: { [sameKey]: { bookmarked: true, tags: ['current'], savedTopics: {} } } };
  const result = await mergeArchivedMetadata({
    snapshot,
    destination,
    resolveTarget: async (key) => {
      if (key === archivedKey) return { targetKey };
      if (key === sameKey) return { targetKey: sameKey };
      return { reason: 'archived session not found' };
    },
  });

  assert.deepEqual(result.eligible, [
    { sourceKey: archivedKey, targetKey, rewritten: true },
    { sourceKey: sameKey, targetKey: sameKey, rewritten: false },
  ]);
  assert.deepEqual(result.metadata.sessions[sameKey], { bookmarked: true, tags: ['current', 'same-key'], savedTopics: {} });
  assert.equal(result.metadata.sessions[missingKey], undefined);
  assert.deepEqual(result.unmatched, [{ sourceKey: missingKey, reason: 'archived session not found' }]);
});

test('bookmarks OR, tags union, and current saved topics win reported conflicts', async () => {
  const archivedTopic = { title: 'Archived', note: 'recover me', prompt: 'old', timestamp: '2026-01-01' };
  const currentTopic = { title: 'Current', note: 'keep me', prompt: 'new', timestamp: '2026-02-01' };
  const snapshot = {
    version: 3,
    sessions: { [archivedKey]: {
      bookmarked: true,
      tags: ['archive', 'shared'],
      savedTopics: { conflict: archivedTopic, archivedOnly: { title: 'Archived only' } },
    } },
  };
  const destination = {
    version: 3,
    sessions: { [targetKey]: {
      bookmarked: false,
      tags: ['current', 'shared'],
      savedTopics: { conflict: currentTopic, currentOnly: { title: 'Current only' } },
    } },
  };
  const result = await mergeArchivedMetadata({ snapshot, destination, resolveTarget: async () => targetKey });
  const merged = result.metadata.sessions[targetKey];

  assert.equal(merged.bookmarked, true);
  assert.deepEqual(merged.tags, ['archive', 'current', 'shared']);
  assert.deepEqual(merged.savedTopics, {
    conflict: currentTopic,
    archivedOnly: { title: 'Archived only' },
    currentOnly: { title: 'Current only' },
  });
  assert.deepEqual(result.conflicts, [{
    sourceKey: archivedKey,
    targetKey,
    field: 'savedTopics',
    id: 'conflict',
    current: currentTopic,
    archived: archivedTopic,
  }]);
});

test('preserves legacy labels already present in the current destination', async () => {
  const destination = { version: 2, sessions: { [targetKey]: { labels: ['current-label'] } } };
  const snapshot = { version: 3, sessions: { [archivedKey]: { tags: ['archive-tag'] } } };
  const result = await mergeArchivedMetadata({ snapshot, destination, resolveTarget: async () => targetKey });
  assert.deepEqual(result.metadata.sessions[targetKey].tags, ['archive-tag', 'current-label']);
});

test('empty or reasonless resolutions are reported and skipped', async () => {
  const snapshot = { version: 3, sessions: { [archivedKey]: { bookmarked: true } } };
  const result = await mergeArchivedMetadata({ snapshot, destination: { version: 3, sessions: {} }, resolveTarget: async () => null });
  assert.equal(result.metadata.sessions[archivedKey], undefined);
  assert.deepEqual(result.unmatched, [{ sourceKey: archivedKey, reason: 'session key is not eligible' }]);
});
