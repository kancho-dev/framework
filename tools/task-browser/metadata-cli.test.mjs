import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('./metadata-cli.mjs', import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'task-browser-next-actor-'));
  const taskDir = join(root, 'projects', 'demo', 'work', 'task');
  const metadataPath = join(root, '.tools-config', 'task-browser', 'tasks.json');
  const historyPath = join(root, '.tools-config', 'task-browser', 'task-history.jsonl');
  await mkdir(taskDir, { recursive: true });
  await mkdir(join(root, '.tools-config', 'task-browser'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), '# Test\n');
  await writeFile(join(taskDir, 'TASK.md'), '# Task\n');
  await writeFile(metadataPath, `${JSON.stringify({ version: 1, nextDisplayNumber: 2, tasks: { 'demo/task': { displayId: '#1', project: 'demo', slug: 'task', path: 'projects/demo/work/task', status: 'active', priority: 'normal', type: 'implementation' } } }, null, 2)}\n`);
  return { root, metadataPath, historyPath };
}

function run(ctx, ...args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WORKSPACE_ROOT: ctx.root, TASK_BROWSER_METADATA: ctx.metadataPath, TASK_BROWSER_HISTORY: ctx.historyPath },
  });
}

test('CLI persists, inspects, clears, validates, and records only real nextActor changes', async () => {
  const ctx = await fixture();
  assert.equal(run(ctx, 'set', '#1', '--next-actor', 'operator').status, 0);
  assert.equal(JSON.parse(run(ctx, 'get', '#1').stdout).metadata.nextActor, 'operator');
  assert.equal(JSON.parse(run(ctx, 'list').stdout)[0].nextActor, 'operator');

  assert.equal(run(ctx, 'set', '#1', '--next-actor', 'operator').status, 0);
  assert.equal(run(ctx, 'clear', '#1', '--next-actor').status, 0);
  assert.equal(JSON.parse(run(ctx, 'get', '#1').stdout).metadata.nextActor, null);

  const events = (await readFile(ctx.historyPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.changes.nextActor), [
    { before: null, after: 'operator' },
    { before: 'operator', after: null },
  ]);

  const invalid = run(ctx, 'set', '#1', '--next-actor', 'builder');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /nextActor must be one of/);
});
