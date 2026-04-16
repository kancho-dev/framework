const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePiJsonl, shouldIncludePiSession } = require('./normalize');

test('shouldIncludePiSession respects workspace scope filtering', () => {
  assert.equal(shouldIncludePiSession({ cwd: '/workspace/project-a' }, 'workspace', '/workspace'), true);
  assert.equal(shouldIncludePiSession({ cwd: '/workspace/project-a' }, 'workspace', '/other'), false);
  assert.equal(shouldIncludePiSession({ cwd: '/workspace/project-a' }, 'all', '/other'), true);
});

test('normalizePiJsonl keeps user/final assistant text and drops tool results from searchable messages', () => {
  const normalized = normalizePiJsonl({
    workspace: 'agent-framework-ws',
    workspaceRoot: '/workspace',
    scope: 'workspace',
    sessionFiles: [
      {
        filePath: '/tmp/pi-session.jsonl',
        records: [
          { type: 'session', id: 'pi-ses-1', version: 3, timestamp: '2026-04-16T07:10:43.747Z', cwd: '/workspace/project-a' },
          { type: 'model_change', timestamp: '2026-04-16T07:10:43.754Z', provider: 'openai-codex', modelId: 'gpt-5.4' },
          { type: 'thinking_level_change', timestamp: '2026-04-16T07:10:43.754Z', thinkingLevel: 'low' },
          {
            type: 'message',
            id: 'user-1',
            parentId: null,
            timestamp: '2026-04-16T07:12:35.816Z',
            message: {
              role: 'user',
              content: [{ type: 'text', text: 'Please inspect the adapter' }],
            },
          },
          {
            type: 'message',
            id: 'assistant-1',
            parentId: 'user-1',
            timestamp: '2026-04-16T07:12:40.069Z',
            message: {
              role: 'assistant',
              api: 'openai-codex-responses',
              provider: 'openai-codex',
              model: 'gpt-5.4',
              content: [
                { type: 'thinking', thinking: 'hidden' },
                { type: 'toolCall', name: 'read', arguments: { path: 'README.md' } },
                { type: 'text', text: 'I inspected the adapter.' },
              ],
            },
          },
          {
            type: 'message',
            id: 'tool-1',
            parentId: 'assistant-1',
            timestamp: '2026-04-16T07:12:40.176Z',
            message: {
              role: 'toolResult',
              toolCallId: 'call-1',
              toolName: 'read',
              content: [{ type: 'text', text: 'README contents' }],
            },
          },
        ],
      },
    ],
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].session.externalId, 'pi-ses-1');
  assert.equal(normalized[0].messages.length, 2);
  assert.equal(normalized[0].messages[0].content, 'Please inspect the adapter');
  assert.equal(normalized[0].messages[1].content, 'I inspected the adapter.');
  assert.equal(normalized[0].workReports.length, 0);
  assert.equal(normalized[0].session.sourceMetadata.cwd, '/workspace/project-a');
  assert.equal(normalized[0].session.sourceMetadata.modelChanges[0].modelId, 'gpt-5.4');
  assert.equal(normalized[0].session.sourceMetadata.toolResults[0].toolName, 'read');
});
