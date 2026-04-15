const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOpenCodeSqlite, shouldIncludeSession } = require('./normalize');

test('shouldIncludeSession respects workspace scope filtering', () => {
  const session = {
    directory: '/workspace/project-a',
    project_worktree: '/workspace',
  };

  assert.equal(shouldIncludeSession(session, 'workspace', '/workspace'), true);
  assert.equal(shouldIncludeSession(session, 'workspace', '/other'), false);
  assert.equal(shouldIncludeSession(session, 'all', '/other'), true);
});

test('normalizeOpenCodeSqlite keeps text parts, drops reasoning and creates todo-derived report', () => {
  const normalized = normalizeOpenCodeSqlite({
    dbPath: '/tmp/opencode.db',
    workspace: 'agent-framework-ws',
    workspaceRoot: '/workspace',
    scope: 'workspace',
    raw: {
      sessions: [
        {
          id: 'ses-1',
          project_id: 'proj-1',
          parent_id: null,
          slug: 'clever-panda',
          directory: '/workspace/project-a',
          title: 'Example session',
          version: '1.0.0',
          time_created: 1000,
          time_updated: 2000,
          time_archived: null,
          workspace_id: null,
          project_worktree: '/workspace/project-a',
          project_name: null,
        },
      ],
      messages: [
        {
          id: 'msg-1',
          session_id: 'ses-1',
          time_created: 1100,
          time_updated: 1100,
          data: JSON.stringify({ role: 'user', agent: 'build' }),
        },
        {
          id: 'msg-2',
          session_id: 'ses-1',
          time_created: 1200,
          time_updated: 1300,
          data: JSON.stringify({ role: 'assistant', parentID: 'msg-1', agent: 'build', mode: 'build' }),
        },
      ],
      parts: [
        {
          id: 'part-1',
          message_id: 'msg-1',
          session_id: 'ses-1',
          time_created: 1101,
          time_updated: 1101,
          data: JSON.stringify({ type: 'text', text: 'Plan the task' }),
        },
        {
          id: 'part-2',
          message_id: 'msg-2',
          session_id: 'ses-1',
          time_created: 1201,
          time_updated: 1201,
          data: JSON.stringify({ type: 'reasoning', text: 'hidden' }),
        },
        {
          id: 'part-3',
          message_id: 'msg-2',
          session_id: 'ses-1',
          time_created: 1202,
          time_updated: 1202,
          data: JSON.stringify({ type: 'text', text: 'Done' }),
        },
      ],
      todos: [
        {
          session_id: 'ses-1',
          content: 'Plan the task',
          status: 'completed',
          priority: 'high',
          position: 0,
          time_created: 1300,
          time_updated: 1400,
        },
      ],
    },
  });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].session.externalId, 'ses-1');
  assert.equal(normalized[0].messages.length, 2);
  assert.equal(normalized[0].messages[1].content, 'Done');
  assert.equal(normalized[0].workReports.length, 1);
  assert.match(normalized[0].workReports[0].summary, /Completed:/);
});
