const { execFileSync } = require('child_process');

function querySqlite(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });

  const text = output.trim();
  if (!text) return [];
  return JSON.parse(text);
}

function readOpenCodeData(dbPath) {
  const sessions = querySqlite(
    dbPath,
    `SELECT s.id, s.project_id, s.parent_id, s.slug, s.directory, s.title, s.version,
            s.time_created, s.time_updated, s.time_archived, s.workspace_id,
            p.worktree AS project_worktree, p.name AS project_name
     FROM session s
     JOIN project p ON p.id = s.project_id
     ORDER BY s.time_created ASC`
  );

  const messages = querySqlite(
    dbPath,
    `SELECT id, session_id, time_created, time_updated, data
     FROM message
     ORDER BY session_id, time_created, id`
  );

  const parts = querySqlite(
    dbPath,
    `SELECT id, message_id, session_id, time_created, time_updated, data
     FROM part
     ORDER BY session_id, message_id, time_created, id`
  );

  const todos = querySqlite(
    dbPath,
    `SELECT session_id, content, status, priority, position, time_created, time_updated
     FROM todo
     ORDER BY session_id, position ASC`
  );

  return {
    sessions,
    messages,
    parts,
    todos,
  };
}

module.exports = {
  querySqlite,
  readOpenCodeData,
};
