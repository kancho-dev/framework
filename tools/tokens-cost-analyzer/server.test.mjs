import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  await new Promise((resolveClosed) => server.close(resolveClosed));
  return port;
}

async function waitForReport(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw lastError;
}

test('server report endpoint analyzes fixture data and returns dashboard totals', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'tokens-analyzer-server-'));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const piRoot = join(workspaceRoot, 'pi-sessions');
  const sessionDir = join(piRoot, `-${resolve(workspaceRoot).replace(/\//g, '-')}--`);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'server-session.jsonl'), `${JSON.stringify({
    type: 'message',
    timestamp: '2026-01-03T00:00:00.000Z',
    message: { role: 'assistant', model: 'server-test-model', provider: 'test', usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 1 } },
  })}\n`);

  const port = await unusedPort();
  const missingRoot = join(workspaceRoot, 'missing');
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: {
      ...process.env,
      WORKSPACE_ROOT: workspaceRoot,
      PI_SESSION_ROOT: piRoot,
      OPENCODE_DB: join(missingRoot, 'opencode.db'),
      CODEX_SESSION_ROOT: join(missingRoot, 'codex'),
      CLAUDE_PROJECTS_ROOT: join(missingRoot, 'claude'),
      TOKENS_COST_ANALYZER_PORT: String(port),
      TOKENS_COST_ANALYZER_LIMIT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });

  const report = await waitForReport(`http://127.0.0.1:${port}/api/report`, child);
  assert.equal(report.analysis.mode, 'limited');
  assert.equal(report.totals.records, 1);
  assert.equal(report.totals.tokens, 13);
  assert.deepEqual(report.bySource.map(({ key, records, tokens }) => ({ key, records, tokens })), [
    { key: 'pi', records: 1, tokens: 13 },
  ]);
  assert.ok(report.warnings.some((warning) => warning.startsWith('opencode:')));
});
