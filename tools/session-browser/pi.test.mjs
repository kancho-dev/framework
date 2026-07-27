import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const workspaceRoot = await mkdtemp(join(tmpdir(), 'pi-ws-'));
const sessionRoot = await mkdtemp(join(tmpdir(), 'pi-sessions-'));
await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n');
const jsonl = (lines) => lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
const usage = (input, output, cacheRead, cacheWrite) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite });

await writeFile(join(sessionRoot, 'compact.jsonl'), jsonl([
  { type: 'session', version: 3, id: 'PI-COMPACT', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:00.000Z' },
  { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'start' } },
  { type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }], usage: usage(10, 20, 100, 5) } },
  { type: 'message', id: 'u2', parentId: 'a1', timestamp: '2026-01-01T00:02:00.000Z', message: { role: 'user', content: 'continue' } },
  { type: 'message', id: 'a2', parentId: 'u2', timestamp: '2026-01-01T00:02:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'latest' }], usage: usage(2000, 3000, 40000, 5000) } },
  { type: 'message', id: 'abandoned', parentId: 'a1', timestamp: '2026-01-01T00:00:30.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'abandoned branch' }], usage: usage(90000, 1000, 90000, 1000) } },
]));

await writeFile(join(sessionRoot, 'no-response.jsonl'), jsonl([
  { type: 'session', version: 3, id: 'PI-NO-RESPONSE', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:00.000Z' },
  { type: 'message', id: 'only-user', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'not answered yet' } },
]));

process.env.SESSION_SOURCES = 'pi';
process.env.SESSION_ROOT = sessionRoot;
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

test('Pi session without a completed response reports unknown context', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent(join(sessionRoot, 'no-response.jsonl'))}`);
  assert.deepEqual(detail.contextLoad, { latest: null, preferredCeiling: 200000 });
});

test('Pi detail reports latest active-branch context', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent(join(sessionRoot, 'compact.jsonl'))}`);
  assert.deepEqual(detail.contextLoad, { latest: 50000, preferredCeiling: 200000 });
});
