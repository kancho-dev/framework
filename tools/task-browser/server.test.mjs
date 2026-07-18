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

async function addTask(ctx, slug, metadata) {
  const taskDir = join(ctx.root, 'projects', 'demo', 'work', slug);
  await mkdir(join(taskDir, 'runs'), { recursive: true });
  await writeFile(join(taskDir, 'TASK.md'), `# ${slug}\n\n## Purpose\nSummary fixture.\n`);
  await writeFile(join(taskDir, 'HANDOFF.md'), '# Handoff\n\n## Next Action\nContinue.\n');
  await writeFile(join(taskDir, 'CONTEXT.md'), '# Context\n');
  return [`demo/${slug}`, { displayId: metadata.displayId, project: 'demo', slug, path: `projects/demo/work/${slug}`, type: 'implementation', ...metadata }];
}

async function withServer(ctx, run) {
  const server = createServer(createTaskBrowserHandler({ workspaceRoot: ctx.root, metadataPath: ctx.metadataPath, historyPath: ctx.historyPath }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function putSteeringNotes(base, key, content, revision) {
  return fetch(`${base}/api/steering-notes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, content, revision }) });
}

async function patch(base, nextActor) {
  return fetch(`${base}/api/task-metadata`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'demo/task', metadata: { nextActor } }) });
}

test('Steering Notes API safely saves, detects conflicts, clears, and exposes pending state', async () => {
  const ctx = await fixture();
  await withServer(ctx, async (base) => {
    let tasks = await (await fetch(`${base}/api/tasks`)).json();
    const initial = tasks.tasks[0].steeringNotes;
    assert.equal(tasks.tasks[0].hasPendingSteeringNotes, false);

    let response = await putSteeringNotes(base, 'demo/task', 'Use the narrow path.\n', initial.revision);
    assert.equal(response.status, 200);
    const saved = (await response.json()).steeringNotes;
    assert.equal(await readFile(join(ctx.root, 'projects/demo/work/task/NOTES.md'), 'utf8'), 'Use the narrow path.\n');

    response = await putSteeringNotes(base, 'demo/task', 'stale overwrite', initial.revision);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed or were consumed/);

    tasks = await (await fetch(`${base}/api/tasks`)).json();
    assert.equal(tasks.tasks[0].hasPendingSteeringNotes, true);
    assert.equal(tasks.tasks[0].steeringNotes.content, 'Use the narrow path.\n');

    response = await putSteeringNotes(base, 'demo/task', '', saved.revision);
    assert.equal(response.status, 200);
    await assert.rejects(readFile(join(ctx.root, 'projects/demo/work/task/NOTES.md'), 'utf8'), { code: 'ENOENT' });
  });
  assert.doesNotMatch(await readFile(ctx.metadataPath, 'utf8'), /Use the narrow path/);
});

test('Steering Notes API rejects unknown, traversal-like, invalid, and oversized payloads', async () => {
  const ctx = await fixture();
  await withServer(ctx, async (base) => {
    const revision = (await (await fetch(`${base}/api/tasks`)).json()).tasks[0].steeringNotes.revision;
    assert.equal((await putSteeringNotes(base, '../demo/task', 'x', revision)).status, 404);
    assert.equal((await putSteeringNotes(base, 'demo/../../task', 'x', revision)).status, 404);
    assert.equal((await putSteeringNotes(base, 'missing/task', 'x', revision)).status, 404);
    assert.equal((await putSteeringNotes(base, 'demo/task', 'x'.repeat(16_001), revision)).status, 413);
    const invalid = await fetch(`${base}/api/steering-notes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'demo/task', content: 4, revision }) });
    assert.equal(invalid.status, 400);
  });
});

test('summary groups, filters, and deterministically orders actionable next actors', async () => {
  const ctx = await fixture();
  const entries = [
    await addTask(ctx, 'operator-blocked', { displayId: '#2', status: 'blocked', priority: 'normal', nextActor: 'operator', order: 9 }),
    await addTask(ctx, 'operator-review', { displayId: '#3', status: 'review', priority: 'urgent', nextActor: 'operator', order: 2 }),
    await addTask(ctx, 'operator-planned', { displayId: '#4', status: 'planned', priority: 'high', nextActor: 'operator', order: 1 }),
    await addTask(ctx, 'agent-active', { displayId: '#5', status: 'active', priority: 'normal', nextActor: 'agent' }),
    await addTask(ctx, 'stale-paused', { displayId: '#6', status: 'paused', priority: 'urgent', nextActor: 'operator' }),
    await addTask(ctx, 'stale-done', { displayId: '#7', status: 'done', priority: 'urgent', nextActor: 'agent' }),
    await addTask(ctx, 'unknown-actor', { displayId: '#8', status: 'active', priority: 'urgent', nextActor: 'builder' }),
  ];
  const stored = JSON.parse(await readFile(ctx.metadataPath, 'utf8'));
  stored.nextDisplayNumber = 9;
  for (const [key, metadata] of entries) stored.tasks[key] = metadata;
  await writeFile(ctx.metadataPath, `${JSON.stringify(stored)}\n`);

  await withServer(ctx, async (base) => {
    const summary = await (await fetch(`${base}/api/summary`)).json();
    assert.deepEqual(summary.nextActors.counts, { operator: 3, agent: 1 });
    assert.deepEqual(summary.nextActors.operatorTasks.map((task) => task.key), [
      'demo/operator-blocked',
      'demo/operator-review',
      'demo/operator-planned',
    ]);
  });
});

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
