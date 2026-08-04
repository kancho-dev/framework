import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    assert.equal((await fetch(`${origin}${tool.base}/?workspace=enabled`)).status, 200, `${tool.base} enabled page`);
    assert.equal((await fetch(`${origin}${tool.base}/shared/${tool.sharedAsset}`)).status, 200, `${tool.base} workspace-independent shared alias`);
  }
  assert.equal((await fetch(`${origin}/tools/tokens-cost-analyzer/refresh.test.mjs`)).status, 404);
});
