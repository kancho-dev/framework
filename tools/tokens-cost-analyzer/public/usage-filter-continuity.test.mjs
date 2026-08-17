import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { persistUsageFilters, restoreUsageFilters, usageFilterContinuityKey } from './usage-filter-continuity.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('usage filters round-trip within one workspace scope', () => {
  const local = storage();
  persistUsageFilters(local, '/workspace/a', {
    sources: new Set(['pi']), models: new Set(['openai/gpt']), machineIds: new Set(['pc']), workspaceKeys: new Set(['pc/ws']),
  });
  const restored = restoreUsageFilters(local, '/workspace/a');
  assert.deepEqual([...restored.sources], ['pi']);
  assert.deepEqual([...restored.models], ['openai/gpt']);
  assert.deepEqual([...restored.machineIds], ['pc']);
  assert.deepEqual([...restored.workspaceKeys], ['pc/ws']);
  assert.equal(restoreUsageFilters(local, '/workspace/b'), null, 'another workspace does not inherit the selection');
});

test('malformed and non-string saved values fail soft', () => {
  const local = storage();
  local.setItem(usageFilterContinuityKey('broken'), '{');
  assert.equal(restoreUsageFilters(local, 'broken'), null);
  local.setItem(usageFilterContinuityKey('mixed'), JSON.stringify({ sources: ['pi', 7], models: 'bad' }));
  const restored = restoreUsageFilters(local, 'mixed');
  assert.deepEqual([...restored.sources], ['pi']);
  assert.equal(restored.models.size, 0);
  assert.equal(restored.machineIds.size, 0);
});
