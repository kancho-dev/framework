import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTokensCostAnalyzerHandler, ensureArtifacts } from './server.mjs';
import { loadExternalSources } from './sources.mjs';
import { fetchSource } from './source-fetch.mjs';
import { createReportViewCache } from './report-view-cache.mjs';

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

  // Roots are redacted out of the artifact, so the payload's local path knowledge
  // must come from local configuration rather than from the report.
  assert.equal(report.workspaceRoot, workspaceRoot);
  const artifact = JSON.parse(await readFile(join(workspaceRoot, '.tools-config', 'tokens-cost-analyzer', 'report.v1.json'), 'utf8'));
  assert.equal('workspaceRoot' in artifact, false);
  assert.equal(artifact.records[0].sessionBrowserPath.startsWith('~/'), false, 'this fixture lives outside HOME, so nothing is redacted here');
  assert.equal(report.topDrivers[0].sessionBrowserPath, artifact.records[0].sessionBrowserPath);
  assert.equal(artifact.records[0].workspaceId, artifact.origin.workspaces[0]);
});

test('a redacted local session path is expanded back for the local machine only', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'tokens-analyzer-expand-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const record = (unitId, sessionId, sessionBrowserPath) => ({
    unitId, sessionId, sessionBrowserPath, source: 'pi', messageId: 'm', workspaceId: 'home',
    timestamp: '2026-01-03T00:00:00.000Z', date: '2026-01-03', totalTokens: 1, tokens: {}, warnings: [],
  });
  await writeFile(join(outputDir, 'report.v1.json'), JSON.stringify({
    report: { generatedAt: '2026-01-03T00:00:00.000Z', coverage: { mode: 'full-history', limit: null, limitScope: 'x' }, warnings: [] },
    origin: { machineId: 'workstation', workspaces: ['home'] },
    records: [record('workstation/pi/local/m', 'local', '~/.pi/local.jsonl'), record('laptop/pi/remote/m', 'remote', '~/.pi/remote.jsonl')],
  }));
  await writeFile(join(outputDir, 'daily.json'), JSON.stringify({ generatedAt: '2026-01-03T00:00:00.000Z', daily: [] }));

  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: outputDir, outputDir });
  const payload = await new Promise((resolvePayload) => {
    const res = { writeHead() {}, setHeader() {}, end(body) { resolvePayload(JSON.parse(body)); } };
    handler({ url: '/api/report' }, res);
  });

  const pathBySession = new Map(payload.topDrivers.map((driver) => [driver.sessionId, driver.sessionBrowserPath]));
  assert.equal(pathBySession.get('local'), join(homedir(), '.pi', 'local.jsonl'));
  assert.equal(pathBySession.get('remote'), '~/.pi/remote.jsonl', "another machine's home directory is not ours to expand");
  assert.equal(payload.workspaceRoot, outputDir);
});

test('artifact regeneration is age-guarded, single-flight, manual-aware, and retryable', async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), 'tokens-analyzer-artifacts-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const now = Date.parse('2026-01-03T00:08:00.000Z');
  const writeArtifacts = async (generatedAt) => {
    await writeFile(join(outputDir, 'report.v1.json'), JSON.stringify({ report: { generatedAt } }));
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

// --- merged loading below the request handler's catch ------------

const LOCAL_STATES = ['unreachable', 'unauthorized', 'missing', 'unreadable', 'invalid', 'incompatible', 'disabled'];

function localRecord(overrides = {}) {
  return {
    source: 'pi', sessionId: 'local-session', messageId: 'm1', workspaceId: 'framework',
    unitId: 'workstation/pi/local-session/m1', identityClass: 'native',
    timestamp: '2026-01-03T00:00:00.000Z', date: '2026-01-03',
    totalTokens: 13, tokens: {}, recordedCost: 2, estimatedCost: null, warnings: [], ...overrides,
  };
}

async function fixtureOutputDir(t, { records = [localRecord()], sources = null, workspaces = ['framework'] } = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'tokens-analyzer-step8-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  await writeFile(join(outputDir, 'report.v1.json'), JSON.stringify({
    schema: 'tokens-cost-analyzer/report', schemaVersion: 1,
    report: { reportId: 'report-local', generatedAt: '2026-01-03T00:00:00.000Z', generatorVersion: '0.6.0', currency: 'USD', coverage: { mode: 'full-history', limit: null, limitScope: 'x' }, pricingSources: [], warnings: [] },
    origin: { machineId: 'workstation', workspaces },
    records,
  }));
  await writeFile(join(outputDir, 'daily.json'), JSON.stringify({ generatedAt: '2026-01-03T00:00:00.000Z', workspaceRoot: outputDir, analysis: { mode: 'full-history' }, daily: [] }));
  if (sources) await writeFile(join(outputDir, 'sources.json'), typeof sources === 'string' ? sources : JSON.stringify(sources));
  return outputDir;
}

function request(outputDir, options = {}, path = '/api/report') {
  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: outputDir, outputDir, ...options });
  return new Promise((resolvePayload) => {
    let status;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(body) { resolvePayload({ status, payload: JSON.parse(body) }); } };
    handler({ url: path }, res);
  });
}

const oneSource = { schemaVersion: 1, sources: [{ id: 'laptop', type: 'ssh', host: 'laptop.local', remotePath: '~/report.v1.json' }] };

// A validated report from another machine. Fingerprints differ per machine so
// dedup never quietly removes the second source's contribution.
function remoteReportFor(machineId, sessionId) {
  return {
    schema: 'tokens-cost-analyzer/report', schemaVersion: 1,
    report: { reportId: `report-${machineId}`, generatedAt: '2026-01-03T00:00:00.000Z', generatorVersion: '0.6.0', currency: 'USD', coverage: { mode: 'full-history', limit: null, limitScope: 'x' }, pricingSources: [], warnings: [] },
    origin: { machineId, workspaces: ['framework'] },
    records: [localRecord({
      unitId: `${machineId}/pi/${sessionId}/m1`, sessionId, totalTokens: 7,
      contentFingerprint: `a1b2c3d4e5f607${machineId.length.toString(16).padStart(2, '0')}`,
      derivation: { generatorVersion: '0.6.0', pricingFingerprint: 'sha256:abc' },
    })],
  };
}

test('every external-source failure state still returns 200 with local records intact', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  // The baseline is a genuine local-only run — no sources.json at all — so the
  // comparison is against today's behaviour rather than against a merge that
  // happened to produce nothing.
  const { payload: localOnly } = await request(await fixtureOutputDir(t));

  for (const state of LOCAL_STATES) {
    const loadExternal = async () => ({ loads: [{ records: [], state: { id: 'laptop', sourceKey: null, state, included: false, detail: `${state} detail` } }] });
    const { status, payload } = await request(outputDir, { loadExternal });

    assert.equal(status, 200, state);
    assert.equal(payload.totals.records, 1, state);
    assert.equal(payload.totals.tokens, 13, state);
    assert.deepEqual(payload.topMessageDrivers, localOnly.topMessageDrivers, `${state}: local records are complete and unchanged`);
    assert.deepEqual(payload.daily, localOnly.daily, state);
    assert.equal(payload.merge.sources.find((row) => row.id === 'laptop').included, false, state);
  }
});

test('an external loader that throws cannot take the local dashboard down', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const { status, payload } = await request(outputDir, { loadExternal: () => Promise.reject(new Error('boom')) });

  assert.equal(status, 200);
  assert.equal(payload.totals.records, 1);
  assert.equal(payload.merge.sources.at(-1).state, 'invalid', 'the failure is reported as a source row, not as a 500');
});

test('an unreadable sources.json is reported as a source row, not as a failed request', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: '{ not json' });
  const { status, payload } = await request(outputDir);

  assert.equal(status, 200);
  assert.equal(payload.totals.tokens, 13, 'one unusable config file must not blank local analysis');
  const row = payload.merge.sources.find((source) => source.id === 'sources.json');
  assert.equal(row.included, false);
  assert.match(row.detail, /not valid JSON/);
});

test('with no sources.json the payload is local-only plus exactly the additive fields', async (t) => {
  const outputDir = await fixtureOutputDir(t);
  const { status, payload } = await request(outputDir);

  assert.equal(status, 200);
  // Regression guard: one green row, one By Workspace line.
  assert.equal(payload.merge.sources.length, 1);
  assert.deepEqual(
    { id: payload.merge.sources[0].id, included: payload.merge.sources[0].included, isLocal: payload.merge.sources[0].isLocal, records: payload.merge.sources[0].records },
    { id: 'this machine', included: true, isLocal: true, records: 1 },
  );
  assert.deepEqual(payload.merge.totalsExclude, []);
  assert.deepEqual(payload.merge.warnings, []);
  assert.equal(payload.byWorkspace.length, 1);
  assert.equal(payload.byWorkspace[0].key, 'workstation/framework');
  assert.equal(payload.byWorkspace[0].tokens, payload.totals.tokens, 'By Workspace rows sum to the overall total');

  // Local records survive merge byte-identically apart from the additive sourceKey.
  const artifact = JSON.parse(await readFile(join(outputDir, 'report.v1.json'), 'utf8'));
  const { sourceKey, ...merged } = payload.topMessageDrivers[0];
  assert.equal(sourceKey, 'workstation');
  assert.deepEqual(merged, artifact.records[0]);
});

// The session-link rule is a local lookup, so the browser needs this machine's own
// workspace roots — reports deliberately carry none.
test('the payload carries this machine identity and its local workspace roots', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: { schemaVersion: 1, self: { machineId: 'ignored-here', catchAllId: 'home' } } });
  const { payload } = await request(outputDir);

  // The stamping identity is the report's, not the config's: records already
  // carry `unitId`s built from it, and a renamed machine must not orphan them.
  assert.equal(payload.linkTargets.machineId, 'workstation');
  assert.deepEqual(payload.linkTargets.workspaces, [{ id: 'home', root: outputDir }], 'the catch-all root is always a link target');
});

// The regression this guards: a CLI run under `$HOME` and a server rooted at a
// project directory derived different workspace ids, so no record resolved and
// every deep link vanished with nothing said. `scan-scope.json` is written by
// the run that stamped the ids, so the two cannot drift apart.
test('an artifact scanned under one root keeps its links when the server is rooted elsewhere', async (t) => {
  const outputDir = await fixtureOutputDir(t, { records: [localRecord({ workspaceId: 'alice' })], workspaces: ['alice'] });
  await writeFile(join(outputDir, 'scan-scope.json'), JSON.stringify({ machineId: 'workstation', workspaces: [{ id: 'alice', root: '/home/alice' }] }));

  const { payload } = await request(outputDir);

  assert.deepEqual(payload.linkTargets.workspaces, [{ id: 'alice', root: '/home/alice' }], 'link targets follow the scan, not the server root');
  assert.deepEqual(payload.linkTargets.unresolvedWorkspaces, [], 'every scanned workspace resolves');
});

test('a scope the local configuration cannot resolve is reported instead of silently unlinking', async (t) => {
  const outputDir = await fixtureOutputDir(t, { records: [localRecord({ workspaceId: 'alice' })], workspaces: ['alice'] });
  const { payload } = await request(outputDir);

  // No scan-scope.json: the fallback derives ids from the server root, which
  // cannot know about `alice`. The rows go inert — and now say so.
  assert.deepEqual(payload.linkTargets.unresolvedWorkspaces, ['alice']);
});

test('an unusable sources.json costs the deep links, not the dashboard', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: '{ not json' });
  const { payload } = await request(outputDir);

  assert.equal(payload.linkTargets.machineId, 'workstation', 'identity still comes from the local report');
  assert.equal(payload.linkTargets.workspaces.length, 1, 'the default scan is the fallback, never a crash');
});

// The named regression test for the whole task: a dashboard
// request must cost local work plus a cache read, never a network round trip.
test('a slow external source does not delay a dashboard request', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const remoteReport = {
    schema: 'tokens-cost-analyzer/report', schemaVersion: 1,
    report: { reportId: 'report-laptop', generatedAt: '2026-01-03T00:00:00.000Z', generatorVersion: '0.6.0', currency: 'USD', coverage: { mode: 'full-history', limit: null, limitScope: 'x' }, pricingSources: [], warnings: [] },
    origin: { machineId: 'laptop', workspaces: ['framework'] },
    // A validated report: this one has to survive `validateReport`, since an
    // invalid one would leave no snapshot and the second request would be cold.
    records: [localRecord({
      unitId: 'laptop/pi/remote/m1', sessionId: 'remote', totalTokens: 7,
      contentFingerprint: 'a1b2c3d4e5f60718', derivation: { generatorVersion: '0.6.0', pricingFingerprint: 'sha256:abc' },
    })],
  };
  const warm = (options) => loadExternalSources({ ...options, fetch: async () => ({ ok: true, text: JSON.stringify(remoteReport) }) });
  const warmed = await request(outputDir, { loadExternal: warm });
  // The fixture's report predates today, so the remote is legitimately
  // stale-report — still counted, which is the point.
  assert.deepEqual(warmed.payload.merge.sources.map((source) => source.state), ['ok', 'stale-report'], 'the first fetch is awaited and lands');

  // `timeoutSeconds` defaults to 10 s; this executor never resolves at all, so
  // any awaiting of it would show up as a hung request rather than a slow one.
  let reached = false;
  const stalled = (options) => loadExternalSources({
    ...options,
    now: Date.now() + 60 * 60_000,
    fetch: async () => { reached = true; await new Promise(() => {}); },
  });

  // Bounded rather than awaited outright: if this regresses, the point is that
  // the request blocks, and a blocked test must say so instead of wedging the
  // suite behind a fetch that never resolves.
  const started = Date.now();
  const { status, payload } = await Promise.race([
    request(outputDir, { loadExternal: stalled }),
    new Promise((_, fail) => setTimeout(() => fail(new Error('the dashboard request awaited the external fetch')), 10_000)),
  ]);
  const elapsed = Date.now() - started;

  assert.equal(status, 200, 'local isolation: an external source never changes the status');
  assert.ok(elapsed < 1000, `expected the response to be independent of timeoutSeconds, took ${elapsed}ms`);
  assert.equal(payload.totals.tokens, 20, 'the cached external records are counted, whole');
  assert.deepEqual(payload.merge.sources.map((source) => source.state), ['ok', 'stale-report'], 'the cached snapshot is what the card reports');
  assert.equal(payload.merge.sources[1].included, true, 'a machine we could not reach this second still counts');
  assert.ok(reached, 'the refresh really was started — it was just not awaited');
});

// The endpoint's whole value is that a browser tab polling it once a
// second cannot become a fetch loop against every configured machine.
test('the sources status endpoint reports flights and starts none', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const exploding = () => { throw new Error('the status endpoint contacted a source'); };

  const { status, payload } = await request(outputDir, { loadExternal: exploding }, '/api/sources/status');

  assert.equal(status, 200);
  assert.deepEqual(payload, { sources: [] }, 'nothing has been loaded in this process, so nothing is claimed about it');

  // And it stays cheap: no local report, no merge, no summarize.
  assert.equal(payload.totals, undefined);
  assert.equal(payload.merge, undefined);
  assert.equal(payload.daily, undefined);
});

test('an unreadable sources.json leaves the status endpoint polling harmlessly', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: '{ not json' });
  const { status, payload } = await request(outputDir, {}, '/api/sources/status');

  assert.equal(status, 200, 'a polling client must not start erroring over local configuration');
  assert.deepEqual(payload.sources, []);
  assert.match(payload.error, /./);
});

test('the status endpoint and the report cannot disagree about a source', async (t) => {
  const outputDir = await fixtureOutputDir(t, {
    sources: { schemaVersion: 1, sources: [oneSource.sources[0], { id: 'old-laptop', type: 'archived' }] },
  });
  await mkdir(join(outputDir, 'archive'), { recursive: true });
  await writeFile(join(outputDir, 'archive', 'old-laptop.json'), JSON.stringify(remoteReportFor('old-laptop', 'retired')));

  const warm = (options) => loadExternalSources({ ...options, fetch: async (source, fetchOptions) => (source.type === 'archived'
    ? fetchSource(source, fetchOptions)
    : { ok: true, text: JSON.stringify(remoteReportFor('laptop', 'remote')) }) });
  const { payload: report } = await request(outputDir, { loadExternal: warm });

  const { payload: statusPayload } = await request(outputDir, { loadExternal: () => { throw new Error('no fetching'); } }, '/api/sources/status');
  const byId = new Map(statusPayload.sources.map((source) => [source.id, source]));

  assert.deepEqual([...byId.keys()], ['laptop', 'old-laptop'], 'both configured sources are described from what the report loaded');
  for (const row of report.merge.sources.filter((source) => !source.isLocal)) {
    const status = byId.get(row.id);
    assert.equal(status.state, row.state, row.id);
    assert.equal(status.included, row.included, row.id);
    assert.equal(status.fromCache, row.fromCache, row.id);
    assert.equal(status.lastSuccessAt, row.lastSuccessAt, row.id);
    assert.equal(status.generatedAt, row.generatedAt, row.id);
    // Both endpoints derive ages from the same events; only the clock moved.
    assert.ok(Math.abs((status.reportAgeHours ?? 0) - (row.reportAgeHours ?? 0)) < 0.001, row.id);
    assert.equal(status.fetchAgeHours == null, row.fetchAgeHours == null, row.id);
  }
  assert.equal(byId.get('old-laptop').state, 'archived');
  assert.equal(byId.get('old-laptop').refreshing, false, 'an archived source is never in flight');
  assert.equal(byId.get('laptop').refreshing, false, 'nothing is in flight once the report has landed');
});

test('report and daily requests share one in-flight external fetch', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  let calls = 0;
  let release;
  const fetch = async () => {
    calls += 1;
    await new Promise((resolveFetch) => { release = resolveFetch; });
    return { ok: false, state: 'unreachable', detail: 'asleep' };
  };
  const loadExternal = (options) => loadExternalSources({ ...options, fetch });

  const report = request(outputDir, { loadExternal });
  const daily = request(outputDir, { loadExternal }, '/api/daily-usage');
  while (!release) await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(calls, 1);
  release();
  assert.deepEqual((await Promise.all([report, daily])).map((response) => response.status), [200, 200]);
});

test('the daily endpoint serves merged records so the widget cannot disagree with the dashboard', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const remote = { records: [localRecord({ unitId: 'laptop/pi/remote/m1', sessionId: 'remote', totalTokens: 7, sourceKey: 'laptop' })], state: { id: 'laptop', sourceKey: 'laptop', reportId: 'report-laptop', state: 'ok', included: true, detail: null, generatedAt: '2026-01-03T00:00:00.000Z', currency: 'USD', coverageMode: 'full-history' } };
  const loadExternal = async () => ({ loads: [remote] });

  const report = await request(outputDir, { loadExternal });
  const daily = await request(outputDir, { loadExternal }, '/api/daily-usage');

  assert.equal(report.payload.totals.tokens, 20);
  assert.deepEqual(daily.payload.daily, report.payload.daily);
  assert.deepEqual(daily.payload.daily, [{ date: '2026-01-03', tokens: 20, records: 2 }]);
  assert.deepEqual(report.payload.byWorkspace.map((row) => row.key), ['workstation/framework', 'laptop/framework']);
});

// A synced project directory puts the same sessionId on two machines.
// Merge drops identical records, but distinct messages survive on both — and a
// single rolled-up row would wear one machine's provenance while the session link points at the other.
test('one session seen on two machines stays two rows with honest provenance', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const remote = { records: [localRecord({ unitId: 'laptop/pi/local-session/m2', messageId: 'm2', sourceKey: 'laptop', workspaceId: 'client-x' })], state: { id: 'laptop', sourceKey: 'laptop', reportId: 'report-laptop', state: 'ok', included: true, detail: null, generatedAt: '2026-01-03T00:00:00.000Z', currency: 'USD', coverageMode: 'full-history' } };
  const { payload } = await request(outputDir, { loadExternal: async () => ({ loads: [remote] }) });

  assert.equal(payload.topDrivers.length, 2, 'the same session on two machines is two rollup rows');
  assert.deepEqual(
    payload.topDrivers.map((driver) => [driver.sourceKey, driver.workspaceId, driver.recordCount]).sort(),
    [['laptop', 'client-x', 1], ['workstation', 'framework', 1]],
  );
});

test('a currency-excluded source contributes tokens without inflating the unpriced counters', async (t) => {
  // One genuinely unpriced local record beside the currency-excluded remote, so
  // every counter has to tell the two apart rather than happening to read zero.
  const unpriced = localRecord({ unitId: 'workstation/pi/local-session/m2', messageId: 'm2', totalTokens: 4, recordedCost: null, estimatedCost: null });
  const outputDir = await fixtureOutputDir(t, { sources: oneSource, records: [localRecord(), unpriced] });
  const remote = { records: [localRecord({ unitId: 'eu/pi/remote/m1', sessionId: 'remote', totalTokens: 5, recordedCost: 9, sourceKey: 'eu', workspaceId: 'eu-ws' })], state: { id: 'eu', sourceKey: 'eu', reportId: 'report-eu', state: 'ok', included: true, detail: null, generatedAt: '2026-01-03T00:00:00.000Z', currency: 'EUR', coverageMode: 'full-history' } };
  const { payload } = await request(outputDir, { loadExternal: async () => ({ loads: [remote] }) });

  assert.equal(payload.totals.tokens, 22, 'token counts are currency-free');
  assert.equal(payload.totals.recordedCost, 2, 'no EUR amount reaches a USD total');
  assert.equal(payload.totals.unknownCostRecords, 1, 'a deliberate exclusion is not a data-quality problem');
  assert.equal(payload.trustIssues.length, 1);
  assert.match(payload.warnings.join(' '), /EUR.*USD/);

  // The per-key panels must agree with the headline; a currency exclusion that
  // leaked into these counts would contradict `totals.unknownCostRecords`.
  const unknownBy = (rowsList) => rowsList.map((row) => [row.key, row.unknown]);
  assert.deepEqual(unknownBy(payload.byModel), [['unknown-model', 1]]);
  assert.deepEqual(unknownBy(payload.bySource), [['pi', 1]]);
  assert.deepEqual(unknownBy(payload.byWorkspace).sort(), [['eu/eu-ws', 0], ['workstation/framework', 1]]);

  // The aggregate cells carry the same three cost states as the headline, since
  // the cost breakdowns are drawn from them and never from the records.
  const excluded = payload.usage.cells.find((cell) => cell.machineId === 'eu');
  const local = payload.usage.cells.find((cell) => cell.machineId === 'workstation');
  assert.equal(excluded.tokens, 5, 'excluded costs never exclude tokens');
  assert.equal(excluded.recordedCost, 0);
  assert.equal(excluded.recordedCostRecords, 0, 'no EUR amount can enter a USD stack');
  assert.equal(excluded.costExcludedRecords, 1);
  assert.equal(excluded.costExcludedTokens, 5);
  assert.equal(local.recordedCost, 2);
  assert.equal(local.recordedCostRecords, 1);
  assert.equal(local.costExcludedRecords, 0);
  assert.equal(local.unknownCostRecords, 1, 'the genuinely unpriced record stays a pricing gap');
  assert.equal(payload.usage.cells.some((cell) => 'subscriptionCost' in cell), false, 'subscription spend has no record to attach to');
});

test('a limited external source makes the whole aggregate limited', async (t) => {
  const outputDir = await fixtureOutputDir(t, { sources: oneSource });
  const remote = { records: [], state: { id: 'laptop', sourceKey: 'laptop', reportId: 'report-laptop', state: 'ok', included: true, detail: null, generatedAt: '2026-01-03T00:00:00.000Z', currency: 'USD', coverageMode: 'limited' } };
  const { payload } = await request(outputDir, { loadExternal: async () => ({ loads: [remote] }) });

  assert.equal(payload.analysis.mode, 'limited', 'incompleteness is contagious upward');
  assert.match(payload.warnings.join(' '), /limited history/);
});

test('subscription records are summarized alongside merged token usage', async (t) => {
  const outputDir = await fixtureOutputDir(t);
  await writeFile(join(outputDir, 'subscriptions.json'), JSON.stringify({
    records: [
      { month: '2026-01', service: 'claude', amount: 20.005, currency: 'USD' },
      { month: '2026-01', service: 'openai', amount: 10, currency: 'USD' },
    ],
  }));

  const { status, payload } = await request(outputDir);
  assert.equal(status, 200);
  assert.equal(payload.totals.subscriptionCost, 30.005);
  assert.deepEqual(payload.subscriptions.byMonth, [{ month: '2026-01', amount: 30.005 }]);
  assert.equal(payload.monthly.find((row) => row.month === '2026-01').subscriptionCost, 30.005);
});

// --- the request path must not re-parse the report artifact ----------------

test('a handler parses an unchanged report artifact once across requests', async (t) => {
  const outputDir = await fixtureOutputDir(t);
  let parses = 0;
  const cache = createReportViewCache();
  const readReportView = (path, build) => cache(path, (report) => { parses += 1; return build(report); });
  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: outputDir, outputDir, readReportView });
  const send = (path) => new Promise((done) => {
    let status;
    handler({ url: path }, { writeHead(code) { status = code; }, setHeader() {}, end(body) { done({ status, payload: JSON.parse(body) }); } });
  });

  const first = await send('/api/report');
  const second = await send('/api/report');
  const daily = await send('/api/daily-usage');

  assert.equal(first.status, 200);
  assert.equal(parses, 1, 'the artifact is parsed once and reused');
  assert.deepEqual(second.payload, first.payload, 'the reused view produces an identical response');
  assert.equal(daily.status, 200);
});

test('a rewritten report artifact is re-parsed', async (t) => {
  const outputDir = await fixtureOutputDir(t);
  let parses = 0;
  const cache = createReportViewCache();
  const readReportView = (path, build) => cache(path, (report) => { parses += 1; return build(report); });
  const handler = createTokensCostAnalyzerHandler({ workspaceRoot: outputDir, outputDir, readReportView });
  const send = () => new Promise((done) => {
    handler({ url: '/api/report' }, { writeHead() {}, setHeader() {}, end(body) { done(JSON.parse(body)); } });
  });

  const before = await send();
  const artifact = JSON.parse(await readFile(join(outputDir, 'report.v1.json'), 'utf8'));
  artifact.records.push(localRecord({ messageId: 'm2', unitId: 'workstation/pi/local-session/m2' }));
  await new Promise((done) => setTimeout(done, 10));
  await writeFile(join(outputDir, 'report.v1.json'), JSON.stringify(artifact));
  const after = await send();

  assert.equal(before.totals.records, 1);
  assert.equal(after.totals.records, 2, 'the new record is visible without restarting the server');
  assert.equal(parses, 2);
});
