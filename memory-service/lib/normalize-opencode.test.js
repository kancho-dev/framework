const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTextContent, normalizeOpenCodeTranscript } = require('./normalize-opencode');

test('extractTextContent strips thinking and tool noise', () => {
  const result = extractTextContent([
    { type: 'thinking', text: 'hidden' },
    { type: 'text', text: 'hello' },
    { type: 'tool_call', text: 'skip me' },
    { type: 'text', text: 'world' },
  ]);

  assert.equal(result, 'hello\nworld');
});

test('normalizeOpenCodeTranscript returns session, messages, and work reports', () => {
  const content = [
    JSON.stringify({ type: 'session', id: 'sess-1', timestamp: '2026-04-14T10:00:00Z', source: 'cli' }),
    JSON.stringify({ type: 'message', id: 'm1', timestamp: '2026-04-14T10:01:00Z', message: { role: 'user', content: 'Plan the task' } }),
    JSON.stringify({ type: 'message', id: 'm2', timestamp: '2026-04-14T10:02:00Z', message: { role: 'assistant', content: [{ type: 'thinking', text: 'hidden' }, { type: 'text', text: 'Done' }] } }),
    JSON.stringify({ type: 'work_report', id: 'wr1', timestamp: '2026-04-14T10:03:00Z', project: 'agent-framework', work_item: 'task-1', summary: 'Completed planning' }),
  ].join('\n');

  const normalized = normalizeOpenCodeTranscript({
    content,
    sourcePath: '/tmp/sample.jsonl',
    workspace: 'demo',
  });

  assert.equal(normalized.session.platform, 'opencode');
  assert.equal(normalized.session.workspace, 'demo');
  assert.equal(normalized.session.externalId, 'sess-1');
  assert.equal(normalized.messages.length, 2);
  assert.equal(normalized.messages[1].content, 'Done');
  assert.equal(normalized.workReports.length, 1);
  assert.equal(normalized.workReports[0].project, 'agent-framework');
});
