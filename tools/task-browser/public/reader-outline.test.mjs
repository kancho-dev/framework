import test from 'node:test';
import assert from 'node:assert/strict';
import { outlineEntries } from './reader-outline.js';

const heading = (tagName, textContent) => ({ tagName, textContent });

test('returns an empty outline for a document without headings', () => {
  assert.deepEqual(outlineEntries([]), []);
});

test('preserves order, nesting levels, and distinct targets for duplicate headings', () => {
  assert.deepEqual(outlineEntries([
    heading('H1', 'Release'),
    heading('H2', 'Checks'),
    heading('H2', 'Checks'),
  ]), [
    { id: 'reader-heading-1', level: 1, text: 'Release' },
    { id: 'reader-heading-2', level: 2, text: 'Checks' },
    { id: 'reader-heading-3', level: 2, text: 'Checks' },
  ]);
});

test('keeps unsafe-looking heading text as inert data for textContent rendering', () => {
  assert.deepEqual(outlineEntries([heading('H3', '<img src=x onerror=alert(1)> & **bold**')]), [
    { id: 'reader-heading-1', level: 3, text: '<img src=x onerror=alert(1)> & **bold**' },
  ]);
});
