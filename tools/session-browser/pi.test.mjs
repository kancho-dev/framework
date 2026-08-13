import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function putMetadata(server, path, patch) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/metadata`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, ...patch }),
  });
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

test('saved topics persist independently from the manual session bookmark', async (t) => {
  const metadataPath = join(workspaceRoot, 'saved-topics-metadata.json');
  const handler = createSessionBrowserHandler({ workspaceRoot, metadataPath });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  t.after(() => rm(metadataPath, { force: true }));
  const path = join(sessionRoot, 'compact.jsonl');

  let result = await putMetadata(server, path, { bookmarked: true });
  assert.equal(result.metadata.bookmarked, true);
  result = await putMetadata(server, path, { savedTopics: { u2: { title: 'Continue', note: 'Useful answer', prompt: 'continue', timestamp: '2026-01-01T00:02:00.000Z' } } });
  assert.equal(result.metadata.bookmarked, true);
  assert.equal(result.metadata.savedTopicCount, 1);

  result = await putMetadata(server, path, { savedTopics: {} });
  assert.equal(result.metadata.bookmarked, true);
  assert.equal(result.metadata.savedTopicCount, 0);
  const stored = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(stored.version, 3);
  assert.equal(stored.sessions[`pi:${path}`].bookmarked, true);

  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent(path)}`);
  assert.equal(detail.metadata.bookmarked, true);
  assert.equal(detail.metadata.savedTopicCount, 0);
});

test('a repeated list scan reflects appended, added, and removed sessions', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const added = join(sessionRoot, 'cache-check.jsonl');
  t.after(() => rm(added, { force: true }));

  const before = await getJson(server, '/api/sessions');
  assert.ok(before.sessions.some((session) => session.id === 'PI-COMPACT'));
  assert.ok(!before.sessions.some((session) => session.id === 'PI-CACHE-CHECK'));

  await writeFile(added, jsonl([
    { type: 'session', version: 3, id: 'PI-CACHE-CHECK', cwd: workspaceRoot, timestamp: '2026-01-02T00:00:00.000Z' },
    { type: 'message', id: 'c1', parentId: null, timestamp: '2026-01-02T00:00:01.000Z', message: { role: 'user', content: 'added later' } },
  ]));
  const withAdded = await getJson(server, '/api/sessions');
  const appearing = withAdded.sessions.find((session) => session.id === 'PI-CACHE-CHECK');
  assert.equal(appearing?.userMessageCount, 1);

  await appendFile(added, jsonl([
    { type: 'message', id: 'c2', parentId: 'c1', timestamp: '2026-01-02T00:00:02.000Z', message: { role: 'user', content: 'appended' } },
  ]));
  const withAppend = await getJson(server, '/api/sessions');
  assert.equal(withAppend.sessions.find((session) => session.id === 'PI-CACHE-CHECK')?.userMessageCount, 2);

  await rm(added);
  const afterRemoval = await getJson(server, '/api/sessions');
  assert.ok(!afterRemoval.sessions.some((session) => session.id === 'PI-CACHE-CHECK'));
});

test('overlapping list requests return the same sessions', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const [sessions, summary] = await Promise.all([getJson(server, '/api/sessions'), getJson(server, '/api/summary')]);
  assert.ok(sessions.sessions.length > 0);
  assert.equal(summary.latestUpdatedSession?.id, sessions.sessions[0].id);
});
