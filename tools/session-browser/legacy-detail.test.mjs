import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const workspaceRoot = await mkdtemp(join(tmpdir(), 'legacy-detail-workspace-'));
const liveRoot = await mkdtemp(join(tmpdir(), 'legacy-detail-live-'));
const configDir = join(workspaceRoot, '.tools-config', 'session-browser');
const archive = join(configDir, 'archive', 'old');
const roots = {
  pi: join(archive, 'pi', 'sessions'),
  'claude-code': join(archive, 'claude', 'projects'),
  codex: join(archive, 'codex', 'sessions'),
  opencode: join(archive, 'opencode.db'),
};
const opencodeData = join(archive, 'opencode');
await Promise.all([roots.pi, roots['claude-code'], roots.codex, join(opencodeData, 'storage', 'session_diff')].map((path) => mkdir(path, { recursive: true })));
const oldCwd = '/old/workspace';
const jsonl = (lines) => `${lines.map(JSON.stringify).join('\n')}\n`;

const piFile = join(roots.pi, 'pi-session.jsonl');
await writeFile(piFile, jsonl([
  { type: 'session', id: 'pi-id', cwd: oldCwd, timestamp: '2026-01-01T00:00:00.000Z' },
  { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'pi prompt' } },
]));
const unmapped = join(roots.pi, 'unmapped.jsonl');
await writeFile(unmapped, jsonl([{ type: 'session', id: 'unmapped', cwd: '/other/workspace' }]));
const codexId = '12345678-1234-1234-1234-123456789abc';
await writeFile(join(roots.codex, `rollout-${codexId}.jsonl`), jsonl([
  { type: 'session_meta', timestamp: '2026-01-01T00:00:00.000Z', payload: { id: codexId, cwd: oldCwd } },
]));
const claudeId = 'claude-session';
await writeFile(join(roots['claude-code'], `${claudeId}.jsonl`), jsonl([
  { type: 'user', sessionId: claudeId, cwd: oldCwd, timestamp: '2026-01-01T00:00:00.000Z', message: { role: 'user', content: 'claude prompt' } },
]));
try {
  await execFileAsync('sqlite3', [roots.opencode, [
    'create table session (id text primary key, parent_id text, directory text, path text, title text, model text, cost real, tokens_input integer, tokens_output integer, tokens_cache_read integer, tokens_cache_write integer, time_created integer, time_updated integer, time_archived integer);',
    'create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text);',
    'create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text);',
    `insert into session values ('oc-id',null,'${oldCwd}','${oldCwd}','OpenCode legacy','',0,0,0,0,0,1000,1000,null);`,
    `insert into message values ('oc-message','oc-id',1000,1000,'{"role":"user"}');`,
    `insert into message values ('oc-assistant','oc-id',1001,1001,'{"role":"assistant"}');`,
    `insert into part values ('oc-patch','oc-assistant','oc-id',1001,1001,'{"type":"patch","files":["${oldCwd}/file.js"]}');`,
  ].join('\n')]);
} catch {
  // The OpenCode case skips when sqlite3 is unavailable; file adapters still run.
}
await writeFile(join(opencodeData, 'storage', 'session_diff', 'oc-id.json'), JSON.stringify([
  { file: 'file.js', patch: '-old\\n+new', additions: 1, deletions: 1, status: 'modified' },
]));

const configPath = join(configDir, 'machines.json');
await writeFile(configPath, JSON.stringify({
  version: 1,
  machines: [{
    id: 'old', label: 'Old machine',
    roots: {
      pi: 'archive/old/pi/sessions',
      'claude-code': 'archive/old/claude/projects',
      codex: 'archive/old/codex/sessions',
      opencode: 'archive/old/opencode.db',
    },
    artifacts: { 'opencode-data': 'archive/old/opencode' },
    pathMap: [{ from: oldCwd, to: '.' }],
  }],
}));

await mkdir(join(liveRoot, 'codex-home', 'sessions'), { recursive: true });
await mkdir(join(liveRoot, 'claude-home', 'projects'), { recursive: true });
process.env.SESSION_SOURCES = 'pi,opencode,codex,claude-code';
process.env.SESSION_ROOT = liveRoot;
process.env.CODEX_HOME = join(liveRoot, 'codex-home');
process.env.CLAUDE_HOME = join(liveRoot, 'claude-home');
process.env.OPENCODE_DB = join(liveRoot, 'missing-opencode.db');
process.env.WORKSPACE_ROOT = workspaceRoot;
const { createSessionBrowserHandler } = await import('./server.mjs');

async function withServer(run) {
  const handler = createSessionBrowserHandler({ workspaceRoot, legacyMachinesPath: configPath });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise((resolve) => server.listen(0, resolve));
  try { await run(server); } finally { server.close(); }
}

async function detail(server, ref) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/session?ref=${encodeURIComponent(ref)}`);
  return { status: response.status, body: await response.json() };
}

test('detail loaders resolve all configured legacy source roots', async (t) => {
  await withServer(async (server) => {
    const refs = [
      `pi@old:${piFile}`,
      `codex@old:${codexId}`,
      `claude-code@old:${claudeId}`,
    ];
    try { await execFileAsync('sqlite3', ['-version']); refs.push('opencode@old:oc-id'); } catch { t.diagnostic('sqlite3 unavailable; OpenCode detail skipped'); }

    for (const ref of refs) {
      const result = await detail(server, ref);
      assert.equal(result.status, 200, `${ref}: ${JSON.stringify(result.body)}`);
      assert.equal(result.body.machineId, 'old');
      assert.equal(result.body.archived, true);
      assert.equal(result.body.originalCwd, oldCwd);
      assert.equal(result.body.cwd, workspaceRoot);
      assert.ok(result.body.path.includes('@old:'));
      if (ref.startsWith('opencode@')) {
        const patch = result.body.entries.flatMap((entry) => entry.message?.content || []).find((block) => block.type === 'patch');
        assert.equal(patch.diffs[0].patch, '-old\\n+new');
      }
    }
  });
});

test('legacy scans merge all configured sources and count unmapped sessions', async () => {
  await withServer(async (server) => {
    let response;
    let body;
    response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions`);
    body = await response.json();
    assert.equal(body.archivesLoading, true);
    assert.equal(body.sessions.some(({ machineId }) => machineId), false);
    for (let attempt = 0; attempt < 30 && body.archivesLoading; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions?archivesOnly=1`);
      body = await response.json();
    }
    assert.equal(response.status, 200);
    assert.equal(body.archivesLoading, false);
    assert.deepEqual(new Set(body.sessions.map(({ source }) => source)), new Set(['pi', 'codex', 'claude-code', 'opencode']));
    assert.ok(body.sessions.every(({ machineId }) => machineId === 'old'));
    assert.deepEqual(body.unmappedSessions, [{ machineId: 'old', label: 'Old machine', count: 1 }]);
    assert.deepEqual(body.sourceErrors, []);
  });
});

test('an unmapped legacy detail remains outside this workspace', async () => {
  await withServer(async (server) => {
    assert.equal((await detail(server, `pi@old:${unmapped}`)).status, 404);
  });
});

test('live and archived summaries stay isolated when both roots name the same files', async () => {
  const aliasedFile = join(liveRoot, 'aliased.jsonl');
  await writeFile(aliasedFile, jsonl([
    { type: 'session', id: 'aliased', cwd: workspaceRoot, timestamp: '2026-01-01T00:00:00.000Z' },
    { type: 'message', id: 'u1', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: 'aliased prompt' } },
  ]));
  await utimes(aliasedFile, new Date('2026-06-01T00:00:00.000Z'), new Date('2026-06-01T00:00:00.000Z'));
  const aliasedConfig = join(configDir, 'aliased-machines.json');
  await writeFile(aliasedConfig, JSON.stringify({
    version: 1,
    machines: [{
      id: 'alias', label: 'Aliased machine',
      roots: { pi: liveRoot },
      pathMap: [{ from: workspaceRoot, to: '.' }],
    }],
  }));

  const handler = createSessionBrowserHandler({ workspaceRoot, legacyMachinesPath: aliasedConfig });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const port = server.address().port;
    let body = await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json();
    for (let attempt = 0; attempt < 30 && body.archivesLoading; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      body = await (await fetch(`http://127.0.0.1:${port}/api/sessions?archivesOnly=1`)).json();
    }
    // Exercise another cached scan after both provenance variants have settled.
    body = await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json();
    const live = body.sessions.find((session) => session.id === 'aliased' && !session.machineId);
    const archived = body.sessions.find((session) => session.id === 'aliased' && session.machineId === 'alias');
    assert.equal(live.updatedAt, '2026-06-01T00:00:00.000Z');
    assert.equal(archived.updatedAt, '2026-01-01T00:00:01.000Z');
  } finally {
    server.close();
  }
});

test('an archived session keeps its own last-updated time instead of the copy time', async () => {
  await withServer(async (server) => {
    const port = server.address().port;
    let body = await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json();
    for (let attempt = 0; attempt < 30 && body.archivesLoading; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      body = await (await fetch(`http://127.0.0.1:${port}/api/sessions?archivesOnly=1`)).json();
    }
    const archived = body.sessions.find((session) => session.machineId === 'old' && session.source === 'pi');

    // The fixture file was written seconds ago, so an mtime-derived value cannot be 2026.
    assert.equal(archived.updatedAt, '2026-01-01T00:00:01.000Z');

    const detail = await (await fetch(`http://127.0.0.1:${port}/api/session?ref=${encodeURIComponent(`pi@old:${piFile}`)}`)).json();
    assert.equal(detail.updatedAt, '2026-01-01T00:00:01.000Z');
  });
});
