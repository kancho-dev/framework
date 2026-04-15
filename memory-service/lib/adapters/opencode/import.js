const { readOpenCodeData } = require('./read-sqlite');
const { normalizeOpenCodeSqlite } = require('./normalize');

async function upsertSession(client, schema, session) {
  const { rows } = await client.query(
    `INSERT INTO ${schema}.sessions (
      platform, workspace, external_id, session_type, source_path, source_hash, started_at, ended_at, message_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (platform, workspace, external_id) DO UPDATE SET
      session_type = EXCLUDED.session_type,
      source_path = EXCLUDED.source_path,
      source_hash = EXCLUDED.source_hash,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      message_count = EXCLUDED.message_count,
      updated_at = NOW()
    RETURNING id`,
    [
      session.platform,
      session.workspace,
      session.externalId,
      session.sessionType,
      session.sourcePath,
      session.sourceHash,
      session.startedAt,
      session.endedAt,
      session.messageCount,
    ]
  );

  return rows[0].id;
}

async function insertMessages(client, schema, sessionId, session, messages) {
  for (const message of messages) {
    await client.query(
      `INSERT INTO ${schema}.messages (
        platform, workspace, session_id, external_id, parent_external_id, role, content, source_type, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (platform, workspace, session_id, external_id) DO NOTHING`,
      [
        session.platform,
        session.workspace,
        sessionId,
        message.externalId,
        message.parentExternalId,
        message.role,
        message.content,
        message.sourceType,
        message.createdAt,
      ]
    );
  }
}

async function upsertWorkReports(client, schema, sessionId, session, workReports) {
  for (const report of workReports) {
    await client.query(
      `INSERT INTO ${schema}.work_reports (
        platform, workspace, session_id, external_id, project, work_item, summary, source_type, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (platform, workspace, external_id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        project = EXCLUDED.project,
        work_item = EXCLUDED.work_item,
        summary = EXCLUDED.summary,
        source_type = EXCLUDED.source_type,
        created_at = EXCLUDED.created_at`,
      [
        session.platform,
        session.workspace,
        sessionId,
        report.externalId,
        report.project,
        report.workItem,
        report.summary,
        report.sourceType,
        report.createdAt,
      ]
    );
  }
}

async function importOpenCodeSqlite(pool, config, dbPath, scope = 'workspace') {
  const raw = readOpenCodeData(dbPath);
  const normalizedSessions = normalizeOpenCodeSqlite({
    dbPath,
    workspace: config.workspace,
    workspaceRoot: config.workspaceRoot,
    scope,
    raw,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let importedSessions = 0;
    let importedMessages = 0;
    let importedReports = 0;

    for (const normalized of normalizedSessions) {
      const sessionId = await upsertSession(client, config.db.schema, normalized.session);
      await insertMessages(client, config.db.schema, sessionId, normalized.session, normalized.messages);
      await upsertWorkReports(client, config.db.schema, sessionId, normalized.session, normalized.workReports);

      importedSessions += 1;
      importedMessages += normalized.messages.length;
      importedReports += normalized.workReports.length;
    }

    await client.query('COMMIT');

    return {
      sessions: importedSessions,
      messages: importedMessages,
      workReports: importedReports,
      scope,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  importOpenCodeSqlite,
};
