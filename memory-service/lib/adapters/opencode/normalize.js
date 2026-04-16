const path = require('path');
const crypto = require('crypto');

const IGNORED_PART_TYPES = new Set(['reasoning', 'step-start', 'step-finish']);

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIsoTime(value) {
  if (!value && value !== 0) return null;
  return new Date(Number(value)).toISOString();
}

function normalizePath(input) {
  if (!input) return null;
  return path.resolve(input);
}

function isPathInside(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) return false;
  const normalizedRoot = normalizePath(rootPath);
  const normalizedCandidate = normalizePath(candidatePath);
  if (!normalizedRoot || !normalizedCandidate) return false;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function shouldIncludeSession(session, scope, workspaceRoot) {
  if (scope === 'all') return true;
  return isPathInside(workspaceRoot, session.directory) || isPathInside(workspaceRoot, session.project_worktree);
}

function partText(partData) {
  if (!partData || !partData.type) return null;
  if (IGNORED_PART_TYPES.has(partData.type)) return null;
  if (partData.type === 'text') return typeof partData.text === 'string' ? partData.text.trim() : null;
  return null;
}

function buildSourceType(messageData) {
  const pieces = ['opencode'];
  if (messageData.agent) pieces.push(messageData.agent);
  if (messageData.mode) pieces.push(messageData.mode);
  return pieces.join(':');
}

function hashSessionFingerprint(session) {
  const value = [session.id, session.project_id, session.directory, session.time_created].join('|');
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildTodoMetadata(todos) {
  const completed = todos.filter((todo) => todo.status === 'completed');
  const remaining = todos.filter((todo) => todo.status !== 'completed');
  const statuses = {};

  todos.forEach((todo) => {
    const key = todo.status || 'unknown';
    statuses[key] = (statuses[key] || 0) + 1;
  });

  return {
    todoCount: todos.length,
    completedCount: completed.length,
    openCount: remaining.length,
    statuses,
  };
}

function buildSessionMetadata(session) {
  return {
    projectId: session.project_id || null,
    parentId: session.parent_id || null,
    slug: session.slug || null,
    title: session.title || null,
    version: session.version || null,
    directory: session.directory || null,
    workspaceId: session.workspace_id || null,
    projectName: session.project_name || null,
    projectWorktree: session.project_worktree || null,
    archivedAt: toIsoTime(session.time_archived),
  };
}

function buildWorkReport(session, todos) {
  if (!todos.length) return null;

  const completed = todos.filter((todo) => todo.status === 'completed');
  const remaining = todos.filter((todo) => todo.status !== 'completed');
  const lines = [`Session: ${session.title}`];

  if (completed.length) {
    lines.push('', 'Completed:');
    completed.forEach((todo) => {
      lines.push(`- ${todo.content}`);
    });
  }

  if (remaining.length) {
    lines.push('', 'Open:');
    remaining.forEach((todo) => {
      lines.push(`- [${todo.status}] ${todo.content}`);
    });
  }

  return {
    externalId: `opencode-todo-report:${session.id}`,
    project: session.project_worktree || session.directory || null,
    workItem: session.slug || session.title || null,
    summary: lines.join('\n').trim(),
    sourceType: 'opencode:todo-derived',
    sourceMetadata: buildTodoMetadata(todos),
    createdAt: toIsoTime(Math.max(...todos.map((todo) => Number(todo.time_updated || todo.time_created || 0)))) || toIsoTime(session.time_updated),
  };
}

function normalizeOpenCodeSqlite({ dbPath, workspace, workspaceRoot, scope, raw }) {
  const messagesBySession = new Map();
  const partsByMessage = new Map();
  const todosBySession = new Map();

  raw.messages.forEach((message) => {
    const list = messagesBySession.get(message.session_id) || [];
    list.push(message);
    messagesBySession.set(message.session_id, list);
  });

  raw.parts.forEach((part) => {
    const list = partsByMessage.get(part.message_id) || [];
    list.push(part);
    partsByMessage.set(part.message_id, list);
  });

  raw.todos.forEach((todo) => {
    const list = todosBySession.get(todo.session_id) || [];
    list.push(todo);
    todosBySession.set(todo.session_id, list);
  });

  return raw.sessions
    .filter((session) => shouldIncludeSession(session, scope, workspaceRoot))
    .map((session) => {
      const sessionMessages = messagesBySession.get(session.id) || [];
      const normalizedMessages = sessionMessages
        .map((message) => {
          const messageData = parseJson(message.data) || {};
          const parts = (partsByMessage.get(message.id) || [])
            .map((part) => parseJson(part.data))
            .filter(Boolean);

          const content = parts
            .map(partText)
            .filter(Boolean)
            .join('\n')
            .trim();

          if (!content) return null;

          return {
            externalId: message.id,
            parentExternalId: messageData.parentID || null,
            role: messageData.role || 'assistant',
            content,
            sourceType: buildSourceType(messageData),
            createdAt: toIsoTime(message.time_created) || toIsoTime(messageData.time?.created),
          };
        })
        .filter(Boolean);

      const normalizedTodos = todosBySession.get(session.id) || [];
      const workReport = buildWorkReport(session, normalizedTodos);

      return {
        session: {
          platform: 'opencode',
          workspace,
          externalId: session.id,
          sessionType: session.parent_id ? 'child-session' : 'session',
          sourcePath: dbPath,
          sourceHash: hashSessionFingerprint(session),
          sourceMetadata: buildSessionMetadata(session),
          startedAt: toIsoTime(session.time_created),
          endedAt: toIsoTime(session.time_archived || session.time_updated),
          messageCount: normalizedMessages.length,
        },
        messages: normalizedMessages,
        workReports: workReport ? [workReport] : [],
      };
    });
}

module.exports = {
  normalizeOpenCodeSqlite,
  shouldIncludeSession,
};
