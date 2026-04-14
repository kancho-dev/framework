const { formatTimestamp, truncate } = require('./format');

async function searchMessages(pool, schema, query, limit = 20) {
  const { rows } = await pool.query(
    `SELECT s.external_id AS session_external_id, m.role, m.content, m.created_at,
            ts_rank(to_tsvector('english', COALESCE(m.content, '')), websearch_to_tsquery('english', $1)) AS rank
     FROM ${schema}.messages m
     JOIN ${schema}.sessions s ON s.id = m.session_id
     WHERE to_tsvector('english', COALESCE(m.content, '')) @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC, m.created_at DESC
     LIMIT $2`,
    [query, limit]
  );

  rows.forEach((row) => {
    console.log(`[${formatTimestamp(row.created_at)}] ${row.role} @ ${row.session_external_id}`);
    console.log(`  ${truncate(row.content, 240)}\n`);
  });
}

async function recentMessages(pool, schema, limit = 20) {
  const { rows } = await pool.query(
    `SELECT s.external_id AS session_external_id, m.role, m.content, m.created_at
     FROM ${schema}.messages m
     JOIN ${schema}.sessions s ON s.id = m.session_id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [limit]
  );

  rows.reverse().forEach((row) => {
    console.log(`[${formatTimestamp(row.created_at)}] ${row.role} @ ${row.session_external_id}`);
    console.log(`  ${truncate(row.content, 240)}`);
  });
}

async function listReports(pool, schema, limit = 10) {
  const { rows } = await pool.query(
    `SELECT project, work_item, summary, created_at
     FROM ${schema}.work_reports
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  rows.forEach((row) => {
    console.log(`[${formatTimestamp(row.created_at)}] ${row.project || '—'} / ${row.work_item || '—'}`);
    console.log(`  ${truncate(row.summary, 240)}\n`);
  });
}

async function listSessions(pool, schema, limit = 20) {
  const { rows } = await pool.query(
    `SELECT external_id, session_type, message_count, started_at, ended_at
     FROM ${schema}.sessions
     ORDER BY COALESCE(ended_at, started_at) DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  rows.forEach((row) => {
    console.log(`${row.external_id} | ${row.session_type || 'session'} | ${row.message_count} msgs | ${formatTimestamp(row.started_at)} -> ${formatTimestamp(row.ended_at)}`);
  });
}

async function searchLessons(pool, schema, query, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, category, severity, title, description, tags, created_at
     FROM ${schema}.lessons
     WHERE to_tsvector('english', title || ' ' || description) @@ websearch_to_tsquery('english', $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [query, limit]
  );

  rows.forEach((row) => {
    console.log(`#${row.id} [${row.severity}] ${row.title}`);
    console.log(`  category: ${row.category || '—'} | tags: ${(row.tags || []).join(', ') || '—'} | ${formatTimestamp(row.created_at)}`);
    console.log(`  ${truncate(row.description, 240)}\n`);
  });
}

async function addLesson(pool, schema, workspace, lesson) {
  const { rows } = await pool.query(
    `INSERT INTO ${schema}.lessons (
      workspace, category, severity, title, description, tags, related_project, related_work_item, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      workspace,
      lesson.category,
      lesson.severity,
      lesson.title,
      lesson.description,
      lesson.tags,
      lesson.relatedProject,
      lesson.relatedWorkItem,
      lesson.createdBy,
    ]
  );

  console.log(`Added lesson #${rows[0].id}`);
}

module.exports = {
  addLesson,
  listReports,
  listSessions,
  recentMessages,
  searchLessons,
  searchMessages,
};
