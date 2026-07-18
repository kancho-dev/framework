import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskBrowserHandler } from './server.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'task-browser-server-next-actor-'));
  const taskDir = join(root, 'projects', 'demo', 'work', 'task');
  const metadataPath = join(root, 'tasks.json');
  const historyPath = join(root, 'history.jsonl');
  await mkdir(join(taskDir, 'runs'), { recursive: true });
  await writeFile(join(taskDir, 'TASK.md'), '# Test task\n\n## Purpose\nTest next actor.\n');
  await writeFile(join(taskDir, 'HANDOFF.md'), '# Handoff\n\n## Next Action\nAgent implements.\n');
  await writeFile(join(taskDir, 'CONTEXT.md'), '# Context\n');
  await writeFile(metadataPath, `${JSON.stringify({ version: 1, nextDisplayNumber: 2, tasks: { 'demo/task': { displayId: '#1', project: 'demo', slug: 'task', path: 'projects/demo/work/task', status: 'active', priority: 'normal', type: 'implementation', nextActor: null } } })}\n`);
  return { root, metadataPath, historyPath };
}

async function withServer(ctx, run) {
  const server = createServer(createTaskBrowserHandler({ workspaceRoot: ctx.root, metadataPath: ctx.metadataPath, historyPath: ctx.historyPath }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function patch(base, nextActor) {
  return fetch(`${base}/api/task-metadata`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'demo/task', metadata: { nextActor } }) });
}

test('browser API persists and clears nextActor, rejects invalid values, and skips no-op history', async () => {
  const ctx = await fixture();
  await withServer(ctx, async (base) => {
    let response = await patch(base, 'agent');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).metadata.nextActor, 'agent');
    assert.equal((await patch(base, 'agent')).status, 200);

    response = await patch(base, 'builder');
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /nextActor must be one of/);

    response = await patch(base, null);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).metadata.nextActor, null);
  });
  const events = (await readFile(ctx.historyPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.changes.nextActor), [
    { before: null, after: 'agent' },
    { before: 'agent', after: null },
  ]);
});
