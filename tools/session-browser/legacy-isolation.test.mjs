import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspaceRoot = await mkdtemp(join(tmpdir(), 'legacy-isolation-workspace-'));
const liveRoot = await mkdtemp(join(tmpdir(), 'legacy-isolation-live-'));
const configDir = join(workspaceRoot, '.tools-config', 'session-browser');
await mkdir(configDir, { recursive: true });
await writeFile(join(liveRoot, 'live.jsonl'), `${JSON.stringify({ type: 'session', id: 'live', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:00.000Z' })}\n`);
const malformedPath = join(configDir, 'malformed.json');
const missingPath = join(configDir, 'missing.json');
await writeFile(malformedPath, '{broken');
await writeFile(missingPath, JSON.stringify({
  version: 1,
  machines: [{
    id: 'missing',
    roots: { pi: 'archive/missing/pi', codex: 'archive/missing/codex' },
    pathMap: [{ from: '/old/workspace', to: '.' }],
  }],
}));

process.env.SESSION_SOURCES = 'pi';
process.env.SESSION_ROOT = liveRoot;
process.env.WORKSPACE_ROOT = workspaceRoot;
const { createSessionBrowserHandler } = await import('./server.mjs');

async function sessions(legacyMachinesPath) {
  const handler = createSessionBrowserHandler({ workspaceRoot, legacyMachinesPath });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions`);
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('broken legacy configuration leaves current sessions byte-identical', async () => {
  const baseline = await sessions(join(configDir, 'absent.json'));
  const malformed = await sessions(malformedPath);
  const missing = await sessions(missingPath);

  assert.equal(baseline.status, 200);
  assert.equal(malformed.status, 200);
  assert.equal(missing.status, 200);
  assert.equal(JSON.stringify(malformed.body.sessions), JSON.stringify(baseline.body.sessions));
  assert.equal(JSON.stringify(missing.body.sessions), JSON.stringify(baseline.body.sessions));
  assert.ok(malformed.body.sourceErrors.some(({ source, code }) => source === 'legacy-config' && code === 'invalid-config'));
  assert.deepEqual(new Set(missing.body.sourceErrors.map(({ source }) => source)), new Set(['pi@missing', 'codex@missing']));
});
