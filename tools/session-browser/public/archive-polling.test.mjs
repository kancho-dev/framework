import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_POLL_DELAY_MS, shouldPollArchives } from './archive-polling.js';

test('polls only while the server reports cold archives loading', () => {
  assert.equal(shouldPollArchives({ archivesLoading: true }), true);
  assert.equal(shouldPollArchives({ archivesLoading: false }), false);
  assert.equal(shouldPollArchives({}), false);
  assert.ok(ARCHIVE_POLL_DELAY_MS > 0 && ARCHIVE_POLL_DELAY_MS < 10_000);
});
