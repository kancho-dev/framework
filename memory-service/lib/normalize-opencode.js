const crypto = require('crypto');

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractTextContent(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;

  if (Array.isArray(value)) {
    const text = value
      .filter((part) => part && !['thinking', 'tool_call', 'tool_result'].includes(part.type))
      .map((part) => part.text || part.content || '')
      .join('\n')
      .trim();
    return text || null;
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text.trim() || null;
    if (typeof value.content === 'string') return value.content.trim() || null;
  }

  return null;
}

function getRole(entry) {
  return entry.role || entry.message?.role || null;
}

function getCreatedAt(entry) {
  return entry.timestamp || entry.created_at || entry.createdAt || null;
}

function getExternalId(entry, fallbackPrefix, index) {
  return entry.id || entry.message_id || entry.message?.id || `${fallbackPrefix}-${index}`;
}

function hashFileContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function normalizeOpenCodeTranscript({ content, sourcePath, workspace }) {
  const lines = content.split('\n').filter((line) => line.trim());
  const entries = lines.map(parseJsonLine).filter(Boolean);

  if (entries.length === 0) {
    throw new Error('No valid JSONL entries found in transcript');
  }

  const sessionEntry = entries.find((entry) => entry.type === 'session') || entries[0];
  const sessionExternalId = sessionEntry.session_id || sessionEntry.id || sessionEntry.sessionId || hashFileContent(sourcePath);

  const messages = [];
  const workReports = [];

  entries.forEach((entry, index) => {
    if (entry.type === 'message' || entry.message || entry.role) {
      const role = getRole(entry);
      if (!role || !['system', 'user', 'assistant', 'tool'].includes(role)) return;

      const contentText = extractTextContent(entry.message?.content || entry.content);
      if (!contentText) return;

      messages.push({
        externalId: getExternalId(entry, 'msg', index),
        parentExternalId: entry.parent_id || entry.parentId || null,
        role,
        content: contentText,
        sourceType: entry.source || sessionEntry.source || 'opencode',
        createdAt: getCreatedAt(entry) || new Date().toISOString(),
      });
      return;
    }

    if (entry.type === 'work_report') {
      const summary = extractTextContent(entry.summary || entry.content);
      if (!summary) return;

      workReports.push({
        externalId: getExternalId(entry, 'work-report', index),
        project: entry.project || null,
        workItem: entry.work_item || entry.workItem || null,
        summary,
        sourceType: entry.source || 'opencode',
        createdAt: getCreatedAt(entry) || new Date().toISOString(),
      });
    }
  });

  const startedAt = getCreatedAt(sessionEntry) || messages[0]?.createdAt || null;
  const endedAt = messages[messages.length - 1]?.createdAt || startedAt;

  return {
    session: {
      platform: 'opencode',
      workspace,
      externalId: sessionExternalId,
      sessionType: sessionEntry.session_type || sessionEntry.sessionType || 'session',
      sourcePath,
      sourceHash: hashFileContent(content),
      startedAt,
      endedAt,
      messageCount: messages.length,
    },
    messages,
    workReports,
  };
}

module.exports = {
  extractTextContent,
  normalizeOpenCodeTranscript,
};
