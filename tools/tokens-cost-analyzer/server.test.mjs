import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureArtifacts } from './server.mjs';

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
  assert.deepEqual(report.daily, [{ date: '2026-01-03', tokens: 13, records: 1 }]);

  const dailyArtifact = JSON.parse(await readFile(join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer', 'daily.json'), 'utf8'));
  assert.equal(dailyArtifact.generatedAt, report.generatedAt);
  assert.deepEqual(dailyArtifact.daily, report.daily);
  const dailyResponse = await fetch(`http://127.0.0.1:${port}/api/daily-usage`);
  assert.equal(dailyResponse.status, 200);
  assert.deepEqual(await dailyResponse.json(), dailyArtifact);

  const browserModule = await fetch(`http://127.0.0.1:${port}/shared/refresh-coordinator.mjs`);
  assert.equal(browserModule.status, 200);
  assert.equal(browserModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('artifact regeneration is age-guarded, single-flight, manual-aware, and retryable', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'tokens-analyzer-artifacts-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const now = Date.parse('2026-01-03T00:08:00.000Z');
  const writeArtifacts = async (generatedAt) => {
    await writeFile(join(outputDir, 'normalized.json'), JSON.stringify({ generatedAt }));
    await writeFile(join(outputDir, 'daily.json'), JSON.stringify({ generatedAt, daily: [] }));
  };
  await writeArtifacts('2026-01-03T00:00:00.000Z');

  let runs = 0;
  let release;
  let markStarted;
  const started = new Promise((resolveStarted) => { markStarted = resolveStarted; });
  const runAnalysis = async () => {
    runs += 1;
    markStarted();
    await new Promise((resolveRun) => { release = resolveRun; });
    await writeArtifacts(new Date(now).toISOString());
  };
  const options = { workspaceRoot: outputDir, outputDir, refresh: true, manual: false, now: () => now, runAnalysis };
  await ensureArtifacts(options);
  assert.equal(runs, 0, 'automatic refresh skips artifacts younger than nine minutes');

  const first = ensureArtifacts({ ...options, manual: true });
  const second = ensureArtifacts({ ...options, manual: true });
  await started;
  assert.equal(runs, 1, 'concurrent requests share one analysis');
  release();
  await Promise.all([first, second]);

  let attempts = 0;
  const failing = { ...options, manual: true, runAnalysis: async () => { attempts += 1; throw new Error('analysis failed'); } };
  await assert.rejects(ensureArtifacts(failing), /analysis failed/);
  await assert.rejects(ensureArtifacts(failing), /analysis failed/);
  assert.equal(attempts, 2, 'a failed analysis clears the in-flight slot');
});
