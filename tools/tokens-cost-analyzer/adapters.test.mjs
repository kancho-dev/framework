import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

async function analyze(source, workspaceRoot, sourceArgs) {
  const outDir = join(workspaceRoot, 'out');
  await execFileAsync(process.execPath, [join(here, 'analyze.mjs'), '--workspace', workspaceRoot, '--out', outDir, '--source', source, ...sourceArgs]);
  return JSON.parse(await readFile(join(outDir, 'normalized.json'), 'utf8'));
}

async function fixtureWorkspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'tokens-analyzer-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeJsonl(path, entries) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

test('Pi CLI analysis normalizes recorded usage and native cost', async (t) => {
  const workspaceRoot = await fixtureWorkspace(t);
  const piRoot = join(workspaceRoot, 'pi-sessions');
  const encodedWorkspace = `-${resolve(workspaceRoot).replace(/\//g, '-')}--`;
  await writeJsonl(join(piRoot, encodedWorkspace, 'pi-session.jsonl'), [
    { type: 'model_change', provider: 'anthropic', modelId: 'claude-test' },
    { type: 'message', id: 'user-1', message: { role: 'user' } },
    { type: 'message', timestamp: '2026-01-02T03:04:05.000Z', message: { role: 'assistant', model: 'claude-test', provider: 'anthropic', usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 4, cost: { total: 0.0123 } } } },
  ]);

  const result = await analyze('pi', workspaceRoot, ['--pi-root', piRoot]);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].tokens, {
    input: { value: 100, class: 'recorded' },
    output: { value: 20, class: 'recorded' },
    cacheRead: { value: 30, class: 'recorded' },
    cacheWrite: { value: 4, class: 'recorded' },
  });
  assert.equal(result.records[0].totalTokens, 154);
  assert.equal(result.records[0].recordedCost, 0.0123);
  assert.equal(result.records[0].sessionTopicId, 'user-1');
});

test('Codex CLI analysis uses last-turn usage and splits cached input', async (t) => {
  const workspaceRoot = await fixtureWorkspace(t);
  const codexRoot = join(workspaceRoot, 'codex-sessions');
  await writeJsonl(join(codexRoot, 'rollout-test-session.jsonl'), [
    { type: 'session_meta', payload: { id: 'codex-session', cwd: workspaceRoot, model_provider: 'openai' }, timestamp: '2026-01-02T03:04:05.000Z' },
    { type: 'turn_context', payload: { cwd: workspaceRoot, model: 'gpt-test' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', id: 'user-2' } },
    { type: 'event_msg', timestamp: '2026-01-02T03:05:05.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 120, cached_input_tokens: 40, output_tokens: 15, total_tokens: 135 }, total_token_usage: { input_tokens: 9999 } } } },
  ]);

  const result = await analyze('codex', workspaceRoot, ['--codex-root', codexRoot]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].tokens.input.value, 80);
  assert.equal(result.records[0].tokens.cacheRead.value, 40);
  assert.equal(result.records[0].tokens.output.value, 15);
  assert.equal(result.records[0].tokens.cacheWrite.value, null);
  assert.equal(result.records[0].totalTokens, 135);
  assert.equal(result.records[0].sessionTopicId, 'user-2');
});

test('Claude Code CLI analysis maps Anthropic usage for in-workspace messages', async (t) => {
  const workspaceRoot = await fixtureWorkspace(t);
  const claudeRoot = join(workspaceRoot, 'claude-projects');
  await writeJsonl(join(claudeRoot, 'project', 'claude-session.jsonl'), [
    { type: 'user', uuid: 'user-3', message: { role: 'user' } },
    { type: 'assistant', uuid: 'assistant-3', cwd: workspaceRoot, timestamp: '2026-01-02T03:06:05.000Z', message: { model: 'claude-test', usage: { input_tokens: 90, output_tokens: 10, cache_read_input_tokens: 25, cache_creation_input_tokens: 5 } } },
    { type: 'assistant', uuid: 'outside', cwd: join(workspaceRoot, '..', 'other'), timestamp: '2026-01-02T03:07:05.000Z', message: { model: 'claude-test', usage: { input_tokens: 999, output_tokens: 999 } } },
  ]);

  const result = await analyze('claude-code', workspaceRoot, ['--claude-root', claudeRoot]);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0].tokens, {
    input: { value: 90, class: 'recorded' },
    output: { value: 10, class: 'recorded' },
    cacheRead: { value: 25, class: 'recorded' },
    cacheWrite: { value: 5, class: 'recorded' },
  });
  assert.equal(result.records[0].totalTokens, 130);
  assert.equal(result.records[0].sessionBrowserPath, 'claude-code:claude-session');
  assert.equal(result.records[0].sessionTopicId, 'user-3');
});
