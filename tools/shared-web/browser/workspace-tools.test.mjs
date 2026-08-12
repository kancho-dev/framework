import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceAllowsTool, workspaceFilterForTool } from './workspace-tools.js';

test('Task and Session Browser workspaces are enabled unless explicitly disabled', () => {
  assert.equal(workspaceAllowsTool({ tools: {} }, 'task-browser'), true);
  assert.equal(workspaceAllowsTool({ tools: { 'task-browser': false } }, 'task-browser'), false);
  assert.equal(workspaceAllowsTool({ tools: {} }, 'session-browser'), true);
  assert.equal(workspaceAllowsTool({ tools: { 'session-browser': false } }, 'session-browser'), false);
});

test('Tokens / Cost Analyzer workspaces require explicit enablement', () => {
  assert.equal(workspaceAllowsTool({ tools: {} }, 'tokens-cost-analyzer'), false);
  assert.equal(workspaceAllowsTool({ tools: { 'tokens-cost-analyzer': true } }, 'tokens-cost-analyzer'), true);
});

test('tool workspace filters exclude disabled workspaces', () => {
  const workspaces = [
    { id: 'framework', tools: { 'task-browser': true } },
    { id: 'global', tools: { 'task-browser': false } },
  ];
  assert.deepEqual(workspaces.filter(workspaceFilterForTool('task-browser')).map(({ id }) => id), ['framework']);
});
