import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// server.mjs reads CLAUDE_PROJECTS_ROOT / WORKSPACE_ROOT / SESSION_SOURCES at load time,
// so the synthetic (non-private) fixtures and env must be prepared before importing it.
const workspaceRoot = await mkdtemp(join(tmpdir(), 'cc-ws-'));
const projectsRoot = await mkdtemp(join(tmpdir(), 'cc-proj-'));
await writeFile(join(workspaceRoot, 'AGENTS.md'), '# test\n');

// The encoded directory name is cosmetic; the adapter filters on the real cwd field.
const projDir = join(projectsRoot, `-${workspaceRoot.replace(/\//g, '-')}`);
await mkdir(join(projDir, 'PARENT', 'subagents'), { recursive: true });

const jsonl = (lines) => lines.map((line) => JSON.stringify(line)).join('\n') + '\n';

await writeFile(join(projDir, 'PARENT.jsonl'), jsonl([
  { type: 'ai-title', aiTitle: 'Synthetic parent session', sessionId: 'PARENT' },
  { type: 'user', uuid: 'u1', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'hello world' } },
  { type: 'assistant', uuid: 'a1', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'assistant', model: 'claude-test', content: [
    { type: 'thinking', thinking: 'let me think' },
    { type: 'text', text: 'hi there' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'x' } },
  ], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } },
  { type: 'user', uuid: 'u2', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:02.000Z', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 't1', content: 'file body' },
  ] } },
]));

await writeFile(join(projDir, 'PARENT', 'subagents', 'agent-SUB.jsonl'), jsonl([
  { type: 'user', uuid: 's-u1', cwd: workspaceRoot, sessionId: 'PARENT', agentId: 'SUB', isSidechain: true, timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'user', content: 'sub task' } },
  { type: 'assistant', uuid: 's-a1', cwd: workspaceRoot, sessionId: 'PARENT', agentId: 'SUB', isSidechain: true, timestamp: '2026-01-01T00:00:04.000Z', message: { role: 'assistant', model: 'claude-test', content: [
    { type: 'text', text: 'sub answer' },
  ], usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } } },
]));
await mkdir(join(projDir, 'STALE-PARENT', 'subagents'), { recursive: true });
await copyFile(
  join(projDir, 'PARENT', 'subagents', 'agent-SUB.jsonl'),
  join(projDir, 'STALE-PARENT', 'subagents', 'agent-SUB.jsonl'),
);
await writeFile(join(projDir, 'STALE-PARENT', 'subagents', 'agent-REMAP.jsonl'), jsonl([
  { type: 'user', uuid: 'r-u1', cwd: workspaceRoot, sessionId: 'RECORDED-PARENT', agentId: 'REMAP', isSidechain: true, timestamp: '2026-01-01T00:00:05.000Z', message: { role: 'user', content: 'remapped task' } },
]));
await writeFile(join(projDir, 'RECORDED-PARENT.jsonl'), jsonl([
  { type: 'user', uuid: 'rp-u1', cwd: workspaceRoot, sessionId: 'RECORDED-PARENT', timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'recorded parent' } },
]));

// A session in a different workspace must be excluded by the cwd filter.
await writeFile(join(projDir, 'OTHER.jsonl'), jsonl([
  { type: 'assistant', uuid: 'o1', cwd: '/somewhere/else', timestamp: '2026-01-02T00:00:00.000Z', message: { role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'nope' }], usage: { input_tokens: 1, output_tokens: 1 } } },
]));

process.env.SESSION_SOURCES = 'claude-code';
process.env.CLAUDE_PROJECTS_ROOT = projectsRoot;
process.env.WORKSPACE_ROOT = workspaceRoot;
process.env.SESSION_BROWSER_METADATA = join(workspaceRoot, 'metadata.json');

const { createSessionBrowserHandler } = await import('./server.mjs');

function startServer() {
  const handler = createSessionBrowserHandler();
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function getJson(server, path) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return res.json();
}

test('lists parent and sub-agent sessions, filtered by cwd', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const data = await getJson(server, '/api/sessions');
  assert.deepEqual(data.sourceErrors, []);
  const ids = data.sessions.map((s) => s.id);
  assert.ok(ids.includes('PARENT'), 'lists parent');
  assert.ok(ids.includes('PARENT/agent-SUB'), 'lists sub-agent under its recorded parent');
  assert.equal(ids.filter((id) => id.endsWith('/agent-SUB')).length, 1, 'deduplicates a stale byte-identical sidechain copy under another parent');
  assert.ok(!ids.includes('OTHER'), 'excludes other-workspace session');
  const sub = data.sessions.find((s) => s.id === 'PARENT/agent-SUB');
  assert.equal(sub.parentId, 'PARENT', 'sub-agent carries parentId so the UI shows the child badge');
  assert.equal(sub.source, 'claude-code');
});

test('parent detail normalizes blocks, maps usage, links children', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('claude-code:PARENT')}`);
  const types = {};
  for (const entry of detail.entries) for (const block of entry.message.content || []) types[block.type] = (types[block.type] || 0) + 1;
  assert.ok(types.text >= 2, 'assistant text + tool_result text');
  assert.equal(types.thinking, 1, 'thinking block preserved');
  assert.equal(types.toolCall, 1, 'tool_use normalized to toolCall');
  assert.equal(detail.parentSession, null);
  assert.deepEqual(detail.childSessions.map((c) => c.path), ['claude-code:PARENT/agent-SUB']);
  assert.deepEqual(detail.tokens, { input: 10, output: 20, cacheRead: 100, cacheWrite: 5, total: 135 });
});

test('sub-agent detail links back to its parent', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('claude-code:PARENT/agent-SUB')}`);
  assert.equal(detail.isSidechain, true);
  assert.equal(detail.parentSession.path, 'claude-code:PARENT');
  assert.deepEqual(detail.childSessions, []);
});

test('sidechain detail resolves a recorded parent id that differs from its directory', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('claude-code:RECORDED-PARENT/agent-REMAP')}`);
  assert.equal(detail.id, 'RECORDED-PARENT/agent-REMAP');
  assert.equal(detail.parentId, 'RECORDED-PARENT');
});

test('recorded parent detail links a sidechain stored under a stale directory parent', async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const detail = await getJson(server, `/api/session?ref=${encodeURIComponent('claude-code:RECORDED-PARENT')}`);
  assert.deepEqual(detail.childSessions.map((child) => child.path), ['claude-code:RECORDED-PARENT/agent-REMAP']);
});
