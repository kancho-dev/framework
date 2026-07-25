import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

const sql = (value) => value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`;
const row = (table, values) => `insert into ${table} values (${values.map(sql).join(',')});`;

// Real OpenCode payload shape: `reasoning` sits beside `output` and `total` already
// covers every component.
const withTotal = { total: 18333, input: 795, output: 118, reasoning: 12, cache: { write: 0, read: 17408 } };
const withoutTotal = { input: 795, output: 118, reasoning: 12, cache: { write: 0, read: 17408 } };
const withoutReasoning = { total: 315, input: 100, output: 10, cache: { write: 5, read: 200 } };

const assistant = (tokens) => JSON.stringify({ role: 'assistant', providerID: 'anthropic', modelID: 'claude-test', tokens, time: { created: 1000 } });

let records = [];

before(async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'oc-an-ws-'));
  const outDir = await mkdtemp(join(tmpdir(), 'oc-an-out-'));
  const opencodeDb = join(await mkdtemp(join(tmpdir(), 'oc-an-db-')), 'opencode.db');
  await execFileAsync('sqlite3', [opencodeDb, [
    'create table session (id text primary key, directory text, path text, title text, model text, cost real, tokens_input integer, tokens_output integer, tokens_cache_read integer, tokens_cache_write integer, time_created integer, time_updated integer);',
    'create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);',
    row('session', ['ses_a', workspaceRoot, workspaceRoot, 'Analyzer fixture', '{"providerID":"anthropic","id":"claude-test"}', 0, 0, 0, 0, 0, 1000, 1000]),
    row('message', ['msg_total', 'ses_a', 1000, 1000, assistant(withTotal)]),
    row('message', ['msg_no_total', 'ses_a', 1001, 1001, assistant(withoutTotal)]),
    row('message', ['msg_no_reasoning', 'ses_a', 1002, 1002, assistant(withoutReasoning)]),
  ].join('\n')]);

  await execFileAsync('node', [join(here, 'analyze.mjs'), '--workspace', workspaceRoot, '--out', outDir, '--opencode-db', opencodeDb, '--source', 'opencode']);
  ({ records } = JSON.parse(await readFile(join(outDir, 'normalized.json'), 'utf8')));
});

const record = (messageId) => records.find((item) => item.messageId === messageId);

test('honors the explicit OpenCode total, which includes reasoning', () => {
  const found = record('msg_total');
  assert.equal(found.totalTokens, 18333, 'not the 18321 component sum that omits reasoning');
  assert.equal(found.totalTokensClass, 'source-derived');
});

test('reports reasoning tokens in the breakdown', () => {
  assert.deepEqual(record('msg_total').tokens.reasoning, { value: 12, class: 'recorded' });
});

test('derives a reasoning-inclusive total when no explicit total exists', () => {
  assert.equal(record('msg_no_total').totalTokens, 18333);
});

test('records without reasoning keep the four-component shape', () => {
  const found = record('msg_no_reasoning');
  assert.deepEqual(Object.keys(found.tokens), ['input', 'output', 'cacheRead', 'cacheWrite']);
  assert.equal(found.totalTokens, 315);
});

test('cost stays priced from input/output/cache components only', () => {
  assert.equal(record('msg_total').tokens.reasoning.value, 12);
  assert.ok(!(record('msg_total').warnings || []).some((warning) => warning.includes('reasoning')));
});
