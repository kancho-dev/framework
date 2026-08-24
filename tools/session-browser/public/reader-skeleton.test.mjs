import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerSkeleton } from './reader-skeleton.js';

test('exposes reader identity and summary metadata while detail loads', () => {
  assert.deepEqual(readerSkeleton({
    id: 'session-1',
    source: 'claude-code',
    name: 'Known title',
    updatedAt: '2026-08-24T12:00:00.000Z',
    messageCount: 12,
    contextLoad: { total: 10 },
  }), {
    title: 'Known title',
    source: 'claude-code',
    updatedAt: '2026-08-24T12:00:00.000Z',
    messageCount: 12,
    contextLoad: { total: 10 },
  });
});

test('returns no shell when list metadata is unavailable', () => {
  assert.equal(readerSkeleton(null), null);
});
