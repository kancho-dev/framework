const crypto = require('crypto');
const path = require('path');

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

function shouldIncludePiSession(session, scope, workspaceRoot) {
  if (scope === 'all') return true;
  return isPathInside(workspaceRoot, session.cwd);
}

function buildMessageSourceType(message) {
  const pieces = ['pi'];
  if (message.api) pieces.push(message.api);
  if (message.provider) pieces.push(message.provider);
  if (message.model) pieces.push(message.model);
  return pieces.join(':');
}

function buildSessionSourceHash(sessionFile) {
  return crypto.createHash('sha256').update(JSON.stringify(sessionFile.records)).digest('hex');
}

function buildSessionMetadata(sessionRecord, records) {
  const modelChanges = records
    .filter((record) => record.type === 'model_change')
    .map((record) => ({ provider: record.provider || null, modelId: record.modelId || null, timestamp: record.timestamp || null }));

  const thinkingLevels = records
    .filter((record) => record.type === 'thinking_level_change')
    .map((record) => ({ thinkingLevel: record.thinkingLevel || null, timestamp: record.timestamp || null }));

  return {
    cwd: sessionRecord.cwd || null,
    version: sessionRecord.version || null,
    modelChanges,
    thinkingLevels,
  };
}

function normalizeAssistantText(content) {
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeUserText(content) {
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildToolResultText(message) {
  const parts = message.content || [];
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizePiSessionFile({ workspace, workspaceRoot, scope, sessionFile }) {
  const sessionRecord = sessionFile.records.find((record) => record.type === 'session');
  if (!sessionRecord) return null;
  if (!shouldIncludePiSession(sessionRecord, scope, workspaceRoot)) return null;

  const messages = sessionFile.records
    .filter((record) => record.type === 'message')
    .map((record) => {
      const message = record.message || {};
      const content = Array.isArray(message.content) ? message.content : [];
      let normalizedContent = null;

      if (message.role === 'user') {
        normalizedContent = normalizeUserText(content);
      } else if (message.role === 'assistant') {
        normalizedContent = normalizeAssistantText(content);
      } else if (message.role === 'toolResult') {
        normalizedContent = null;
      }

      if (!normalizedContent) return null;

      return {
        externalId: record.id,
        parentExternalId: record.parentId || null,
        role: message.role,
        content: normalizedContent,
        sourceType: buildMessageSourceType(message),
        createdAt: record.timestamp || message.timestamp || null,
      };
    })
    .filter(Boolean);

  const toolResults = sessionFile.records
    .filter((record) => record.type === 'message' && record.message?.role === 'toolResult')
    .map((record) => ({
      toolName: record.message.toolName || null,
      toolCallId: record.message.toolCallId || null,
      hasTextOutput: Boolean(buildToolResultText(record.message)),
      timestamp: record.timestamp || null,
    }));

  return {
    session: {
      platform: 'pi',
      workspace,
      externalId: sessionRecord.id,
      sessionType: 'session',
      sourcePath: sessionFile.filePath,
      sourceHash: buildSessionSourceHash(sessionFile),
      sourceMetadata: {
        ...buildSessionMetadata(sessionRecord, sessionFile.records),
        toolResults,
      },
      startedAt: sessionRecord.timestamp || null,
      endedAt: messages.at(-1)?.createdAt || sessionRecord.timestamp || null,
      messageCount: messages.length,
    },
    messages,
    workReports: [],
  };
}

function normalizePiJsonl({ workspace, workspaceRoot, scope, sessionFiles }) {
  return sessionFiles
    .map((sessionFile) => normalizePiSessionFile({ workspace, workspaceRoot, scope, sessionFile }))
    .filter(Boolean);
}

module.exports = {
  normalizePiJsonl,
  normalizePiSessionFile,
  shouldIncludePiSession,
};
