import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const workspaceRoot = await mkdtemp(join(tmpdir(), 'codex-ws-'));
const sessionRoot = await mkdtemp(join(tmpdir(), 'codex-sessions-'));
await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n');
const dir = join(sessionRoot, '2026', '01', '01');
await mkdir(dir, { recursive: true });
const id = '12345678-1234-1234-1234-123456789abc';
const jsonl = (lines) => lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
const tokenCount = (input, cached, output) => ({ type: 'event_msg', timestamp: '2026-01-01T00:00:02.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }, total_token_usage: {}, model_context_window: 999999 } } });
await writeFile(join(dir, `rollout-${id}.jsonl`), jsonl([
  { type: 'session_meta', timestamp: '2026-01-01T00:00:00.000Z', payload: { id, cwd: workspaceRoot, model_provider: 'openai' } },
  { type: 'turn_context', timestamp: '2026-01-01T00:00:00.000Z', payload: { model: 'codex-test', cwd: workspaceRoot } },
  tokenCount(10000, 8000, 1000),
  tokenCount(50000, 40000, 5000),
]));

process.env.SESSION_SOURCES = 'codex';
process.env.CODEX_SESSION_ROOT = sessionRoot;
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

test('Codex uses latest turn usage for context', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('codex:' + id)}`);
  assert.deepEqual(detail.contextLoad, { latest: 55000, preferredCeiling: 200000 });
});
