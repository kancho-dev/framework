import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { usageCells } from '../rollups.mjs';
import { usageFilterOptions, workspaceFilterKey } from './usage-breakdown.js';
import { AFFECTS_COPY, filterBarModel, panelFilterState, TOTALS_LABEL } from './usage-filter-bar.js';

const options = {
  machines: [{ value: 'machine-a', label: 'machine-a', tokens: 500 }, { value: 'machine-b', label: 'machine-b', tokens: 300 }],
  workspaces: [{ value: workspaceFilterKey('machine-a', 'ws-1'), label: 'machine-a / ws-1', tokens: 400 }],
  sources: [{ value: 'claude-code', label: 'claude-code', tokens: 600 }, { value: 'pi', label: 'pi', tokens: 200 }],
  models: [{ value: 'anthropic/claude-opus-5', label: 'anthropic/claude-opus-5', tokens: 700 }],
};

const selection = (machineIds = [], workspaceKeys = [], sources = [], models = []) => ({ machineIds: new Set(machineIds), workspaceKeys: new Set(workspaceKeys), sources: new Set(sources), models: new Set(models) });
const facet = (model, name) => model.facets.find((entry) => entry.name === name);

test('a trigger names its facet and its selection before it is opened', () => {
  const idle = filterBarModel(options, selection());
  assert.deepEqual(idle.facets.map((entry) => entry.label), ['Agent tools · All', 'Models · All', 'Machines · All', 'Workspaces · All']);
  assert.equal(idle.combined.label, 'Filters · All');
  assert.equal(idle.active, false);

  const picked = filterBarModel(options, selection(['machine-a', 'machine-b']));
  assert.equal(facet(picked, 'machine').label, 'Machines · 2', 'the compact count is visible without changing the control width');
  assert.equal(facet(picked, 'workspace').label, 'Workspaces · All', 'an untouched facet still says All');
  assert.equal(picked.active, true);
});

test('the narrow-screen trigger sums every facet so nothing hides behind a collapse', () => {
  const model = filterBarModel(options, selection(['machine-a'], [workspaceFilterKey('machine-a', 'ws-1')]));
  assert.equal(model.combined.label, 'Filters · 2');
  assert.equal(model.count, 2);
});

test('option rows carry all-record totals, labelled as such', () => {
  const model = filterBarModel(options, selection(['machine-b']));
  assert.deepEqual(facet(model, 'machine').options.map((option) => [option.label, option.tokens, option.checked]), [
    ['machine-a', 500, false],
    ['machine-b', 300, true],
  ], 'totals do not move with the selection');
  assert.equal(model.totalsLabel, TOTALS_LABEL);
});

test('selections appear as removable chips addressed by facet and value', () => {
  const key = workspaceFilterKey('machine-a', 'ws-1');
  const model = filterBarModel(options, selection(['machine-a'], [key]));
  assert.deepEqual(model.chips.map((chip) => [chip.name, chip.value, chip.label]), [
    ['machine', 'machine-a', 'machine-a'],
    ['workspace', key, 'machine-a / ws-1'],
  ]);
  assert.equal(model.chips[1].remove, 'Remove workspace filter machine-a / ws-1');
  assert.deepEqual(model.activeGroups.map((group) => [group.title, group.chips.length]), [['Machines', 1], ['Workspaces', 1]], 'the summary popover groups active values by facet');
  assert.deepEqual(filterBarModel(options, selection()).chips, [], 'nothing selected, nothing to clear');
});

test('a selected value missing from the report stays visible and removable', () => {
  const model = filterBarModel(options, selection(['machine-gone']));
  const stale = facet(model, 'machine').options.at(-1);
  assert.deepEqual([stale.value, stale.checked, stale.stale, stale.tokens], ['machine-gone', true, true, 0]);
  assert.equal(model.chips.at(-1).stale, true, 'the chip is the way out of a filter with no matching records');
  assert.equal(model.active, true);
});

test('the panel state appears only when filtered and stays non-interactive', () => {
  assert.deepEqual(panelFilterState(filterBarModel(options, selection())), { active: false });
  const state = panelFilterState(filterBarModel(options, selection(['machine-a'], [workspaceFilterKey('machine-a', 'ws-1')])));
  assert.deepEqual(state, { active: true, label: 'Filtered · 2', title: AFFECTS_COPY });
  assert.equal('action' in state, false, 'the badge describes the whole cohort; it does not edit one facet');
  assert.equal('target' in state, false);
});

test('scope is stated once, by the model', () => {
  assert.match(AFFECTS_COPY, /Daily token usage and Usage breakdown/);
  assert.match(AFFECTS_COPY, /never filtered/);
  assert.equal(filterBarModel(options, selection()).affects, AFFECTS_COPY);
});

test('agent tool is a cohort facet like any other', () => {
  const model = filterBarModel(options, selection(['machine-a'], [], ['pi']));
  assert.equal(facet(model, 'source').label, 'Agent tools · 1');
  assert.equal(model.count, 2, 'facets compose rather than replacing one another');
  const chip = model.chips.find((entry) => entry.name === 'source');
  assert.deepEqual([chip.value, chip.label, chip.remove], ['pi', 'pi', 'Remove agent tool filter pi']);
});

test('model is a cohort facet alongside the others', () => {
  const model = filterBarModel(options, selection([], [], [], ['anthropic/claude-opus-5']));
  assert.equal(facet(model, 'model').label, 'Models · 1');
  const chip = model.chips.find((entry) => entry.name === 'model');
  assert.equal(chip.remove, 'Remove model filter anthropic/claude-opus-5');
  assert.equal(filterBarModel(options, selection(['machine-a'], [], ['pi'], ['anthropic/claude-opus-5'])).count, 3, 'every facet counts toward the collapsed trigger');
});

test('the bar is built from the same options the cohort filter uses', () => {
  const cells = usageCells([
    { date: '2026-08-10', source: 'claude-code', sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100 },
    { date: '2026-08-10', source: 'codex', sourceKey: null, workspaceId: null, totalTokens: 40 },
  ]).cells;
  const model = filterBarModel(usageFilterOptions(cells), selection());
  assert.deepEqual(facet(model, 'machine').options.map((option) => option.label), ['machine-a', 'Unknown machine']);
  assert.deepEqual(facet(model, 'workspace').options.map((option) => option.label), ['machine-a / ws-1', 'Unknown machine / Unknown workspace']);
  assert.deepEqual(facet(model, 'source').options.map((option) => [option.value, option.label]), [['claude-code', 'claude-code'], ['codex', 'codex']]);
  assert.deepEqual(facet(model, 'model').options.map((option) => option.label), ['Unknown model'], 'a report with no model attribution still offers the gap');
});
