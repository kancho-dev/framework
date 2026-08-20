import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImmutableSourceMemo } from './immutable-source-memo.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('cold immutable sources load in the background and then remain memoized', async () => {
  const memo = createImmutableSourceMemo();
  let release;
  let loads = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const entry = { key: 'pi@old', immutable: true, load: async () => { loads += 1; await gate; return { sessions: ['archived'] }; } };

  assert.deepEqual(memo.snapshot([entry]), { loading: true, results: [] });
  assert.equal(loads, 0);
  await settle();
  assert.equal(loads, 1);
  assert.deepEqual(memo.snapshot([entry]), { loading: true, results: [] });

  release();
  await settle();
  assert.deepEqual(memo.snapshot([entry]), {
    loading: false,
    results: [{ entry, status: 'fulfilled', value: { sessions: ['archived'] } }],
  });
  memo.snapshot([entry]);
  assert.equal(loads, 1);
});

test('source failures settle independently and retry after the rejection is observed', async () => {
  const memo = createImmutableSourceMemo();
  const error = new Error('broken archive');
  let attempts = 0;
  const good = { key: 'pi@old', load: async () => ['good'] };
  const bad = { key: 'codex@old', load: async () => {
    attempts += 1;
    if (attempts === 1) throw error;
    return ['recovered'];
  } };

  memo.snapshot([good, bad]);
  await settle();
  const rejected = memo.snapshot([good, bad]);
  assert.equal(rejected.loading, false);
  assert.equal(rejected.results[0].status, 'fulfilled');
  assert.equal(rejected.results[1].status, 'rejected');
  assert.equal(rejected.results[1].reason, error);

  const retrying = memo.snapshot([good, bad]);
  assert.equal(retrying.loading, false);
  assert.equal(retrying.results[1].status, 'rejected');
  assert.equal(retrying.results[1].reason, error);
  await settle();
  const recovered = memo.snapshot([good, bad]);
  assert.equal(recovered.loading, false);
  assert.deepEqual(recovered.results[1], {
    entry: bad,
    status: 'fulfilled',
    value: ['recovered'],
  });
  assert.equal(attempts, 2);
});

test('mutable escape-hatch sources rescan after a settled result is observed', async () => {
  const memo = createImmutableSourceMemo();
  let loads = 0;
  const entry = { key: 'pi@old', immutable: false, load: async () => ++loads };

  memo.snapshot([entry]);
  await settle();
  assert.equal(memo.snapshot([entry]).results[0].value, 1);
  assert.equal(memo.snapshot([entry]).loading, true);
  await settle();
  assert.equal(memo.snapshot([entry]).results[0].value, 2);
});
