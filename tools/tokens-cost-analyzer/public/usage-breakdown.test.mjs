import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dailyUsage, usageCells } from '../rollups.mjs';
import { buildUsageBreakdown, METRICS, GROUPINGS, modelAliases, modelIdentity, UNKNOWN_MODEL, bucketStart, windowRangeLabel, dailySeries, OTHER, seriesSlots, selectCells, timeBuckets, zeroMetricCopy, zeroMetricState, UNKNOWN_TOOL, unknownAttributionTokens, usageFilterOptions, weekBuckets, weekStart, workspaceFilterKey } from './usage-breakdown.js';

// A Thursday, so "the current week" and "today" are never the same date.
const NOW = Date.parse('2026-08-13T12:00:00Z');
const MONDAY = '2026-08-10';

function record(overrides = {}) {
  return { date: MONDAY, source: 'claude-code', sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100, estimatedCost: 0.5, ...overrides };
}

function cellsOf(records) { return usageCells(records).cells; }

test('weekStart snaps every day to its Monday and rejects non-dates', () => {
  assert.equal(weekStart('2026-08-10'), MONDAY); // Monday itself
  assert.equal(weekStart('2026-08-16'), MONDAY); // Sunday, same week
  assert.equal(weekStart('2026-08-17'), '2026-08-17'); // next Monday
  assert.equal(weekStart('2026-01-01'), '2025-12-29'); // week crossing the year
  assert.equal(weekStart(''), null);
  assert.equal(weekStart('2026-08'), null);
  assert.equal(weekStart(undefined), null);
});

test('cells partition dated records and disclose undated ones', () => {
  const { cells, undatedTokens, undatedRecords } = usageCells([
    record(),
    record({ date: '2026-08-16', totalTokens: 20 }),
    record({ date: null, totalTokens: 7 }),
  ]);
  assert.equal(cells.length, 2, 'two UTC days of one week stay two cells');
  assert.deepEqual(cells[0], {
    date: MONDAY, source: 'claude-code', machineId: 'machine-a', workspaceId: 'ws-1',
    provider: '', model: '',
    tokens: 100, records: 1, unknownCostRecords: 0,
    recordedCost: 0, estimatedCost: 0.5, recordedCostRecords: 0, estimatedCostRecords: 1,
    costExcludedRecords: 0, costExcludedTokens: 0,
  });
  assert.deepEqual(cells[1].date, '2026-08-16');
  assert.equal(undatedTokens, 7);
  assert.equal(undatedRecords, 1);
});

test('unknown-cost records are counted per cell but excluded ones are not', () => {
  const { cells } = usageCells([
    record({ recordedCost: null, estimatedCost: null }),
    record({ recordedCost: null, estimatedCost: null, costExcluded: true }),
    record({ estimatedCost: 0.4 }),
  ]);
  assert.equal(cells[0].unknownCostRecords, 1);
  assert.equal(cells[0].records, 3);
});

test('the axis is 12 Monday-first UTC weeks ending with the current week', () => {
  const buckets = weekBuckets(12, NOW);
  assert.equal(buckets.length, 12);
  assert.equal(buckets.at(-1).key, MONDAY);
  assert.equal(buckets.at(-1).end, '2026-08-16');
  assert.equal(buckets[0].key, '2026-05-25');
  assert.match(buckets.at(-1).range, /Aug 10 – Aug 16 UTC/);
});

test('the weekly default is the latest 24 Monday-first UTC weeks', () => {
  const breakdown = buildUsageBreakdown(cellsOf([record()]), { now: NOW });
  assert.equal(breakdown.bucket, 'week');
  assert.equal(breakdown.buckets.length, 24);
  assert.equal(breakdown.buckets.at(-1).key, MONDAY);
  assert.equal(breakdown.buckets[0].key, '2026-03-02', '23 weeks before the current Monday');
});

test('empty weeks keep their position on the axis', () => {
  const breakdown = buildUsageBreakdown(cellsOf([record({ date: '2026-06-01' }), record()]), { now: NOW });
  assert.equal(breakdown.buckets.length, 24);
  assert.equal(breakdown.bucketTotals.filter((total) => total === 0).length, 22);
  assert.equal(breakdown.series[0].values[breakdown.buckets.length - 1].tokens, 100);
});

test('records outside the range are excluded from the visible totals', () => {
  const breakdown = buildUsageBreakdown(cellsOf([record({ date: '2026-01-05' }), record()]), { now: NOW });
  assert.equal(breakdown.totals.tokens, 100);
  assert.equal(breakdown.totals.records, 1);
});

test('stack totals conserve the filtered total under every filter', () => {
  const cells = cellsOf([
    record({ totalTokens: 100 }),
    record({ sourceKey: 'machine-b', workspaceId: 'ws-1', totalTokens: 40 }),
    record({ workspaceId: 'ws-2', source: 'codex', totalTokens: 60 }),
    record({ source: null, workspaceId: null, totalTokens: 5 }),
  ]);
  const cases = [
    {},
    { machineIds: ['machine-a'] },
    { machineIds: ['machine-b'] },
    { workspaceKeys: [workspaceFilterKey('machine-a', 'ws-2')] },
    { machineIds: ['machine-a'], workspaceKeys: [workspaceFilterKey('machine-a', 'ws-1')] },
  ];
  for (const filters of cases) {
    const breakdown = buildUsageBreakdown(cells, { now: NOW, ...filters });
    const stacked = breakdown.series.reduce((total, group) => total + group.values.reduce((sum, value) => sum + value.tokens, 0), 0);
    assert.equal(stacked, breakdown.totals.tokens, `series conserve the total for ${JSON.stringify(filters)}`);
    assert.equal(breakdown.bucketTotals.reduce((a, b) => a + b, 0), breakdown.totals.tokens);
  }
});

test('workspace filters are qualified by machine', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100 }),
    record({ sourceKey: 'machine-b', workspaceId: 'ws-1', totalTokens: 40 }),
  ]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW, workspaceKeys: [workspaceFilterKey('machine-b', 'ws-1')] });
  assert.equal(breakdown.totals.tokens, 40, 'the same workspace id on another machine is a different series');
});

test('unknown source and workspace stay visible as their own buckets', () => {
  const cells = cellsOf([record({ source: null, sourceKey: null, workspaceId: null, totalTokens: 30 })]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW });
  assert.deepEqual(breakdown.series.map((group) => group.key), [UNKNOWN_TOOL]);
  const options = usageFilterOptions(cells, { now: NOW });
  assert.deepEqual(options.machines.map((option) => option.label), ['Unknown machine']);
  assert.deepEqual(options.workspaces.map((option) => option.label), ['Unknown machine / Unknown workspace']);
});

test('top 7 plus Other, with Unknown never folded into Other', () => {
  const cells = cellsOf([
    ...Array.from({ length: 9 }, (_, index) => record({ source: `tool-${index}`, totalTokens: (9 - index) * 100 })),
    record({ source: null, totalTokens: 1 }),
  ]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW });
  assert.deepEqual(breakdown.series.map((group) => group.key), ['tool-0', 'tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', OTHER, UNKNOWN_TOOL]);
  const other = breakdown.series.find((group) => group.key === OTHER);
  assert.equal(other.total, 200 + 100, 'Other holds exactly the two smallest known tools');
  assert.equal(breakdown.series.at(-1).total, 1, 'Unknown keeps its own series however small');
  const stacked = breakdown.series.reduce((total, group) => total + group.values.reduce((sum, value) => sum + value.tokens, 0), 0);
  assert.equal(stacked, breakdown.totals.tokens);
});

test('a value carries the provenance and unknown-cost count its tooltip claims', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-b', totalTokens: 10, recordedCost: null, estimatedCost: null }),
    record({ sourceKey: 'machine-a', workspaceId: 'ws-2', totalTokens: 10 }),
  ]);
  const value = buildUsageBreakdown(cells, { now: NOW }).series[0].values.at(-1);
  assert.equal(value.unknownCostRecords, 1);
  assert.deepEqual(value.machines, ['machine-a', 'machine-b']);
  assert.deepEqual(value.workspaces, ['machine-a / ws-2', 'machine-b / ws-1']);
});

test('a filter that matches nothing reports empty rather than a blank chart', () => {
  const breakdown = buildUsageBreakdown(cellsOf([record()]), { now: NOW, machineIds: ['machine-z'] });
  assert.equal(breakdown.empty, true);
  assert.deepEqual(breakdown.series, []);
  assert.equal(breakdown.buckets.length, 24);
});

test('filter options come from the whole cell set, not the current selection or the chart range', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', totalTokens: 100 }),
    record({ sourceKey: 'machine-b', totalTokens: 400 }),
    record({ date: '2026-01-05', sourceKey: 'machine-old', totalTokens: 10 }),
  ]);
  const options = usageFilterOptions(cells);
  assert.deepEqual(
    options.machines.map((option) => option.value),
    ['machine-b', 'machine-a', 'machine-old'],
    'ordered by tokens; a machine outside the charted range still scopes the multi-year heatmap',
  );
});

test('the daily series reproduces the report rollup when nothing is selected', () => {
  const records = [
    record({ date: '2026-08-10', totalTokens: 100 }),
    record({ date: '2026-08-10', source: 'codex', totalTokens: 30 }),
    record({ date: '2026-01-05', sourceKey: 'machine-b', totalTokens: 40 }),
    record({ date: null, totalTokens: 7 }),
  ];
  assert.deepEqual(dailySeries(usageCells(records).cells), dailyUsage(records));
});

test('the daily series follows the same cohort as the breakdown', () => {
  const records = [
    record({ date: '2026-08-10', totalTokens: 100 }),
    record({ date: '2026-08-11', sourceKey: 'machine-b', totalTokens: 40 }),
    record({ date: '2026-08-12', workspaceId: 'ws-2', totalTokens: 60 }),
  ];
  const cells = usageCells(records).cells;
  for (const filters of [{}, { machineIds: ['machine-a'] }, { workspaceKeys: [workspaceFilterKey('machine-a', 'ws-2')] }, { sources: ['claude-code'] }]) {
    const daily = dailySeries(cells, filters);
    const breakdown = buildUsageBreakdown(cells, { now: NOW, ...filters });
    assert.equal(daily.reduce((total, row) => total + row.tokens, 0), breakdown.totals.tokens, JSON.stringify(filters));
    assert.equal(daily.reduce((total, row) => total + row.records, 0), breakdown.totals.records);
  }
});

test('an unselected dimension never narrows the cohort', () => {
  const cells = cellsOf([record(), record({ sourceKey: 'machine-b', totalTokens: 40 })]);
  assert.equal(selectCells(cells, {}).length, 2);
  assert.equal(selectCells(cells, { machineIds: [] , workspaceKeys: [], sources: [] }).length, 2);
  assert.equal(selectCells(cells, { machineIds: ['machine-b'] }).length, 1);
});

// --- Slice 5: provider-qualified model grouping -----------------------------

// The rules below are not style choices; each one is a shape the real report
// actually contains (see runs/2026-08-17-1540-builder-slice-5-model-grouping.md).
test('a label the adapter already qualified is never re-prefixed', () => {
  // pi and opencode emit `openai/gpt-5.5:low`, and the shared normalizer maps
  // pi's `openai-codex` onto `openai`, so both land on one identity.
  const pi = { source: 'pi', provider: 'openai', model: 'openai/gpt-5.5:low' };
  const opencode = { source: 'opencode', provider: 'openai', model: 'openai/gpt-5.5:low' };
  assert.equal(modelIdentity(pi), 'openai/gpt-5.5:low');
  assert.equal(modelIdentity(opencode), modelIdentity(pi), 'one model reached through two adapters is one series');
});

test('a bare label is qualified by its own stated provider', () => {
  assert.equal(modelIdentity({ source: 'claude-code', provider: 'anthropic', model: 'claude-opus-5' }), 'anthropic/claude-opus-5');
});

test("an adapter's missing provider does not fork a model into two series", () => {
  // codex omits the provider on 95.4% of its records and says `openai` on the
  // rest. Qualifying blindly would draw its busiest model twice.
  const cells = cellsOf([
    record({ source: 'codex', provider: null, model: 'gpt-5-codex', totalTokens: 900 }),
    record({ source: 'codex', provider: 'openai', model: 'gpt-5-codex', totalTokens: 100 }),
  ]);
  const aliases = modelAliases(cells);
  assert.equal(aliases.get('gpt-5-codex'), 'openai/gpt-5-codex');
  const breakdown = buildUsageBreakdown(cells, { now: NOW, groupBy: 'model' });
  assert.deepEqual(breakdown.series.map((group) => group.key), ['openai/gpt-5-codex']);
  assert.equal(breakdown.series[0].tokens, 1000, 'both halves land in one series');
});

test('an ambiguous bare label stays unqualified rather than picking a provider', () => {
  const cells = cellsOf([
    record({ source: 'a', provider: 'openai', model: 'shared-model', totalTokens: 10 }),
    record({ source: 'b', provider: 'azure', model: 'shared-model', totalTokens: 10 }),
    record({ source: 'c', provider: null, model: 'shared-model', totalTokens: 10 }),
  ]);
  assert.equal(modelAliases(cells).has('shared-model'), false, 'two candidates is ambiguity, not evidence');
  const keys = buildUsageBreakdown(cells, { now: NOW, groupBy: 'model' }).series.map((group) => group.key);
  assert.deepEqual(keys.sort(), ['azure/shared-model', 'openai/shared-model', 'shared-model'], 'the unqualified usage is shown as itself');
});

test('model identity does not move when a filter removes the qualifying cell', () => {
  const cells = cellsOf([
    record({ source: 'codex', sourceKey: 'machine-a', provider: 'openai', model: 'gpt-5-codex', totalTokens: 100 }),
    record({ source: 'codex', sourceKey: 'machine-b', provider: null, model: 'gpt-5-codex', totalTokens: 50 }),
  ]);
  const filtered = buildUsageBreakdown(cells, { now: NOW, groupBy: 'model', machineIds: ['machine-b'] });
  assert.deepEqual(filtered.series.map((group) => group.key), ['openai/gpt-5-codex'], 'aliases come from the whole cell set, like colour slots');
});

test('a model gap is its own Unknown series and is never folded into Other', () => {
  const cells = cellsOf([
    ...Array.from({ length: 9 }, (_, index) => record({ model: `model-${index}`, provider: 'p', totalTokens: (9 - index) * 100 })),
    record({ model: null, provider: null, totalTokens: 5 }),
  ]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW, groupBy: 'model' });
  assert.equal(breakdown.series.at(-1).key, UNKNOWN_MODEL);
  assert.equal(breakdown.series.at(-1).unknown, true);
  assert.equal(breakdown.series.at(-1).tokens, 5);
  assert.ok(breakdown.series.some((group) => group.key === OTHER));
  const stacked = breakdown.series.reduce((total, group) => total + group.tokens, 0);
  assert.equal(stacked, breakdown.totals.tokens, 'model grouping conserves the total like every other dimension');
});

test('model is both a grouping and a cohort facet', () => {
  assert.deepEqual(Object.keys(GROUPINGS), ['source', 'machine', 'workspace', 'model']);
  const cells = cellsOf([record({ model: 'm', provider: 'p' })]);
  assert.deepEqual(usageFilterOptions(cells).models.map((option) => [option.value, option.label]), [['p/m', 'p/m']]);
});

test('the model filter carries the identity the legend prints, not the raw label', () => {
  // The same fork the grouping fixes: filtering by the raw label would offer two
  // checkboxes for one model wherever an adapter's provider is inconsistent.
  const cells = cellsOf([
    record({ source: 'codex', provider: null, model: 'gpt-5-codex', totalTokens: 900 }),
    record({ source: 'codex', provider: 'openai', model: 'gpt-5-codex', totalTokens: 100 }),
    record({ source: 'pi', provider: 'openai', model: 'openai/gpt-5.5:low', totalTokens: 40 }),
  ]);
  const options = usageFilterOptions(cells).models;
  assert.deepEqual(options.map((option) => option.value), ['openai/gpt-5-codex', 'openai/gpt-5.5:low'], 'one checkbox per model');
  assert.equal(options[0].tokens, 1000, 'and its total is the whole model');
  assert.equal(selectCells(cells, { models: ['openai/gpt-5-codex'] }).length, 2, 'both halves are selected by one identity');
  assert.equal(buildUsageBreakdown(cells, { now: NOW, models: ['openai/gpt-5-codex'] }).totals.tokens, 1000);
});

test('the model facet composes with the other facets and with model grouping', () => {
  const cells = cellsOf([
    record({ source: 'pi', sourceKey: 'machine-a', provider: 'openai', model: 'openai/gpt-5.5:low', totalTokens: 100 }),
    record({ source: 'pi', sourceKey: 'machine-b', provider: 'openai', model: 'openai/gpt-5.5:low', totalTokens: 40 }),
    record({ source: 'pi', sourceKey: 'machine-a', provider: 'openai', model: 'openai/gpt-5.4:low', totalTokens: 7 }),
  ]);
  const both = buildUsageBreakdown(cells, { now: NOW, models: ['openai/gpt-5.5:low'], machineIds: ['machine-a'] });
  assert.equal(both.totals.tokens, 100, 'facets intersect');
  const grouped = buildUsageBreakdown(cells, { now: NOW, groupBy: 'model', models: ['openai/gpt-5.5:low'] });
  assert.deepEqual(grouped.series.map((group) => group.key), ['openai/gpt-5.5:low'], 'grouping and filtering agree on identity');
  assert.equal(dailySeries(cells, { models: ['openai/gpt-5.5:low'] }).reduce((total, row) => total + row.tokens, 0), 140, 'the heatmap follows the same cohort');
});

test('an unattributed model is selectable under the empty value', () => {
  const cells = cellsOf([record({ model: null, provider: null, totalTokens: 30 }), record({ model: 'm', provider: 'p', totalTokens: 5 })]);
  const unknown = usageFilterOptions(cells).models.find((option) => option.label === UNKNOWN_MODEL);
  assert.equal(unknown.value, '', 'the gap is the empty string, so a real model could never collide with the label');
  assert.equal(buildUsageBreakdown(cells, { now: NOW, models: [''] }).totals.tokens, 30);
});

// --- Slice 5: agent tool joins the shared cohort ----------------------------

test('agent tool filters the cohort and intersects the other facets', () => {
  const cells = cellsOf([
    record({ source: 'claude-code', sourceKey: 'machine-a', totalTokens: 100 }),
    record({ source: 'pi', sourceKey: 'machine-a', totalTokens: 40 }),
    record({ source: 'pi', sourceKey: 'machine-b', totalTokens: 7 }),
  ]);
  assert.equal(selectCells(cells, { sources: ['pi'] }).length, 2);
  assert.deepEqual(selectCells(cells, { sources: ['claude-code', 'pi'] }).length, 3, 'values inside one facet union');
  const both = selectCells(cells, { sources: ['pi'], machineIds: ['machine-a'] });
  assert.deepEqual(both.map((cell) => cell.tokens), [40], 'facets intersect: pi on machine-a, not pi or machine-a');
  const breakdown = buildUsageBreakdown(cells, { now: NOW, sources: ['pi'] });
  assert.equal(breakdown.totals.tokens, 47);
  assert.deepEqual(breakdown.series.map((group) => group.key), ['pi'], 'a filtered-out tool leaves no empty series behind');
  assert.equal(dailySeries(cells, { sources: ['pi'] }).reduce((total, row) => total + row.tokens, 0), 47, 'the heatmap follows the same cohort');
});

test('unattributed agent tool is selectable under its own value', () => {
  const cells = cellsOf([record({ source: null, totalTokens: 30 }), record({ source: 'pi', totalTokens: 5 })]);
  const option = usageFilterOptions(cells).sources.find((entry) => entry.label === UNKNOWN_TOOL);
  assert.equal(option.value, '', 'the value is the raw absence, not an invented tool name');
  assert.equal(selectCells(cells, { sources: [option.value] }).length, 1);
  assert.equal(buildUsageBreakdown(cells, { now: NOW, sources: [option.value] }).totals.tokens, 30);
});

test('history availability follows the agent-tool cohort too', () => {
  const cells = cellsOf([
    record({ source: 'pi', date: '2026-08-10' }),
    record({ source: 'codex', date: '2026-02-10' }),
  ]);
  assert.equal(buildUsageBreakdown(cells, { now: NOW }).navigation.canPrevious, true);
  assert.equal(buildUsageBreakdown(cells, { now: NOW, sources: ['pi'] }).navigation.canPrevious, false, 'no earlier pi usage is reachable');
});

test('colour slots are unique per tool and stable under filtering', () => {
  const cells = cellsOf([
    record({ source: 'claude-code', totalTokens: 500 }),
    record({ source: 'codex', totalTokens: 300, sourceKey: 'machine-b' }),
    record({ source: 'pi', totalTokens: 400 }),
    record({ source: null, totalTokens: 9 }),
  ]);
  const slots = seriesSlots(cells);
  assert.deepEqual([...slots.entries()], [['claude-code', 0], ['pi', 1], ['codex', 2]]);
  assert.equal(new Set(slots.values()).size, slots.size, 'no two tools share a slot');
  assert.equal(slots.has(UNKNOWN_TOOL), false, 'Unknown keeps its reserved colour, not a slot');
  const filtered = seriesSlots(cells);
  assert.deepEqual([...filtered.entries()], [...slots.entries()], 'slots come from the unfiltered set');
});

// --- Slice 3: buckets and groupings -----------------------------------------

test('each grain has its own deterministic range, ending on the current bucket', () => {
  const day = timeBuckets('day', NOW);
  assert.equal(day.length, 30);
  assert.equal(day.at(-1).key, '2026-08-13');
  assert.equal(day[0].key, '2026-07-15');
  assert.equal(day.at(-1).end, day.at(-1).key, 'a day bucket starts and ends on itself');

  const month = timeBuckets('month', NOW);
  assert.equal(month.length, 18);
  assert.equal(month.at(-1).key, '2026-08');
  assert.equal(month.at(-1).end, '2026-08-31', 'the axis carries the real last day of the month');
  assert.equal(month[0].key, '2025-03');

  assert.equal(timeBuckets('week', NOW).length, 24);
  assert.equal(timeBuckets('nonsense', NOW).length, 24, 'an unknown grain falls back to the default');
});

test('February and month ends are calendar-correct, not 30-day arithmetic', () => {
  const month = timeBuckets('month', Date.parse('2024-02-29T12:00:00Z'), 2);
  assert.deepEqual(month.map((bucket) => bucket.key), ['2024-01', '2024-02']);
  assert.equal(month.at(-1).end, '2024-02-29', 'a leap February keeps its 29th');
  assert.deepEqual(timeBuckets('day', Date.parse('2026-03-01T00:30:00Z'), 2).map((b) => b.key), ['2026-02-28', '2026-03-01']);
});

test('bucketStart snaps a date to the key of its grain', () => {
  assert.equal(bucketStart('day', '2026-08-16'), '2026-08-16');
  assert.equal(bucketStart('week', '2026-08-16'), MONDAY);
  assert.equal(bucketStart('month', '2026-08-16'), '2026-08');
  for (const bucket of ['day', 'week', 'month']) assert.equal(bucketStart(bucket, '2026-08'), null);
});

test('day and month buckets keep empty positions and exclude out-of-range records', () => {
  const cells = cellsOf([
    record({ date: '2026-08-13', totalTokens: 100 }),
    record({ date: '2026-08-11', totalTokens: 50 }),
    record({ date: '2020-01-02', totalTokens: 999 }),
  ]);
  const day = buildUsageBreakdown(cells, { bucket: 'day', now: NOW });
  assert.equal(day.buckets.length, 30);
  assert.equal(day.totals.tokens, 150, 'the 2020 record is outside every grain');
  assert.equal(day.bucketTotals.at(-1), 100);
  assert.equal(day.bucketTotals.at(-3), 50);
  assert.equal(day.bucketTotals.filter((total) => total === 0).length, 28);

  const month = buildUsageBreakdown(cells, { bucket: 'month', now: NOW });
  assert.equal(month.buckets.length, 18);
  assert.equal(month.bucketTotals.at(-1), 150, 'both August days land in one month bucket');
  assert.equal(month.totals.tokens, 150);
});

test('grouping by machine and by workspace keeps workspaces machine-qualified', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100 }),
    record({ sourceKey: 'machine-b', workspaceId: 'ws-1', totalTokens: 40 }),
    record({ sourceKey: 'machine-a', workspaceId: 'ws-2', source: 'codex', totalTokens: 60 }),
  ]);
  assert.deepEqual(
    buildUsageBreakdown(cells, { now: NOW, groupBy: 'machine' }).series.map((group) => group.key),
    ['machine-a', 'machine-b'],
  );
  assert.deepEqual(
    buildUsageBreakdown(cells, { now: NOW, groupBy: 'workspace' }).series.map((group) => group.key),
    ['machine-a / ws-1', 'machine-a / ws-2', 'machine-b / ws-1'],
    'the same workspace id on two machines is two series, ordered by tokens',
  );
});

test('a missing value is unknown for the grouping that names it, and never folded into Other', () => {
  const cells = cellsOf([
    ...Array.from({ length: 9 }, (_, index) => record({ workspaceId: `ws-${index}`, totalTokens: (9 - index) * 100 })),
    record({ source: null, sourceKey: null, workspaceId: null, totalTokens: 7 }),
  ]);
  for (const [groupBy, unknownKey] of [['source', UNKNOWN_TOOL], ['machine', 'Unknown machine'], ['workspace', 'Unknown machine / Unknown workspace']]) {
    const series = buildUsageBreakdown(cells, { now: NOW, groupBy }).series;
    const unknown = series.filter((group) => group.unknown);
    assert.deepEqual(unknown.map((group) => group.key), [unknownKey], `one unknown series for ${groupBy}`);
    assert.equal(unknown[0].total, 7, `the unknown series keeps its own total for ${groupBy}`);
    assert.equal(series.at(-1).key, unknownKey, 'unknown sorts last, after Other');
    const other = series.find((group) => group.key === OTHER);
    if (other) assert.equal(other.unknown, false, 'Other is a remainder, not a gap');
  }
});

test('an attributed machine with no workspace is still a workspace gap', () => {
  const [group] = buildUsageBreakdown(cellsOf([record({ workspaceId: null })]), { now: NOW, groupBy: 'workspace' }).series;
  assert.equal(group.key, 'machine-a / Unknown workspace');
  assert.equal(group.unknown, true, 'the machine being known does not make the workspace attributed');
});

test('every bucket and grouping combination conserves the filtered total', () => {
  const cells = cellsOf([
    record({ date: '2026-08-13', totalTokens: 100 }),
    record({ date: '2026-08-01', sourceKey: 'machine-b', source: 'codex', totalTokens: 40 }),
    record({ date: '2026-07-20', workspaceId: 'ws-2', totalTokens: 60 }),
    record({ date: '2026-08-12', source: null, workspaceId: null, totalTokens: 5 }),
  ]);
  const filterCases = [{}, { machineIds: ['machine-a'] }, { workspaceKeys: [workspaceFilterKey('machine-a', 'ws-2')] }];
  for (const bucket of ['day', 'week', 'month']) {
    for (const groupBy of ['source', 'machine', 'workspace']) {
      for (const filters of filterCases) {
        const breakdown = buildUsageBreakdown(cells, { now: NOW, bucket, groupBy, ...filters });
        const label = `${bucket}/${groupBy}/${JSON.stringify(filters)}`;
        const stacked = breakdown.series.reduce((total, group) => total + group.values.reduce((sum, value) => sum + value.tokens, 0), 0);
        assert.equal(stacked, breakdown.totals.tokens, `series conserve the total for ${label}`);
        assert.equal(breakdown.bucketTotals.reduce((a, b) => a + b, 0), breakdown.totals.tokens, `bars conserve the total for ${label}`);
        assert.equal(breakdown.bucketTotals.length, breakdown.buckets.length);
      }
    }
  }
});

test('filtering and grouping compose without either widening the cohort', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100 }),
    record({ sourceKey: 'machine-b', workspaceId: 'ws-1', totalTokens: 40 }),
  ]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW, groupBy: 'workspace', machineIds: ['machine-b'] });
  assert.deepEqual(breakdown.series.map((group) => group.key), ['machine-b / ws-1']);
  assert.equal(breakdown.totals.tokens, 40);
});

test('colour slots follow the grouping and still exclude unknown values', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', totalTokens: 500 }),
    record({ sourceKey: 'machine-b', totalTokens: 300 }),
    record({ sourceKey: null, totalTokens: 9 }),
  ]);
  const slots = seriesSlots(cells, 'machine');
  assert.deepEqual([...slots.entries()], [['machine-a', 0], ['machine-b', 1]]);
  assert.equal(slots.has('Unknown machine'), false, 'unknown keeps its reserved colour, not a slot');
});

test('the chart keeps a bar hit target at every width', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /\.chart\{[^}]*overflow-x:auto/, 'dense axes scroll rather than shrink to hairlines');
  const floors = [...css.matchAll(/\.breakdown-chart \.month\{[^}]*min-width:(\d+)px/g)].map(([, width]) => Number(width));
  assert.ok(floors.length >= 1, 'the bar width floor is stated');
  for (const floor of floors) assert.ok(floor >= 10, `a ${floor}px bar is too narrow to hover or tap`);
  assert.match(css, /\.month\{[^}]*align-self:stretch/, 'the hover target is the full-height column, not the visible stack');
});

test('every usage-breakdown bar renders its bucket label at every width', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(app, /const label = `<label>\$\{escapeHtml\(bucket\.label\)\}<\/label>`/, 'the label is unconditional inside the bucket render');
  assert.doesNotMatch(css, /label\.thin\{display:none\}/, 'narrow screens do not hide alternating labels');
});

// --- Slice 3 follow-up: whole-window history navigation ---------------------

test('a window step moves exactly one whole window and stays contiguous', () => {
  for (const [bucket, count] of [['day', 30], ['week', 24], ['month', 18]]) {
    const latest = timeBuckets(bucket, NOW);
    const previous = timeBuckets(bucket, NOW, 0, 1);
    assert.equal(previous.length, count, `${bucket} keeps its window length going back`);
    assert.equal(previous.at(-1).end < latest[0].start, true, `${bucket} history ends before the latest window starts`);
    const gapDays = (Date.parse(`${latest[0].start}T00:00:00Z`) - Date.parse(`${previous.at(-1).end}T00:00:00Z`)) / 86400000;
    assert.equal(gapDays, 1, `${bucket} windows are contiguous: no shared bucket and no gap`);
    assert.equal(previous.some((entry) => latest.some((other) => other.key === entry.key)), false, `${bucket} windows do not overlap`);
    const older = timeBuckets(bucket, NOW, 0, 2);
    assert.equal(older.at(-1).key < previous[0].key, true, `${bucket} step 2 is strictly older than step 1`);
  }
});

test('weekly history stays Monday-aligned and monthly history uses calendar months', () => {
  for (const offset of [0, 1, 2, 5]) {
    for (const entry of timeBuckets('week', NOW, 0, offset)) assert.equal(weekStart(entry.key), entry.key, `week ${entry.key} starts on a Monday`);
  }
  const months = timeBuckets('month', NOW, 0, 1);
  assert.equal(months.at(-1).key, '2025-02', '18 calendar months before 2026-08 is 2025-02');
  assert.equal(months[0].key, '2023-09');
  assert.equal(months.at(-1).end, '2025-02-28', 'a non-leap February ends on the 28th');
  assert.equal(timeBuckets('month', Date.parse('2025-02-15T00:00:00Z'), 0, 1).at(-1).end, '2023-08-31', '18 calendar months back from 2025-02');
});

test('the visible window is spelled out, with years only where they disambiguate', () => {
  assert.equal(windowRangeLabel(timeBuckets('day', NOW)), 'Jul 15 – Aug 13, 2026 UTC');
  assert.equal(windowRangeLabel(timeBuckets('week', NOW)), 'Mar 2 – Aug 16, 2026 UTC');
  assert.equal(windowRangeLabel(timeBuckets('month', NOW)), 'Mar 1, 2025 – Aug 31, 2026 UTC', 'a window crossing years labels both');
  assert.equal(windowRangeLabel([]), '');
});

test('Previous stays available whenever earlier usage exists, even across an empty window', () => {
  // One record two whole weekly windows back (window 1 is 2025-09-15…2026-03-01,
  // window 2 is 2025-03-31…2025-09-14): the adjacent window is empty, and that is
  // exactly the case the Operator refused to let the control skip.
  const cells = cellsOf([record({ date: '2026-08-13' }), record({ date: '2025-05-05', totalTokens: 10 })]);
  const latest = buildUsageBreakdown(cells, { now: NOW });
  assert.equal(latest.navigation.canPrevious, true);
  assert.equal(latest.navigation.canNext, false, 'there is nothing after the latest window');
  assert.equal(latest.navigation.isLatest, true);

  const back1 = buildUsageBreakdown(cells, { now: NOW, offset: 1 });
  assert.equal(back1.empty, true, 'the adjacent window is genuinely empty');
  assert.equal(back1.navigation.canPrevious, true, 'an empty window is stepped through, not skipped');
  assert.equal(back1.navigation.canNext, true);

  const back2 = buildUsageBreakdown(cells, { now: NOW, offset: 2 });
  assert.equal(back2.totals.tokens, 10, 'the older record is two whole windows back');
  assert.equal(back2.navigation.canPrevious, false, 'nothing is older than the oldest record');
});

test('Previous is hidden when the cohort has no earlier usage at all', () => {
  const latest = buildUsageBreakdown(cellsOf([record({ date: '2026-08-13' })]), { now: NOW });
  assert.equal(latest.navigation.canPrevious, false);
  assert.equal(latest.navigation.canNext, false);
});

test('navigation availability follows the selected cohort, not the whole report', () => {
  const cells = cellsOf([
    record({ date: '2026-08-13', sourceKey: 'machine-a' }),
    record({ date: '2025-02-05', sourceKey: 'machine-b', totalTokens: 10 }),
  ]);
  assert.equal(buildUsageBreakdown(cells, { now: NOW }).navigation.canPrevious, true);
  assert.equal(
    buildUsageBreakdown(cells, { now: NOW, machineIds: ['machine-a'] }).navigation.canPrevious,
    false,
    'filtering away every earlier record leaves nothing to go back to',
  );
  assert.equal(buildUsageBreakdown(cells, { now: NOW, machineIds: ['machine-b'] }).navigation.canPrevious, true);
});

test('undated records never make history look reachable', () => {
  const { cells } = usageCells([record({ date: '2026-08-13' }), record({ date: null, totalTokens: 7 })]);
  assert.equal(buildUsageBreakdown(cells, { now: NOW }).navigation.canPrevious, false);
});

test('a historical window keeps the bucket, grouping, filters, and conservation intact', () => {
  const cells = cellsOf([
    record({ date: '2026-02-10', sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100 }),
    record({ date: '2026-02-10', sourceKey: 'machine-b', workspaceId: 'ws-1', source: 'codex', totalTokens: 40 }),
    record({ date: '2026-08-13', totalTokens: 5 }),
  ]);
  const back = buildUsageBreakdown(cells, { now: NOW, offset: 1, groupBy: 'machine', machineIds: ['machine-a'] });
  assert.equal(back.bucket, 'week');
  assert.equal(back.groupBy, 'machine');
  assert.deepEqual(back.series.map((group) => group.key), ['machine-a'], 'the cohort filter still applies in history');
  assert.equal(back.totals.tokens, 100);
  const stacked = back.series.reduce((total, group) => total + group.values.reduce((sum, value) => sum + value.tokens, 0), 0);
  assert.equal(stacked, back.totals.tokens);
  assert.equal(back.bucketTotals.reduce((a, b) => a + b, 0), back.totals.tokens);
  assert.equal(back.buckets.length, 24, 'empty historical buckets keep their positions');
});

test('a negative offset is the latest window, so no control can navigate past it', () => {
  const latest = buildUsageBreakdown(cellsOf([record({ date: '2026-08-13' })]), { now: NOW });
  const clamped = buildUsageBreakdown(cellsOf([record({ date: '2026-08-13' })]), { now: NOW, offset: -3 });
  assert.deepEqual(clamped.buckets, latest.buckets);
  assert.equal(clamped.navigation.canNext, false);
});

// --- Slice 4: separate cost metrics -----------------------------------------

test('tokens and estimated cost measure the same records differently', () => {
  const cells = cellsOf([
    record({ recordedCost: 0.2, estimatedCost: 0.5 }),
    record({ source: 'codex', recordedCost: 0.1, estimatedCost: 0.9 }),
  ]);
  const tokens = buildUsageBreakdown(cells, { now: NOW });
  const estimated = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.equal(tokens.metricTotal, 200);
  assert.equal(estimated.metricTotal, 1.4);
  assert.equal(estimated.totals.tokens, 200, 'the cohort is the same whichever metric is drawn');
  const stacked = estimated.series.reduce((total, group) => total + group.total, 0);
  assert.ok(Math.abs(stacked - 1.4) < 1e-9, 'a cost stack holds only the selected metric, never both summed');
});

// --- Slice 5: recorded cost is no longer a stackable choice ------------------

test('recorded cost is not a selectable metric but stays a per-cell fact', () => {
  assert.deepEqual(Object.keys(METRICS), ['tokens', 'estimatedCost']);
  const cells = cellsOf([record({ recordedCost: 0.2, estimatedCost: 0.5 })]);
  assert.equal(cells[0].recordedCost, 0.2, 'the native fact still travels for tooltips and totals');
  assert.equal(cells[0].recordedCostRecords, 1);
  const asked = buildUsageBreakdown(cells, { now: NOW, metric: 'recordedCost' });
  assert.equal(asked.metric, 'recordedCost', 'the request is echoed, not silently rewritten');
  assert.equal(asked.metricTotal, 100, 'an unknown metric falls back to tokens rather than drawing money as a count');
  assert.equal(asked.series[0].values.at(-1).recordedCost, 0.2, 'the segment still carries recorded cost for the tooltip');
});

test('a group with no cost is unpriced, not zero-valued evidence of free usage', () => {
  const cells = cellsOf([
    record({ source: 'claude-code', recordedCost: 0.4, estimatedCost: 0.4 }),
    record({ source: 'codex', recordedCost: null, estimatedCost: null }),
  ]);
  const estimated = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.equal(estimated.totals.unpricedRecords, 1);
  assert.equal(estimated.totals.unknownCostRecords, 1);
  const codex = estimated.series.find((group) => group.key === 'codex');
  assert.equal(codex.total, 0, 'the series stays visible so its tokens are not lost');
  assert.equal(codex.tokens, 100);
  assert.equal(codex.values.at(-1).estimatedCostRecords, 0, 'nothing priced it, which is what the tooltip must say');
});

test('a zero cost and an unavailable cost are different facts', () => {
  const zero = buildUsageBreakdown(cellsOf([record({ recordedCost: 0, estimatedCost: 0 })]), { now: NOW, metric: 'estimatedCost' });
  const missing = buildUsageBreakdown(cellsOf([record({ recordedCost: null, estimatedCost: null })]), { now: NOW, metric: 'estimatedCost' });
  assert.equal(zero.metricTotal, 0);
  assert.equal(missing.metricTotal, 0);
  assert.equal(zero.totals.unpricedRecords, 0, 'a priced zero is a real $0');
  assert.equal(missing.totals.unpricedRecords, 1, 'an absent price is not $0');
  assert.equal(zero.metricUnavailable, false, 'a real $0 is available even though there is nothing to stack');
  assert.equal(missing.metricUnavailable, true);
  assert.equal(missing.empty, false, 'records still exist; only the price is missing');
});

test('currency-excluded records keep their tokens and stay out of the cost stack', () => {
  const cells = cellsOf([
    record({ recordedCost: 0.5, estimatedCost: 0.5 }),
    record({ source: 'codex', totalTokens: 60, recordedCost: null, estimatedCost: null, costExcluded: true }),
  ]);
  const estimated = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.equal(estimated.totals.tokens, 160, 'excluded costs never exclude tokens');
  assert.equal(estimated.metricTotal, 0.5);
  assert.equal(estimated.totals.costExcludedRecords, 1);
  assert.equal(estimated.totals.costExcludedTokens, 60);
  assert.equal(estimated.totals.unpricedRecords, 0, 'a deliberate exclusion is not an unpriced record');
  assert.equal(estimated.totals.unknownCostRecords, 0);
});

test('cost conservation holds across filtering, grouping, and navigation', () => {
  const cells = cellsOf([
    record({ sourceKey: 'machine-a', estimatedCost: 0.25 }),
    record({ sourceKey: 'machine-b', source: 'codex', estimatedCost: 0.75 }),
    record({ date: '2026-02-10', sourceKey: 'machine-a', estimatedCost: 1.5 }),
  ]);
  for (const options of [{}, { groupBy: 'machine' }, { groupBy: 'workspace' }, { machineIds: ['machine-a'] }, { sources: ['codex'] }, { offset: 1 }, { bucket: 'day' }, { bucket: 'month' }]) {
    const breakdown = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost', ...options });
    const stacked = breakdown.series.reduce((total, group) => total + group.total, 0);
    const bars = breakdown.bucketTotals.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(stacked - breakdown.metricTotal) < 1e-9, `series conserve cost for ${JSON.stringify(options)}`);
    assert.ok(Math.abs(bars - breakdown.metricTotal) < 1e-9, `bars conserve cost for ${JSON.stringify(options)}`);
  }
});

test('Other and Unknown fold by the selected metric and keep both facts', () => {
  const cells = cellsOf([
    ...Array.from({ length: 9 }, (_, index) => record({ source: `tool-${index}`, totalTokens: 100, estimatedCost: (9 - index) / 10 })),
    record({ source: null, totalTokens: 5, estimatedCost: 0.05 }),
  ]);
  const breakdown = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.deepEqual(breakdown.series.map((group) => group.key), ['tool-0', 'tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', OTHER, UNKNOWN_TOOL]);
  const other = breakdown.series.find((group) => group.key === OTHER);
  assert.ok(Math.abs(other.total - 0.3) < 1e-9, 'Other holds exactly the two cheapest known tools');
  assert.equal(other.tokens, 200, 'a folded group keeps its tokens as well as its cost');
  assert.equal(breakdown.series.at(-1).key, UNKNOWN_TOOL, 'Unknown is never folded into Other, cost or not');
});

test('colour slots stay token-ranked so a metric change never recolours a tool', () => {
  const cells = cellsOf([
    record({ source: 'claude-code', totalTokens: 900, estimatedCost: 0.1 }),
    record({ source: 'codex', totalTokens: 100, estimatedCost: 9 }),
  ]);
  assert.deepEqual([...seriesSlots(cells).keys()], ['claude-code', 'codex']);
  const byCost = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.deepEqual(byCost.series.map((group) => group.key), ['codex', 'claude-code'], 'ordering still follows the metric');
});

test('subscription spend has no record to attach to and never reaches a cell', () => {
  const { cells } = usageCells([record({ estimatedCost: 0.5, subscriptionCost: 99 })]);
  assert.equal(cells[0].estimatedCost, 0.5);
  assert.equal(cells[0].subscriptionCost, undefined);
  const breakdown = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  assert.equal(breakdown.metricTotal, 0.5);
});

test('a series carries the counters its legend needs to say unpriced', () => {
  const cells = cellsOf([
    record({ source: 'claude-code', recordedCost: null, estimatedCost: null }),
    record({ source: 'pi', recordedCost: 0.3, estimatedCost: 0.3 }),
  ]);
  const estimated = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  const claude = estimated.series.find((group) => group.key === 'claude-code');
  const pi = estimated.series.find((group) => group.key === 'pi');
  assert.equal(claude.total, 0);
  assert.equal(claude.totals.estimatedCostRecords, 0, 'nothing priced it, so the legend must not print $0.00');
  assert.equal(claude.totals.records, 1);
  assert.equal(pi.totals.estimatedCostRecords, 1);
});

test('folded groups keep the counters as well as the sums', () => {
  const cells = cellsOf([
    ...Array.from({ length: 9 }, (_, index) => record({ source: `tool-${index}`, estimatedCost: (9 - index) / 10 })),
  ]);
  const other = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' }).series.find((group) => group.key === OTHER);
  assert.equal(other.totals.records, 2);
  assert.equal(other.totals.estimatedCostRecords, 2);
});

test('unknown-attribution disclosure counts tokens even when the stack draws cost', () => {
  const cells = cellsOf([
    record({ source: null, totalTokens: 100, estimatedCost: 2 }),
    record({ source: 'pi', totalTokens: 50, estimatedCost: 1 }),
  ]);
  const cost = buildUsageBreakdown(cells, { now: NOW, metric: 'estimatedCost' });
  const unknown = cost.series.find((group) => group.unknown);
  assert.equal(unknown.total, 2, 'the drawn value is money in cost mode');
  assert.equal(unknown.tokens, 100);
  assert.equal(unknownAttributionTokens(cost), 100, 'the disclosure must never print $2 as 2 tokens');
  assert.equal(unknownAttributionTokens(buildUsageBreakdown(cells, { now: NOW })), 100, 'and is the same fact in token mode');
});

test('a zero-total window names why it is zero', () => {
  const zeroFor = (metric) => (metric === 'tokens' ? '0 tokens' : '$0.00');
  const build = (records, metric = 'estimatedCost') => buildUsageBreakdown(cellsOf(records), { now: NOW, metric });

  const priced = build([record({ estimatedCost: 0 })]);
  assert.equal(zeroMetricState(priced).kind, 'priced-zero');
  assert.equal(priced.metricUnavailable, false, 'a priced $0.00 total renders as zero, not unavailable');
  assert.match(zeroMetricCopy(priced, 'last 24 weeks', zeroFor), /The only record .* carries a real estimated cost of \$0\.00/);

  const missing = build([record({ estimatedCost: null }), record({ source: 'codex', estimatedCost: null, costExcluded: true })]);
  assert.equal(zeroMetricState(missing).kind, 'unavailable');
  assert.equal(missing.metricUnavailable, true, 'a wholly unpriced cost total renders as unavailable');
  const unavailable = zeroMetricCopy(missing, 'last 24 weeks', zeroFor);
  assert.match(unavailable, /No estimated cost is available for the 2 records/);
  assert.match(unavailable, /1 unpriced and 1 excluded for currency mismatch/);

  const mixed = build([record({ estimatedCost: 0 }), record({ source: 'codex', estimatedCost: null }), record({ source: 'pi', estimatedCost: null, costExcluded: true })]);
  const state = zeroMetricState(mixed);
  assert.deepEqual([state.kind, state.priced, state.unpriced, state.excluded], ['mixed', 1, 1, 1]);
  const copy = zeroMetricCopy(mixed, 'last 24 weeks', zeroFor);
  assert.match(copy, /1 of the 3 records .* carries a real estimated cost of \$0\.00/);
  assert.doesNotMatch(copy, /No estimated cost is available/, 'a real priced zero is never erased into "all unavailable"');

  const tokens = build([record({ totalTokens: 0 })], 'tokens');
  assert.equal(zeroMetricState(tokens).kind, 'tokens');
  assert.equal(tokens.metricUnavailable, false, 'zero tokens render as zero, never as an unavailable metric');
  assert.match(zeroMetricCopy(tokens, 'last 24 weeks', zeroFor), /Every record .* carries 0 tokens/);
});

// Static guards for the per-bar total label. The bar floor and the label are one
// decision: a label wider than its bar collides with its neighbour, and that is
// invisible in a unit test and at desktop width. Collisions were measured at 0
// from 320px to 1500px across all three metrics and all three buckets.
test('the configurable breakdown replaces fixed usage cards and subscriptions stays unfiltered', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(?:source|workspace|model)-chart"/, 'no obsolete fixed-card targets remain');
  assert.doesNotMatch(app, /renderSourceUsage|#(?:source|workspace|model)-chart/, 'no obsolete fixed-card rendering remains');
  assert.match(html, /<div class="usage-stack">[\s\S]*Daily token usage[\s\S]*Subscriptions[\s\S]*private local data · outside analysis filters/, 'subscriptions occupies the right usage stack with explicit scope');
  assert.match(app, /renderFilteredUsage\(data, root\);\s*renderBars\('#subscription-chart'/, 'subscriptions renders independently of the filtered usage cohort');
  assert.match(html, /Top drivers — sessions[\s\S]*aggregated by source session · outside analysis filters/, 'session drivers state their global scope');
  assert.match(html, /Top drivers — prompts \/ messages[\s\S]*single normalized records · outside analysis filters/, 'message drivers state their global scope');
});

test('the legend ends with the selected-window total', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const render = app.slice(app.indexOf('function renderBreakdownLegend'), app.indexOf('function seriesPriced'));
  assert.match(render, /breakdown\.metricUnavailable \? 'unavailable' : formatMetric\(breakdown\.metricTotal, metric, currency\)/, 'unknown cost is not printed as a zero total');
  assert.match(render, /class="breakdown-total"[\s\S]*Total ·/, 'the accumulated total follows the group values');
});

test('monthly cockpit compact money keeps one decimal of thousands precision', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /notation: 'compact', maximumFractionDigits: 1/, 'in-bar money such as $1.2K is not rounded to $1K');
});

test('the per-bar total is metric-aware and the bar floor leaves room for it', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(app, /function barTotalLabel[\s\S]*isCostMetric\(metric\) \? compactCurrency\(total, currency\) : formatTokens\(total\)/, 'the label follows the drawn metric');
  assert.match(app, /total > 0 \? `<span class="token-label"/, 'an empty bucket carries no label');
  // `1.3B` at 9px muted read as `1.38`, so the suffix is split off and the label
  // sits clear of its bar. Both are invisible on a passing screenshot.
  assert.match(app, /function unitMarkup[\s\S]*\^\(\.\*\?\)\(\[A-Za-z\]\+\)\$/, 'the magnitude suffix is separated from the digits');
  assert.match(css, /\.token-label i\{[^}]*margin-left/, 'and set apart typographically');
  const label = css.match(/\.breakdown-chart \.token-label\{([^}]*)\}/);
  assert.ok(label, 'the breakdown label has its own rule');
  assert.ok(Number(label[1].match(/font-size:(\d+)px/)[1]) >= 10, 'a total a reader must not misread stays at least 10px');
  assert.ok(Number(label[1].match(/translate\(-50%,-(\d+)px\)/)[1]) >= 6, 'the label clears the bar it sits above');
  const floor = css.match(/\.breakdown-chart \.month\{flex:1 1 0;min-width:(\d+)px\}/);
  assert.ok(floor && Number(floor[1]) >= 40, 'bars stay at least as wide as a compact total label');
  for (const [, width, body] of css.matchAll(/@media\(max-width:(\d+)px\)\{([^@]*)\}/g)) {
    const narrowed = body.match(/\.breakdown-chart \.month\{[^}]*min-width:(\d+)px/);
    assert.ok(!narrowed || Number(narrowed[1]) >= 40, `the ≤${width}px block must not narrow bars below the label floor`);
  }
});
