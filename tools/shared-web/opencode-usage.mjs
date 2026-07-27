// OpenCode records the same per-response usage twice: once on the assistant
// `message` row and once on that message's `step-finish` `part` rows. Session
// Browser and Tokens / Cost Analyzer must agree on one total, so the field
// resolution, total/fallback rule, and message/part de-duplication live here.

const TOTAL_COMPONENTS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'];

function known(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function firstKnown(...values) {
  for (const value of values) {
    const number = known(value);
    if (number != null) return number;
  }
  return null;
}

// Each component is number when OpenCode recorded it, otherwise null (unknown, not zero).
export function openCodeTokenValues(tokens) {
  const source = tokens || {};
  const cache = source.cache || {};
  return {
    input: firstKnown(source.input, source.prompt),
    output: firstKnown(source.output, source.completion),
    reasoning: firstKnown(source.reasoning),
    cacheRead: firstKnown(source.cacheRead, source.cache_read, cache.read),
    cacheWrite: firstKnown(source.cacheWrite, source.cache_write, cache.write),
    explicitTotal: firstKnown(source.total),
  };
}

// Unknown components collapse to 0 for callers that only aggregate numbers.
export function openCodeTokenComponents(tokens) {
  const values = openCodeTokenValues(tokens);
  return Object.fromEntries(TOTAL_COMPONENTS.map((field) => [field, values[field] || 0]));
}

// OpenCode's explicit per-response total is authoritative when present and positive;
// otherwise the total is derived from the components, reasoning included.
export function openCodeTotalTokens(tokens) {
  const values = openCodeTokenValues(tokens);
  if (values.explicitTotal != null && values.explicitTotal > 0) return values.explicitTotal;
  return TOTAL_COMPONENTS.reduce((sum, field) => sum + (values[field] || 0), 0);
}

export function hasOpenCodeUsage(tokens) {
  return openCodeTotalTokens(tokens) > 0;
}

function emptyOpenCodeUsage() {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, latestContext: null };
}

function addOpenCodeUsage(usage, tokens) {
  const components = openCodeTokenComponents(tokens);
  for (const field of TOTAL_COMPONENTS) usage[field] += components[field];
  usage.total += openCodeTotalTokens(tokens);
  return usage;
}

// Message-level usage wins; a message's parts are counted only when the message row
// carries no usage of its own, so duplicated payloads are never summed twice.
export function openCodeSessionUsage(messages = [], parts = []) {
  const partsByMessage = new Map();
  for (const part of parts) {
    const messageId = part?.messageId ?? part?.message_id ?? '';
    if (!partsByMessage.has(messageId)) partsByMessage.set(messageId, []);
    partsByMessage.get(messageId).push(part);
  }
  const usage = emptyOpenCodeUsage();
  const seenMessageIds = new Set();
  let latestContextAt = null;
  const add = (row, tokens) => {
    addOpenCodeUsage(usage, tokens);
    const components = openCodeTokenComponents(tokens);
    const context = components.input + components.output + components.cacheRead + components.cacheWrite;
    const createdAt = Number(row?.createdAt ?? row?.time_created ?? row?.data?.time?.created);
    if (Number.isFinite(createdAt)) {
      if (latestContextAt == null || createdAt >= latestContextAt) {
        latestContextAt = createdAt;
        usage.latestContext = context;
      }
    } else if (latestContextAt == null) {
      usage.latestContext = context;
    }
  };
  for (const message of messages) {
    const messageId = message?.id ?? '';
    seenMessageIds.add(messageId);
    const tokens = message?.data?.tokens;
    if (hasOpenCodeUsage(tokens)) {
      add(message, tokens);
      continue;
    }
    for (const part of partsByMessage.get(messageId) || []) add(part, part?.data?.tokens);
  }
  for (const [messageId, group] of partsByMessage) {
    if (seenMessageIds.has(messageId)) continue;
    for (const part of group) add(part, part?.data?.tokens);
  }
  return usage;
}

function jsonNumber(alias, path) {
  return `coalesce(json_extract(${alias}.data, '$.tokens.${path}'), 0)`;
}

function jsonFirst(alias, paths) {
  return `coalesce(${paths.map((path) => `json_extract(${alias}.data, '$.tokens.${path}')`).join(', ')}, 0)`;
}

// SQL mirror of openCodeTokenValues / openCodeTotalTokens for aggregate list queries.
export function openCodeTokenSql(alias) {
  const columns = {
    input: jsonFirst(alias, ['input', 'prompt']),
    output: jsonFirst(alias, ['output', 'completion']),
    reasoning: jsonNumber(alias, 'reasoning'),
    cacheRead: jsonFirst(alias, ['cacheRead', 'cache_read', 'cache.read']),
    cacheWrite: jsonFirst(alias, ['cacheWrite', 'cache_write', 'cache.write']),
  };
  const derivedTotal = TOTAL_COMPONENTS.map((field) => columns[field]).join(' + ');
  return {
    ...columns,
    total: `coalesce(nullif(json_extract(${alias}.data, '$.tokens.total'), 0), ${derivedTotal})`,
    context: `${columns.input} + ${columns.output} + ${columns.cacheRead} + ${columns.cacheWrite}`,
  };
}
