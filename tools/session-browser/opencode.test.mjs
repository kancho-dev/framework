import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const execFileAsync = promisify(execFile);

// server.mjs reads OPENCODE_DB / WORKSPACE_ROOT / SESSION_SOURCES at load time,
// so the synthetic database must exist before it is imported.
const workspaceRoot = await mkdtemp(join(tmpdir(), 'oc-ws-'));
const dataDir = await mkdtemp(join(tmpdir(), 'oc-data-'));
const opencodeDb = join(dataDir, 'opencode.db');
await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n');

// Real OpenCode payload shape: nested cache, reasoning beside output, and a
// `total` that already sums every component.
const usage = (input, output, reasoning, cacheRead) => ({
  total: input + output + reasoning + cacheRead,
  input,
  output,
  reasoning,
  cache: { write: 0, read: cacheRead },
});

const assistant = (tokens) => ({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-test', tokens });

const sql = (value) => value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`;
const row = (table, values) => `insert into ${table} values (${values.map(sql).join(',')});`;

// DUPLICATED stores identical usage on the message and its step-finish part,
// MESSAGE_ONLY only on the message, PART_ONLY only on the part.
const duplicated = usage(795, 118, 12, 17408);
const messageOnly = usage(100, 10, 5, 200);
const partOnly = usage(50, 5, 2, 100);

await execFileAsync('sqlite3', [opencodeDb, [
  'create table session (id text primary key, parent_id text, directory text, path text, title text, model text, cost real, tokens_input integer, tokens_output integer, tokens_cache_read integer, tokens_cache_write integer, time_created integer, time_updated integer, time_archived integer);',
  'create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);',
  'create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);',
  row('session', ['ses_dup', null, workspaceRoot, workspaceRoot, 'Duplicated usage', '{"providerID":"anthropic","id":"claude-test"}', 0, 0, 0, 0, 0, 1000, 1000, null]),
  row('session', ['ses_partial', null, workspaceRoot, workspaceRoot, 'Partial usage', '{"providerID":"anthropic","id":"claude-test"}', 0, 0, 0, 0, 0, 900, 900, null]),
  row('message', ['msg_dup', 'ses_dup', 1000, 1000, JSON.stringify(assistant(duplicated))]),
  row('part', ['prt_dup', 'msg_dup', 'ses_dup', 1000, 1000, JSON.stringify({ type: 'step-finish', tokens: duplicated })]),
  row('message', ['msg_message_only', 'ses_partial', 900, 900, JSON.stringify(assistant(messageOnly))]),
  row('part', ['prt_text', 'msg_message_only', 'ses_partial', 900, 900, JSON.stringify({ type: 'text', text: 'hello' })]),
  row('message', ['msg_part_only', 'ses_partial', 901, 901, JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-test' })]),
  row('part', ['prt_part_only', 'msg_part_only', 'ses_partial', 901, 901, JSON.stringify({ type: 'step-finish', tokens: partOnly })]),
].join('\n')]);

process.env.SESSION_SOURCES = 'opencode';
process.env.OPENCODE_DB = opencodeDb;
process.env.OPENCODE_DATA_DIR = dataDir;
process.env.WORKSPACE_ROOT = workspaceRoot;
process.env.SESSION_BROWSER_METADATA = join(workspaceRoot, 'metadata.json');

const { createSessionBrowserHandler } = await import('./server.mjs');

function startServer() {
  const handler = createSessionBrowserHandler({ workspaceRoot });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function getJson(server, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return res.json();
}

const totalOf = (tokens) => tokens.total;

test('session list counts duplicated message/part usage once', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const data = await getJson(server, '/api/sessions');
  assert.deepEqual(data.sourceErrors, []);
  const session = data.sessions.find((item) => item.id === 'ses_dup');
  assert.equal(totalOf(session.tokens), 18333, 'explicit total counted once, not doubled');
  assert.equal(session.tokens.input, 795);
  assert.equal(session.tokens.cacheRead, 17408);
  assert.deepEqual(session.contextLoad, { latest: 18321, preferredCeiling: 200000 });
});

test('session list keeps message-only and part-only usage', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const data = await getJson(server, '/api/sessions');
  const session = data.sessions.find((item) => item.id === 'ses_partial');
  assert.equal(totalOf(session.tokens), 472, 'message-only 315 plus part-only 157');
  assert.equal(session.tokens.input, 150);
  assert.deepEqual(session.contextLoad, { latest: 155, preferredCeiling: 200000 }, 'uses the latest response rather than the lifetime sum');
});

test('session detail counts duplicated message/part usage once', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('opencode:ses_dup')}`);
  assert.equal(totalOf(detail.tokens), 18333);
  assert.deepEqual(detail.tokens, { input: 795, output: 118, cacheRead: 17408, cacheWrite: 0, total: 18333 });
});

test('session detail keeps message-only and part-only usage', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('opencode:ses_partial')}`);
  assert.equal(totalOf(detail.tokens), 472);
});

test('list and detail totals agree for the same session', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const data = await getJson(server, '/api/sessions');
  for (const summary of data.sessions) {
    const detail = await getJson(server, `/api/session?ref=${encodeURIComponent(summary.path)}`);
    assert.equal(totalOf(detail.tokens), totalOf(summary.tokens), `${summary.id} totals agree`);
  }
});
