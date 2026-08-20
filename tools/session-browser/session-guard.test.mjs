import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspaceRoot = await mkdtemp(join(tmpdir(), 'session-guard-workspace-'));
const liveRoot = await mkdtemp(join(tmpdir(), 'session-guard-live-'));
const configDir = join(workspaceRoot, '.tools-config', 'session-browser');
const archivePi = join(configDir, 'archive', 'old', 'pi', 'sessions');
const archiveCodex = join(configDir, 'archive', 'old', 'codex', 'sessions');
await mkdir(archivePi, { recursive: true });
await mkdir(archiveCodex, { recursive: true });
await writeFile(join(archivePi, 'session.jsonl'), '{}\n');
await writeFile(join(configDir, 'archive', 'old', 'outside.jsonl'), '{}\n');
const externalPiFile = join(liveRoot, 'external.jsonl');
await writeFile(externalPiFile, '{}\n');
await symlink(externalPiFile, join(archivePi, 'escape-link.jsonl'));
const configPath = join(configDir, 'machines.json');
await writeFile(configPath, JSON.stringify({
  version: 1,
  machines: [{
    id: 'old',
    roots: { pi: 'archive/old/pi/sessions', codex: 'archive/old/codex/sessions' },
    pathMap: [{ from: '/old/workspace', to: '.' }],
  }],
}));

process.env.SESSION_SOURCES = 'pi';
process.env.SESSION_ROOT = liveRoot;
process.env.WORKSPACE_ROOT = workspaceRoot;
const { createSessionBrowserHandler } = await import('./server.mjs');

async function withServer(run) {
  const handler = createSessionBrowserHandler({
    workspaceRoot,
    metadataPath: join(workspaceRoot, 'metadata.json'),
    legacyMachinesPath: configPath,
  });
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.statusCode = 404; res.end(); } });
  await new Promise((resolve) => server.listen(0, resolve));
  try { await run(server); } finally { server.close(); }
}

async function putMetadata(server, ref) {
  return fetch(`http://127.0.0.1:${server.address().port}/api/metadata`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref, bookmarked: true }),
  });
}

test('legacy id refs require a configured machine and declared source', async () => {
  await withServer(async (server) => {
    assert.equal((await putMetadata(server, 'codex@old:session-id')).status, 200);
    assert.equal((await putMetadata(server, 'codex@unknown:session-id')).status, 400);
    assert.equal((await putMetadata(server, 'opencode@old:session-id')).status, 400);
  });
});

test('legacy pi refs must resolve under that machine pi root', async () => {
  await withServer(async (server) => {
    assert.equal((await putMetadata(server, `pi@old:${join(archivePi, 'session.jsonl')}`)).status, 200);
    assert.equal((await putMetadata(server, `pi@old:${join(configDir, 'archive', 'old', 'outside.jsonl')}`)).status, 400);
    assert.equal((await putMetadata(server, `pi@old:${join(archivePi, '..', '..', '..', 'escape.jsonl')}`)).status, 400);
    assert.equal((await putMetadata(server, `pi@old:${join(archivePi, 'escape-link.jsonl')}`)).status, 400);
  });
});

test('current-machine id refs retain their existing guard behavior', async () => {
  await withServer(async (server) => {
    assert.equal((await putMetadata(server, 'codex:current-session')).status, 200);
  });
});
