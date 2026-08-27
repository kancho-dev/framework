import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskBrowserHandler, latestDoneTransition, runTimestamp } from './server.mjs';
import { sortTasks } from './public/task-utils.js';

test('run timestamps support historical filename forms and reject invalid dates', () => {
  assert.equal(runTimestamp('2026-08-27-1137-builder.md'), '2026-08-27T11:37:00.000Z');
  assert.equal(runTimestamp('2026-08-27-1137.md'), '2026-08-27T11:37:00.000Z');
  assert.equal(runTimestamp('2026-08-27-113743-builder.md'), '2026-08-27T11:37:43.000Z');
  assert.equal(runTimestamp('20260827-113743-builder.md'), '2026-08-27T11:37:43.000Z');
  assert.equal(runTimestamp('2026-08-27-builder.md'), '2026-08-27T00:00:00.000Z');
  assert.equal(runTimestamp('2026-02-30-1137-builder.md'), null);
  assert.equal(runTimestamp('2026-02-30-builder.md'), null);
  assert.equal(runTimestamp('not-a-run.md'), null);
});

test('Done-transition fallback ignores newer arbitrary history and selects the latest completion', () => {
  const history = [
    { timestamp: '2026-08-29T10:00:00.000Z', changes: { order: { before: 1, after: 2 } } },
    { timestamp: '2026-08-28T10:00:00.000Z', changes: { status: { before: 'review', after: 'done' } } },
    { timestamp: '2026-08-27T10:00:00.000Z', changes: { status: { before: 'active', after: 'done' } } },
    { timestamp: 'invalid', changes: { status: { before: 'review', after: 'done' } } },
  ];
  assert.equal(latestDoneTransition(history), '2026-08-28T10:00:00.000Z');
  assert.equal(latestDoneTransition([{ timestamp: '2026-08-29T10:00:00.000Z', changes: { tags: { before: [], after: ['x'] } } }]), null);
});

test('Done activity sorts #173 above #172 and does not privilege run presence', () => {
  const tasks = [
    { key: 'task-172', hasRunLogs: true, latestRunAt: runTimestamp('2026-08-27-0935-wayfinder-resolution.md'), metadata: { displayId: '#172' } },
    { key: 'task-173', hasRunLogs: true, latestRunAt: runTimestamp('20260827-113743-openclaw-coordination-session-evidence.md'), metadata: { displayId: '#173' } },
    { key: 'history-only', hasRunLogs: false, latestRunAt: '2026-08-28T10:00:00.000Z', metadata: { displayId: '#100' } },
  ];
  assert.deepEqual(sortTasks('done', tasks).map(({ key }) => key), ['history-only', 'task-173', 'task-172']);
});

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

async function boardMove(base, body) {
  return fetch(`${base}/api/board-move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('task inventory and on-demand previews enforce Markdown and task boundaries', async () => {
  const ctx = await fixture();
  const taskDir = join(ctx.root, 'projects/demo/work/task');
  await writeFile(join(taskDir, 'DESIGN.md'), '# Design\n\n<script>alert(1)</script>\n');
  await writeFile(join(taskDir, 'data.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(taskDir, 'NOTES.md'), '# Steering note\n');
  await writeFile(join(taskDir, 'runs', '2026-01-01-1200-builder.md'), '# Secret run heading\n');
  await symlink(join(ctx.root, 'outside.md'), join(taskDir, 'escape.md'));
  await writeFile(join(ctx.root, 'outside.md'), '# Outside\n');

  await withServer(ctx, async (base) => {
    const tasks = await (await fetch(`${base}/api/tasks`)).json();
    const task = tasks.tasks[0];
    assert.deepEqual(task.artifacts.map((file) => file.name), ['CONTEXT.md', 'DESIGN.md', 'HANDOFF.md', 'TASK.md', 'data.bin']);
    assert.equal(task.runs[0].title, 'Secret run heading');
    assert.doesNotMatch(JSON.stringify(task), /# Secret run heading/);

    let response = await fetch(`${base}/api/task-file?key=demo%2Ftask&path=DESIGN.md`);
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /<script>/);
    assert.equal((await fetch(`${base}/api/task-file?key=demo%2Ftask&path=data.bin`)).status, 400);
    assert.equal((await fetch(`${base}/api/task-file?key=demo%2Ftask&path=..%2Foutside.md`)).status, 400);
    assert.equal((await fetch(`${base}/api/task-file?key=demo%2Ftask&path=escape.md`)).status, 400);

    response = await fetch(`${base}/api/run-file?key=demo%2Ftask&path=2026-01-01-1200-builder.md`);
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /Secret run heading/);
  });
});

test('preview APIs reject dot-segment task keys even when escaped targets resemble tasks', async () => {
  const ctx = await fixture();
  const projectEscape = join(ctx.root, 'work', 'sneaky');
  const slugEscape = join(ctx.root, 'projects', 'demo');
  await mkdir(join(projectEscape, 'runs'), { recursive: true });
  await mkdir(join(slugEscape, 'runs'), { recursive: true });
  for (const dir of [projectEscape, slugEscape]) {
    await writeFile(join(dir, 'TASK.md'), '# Decoy task\n');
    await writeFile(join(dir, 'private.md'), '# Private\n');
    await writeFile(join(dir, 'runs', 'private.md'), '# Private run\n');
  }

  await withServer(ctx, async (base) => {
    for (const endpoint of ['task-file', 'run-file']) {
      assert.equal((await fetch(`${base}/api/${endpoint}?key=..%2Fsneaky&path=private.md`)).status, 404);
      assert.equal((await fetch(`${base}/api/${endpoint}?key=demo%2F..&path=private.md`)).status, 404);
    }
  });
});

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

test('board move atomically persists status and the minimal ordering patch', async () => {
  const ctx = await fixture();
  const entries = [
    await addTask(ctx, 'first', { displayId: '#2', status: 'active', priority: 'normal', order: 1 }),
    await addTask(ctx, 'second', { displayId: '#3', status: 'active', priority: 'normal', order: 2 }),
    await addTask(ctx, 'boundary', { displayId: '#4', status: 'active', priority: 'normal', order: 4 }),
  ];
  const stored = JSON.parse(await readFile(ctx.metadataPath, 'utf8'));
  stored.tasks['demo/task'].status = 'planned';
  stored.tasks['demo/task'].order = 9;
  for (const [key, metadata] of entries) stored.tasks[key] = metadata;
  await writeFile(ctx.metadataPath, `${JSON.stringify(stored)}\n`);

  await withServer(ctx, async (base) => {
    const response = await boardMove(base, { key: 'demo/task', status: 'active', index: 1 });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.changes.map(({ key, metadata }) => [key, metadata.status, metadata.order]), [
      ['demo/task', 'active', 2],
      ['demo/second', 'active', 3],
    ]);
  });
  const saved = JSON.parse(await readFile(ctx.metadataPath, 'utf8')).tasks;
  assert.equal(saved['demo/task'].status, 'active');
  assert.equal(saved['demo/task'].order, 2);
  assert.equal(saved['demo/second'].order, 3);
  assert.equal(saved['demo/first'].order, 1);
  assert.equal(saved['demo/boundary'].order, 4);
  const events = (await readFile(ctx.historyPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(({ taskKey, action }) => [taskKey, action]), [['demo/task', 'board.move'], ['demo/second', 'board.move']]);
});

test('rejected board move preserves existing task ordering', async () => {
  const ctx = await fixture();
  const before = await readFile(ctx.metadataPath, 'utf8');
  await withServer(ctx, async (base) => {
    const response = await boardMove(base, { key: 'demo/task', status: 'active', index: 4 });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Invalid destination index/);
  });
  assert.equal(await readFile(ctx.metadataPath, 'utf8'), before);
});

test('status-only metadata moves preserve the existing order value', async () => {
  const ctx = await fixture();
  const stored = JSON.parse(await readFile(ctx.metadataPath, 'utf8'));
  stored.tasks['demo/task'].order = 7;
  await writeFile(ctx.metadataPath, `${JSON.stringify(stored)}\n`);
  await withServer(ctx, async (base) => {
    const response = await fetch(`${base}/api/task-metadata`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'demo/task', metadata: { status: 'review' } }) });
    assert.equal(response.status, 200);
    const metadata = (await response.json()).metadata;
    assert.equal(metadata.status, 'review');
    assert.equal(metadata.order, 7);
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
