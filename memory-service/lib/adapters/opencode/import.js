const { readOpenCodeData } = require('./read-sqlite');
const { normalizeOpenCodeSqlite } = require('./normalize');

async function findExistingSession(client, schema, session) {
  const { rows } = await client.query(
    `SELECT id, source_hash, message_count, ended_at
     FROM ${schema}.sessions
     WHERE platform = $1 AND workspace = $2 AND external_id = $3`,
    [session.platform, session.workspace, session.externalId]
  );
  return rows[0] || null;
}

async function upsertSession(client, schema, session) {
  const existing = await findExistingSession(client, schema, session);
  const { rows } = await client.query(
    `INSERT INTO ${schema}.sessions (
      platform, workspace, external_id, session_type, source_path, source_hash, source_metadata, started_at, ended_at, message_count, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NOW())
    ON CONFLICT (platform, workspace, external_id) DO UPDATE SET
      session_type = EXCLUDED.session_type,
      source_path = EXCLUDED.source_path,
      source_hash = EXCLUDED.source_hash,
      source_metadata = EXCLUDED.source_metadata,
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
      JSON.stringify(session.sourceMetadata || null),
      session.startedAt,
      session.endedAt,
      session.messageCount,
    ]
  );

  const status = !existing
    ? 'inserted'
    : existing.source_hash !== session.sourceHash || Number(existing.message_count) !== Number(session.messageCount) || String(existing.ended_at || '') !== String(session.endedAt || '')
      ? 'updated'
      : 'unchanged';

  return {
    id: rows[0].id,
    status,
  };
}

async function insertMessages(client, schema, sessionId, session, messages) {
  let inserted = 0;
  let skipped = 0;

  for (const message of messages) {
    const result = await client.query(
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

    if (result.rowCount > 0) inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped };
}

async function findExistingWorkReport(client, schema, session, report) {
  const { rows } = await client.query(
    `SELECT summary, created_at
     FROM ${schema}.work_reports
     WHERE platform = $1 AND workspace = $2 AND external_id = $3`,
    [session.platform, session.workspace, report.externalId]
  );
  return rows[0] || null;
}

async function upsertWorkReports(client, schema, sessionId, session, workReports) {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const report of workReports) {
    const existing = await findExistingWorkReport(client, schema, session, report);
    await client.query(
      `INSERT INTO ${schema}.work_reports (
        platform, workspace, session_id, external_id, project, work_item, summary, source_type, source_metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (platform, workspace, external_id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        project = EXCLUDED.project,
        work_item = EXCLUDED.work_item,
        summary = EXCLUDED.summary,
        source_type = EXCLUDED.source_type,
        source_metadata = EXCLUDED.source_metadata,
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
        JSON.stringify(report.sourceMetadata || null),
        report.createdAt,
      ]
    );

    if (!existing) inserted += 1;
    else if (existing.summary !== report.summary || String(existing.created_at || '') !== String(report.createdAt || '')) updated += 1;
    else unchanged += 1;
  }

  return { inserted, updated, unchanged };
}

async function importOpenCodeSqlite(pool, config, dbPath, scope = 'workspace') {
  const raw = readOpenCodeData(dbPath, config.opencode.sqliteBin);
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

    const stats = {
      scope,
      scannedSessions: raw.sessions.length,
      eligibleSessions: normalizedSessions.length,
      sessionsInserted: 0,
      sessionsUpdated: 0,
      sessionsUnchanged: 0,
      messagesInserted: 0,
      messagesSkipped: 0,
      workReportsInserted: 0,
      workReportsUpdated: 0,
      workReportsUnchanged: 0,
    };

    for (const normalized of normalizedSessions) {
      const sessionResult = await upsertSession(client, config.db.schema, normalized.session);
      const messageResult = await insertMessages(client, config.db.schema, sessionResult.id, normalized.session, normalized.messages);
      const reportResult = await upsertWorkReports(client, config.db.schema, sessionResult.id, normalized.session, normalized.workReports);

      if (sessionResult.status === 'inserted') stats.sessionsInserted += 1;
      else if (sessionResult.status === 'updated') stats.sessionsUpdated += 1;
      else stats.sessionsUnchanged += 1;

      stats.messagesInserted += messageResult.inserted;
      stats.messagesSkipped += messageResult.skipped;
      stats.workReportsInserted += reportResult.inserted;
      stats.workReportsUpdated += reportResult.updated;
      stats.workReportsUnchanged += reportResult.unchanged;
    }

    await client.query('COMMIT');

    return stats;
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
