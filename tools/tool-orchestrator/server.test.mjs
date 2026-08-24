import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('server did not become ready');
}

async function waitForArchives(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const payload = await (await fetch(url)).json();
    if (!payload.archivesLoading) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('archives did not finish loading');
}

test('relative shared archive manifests and per-workspace bindings reach Session Browser handlers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-archives-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configDir = join(root, 'config');
  const archiveRoot = join(configDir, 'archive', 'old', 'pi');
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(join(archiveRoot, 'session.jsonl'), `${JSON.stringify({ type: 'session', id: 'archived', cwd: '/old/work', timestamp: '2026-01-01T00:00:00.000Z' })}\n`);
  await writeFile(join(configDir, 'archive-manifest.json'), JSON.stringify({
    version: 1,
    machines: [{ id: 'old', roots: { pi: 'archive/old/pi' } }],
  }));
  const configPath = join(configDir, 'workspaces.json');
  await writeFile(configPath, JSON.stringify({
    sessionArchiveManifestPath: './archive-manifest.json',
    workspaces: [{
      id: 'default', root,
      sessionArchiveBindings: [{ machineId: 'old', pathMap: [{ from: '/old/work', to: '.' }] }],
    }],
  }));
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, TOOL_ORCHESTRATOR_PORT: String(port), TOOL_ORCHESTRATOR_WORKSPACES_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(origin, child);

  const payload = await waitForArchives(`${origin}/tools/sessions/api/sessions?archivesOnly=1`);
  assert.ok(payload.sessions.some(({ machineId, id }) => machineId === 'old' && id === 'archived'), JSON.stringify(payload));
});

test('four-workspace archive overlay isolates defaults, overrides, reset, and failures', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-shared-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const framework = join(root, 'framework');
  const morph = join(root, 'morph');
  const history = join(root, 'history');
  const configDir = join(root, 'config');
  const archive = join(configDir, 'archive', 'old', 'pi');
  const bundleDir = join(configDir, 'archive', 'old', 'metadata');
  await Promise.all([mkdir(framework), mkdir(morph), mkdir(history), mkdir(archive, { recursive: true }), mkdir(join(bundleDir, 'workspaces'), { recursive: true })]);
  const frameworkFile = join(archive, 'framework.jsonl');
  const morphFile = join(archive, 'morph.jsonl');
  await writeFile(frameworkFile, `${JSON.stringify({ type: 'session', id: 'framework-session', cwd: '/old/home/framework/project', timestamp: '2026-01-01T00:00:00.000Z' })}\n`);
  await writeFile(morphFile, `${JSON.stringify({ type: 'session', id: 'morph-session', cwd: '/old/home/morph/project', timestamp: '2026-01-01T00:00:00.000Z' })}\n`);
  await writeFile(join(configDir, 'manifest.json'), JSON.stringify({ version: 1, machines: [{ id: 'old', roots: { pi: 'archive/old/pi' } }] }));
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  const snapshotSpecs = [
    ['framework', '/old/home/framework', `pi@old:${frameworkFile}`, { bookmarked: true, tags: ['framework-default'], savedTopics: { f: { title: 'Framework topic' } } }],
    ['morph', '/old/home/morph', `pi@old:${morphFile}`, { bookmarked: false, tags: ['morph-default'], savedTopics: {} }],
    ['global', '/old/home', `pi@old:${frameworkFile}`, { bookmarked: false, tags: ['global-default'], savedTopics: {} }],
    ['retired-client', '/old/home/framework', `pi@old:${frameworkFile}`, { bookmarked: false, tags: ['history-default'], savedTopics: {} }],
  ];
  const bundleWorkspaces = [];
  for (const [id, oldRoot, key, entry] of snapshotSpecs) {
    const bytes = Buffer.from(JSON.stringify({ version: 3, sessions: { [key]: entry } }));
    const snapshotPath = `workspaces/${id}.json`;
    await writeFile(join(bundleDir, snapshotPath), bytes);
    bundleWorkspaces.push({ workspaceId: id, workspaceLabel: id, oldRoot, sourceMetadataPath: `/old/${id}/metadata.json`, snapshotPath, sha256: sha256(bytes), bytes: bytes.length, exportedAt: '2026-01-01T00:00:00.000Z' });
  }
  const malformedBytes = Buffer.from('{');
  await writeFile(join(bundleDir, 'workspaces/malformed.json'), malformedBytes);
  bundleWorkspaces.push({ workspaceId: 'malformed', workspaceLabel: 'malformed', oldRoot: '/old/home/framework', sourceMetadataPath: '/old/malformed/metadata.json', snapshotPath: 'workspaces/malformed.json', sha256: sha256(malformedBytes), bytes: malformedBytes.length, exportedAt: '2026-01-01T00:00:00.000Z' });
  await writeFile(join(bundleDir, 'bundle.json'), JSON.stringify({ version: 1, machine: { id: 'old', label: 'Old' }, exportedAt: '2026-01-01T00:00:00.000Z', archiveManifest: { path: '../../../manifest.json', sha256: 'a'.repeat(64) }, workspaces: bundleWorkspaces }));
  const metadata = Object.fromEntries(['framework', 'morph', 'global', 'history', 'malformed', 'broken'].map((id) => [id, join(root, 'metadata', `${id}.json`)]));
  const binding = (from, archivedWorkspaceId) => [{ machineId: 'old', metadataBundlePath: 'archive/old/metadata/bundle.json', ...(archivedWorkspaceId ? { archivedWorkspaceId } : {}), pathMap: [{ from, to: '.' }] }];
  const configPath = join(configDir, 'workspaces.json');
  await writeFile(configPath, JSON.stringify({
    sessionArchiveManifestPath: './manifest.json',
    workspaces: [
      { id: 'framework', root: framework, sessionMetadataPath: metadata.framework, sessionArchiveBindings: binding('/old/home/framework') },
      { id: 'morph', root: morph, sessionMetadataPath: metadata.morph, sessionArchiveBindings: binding('/old/home/morph') },
      { id: 'global', root, sessionMetadataPath: metadata.global, sessionArchiveBindings: binding('/old/home') },
      { id: 'history', root: history, sessionMetadataPath: metadata.history, sessionArchiveBindings: binding('/old/home/framework', 'retired-client') },
      { id: 'malformed', root: framework, sessionMetadataPath: metadata.malformed, sessionArchiveBindings: binding('/old/home/framework', 'malformed') },
      { id: 'broken', root, sessionMetadataPath: metadata.broken, sessionArchiveBindings: [{ machineId: 'missing', metadataBundlePath: './missing-bundle.json', pathMap: [] }] },
    ],
  }));
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, TOOL_ORCHESTRATOR_PORT: String(port), TOOL_ORCHESTRATOR_WORKSPACES_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(origin, child);
  const sessionsFor = (id) => waitForArchives(`${origin}/tools/sessions/api/sessions?archivesOnly=1&workspace=${id}`);

  const payloads = [];
  for (const id of ['framework', 'morph', 'global', 'history', 'malformed', 'broken']) payloads.push(await sessionsFor(id));
  const [frameworkPayload, morphPayload, globalPayload, historyPayload, malformedPayload, brokenPayload] = payloads;
  assert.deepEqual(frameworkPayload.sessions.map(({ id }) => id), ['framework-session'], JSON.stringify(frameworkPayload));
  assert.deepEqual(morphPayload.sessions.map(({ id }) => id), ['morph-session']);
  assert.deepEqual(new Set(globalPayload.sessions.map(({ id }) => id)), new Set(['framework-session', 'morph-session']));
  assert.deepEqual(historyPayload.sessions.map(({ id }) => id), ['framework-session']);
  assert.deepEqual(frameworkPayload.sessions[0].metadata.tags, ['framework-default']);
  assert.deepEqual(globalPayload.sessions.find(({ id }) => id === 'framework-session').metadata.tags, ['global-default']);
  assert.deepEqual(historyPayload.sessions[0].metadata.tags, ['history-default']);
  assert.equal(frameworkPayload.sessions[0].metadata.provenance.source, 'archive');
  assert.deepEqual(malformedPayload.sessions.map(({ id }) => id), ['framework-session'], 'bad metadata never hides its session');
  assert.ok(malformedPayload.sourceErrors.some(({ code }) => code === 'invalid-snapshot'));
  assert.ok(brokenPayload.sourceErrors.some(({ code }) => code === 'unknown-machine-binding'));
  assert.ok(brokenPayload.sourceErrors.some(({ code }) => code === 'workspace-unbound'));

  const morphRef = globalPayload.sessions.find(({ id }) => id === 'morph-session').path;
  assert.equal((await fetch(`${origin}/tools/sessions/api/session?workspace=framework&ref=${encodeURIComponent(morphRef)}`)).status, 404);
  const frameworkRef = frameworkPayload.sessions[0].path;
  const detail = await (await fetch(`${origin}/tools/sessions/api/session?workspace=framework&ref=${encodeURIComponent(frameworkRef)}`)).json();
  assert.deepEqual(detail.metadata.tags, ['framework-default']);
  const summary = await (await fetch(`${origin}/tools/sessions/api/summary?workspace=framework`)).json();
  assert.equal(summary.latestBookmarkedSession.bookmarked, true);

  const saved = await fetch(`${origin}/tools/sessions/api/metadata?workspace=framework`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: frameworkRef, tags: ['edited'], savedTopics: { edited: { title: 'Edited topic' } } }),
  });
  assert.equal(saved.status, 200);
  const override = (await saved.json()).metadata;
  assert.equal(override.bookmarked, true, 'copy-on-write retains the complete archived entry');
  assert.deepEqual(override.tags, ['edited']);
  assert.equal(override.savedTopicCount, 1);
  assert.equal(override.provenance.source, 'live');
  assert.equal(override.canReset, true);
  await assert.rejects(readFile(metadata.global, 'utf8'), { code: 'ENOENT' });

  const cleared = await fetch(`${origin}/tools/sessions/api/metadata?workspace=framework`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: frameworkRef, bookmarked: false, tags: [], savedTopics: {} }),
  });
  assert.equal(cleared.status, 200);
  const storedEmpty = JSON.parse(await readFile(metadata.framework, 'utf8'));
  assert.deepEqual(storedEmpty.sessions[frameworkRef], { bookmarked: false, tags: [], savedTopics: {} });
  const reset = await fetch(`${origin}/tools/sessions/api/metadata/override?workspace=framework`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: frameworkRef }),
  });
  assert.equal(reset.status, 200);
  assert.deepEqual((await reset.json()).metadata.tags, ['framework-default']);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(metadata.framework, 'utf8')).sessions, frameworkRef), false);
});

test('an explicitly configured missing shared manifest reports a legacy-config diagnostic', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-missing-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, 'workspaces.json');
  await writeFile(configPath, JSON.stringify({
    sessionArchiveManifestPath: './missing.json',
    workspaces: [{ id: 'default', root, sessionArchiveBindings: [] }],
  }));
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, TOOL_ORCHESTRATOR_PORT: String(port), TOOL_ORCHESTRATOR_WORKSPACES_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(origin, child);

  const payload = await waitForArchives(`${origin}/tools/sessions/api/sessions?archivesOnly=1`);
  assert.ok(payload.sourceErrors.some(({ source, code }) => source === 'legacy-config' && code === 'invalid-config'), JSON.stringify(payload));
});

test('tool assets load without a workspace query while pages and APIs remain gated', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, 'workspaces.json');
  await writeFile(configPath, JSON.stringify({
    defaultWorkspace: 'default',
    workspaces: [
      { id: 'default', name: 'Default', root, tools: { 'task-browser': false, 'session-browser': false, 'tokens-cost-analyzer': false } },
      { id: 'enabled', name: 'Enabled', root, tools: { 'task-browser': true, 'session-browser': true, 'tokens-cost-analyzer': true } },
    ],
  }));
  const port = await unusedPort();
  const child = spawn(process.execPath, [join(here, 'server.mjs')], {
    env: { ...process.env, TOOL_ORCHESTRATOR_PORT: String(port), TOOL_ORCHESTRATOR_WORKSPACES_CONFIG: configPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(origin, child);

  const disabledPage = await (await fetch(origin)).text();
  assert.match(disabledPage, /window\.__FRAMEWORK_COCKPIT__ = .*"workspaceId":"default"/);
  assert.match(disabledPage, /"icon":"\/icon.svg"/, 'Home links use the Cockpit icon from every mounted tool');
  assert.match(disabledPage, /"tools":\[\]/, 'Cockpit menu reflects the selected workspace tool set');
  const enabledPage = await (await fetch(`${origin}/?workspace=enabled`)).text();
  assert.match(enabledPage, /window\.__FRAMEWORK_COCKPIT__ = .*"workspaceId":"enabled"/);
  assert.match(enabledPage, /"tools":\[.*"task-browser".*"session-browser".*"tokens-cost-analyzer"/);

  const disabledConfig = await (await fetch(`${origin}/api/dashboard-config`)).json();
  assert.ok(!disabledConfig.catalog.some((widget) => widget.type === 'daily-usage'));
  const enabledConfig = await (await fetch(`${origin}/api/dashboard-config?workspace=enabled`)).json();
  assert.ok(enabledConfig.catalog.some((widget) => widget.type === 'daily-usage' && widget.size === 'wide'));
  assert.ok(!enabledConfig.layout.some((widget) => widget.type === 'daily-usage'), 'daily usage is available but not shipped by default');
  assert.equal((await fetch(`${origin}/shared/browser/daily-usage-heatmap.js`)).status, 200);
  assert.equal((await fetch(`${origin}/shared/daily-usage-heatmap.css`)).status, 200);

  const tools = [
    { base: '/tools/tasks', asset: 'selection.js', api: 'api/tasks', sharedAsset: 'cockpit-nav.js' },
    { base: '/tools/sessions', asset: 'formatters.js', api: 'api/sessions', sharedAsset: 'select.css' },
    { base: '/tools/tokens-cost-analyzer', asset: 'refresh.js', api: 'api/report', sharedAsset: 'http.mjs' },
  ];
  for (const tool of tools) {
    const asset = await fetch(`${origin}${tool.base}/${tool.asset}`);
    assert.equal(asset.status, 200, `${tool.base} static asset`);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await fetch(`${origin}${tool.base}/`)).status, 404, `${tool.base} disabled page`);
    assert.equal((await fetch(`${origin}${tool.base}/index.html`)).status, 404, `${tool.base} disabled HTML entry`);
    assert.equal((await fetch(`${origin}${tool.base}/index%2Ehtml`)).status, 404, `${tool.base} encoded disabled HTML entry`);
    assert.equal((await fetch(`${origin}${tool.base}/index%2ehtml`)).status, 404, `${tool.base} lowercase encoded disabled HTML entry`);
    assert.equal((await fetch(`${origin}${tool.base}/${tool.api}`)).status, 404, `${tool.base} disabled API`);
    const enabledPageResponse = await fetch(`${origin}${tool.base}/?workspace=enabled`);
    assert.equal(enabledPageResponse.status, 200, `${tool.base} enabled page`);
    assert.match(await enabledPageResponse.text(), /"icon":"\/icon.svg"/, `${tool.base} Home link uses the Cockpit icon`);
    assert.equal((await fetch(`${origin}${tool.base}/shared/${tool.sharedAsset}`)).status, 200, `${tool.base} workspace-independent shared alias`);
  }
  assert.equal((await fetch(`${origin}/tools/tokens-cost-analyzer/refresh.test.mjs`)).status, 404);
});
