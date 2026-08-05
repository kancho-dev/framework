import assert from 'node:assert/strict';
import test from 'node:test';
import { tableScrollKeys } from './table-scroll.js';

function table(ownerId) {
  return { closest: () => ownerId ? { id: ownerId } : null };
}

test('table scroll keys stay attached to their message when preceding tables disappear', () => {
  const before = tableScrollKeys([table('entry-tool'), table('entry-answer'), table('entry-answer')]);
  const after = tableScrollKeys([table('entry-answer'), table('entry-answer')]);

  assert.deepEqual(before, ['entry-tool:table:1', 'entry-answer:table:1', 'entry-answer:table:2']);
  assert.deepEqual(after, ['entry-answer:table:1', 'entry-answer:table:2']);
});

test('tables without a stable owner use an honest positional key', () => {
  assert.deepEqual(tableScrollKeys([table(), table()]), ['index:0', 'index:1']);
});
