const { readPiSessions } = require('./read-jsonl');
const { normalizePiJsonl } = require('./normalize');
const { importNormalizedSessions } = require('../../import-records');

async function importPiJsonl(pool, config, sessionsRoot, scope = 'workspace') {
  const sessionFiles = readPiSessions(sessionsRoot);
  const normalizedSessions = normalizePiJsonl({
    workspace: config.workspace,
    workspaceRoot: config.workspaceRoot,
    scope,
    sessionFiles,
  });

  const stats = {
    scope,
    scannedSessions: sessionFiles.length,
    eligibleSessions: normalizedSessions.length,
    sessionsInserted: 0,
    sessionsUpdated: 0,
    sessionsUnchanged: 0,
    messagesInserted: 0,
    messagesUpdated: 0,
    messagesUnchanged: 0,
    workReportsInserted: 0,
    workReportsUpdated: 0,
    workReportsUnchanged: 0,
  };

  return importNormalizedSessions(pool, config, normalizedSessions, stats);
}

module.exports = {
  importPiJsonl,
};
