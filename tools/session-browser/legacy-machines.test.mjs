import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLegacyMachines, translateCwd } from './legacy-machines.mjs';

async function fixture(config) {
  const workspace = await mkdtemp(join(tmpdir(), 'legacy-machines-'));
  const configDir = join(workspace, '.tools-config', 'session-browser');
  await mkdir(join(configDir, 'archive', 'old', 'pi', 'sessions'), { recursive: true });
  await mkdir(join(configDir, 'archive', 'old', 'codex', 'sessions'), { recursive: true });
  await mkdir(join(configDir, 'archive', 'old', 'opencode', 'storage', 'session_diff'), { recursive: true });
  const configPath = join(configDir, 'machines.json');
  if (config !== undefined) await writeFile(configPath, typeof config === 'string' ? config : JSON.stringify(config));
  return { workspace, configPath };
}

const machineConfig = () => ({
  version: 1,
  machines: [{
    id: 'old',
    label: 'Old laptop',
    roots: {
      pi: 'archive/old/pi/sessions',
      codex: 'archive/old/codex/sessions',
    },
    artifacts: { 'opencode-data': 'archive/old/opencode' },
    pathMap: [
      { from: '/old/work', to: '.' },
      { from: '/old/work/nested', to: 'packages/nested' },
    ],
  }],
});

test('absent config means no machines and no error', async () => {
  const { workspace, configPath } = await fixture();
  assert.deepEqual(await loadLegacyMachines({ workspaceRoot: workspace, configPath }), { machines: {}, errors: [] });
});

test('loads resolved roots into an immutable machine map', async () => {
  const { workspace, configPath } = await fixture(machineConfig());
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath });
  const machine = result.machines.old;

  assert.equal(result.errors.length, 0);
  assert.equal(machine.label, 'Old laptop');
  assert.equal(machine.roots.pi, join(workspace, '.tools-config', 'session-browser', 'archive', 'old', 'pi', 'sessions'));
  assert.equal(machine.immutable, true);
  assert.equal(machine.artifacts['opencode-data'], join(workspace, '.tools-config', 'session-browser', 'archive', 'old', 'opencode'));
  assert.ok(Object.isFrozen(result.machines));
  assert.ok(Object.isFrozen(machine.pathMap));
});

test('translation uses the longest prefix and resolves dot to the workspace', async () => {
  const { workspace, configPath } = await fixture(machineConfig());
  const { machines } = await loadLegacyMachines({ workspaceRoot: workspace, configPath });

  assert.equal(translateCwd(machines.old, '/old/work'), workspace);
  assert.equal(translateCwd(machines.old, '/old/work/src'), join(workspace, 'src'));
  assert.equal(translateCwd(machines.old, '/old/work/nested/src'), join(workspace, 'packages', 'nested', 'src'));
  assert.equal(translateCwd(machines.old, '/old/workspace-lookalike'), null);
  assert.equal(translateCwd(machines.old, '/another/work'), null);
});

test('malformed config fails soft with a typed legacy-config diagnostic', async () => {
  const { workspace, configPath } = await fixture('{broken');
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath });

  assert.deepEqual(result.machines, {});
  assert.equal(result.errors[0].source, 'legacy-config');
  assert.equal(result.errors[0].code, 'invalid-config');
});

test('invalid entries are isolated while valid roots and mappings survive', async () => {
  const config = machineConfig();
  Object.assign(config.machines[0].roots, {
    opencode: 'archive/old/missing.db',
    unknown: 'archive/old/unknown',
  });
  config.machines[0].pathMap.push({ from: '/missing-to' });
  config.machines[0].pathMap.push({ from: '/outside', to: '../../../escape' });
  const { workspace, configPath } = await fixture(config);
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath });

  assert.deepEqual(Object.keys(result.machines.old.roots), ['pi', 'codex']);
  assert.equal(result.machines.old.pathMap.length, 2);
  assert.deepEqual(result.errors.map(({ code }) => code).sort(), ['invalid-path-map-entry', 'missing-root', 'path-map-outside-workspace', 'unknown-source']);
  assert.ok(result.errors.some(({ source }) => source === 'opencode@old'));
});

test('an unreadable root becomes a per-source diagnostic without hiding valid roots', async () => {
  const { workspace, configPath } = await fixture(machineConfig());
  const inspectRoot = async (path) => {
    if (path.endsWith(join('pi', 'sessions'))) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    return stat(path);
  };
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath, inspectRoot });

  assert.deepEqual(Object.keys(result.machines.old.roots), ['codex']);
  assert.equal(result.errors[0].code, 'unreadable-root');
  assert.equal(result.errors[0].source, 'pi@old');
});

test('machine ids matching inherited object keys remain valid', async () => {
  const config = machineConfig();
  config.machines[0].id = 'constructor';
  const { workspace, configPath } = await fixture(config);
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath });

  assert.ok(Object.hasOwn(result.machines, 'constructor'));
  assert.equal(result.errors.length, 0);
});

test('duplicate and malformed machines do not displace the first valid machine', async () => {
  const config = machineConfig();
  config.machines.push(machineConfig().machines[0], { id: '../escape', roots: {}, pathMap: [] });
  const { workspace, configPath } = await fixture(config);
  const result = await loadLegacyMachines({ workspaceRoot: workspace, configPath });

  assert.deepEqual(Object.keys(result.machines), ['old']);
  assert.deepEqual(result.errors.map(({ code }) => code), ['duplicate-machine', 'invalid-machine']);
});
