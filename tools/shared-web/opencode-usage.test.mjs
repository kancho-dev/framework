import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCodeSessionUsage, openCodeTokenValues, openCodeTotalTokens } from './opencode-usage.mjs';

// Shape taken from a real OpenCode row: cache is nested, reasoning is a sibling of
// output, and `total` already accounts for every component.
const responseTokens = { total: 18333, input: 795, output: 118, reasoning: 12, cache: { write: 0, read: 17408 } };

const message = (id, tokens) => ({ id, data: tokens ? { tokens } : {} });
const part = (id, messageId, tokens) => ({ id, messageId, data: { type: 'step-finish', tokens } });

test('reads nested cache fields and reasoning', () => {
  assert.deepEqual(openCodeTokenValues(responseTokens), {
    input: 795, output: 118, reasoning: 12, cacheRead: 17408, cacheWrite: 0, explicitTotal: 18333,
  });
});

test('absent components stay unknown rather than zero', () => {
  assert.deepEqual(openCodeTokenValues({ input: 5 }), {
    input: 5, output: null, reasoning: null, cacheRead: null, cacheWrite: null, explicitTotal: null,
  });
});

test('explicit total wins and includes reasoning', () => {
  assert.equal(openCodeTotalTokens(responseTokens), 18333);
});

test('missing explicit total derives from components including reasoning', () => {
  assert.equal(openCodeTotalTokens({ input: 795, output: 118, reasoning: 12, cache: { read: 17408, write: 0 } }), 18333);
});

test('duplicate message and part usage is counted once', () => {
  const usage = openCodeSessionUsage(
    [message('msg_1', responseTokens)],
    [part('prt_1', 'msg_1', responseTokens)],
  );
  assert.equal(usage.total, 18333);
  assert.equal(usage.input, 795);
  assert.equal(usage.reasoning, 12);
  assert.equal(usage.cacheRead, 17408);
});

test('part usage still counts when the message row carries none', () => {
  const usage = openCodeSessionUsage(
    [message('msg_1', null)],
    [part('prt_1', 'msg_1', responseTokens)],
  );
  assert.equal(usage.total, 18333);
  assert.equal(usage.output, 118);
});

test('message usage still counts when no part carries usage', () => {
  const usage = openCodeSessionUsage([message('msg_1', responseTokens)], []);
  assert.equal(usage.total, 18333);
});

test('parts orphaned from their message row are not dropped', () => {
  const usage = openCodeSessionUsage([], [part('prt_1', 'msg_gone', responseTokens)]);
  assert.equal(usage.total, 18333);
});

test('older orphan parts do not replace a newer message context', () => {
  const older = { input: 10, output: 10 };
  const newer = { input: 50_000, output: 1_100 };
  const usage = openCodeSessionUsage(
    [{ ...message('msg_new', newer), createdAt: 200 }],
    [{ ...part('prt_old', 'msg_gone', older), createdAt: 100 }],
  );
  assert.equal(usage.latestContext, 51_100);
});

test('latest context includes cached input but excludes provider-specific reasoning', () => {
  const usage = openCodeSessionUsage([message('msg_1', responseTokens)], [part('prt_1', 'msg_1', responseTokens)]);
  assert.equal(usage.latestContext, 18321);
});
