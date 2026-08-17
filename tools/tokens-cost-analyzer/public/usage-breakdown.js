// The shaping layer for every cohort-filtered usage view. Pure functions over
// the aggregated day cells the server derives (see `usageCells` in
// `rollups.mjs`), so bucketing, filtering, Unknown/Other handling, and
// conservation are unit-testable without a browser and without touching the
// private record set.
//
// The machine/workspace cohort is defined once here and consumed by both the
// Usage breakdown and the Daily token usage matrix; only the bucketing differs.

export const UNKNOWN_TOOL = 'Unknown agent tool';
export const UNKNOWN_MACHINE = 'Unknown machine';
export const UNKNOWN_WORKSPACE = 'Unknown workspace';
export const UNKNOWN_MODEL = 'Unknown model';
export const OTHER = 'Other';
export const DEFAULT_TOP = 7;

/**
 * Each temporal grain carries its own range. Forcing one bar count on all three
 * would either crush a month view into half a year or stretch a day view across
 * a quarter; the ranges below are fixed per grain so the axis is deterministic
 * and can be stated in words rather than configured.
 */
export const BUCKETS = {
  day: { label: 'Day', noun: 'day', count: 30, rangeLabel: 'last 30 days (UTC)' },
  week: { label: 'Week', noun: 'week', count: 24, rangeLabel: 'last 24 weeks (UTC)' },
  month: { label: 'Month', noun: 'month', count: 18, rangeLabel: 'last 18 months (UTC)' },
};
export const DEFAULT_BUCKET = 'week';
export const DEFAULT_WEEKS = BUCKETS.week.count;

/**
 * The grouping dimensions the aggregated cells can actually carry. Each one
 * names what a missing value means, because an unknown machine and an unknown
 * agent tool are different gaps and must not share one label.
 */
export const GROUPINGS = {
  source: { label: 'Agent tool', noun: 'agent tool' },
  machine: { label: 'Machine', noun: 'machine' },
  workspace: { label: 'Workspace', noun: 'workspace' },
  model: { label: 'Model', noun: 'model' },
};
export const DEFAULT_GROUPING = 'source';

/**
 * The two metrics a stack may measure. Recorded cost was removed as a choice at
 * Checkpoint 4: only one adapter carries native cost, so a recorded-cost stack
 * drew most of the cohort as unpriced and compared almost nothing. The native
 * facts themselves are untouched — cells still carry `recordedCost` and the
 * segment tooltip, the all-time cards, and the monthly chart still state it.
 * Subscription spend is absent by definition — it is a monthly service-level
 * amount with no record to attach to.
 *
 * `records` is the count that carried a value for the metric; the difference
 * from the cell's total record count is what the panel discloses as unpriced
 * rather than drawing as zero.
 */
export const METRICS = {
  tokens: { label: 'Tokens', noun: 'tokens', kind: 'tokens', value: 'tokens', records: 'records', note: 'normalized token usage' },
  estimatedCost: { label: 'Estimated cost', noun: 'estimated cost', kind: 'cost', value: 'estimatedCost', records: 'estimatedCostRecords', note: 'local pricing table' },
};
export const DEFAULT_METRIC = 'tokens';
export function metricMode(metric) { return METRICS[metric] || METRICS[DEFAULT_METRIC]; }
export function isCostMetric(metric) { return metricMode(metric).kind === 'cost'; }

/** The selected metric's value on a cell or an accumulated bucket value. */
export function metricValue(entry, metric = DEFAULT_METRIC) {
  return Number(entry?.[metricMode(metric).value]) || 0;
}

/**
 * Records inside `entry` that carry no value for the selected metric and are not
 * currency-excluded. They are counted, never zero-valued: a group whose price is
 * unknown must not become evidence that the usage was free.
 */
export function unpricedRecords(entry, metric = DEFAULT_METRIC) {
  const mode = metricMode(metric);
  if (mode.kind !== 'cost') return 0;
  return Math.max(0, (Number(entry?.records) || 0) - (Number(entry?.costExcludedRecords) || 0) - (Number(entry?.[mode.records]) || 0));
}

/**
 * Tokens sitting in unattributed series. Always tokens, never the selected
 * metric: the disclosure counts usage the grouping could not place, and in cost
 * mode `group.total` is money, which would print a price as a token count.
 */
export function unknownAttributionTokens(breakdown = {}) {
  return (breakdown.series || []).filter((group) => group.unknown).reduce((total, group) => total + (Number(group.tokens) || 0), 0);
}

/**
 * Why a zero-total window is zero. A total of zero has three different causes
 * and only one of them means the usage was free, so the classification is
 * computed from the priced/unpriced/excluded counts rather than from the total.
 */
export function zeroMetricState(breakdown = {}) {
  const metric = breakdown.metric || DEFAULT_METRIC;
  const mode = metricMode(metric);
  const totals = breakdown.totals || {};
  const records = Number(totals.records) || 0;
  const priced = mode.kind === 'cost' ? Number(totals[mode.records]) || 0 : records;
  const unpriced = mode.kind === 'cost' ? Number(totals.unpricedRecords) || 0 : 0;
  const excluded = mode.kind === 'cost' ? Number(totals.costExcludedRecords) || 0 : 0;
  const kind = mode.kind !== 'cost' ? 'tokens' : priced === 0 ? 'unavailable' : unpriced || excluded ? 'mixed' : 'priced-zero';
  return { kind, metric, records, priced, unpriced, excluded };
}

/**
 * The sentence a reader sees instead of a flat chart. `formatZero` renders the
 * metric's own zero (money or tokens), which is the only formatting this module
 * borrows from the view.
 */
export function zeroMetricCopy(breakdown, window_, formatZero) {
  const state = zeroMetricState(breakdown);
  const noun = metricMode(state.metric).noun;
  const zero = formatZero(state.metric);
  if (state.kind === 'tokens') return `Every record in the ${window_} carries ${zero}, so there is nothing to stack.`;
  if (state.kind === 'priced-zero') return `${state.records === 1 ? 'The only record' : `All ${state.records} records`} in the ${window_} ${state.records === 1 ? 'carries' : 'carry'} a real ${noun} of ${zero}, so there is nothing to stack.`;
  if (state.kind === 'unavailable') return `No ${noun} is available for the ${plural(state.records, 'record')} in the ${window_} (${zeroCounts(state)}) — the price is unknown, not ${zero}.`;
  const others = state.records - state.priced;
  return `${state.priced} of the ${plural(state.records, 'record')} in the ${window_} ${state.priced === 1 ? 'carries' : 'carry'} a real ${noun} of ${zero}; the other ${plural(others, 'record')} (${zeroCounts(state)}) ${others === 1 ? 'carries' : 'carry'} no ${noun} and ${others === 1 ? 'is' : 'are'} not part of that ${zero}.`;
}

function plural(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }

function zeroCounts(state) {
  const parts = [];
  if (state.unpriced) parts.push(`${state.unpriced} unpriced`);
  if (state.excluded) parts.push(`${state.excluded} excluded for currency mismatch`);
  return parts.join(' and ');
}

// Cost sums are floats, so a total assembled in a different order than the parts
// can differ in the last bits. Money is rounded to the cent-fraction the report
// already uses before it is compared or displayed.
export function roundCost(value) { return Math.round((Number(value) || 0) * 1000000) / 1000000; }

/**
 * How many bars share one axis label. A dense axis cannot carry a label per bar,
 * and overlapping rotated labels are less readable than fewer of them; the step
 * is anchored at the newest bucket, which is where a reader orients.
 */
export const MAX_AXIS_LABELS = 12;
export function axisLabelStep(bucketCount, maxLabels = MAX_AXIS_LABELS) {
  return Math.max(1, Math.ceil(Math.max(1, bucketCount) / Math.max(1, maxLabels)));
}
export function axisLabelled(position, bucketCount, maxLabels = MAX_AXIS_LABELS) {
  return (bucketCount - 1 - position) % axisLabelStep(bucketCount, maxLabels) === 0;
}
/**
 * A labelled bar's ordinal counting back from the newest. Rank parity is what
 * lets a narrow screen drop every second label in CSS: at phone width the same
 * 12 labels collide, and a stylesheet cannot recompute the step.
 */
export function axisLabelRank(position, bucketCount, maxLabels = MAX_AXIS_LABELS) {
  return Math.floor((bucketCount - 1 - position) / axisLabelStep(bucketCount, maxLabels));
}

export function bucketMode(bucket) { return BUCKETS[bucket] || BUCKETS[DEFAULT_BUCKET]; }
export function groupingMode(groupBy) { return GROUPINGS[groupBy] || GROUPINGS[DEFAULT_GROUPING]; }

const DAY_MS = 86400000;
// A machine id and a workspace id are both free-form, so the pair is joined on
// a character neither can contain rather than on `/`, which workspace ids use.
const KEY_SEPARATOR = '';

export function workspaceFilterKey(machineId, workspaceId) {
  return `${machineId || ''}${KEY_SEPARATOR}${workspaceId || ''}`;
}

export function machineLabel(machineId) { return machineId || UNKNOWN_MACHINE; }
export function workspaceLabel(machineId, workspaceId) { return `${machineLabel(machineId)} / ${workspaceId || UNKNOWN_WORKSPACE}`; }
export function toolLabel(source) { return source || UNKNOWN_TOOL; }

/**
 * The axis for a grain, built from the calendar rather than from the data so
 * empty positions stay visible as gaps in every mode.
 */
export function timeBuckets(bucket = DEFAULT_BUCKET, now = Date.now(), count = 0, offset = 0) {
  const length = Math.max(1, count || bucketMode(bucket).count);
  const anchor = windowAnchor(bucket, now, length, Math.max(0, offset));
  if (bucket === 'day') return dayBuckets(length, anchor);
  if (bucket === 'month') return monthBuckets(length, anchor);
  return weekBuckets(length, anchor);
}

/**
 * History moves by whole windows, so window N simply re-anchors the same axis
 * builder N×length grains earlier. Stepping the anchor rather than the buckets
 * is what makes adjacent windows exactly contiguous — no shared bucket, no gap —
 * and keeps a week window Monday-aligned, because a week step is a multiple of 7.
 */
export function windowAnchor(bucket, now, count, offset) {
  if (!offset) return now;
  if (bucket === 'month') {
    const date = new Date(now);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count * offset, 1);
  }
  return utcMidnight(now) - (bucket === 'week' ? count * 7 : count) * offset * DAY_MS;
}

function dayBuckets(count, now) {
  const today = utcMidnight(now);
  return Array.from({ length: count }, (_, index) => {
    const time = today - (count - 1 - index) * DAY_MS;
    const key = new Date(time).toISOString().slice(0, 10);
    return { key, start: key, end: key, label: monthDayLabel(time), range: `${monthDayLabel(time)} UTC` };
  });
}

function monthBuckets(count, now) {
  const today = new Date(now);
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (count - 1 - index), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return {
      key: start.toISOString().slice(0, 7),
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      // `Aug ’26` rather than `Aug 26`, which a day axis would read as a date.
      label: `${monthLabel(start)} ’${String(start.getUTCFullYear()).slice(-2)}`,
      range: `${monthLabel(start)} ${start.getUTCFullYear()} UTC`,
    };
  });
}

/**
 * The Monday-first UTC week axis, built from the calendar rather than from the
 * data so weeks with no usage keep their position and a gap stays visible.
 */
export function weekBuckets(weeks = DEFAULT_WEEKS, now = Date.now()) {
  const start = utcMidnight(now);
  const currentMonday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY_MS;
  return Array.from({ length: Math.max(1, weeks) }, (_, index) => {
    const monday = currentMonday - (weeks - 1 - index) * DAY_MS * 7;
    const sunday = monday + 6 * DAY_MS;
    return {
      key: new Date(monday).toISOString().slice(0, 10),
      start: new Date(monday).toISOString().slice(0, 10),
      end: new Date(sunday).toISOString().slice(0, 10),
      label: monthDayLabel(monday),
      range: `${monthDayLabel(monday)} – ${monthDayLabel(sunday)} UTC`,
    };
  });
}

/** Monday 00:00 UTC of the week containing a `YYYY-MM-DD` date, or null. */
export function weekStart(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY_MS).toISOString().slice(0, 10);
}

/** The axis key a `YYYY-MM-DD` date falls in for a grain, or null. */
export function bucketStart(bucket, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);
  return weekStart(date);
}

/**
 * A cell's series under the selected grouping. `unknown` is carried separately
 * from the label because a machine-qualified workspace with no workspace id
 * still shows its machine, yet is as much a gap as an unattributed record.
 */
export function groupOf(cell, groupBy = DEFAULT_GROUPING, models = null) {
  if (groupBy === 'machine') return { key: machineLabel(cell.machineId), unknown: !cell.machineId };
  if (groupBy === 'workspace') return { key: workspaceLabel(cell.machineId, cell.workspaceId), unknown: !cell.workspaceId };
  if (groupBy === 'model') return { key: modelIdentity(cell, models), unknown: !cell.model };
  return { key: toolLabel(cell.source), unknown: !cell.source };
}

/**
 * A model's display identity, provider-qualified — but only as far as the
 * adapters actually evidence it. Measured on the real local report:
 *
 * - `pi` and `opencode` already emit provider-qualified labels
 *   (`openai/gpt-5.5:low`), and the shared normalizer maps pi's `openai-codex`
 *   onto `openai`, so the same model reached through two adapters already
 *   lands on one identity. Re-prefixing those would produce `openai/openai/…`.
 * - `claude-code` emits a bare label and always states `anthropic`, so the
 *   provider qualifies it cleanly.
 * - `codex` emits a bare label and omits the provider on **95.4%** of records,
 *   naming `openai` on the rest. Blind qualification would therefore split its
 *   busiest model into `gpt-5-codex` and `openai/gpt-5-codex` — one real model
 *   drawn as two series, which is the failure the grouping exists to avoid.
 *
 * So a bare label adopts a qualified identity only when the same data contains
 * exactly one — evidence from the records themselves, never an invented
 * provider. Two candidates is genuine ambiguity and the label stands alone.
 */
export function modelIdentity(cell, models = null) {
  const label = cell.model || '';
  if (!label) return UNKNOWN_MODEL;
  if (label.includes('/')) return label;
  if (cell.provider) return `${cell.provider}/${label}`;
  const adopted = models?.get(label);
  return adopted || label;
}

/**
 * The bare labels that have exactly one qualified counterpart in the same cell
 * set, so an adapter's missing provider does not fork a model. Built over the
 * *unfiltered* cells for the same reason colour slots are: a model's identity
 * must not change because a filter removed the cell that qualified it.
 */
export function modelAliases(cells = []) {
  const qualified = new Map();
  for (const cell of cells) {
    const label = cell.model || '';
    if (!label || label.includes('/') || !cell.provider) continue;
    const candidates = qualified.get(label) || new Set();
    candidates.add(`${cell.provider}/${label}`);
    qualified.set(label, candidates);
  }
  const aliases = new Map();
  for (const [label, candidates] of qualified) {
    if (candidates.size === 1) aliases.set(label, [...candidates][0]);
  }
  return aliases;
}

/**
 * A cell's model as a *filter* value. The cohort filters every other facet by a
 * raw cell field, but a model has no single raw field — its identity is the
 * qualification decision above — so the filter carries that identity, which is
 * also what the legend prints. Filtering by the raw label instead would offer
 * two checkboxes for one model wherever an adapter's provider is inconsistent.
 * An absent model stays the empty string, like every other facet's gap, so a
 * real model named "Unknown model" could never collide with it.
 */
export function modelFilterValue(cell, models = null) {
  return cell.model ? modelIdentity(cell, models) : '';
}

/**
 * The exact visible window, spelled out. `last 24 weeks` is only true of the
 * latest window, and a reader looking at history needs to know which history.
 */
export function windowRangeLabel(buckets = []) {
  if (!buckets.length) return '';
  const start = buckets[0].start;
  const end = buckets.at(-1).end;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${dateLabel(start, !sameYear)} – ${dateLabel(end, true)} UTC`;
}

/**
 * Whether history exists on either side of the visible window.
 *
 * `Previous` answers "is any earlier usage reachable", not "is the adjacent
 * window non-empty": the Operator's control steps whole windows and never skips
 * empty ones, so an adjacent empty window is a legitimate, navigable answer.
 * Availability follows the selected cohort, because a filter can remove every
 * earlier record and leave nothing to go back to.
 */
export function windowNavigation(cells = [], { buckets = [], offset = 0, machineIds = [], workspaceKeys = [], sources = [], models = [] } = {}) {
  const start = buckets[0]?.start;
  const earlier = start
    ? selectCells(cells, { machineIds, workspaceKeys, sources, models }).some((cell) => typeof cell.date === 'string' && cell.date < start)
    : false;
  return { offset, canPrevious: earlier, canNext: offset > 0, isLatest: offset === 0 };
}

/**
 * The one definition of the shared cohort. Every filtered view calls this, so a
 * machine selection cannot mean one set of records in the breakdown and another
 * in the heatmap. An empty selection means "all", never "none".
 */
export function selectCells(cells = [], { machineIds = [], workspaceKeys = [], sources = [], models = [] } = {}) {
  const machineFilter = new Set(machineIds);
  const workspaceFilter = new Set(workspaceKeys);
  // Agent tool and model join the cohort as peer facets: facets intersect,
  // values inside one facet union. Selecting `pi` and machine `pc` means pi *on*
  // pc, not both.
  const sourceFilter = new Set(sources);
  const modelFilter = new Set(models);
  if (!machineFilter.size && !workspaceFilter.size && !sourceFilter.size && !modelFilter.size) return cells;
  // Identities come from the whole cell set, never the surviving ones, so a
  // model keeps the identity its checkbox named while the filter is applied.
  const aliases = modelFilter.size ? modelAliases(cells) : null;
  return cells.filter((cell) => (!machineFilter.size || machineFilter.has(cell.machineId))
    && (!sourceFilter.size || sourceFilter.has(cell.source || ''))
    && (!modelFilter.size || modelFilter.has(modelFilterValue(cell, aliases)))
    && (!workspaceFilter.size || workspaceFilter.has(workspaceFilterKey(cell.machineId, cell.workspaceId))));
}

/**
 * The cohort's daily series, in the shape the shared heatmap already consumes.
 * With no filter selected it reproduces the report's own `daily` rollup exactly,
 * which is the property that lets one code path serve both states.
 */
export function dailySeries(cells = [], filters = {}) {
  const byDate = new Map();
  for (const cell of selectCells(cells, filters)) {
    const current = byDate.get(cell.date) || { date: cell.date, tokens: 0, records: 0 };
    current.tokens += Number(cell.tokens) || 0;
    current.records += Number(cell.records) || 0;
    byDate.set(cell.date, current);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Filter options are derived from the whole cell set, never from the current
 * selection: a filter the user cannot widen again is a trap. The set is not
 * restricted to the breakdown's 12-week window either, because the same cohort
 * now scopes the multi-year heatmap, where an older machine is still meaningful.
 * Unknown attribution is an option like any other so those records stay reachable.
 */
export function usageFilterOptions(cells = []) {
  const machines = new Map();
  const workspaces = new Map();
  const sources = new Map();
  const models = new Map();
  const aliases = modelAliases(cells);
  for (const cell of cells) {
    addOption(models, modelFilterValue(cell, aliases), cell.model ? modelIdentity(cell, aliases) : UNKNOWN_MODEL, cell, {});
    addOption(machines, cell.machineId, machineLabel(cell.machineId), cell, {});
    addOption(workspaces, workspaceFilterKey(cell.machineId, cell.workspaceId), workspaceLabel(cell.machineId, cell.workspaceId), cell, { machineId: cell.machineId });
    // The filter value is the raw source, so unattributed cells stay selectable
    // under their own display label rather than being merged into a tool named
    // "Unknown agent tool" that no record actually carries.
    addOption(sources, cell.source || '', toolLabel(cell.source), cell, {});
  }
  return { machines: sortOptions(machines), workspaces: sortOptions(workspaces), sources: sortOptions(sources), models: sortOptions(models) };
}

/**
 * Colour slots, assigned from each tool's rank over the *unfiltered* cell set.
 * Hashing the name was the obvious alternative and it collides: two tools drawn
 * in one colour is a chart that lies. Ranking unfiltered keeps a tool's slot
 * fixed while filters change the series actually on screen.
 */
/* Ranked by tokens on purpose: a colour that moved when the metric changed
 * would make the same tool two different colours in two views of one cohort.
 * Ordering *within* the chart still follows the selected metric. */
export function seriesSlots(cells = [], groupBy = DEFAULT_GROUPING) {
  const totals = new Map();
  const models = groupBy === 'model' ? modelAliases(cells) : null;
  for (const cell of cells) {
    const group = groupOf(cell, groupBy, models);
    if (group.unknown) continue;
    totals.set(group.key, (totals.get(group.key) || 0) + (Number(cell.tokens) || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(ranked.map(([label], index) => [label, index]));
}

export function buildUsageBreakdown(cells = [], options = {}) {
  const { bucket = DEFAULT_BUCKET, groupBy = DEFAULT_GROUPING, metric = DEFAULT_METRIC, weeks = 0, offset = 0, now = Date.now(), machineIds = [], workspaceKeys = [], sources = [], models: modelFilter = [], top = DEFAULT_TOP } = options;
  const buckets = timeBuckets(bucket, now, weeks, offset);
  // Built over every cell, not the filtered ones: a model that a filter left
  // without its qualified counterpart must not change identity mid-session.
  const models = groupBy === 'model' ? modelAliases(cells) : null;
  const index = new Map(buckets.map((entry, position) => [entry.key, position]));
  const groups = new Map();
  const totals = emptyTotals();
  const bucketTotals = buckets.map(() => 0);

  for (const cell of selectCells(cells, { machineIds, workspaceKeys, sources, models: modelFilter })) {
    const position = index.get(bucketStart(bucket, cell.date));
    if (position === undefined) continue;
    const { key: label, unknown } = groupOf(cell, groupBy, models);
    const group = groups.get(label) || newGroup(label, buckets.length, unknown);
    accumulate(group.values[position], cell);
    accumulate(group.totals, cell);
    group.total += metricValue(cell, metric);
    group.tokens += Number(cell.tokens) || 0;
    groups.set(label, group);
    accumulate(totals, cell);
    bucketTotals[position] += metricValue(cell, metric);
  }

  const cost = isCostMetric(metric);
  const breakdown = {
    bucket,
    groupBy,
    metric,
    buckets,
    rangeLabel: windowRangeLabel(buckets),
    navigation: windowNavigation(cells, { buckets, offset, machineIds, workspaceKeys, sources, models: modelFilter }),
    series: orderSeries([...groups.values()], top, buckets.length, cost),
    totals: finishTotals(totals, metric),
    bucketTotals: cost ? bucketTotals.map(roundCost) : bucketTotals,
    // No records at all and no value for the chosen metric are different
    // answers: the second one still has usage to explain, and saying "no
    // records match" there would be false.
    empty: totals.records === 0,
    metricTotal: cost ? roundCost(metricTotalOf(totals, metric)) : metricTotalOf(totals, metric),
  };
  // A zero sum is not evidence of unavailability: it can be a genuine priced
  // zero, or zero tokens. The existing classifier owns that distinction.
  return { ...breakdown, metricUnavailable: cost && zeroMetricState(breakdown).kind === 'unavailable' };
}

function metricTotalOf(totals, metric) { return metricValue(totals, metric); }

function emptyTotals() {
  return { tokens: 0, records: 0, unknownCostRecords: 0, recordedCost: 0, estimatedCost: 0, recordedCostRecords: 0, estimatedCostRecords: 0, costExcludedRecords: 0, costExcludedTokens: 0, machines: new Set(), workspaces: new Set() };
}

function finishTotals(totals, metric) {
  const { machines, workspaces, ...rest } = totals;
  return { ...rest, recordedCost: roundCost(rest.recordedCost), estimatedCost: roundCost(rest.estimatedCost), unpricedRecords: unpricedRecords(rest, metric) };
}

/**
 * Ordering carries two rules that outrank "largest first". `Other` is a
 * remainder and sits after the groups it summarizes; a group with missing
 * attribution is evidence of a gap and is never folded into `Other`, because a
 * reader who cannot see it will read the chart as complete.
 */
function orderSeries(series, top, bucketCount, cost = false) {
  const unknown = series.filter((group) => group.unknown).sort(compareSeries);
  const known = series.filter((group) => !group.unknown).sort(compareSeries);
  const kept = known.slice(0, Math.max(0, top));
  const folded = known.slice(Math.max(0, top));
  const other = folded.length ? [foldInto(newGroup(OTHER, bucketCount), folded)] : [];
  return [...kept, ...other, ...unknown].map((group) => ({
    ...group,
    total: cost ? roundCost(group.total) : group.total,
    // A series carries its own cost counters so the legend can say "unpriced"
    // where a formatted zero would claim the work was free.
    totals: finishValue(group.totals),
    values: group.values.map(finishValue),
  }));
}

function foldInto(target, groups) {
  for (const group of groups) {
    target.total += group.total;
    target.tokens += group.tokens;
    accumulate(target.totals, group.totals);
    group.values.forEach((value, position) => accumulate(target.values[position], value));
  }
  return target;
}

function newGroup(key, bucketCount, unknown = false) {
  return { key, unknown, total: 0, tokens: 0, totals: emptyValue(), values: Array.from({ length: bucketCount }, () => emptyValue()) };
}

function emptyValue() {
  return { tokens: 0, records: 0, unknownCostRecords: 0, recordedCost: 0, estimatedCost: 0, recordedCostRecords: 0, estimatedCostRecords: 0, costExcludedRecords: 0, costExcludedTokens: 0, machines: new Set(), workspaces: new Set() };
}

function accumulate(value, cell) {
  for (const field of COUNTED_FIELDS) value[field] += Number(cell[field]) || 0;
  if (cell.machines) { for (const machine of cell.machines) value.machines.add(machine); }
  else value.machines.add(machineLabel(cell.machineId));
  if (cell.workspaces) { for (const workspace of cell.workspaces) value.workspaces.add(workspace); }
  else value.workspaces.add(workspaceLabel(cell.machineId, cell.workspaceId));
}

const COUNTED_FIELDS = ['tokens', 'records', 'unknownCostRecords', 'recordedCost', 'estimatedCost', 'recordedCostRecords', 'estimatedCostRecords', 'costExcludedRecords', 'costExcludedTokens'];

function finishValue(value) {
  const finished = { machines: [...value.machines].sort(), workspaces: [...value.workspaces].sort() };
  for (const field of COUNTED_FIELDS) finished[field] = value[field];
  finished.recordedCost = roundCost(finished.recordedCost);
  finished.estimatedCost = roundCost(finished.estimatedCost);
  return finished;
}

function addOption(map, value, label, cell, extra) {
  const current = map.get(value) || { value, label, tokens: 0, ...extra };
  current.tokens += Number(cell.tokens) || 0;
  map.set(value, current);
}

function sortOptions(map) { return [...map.values()].sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label)); }
function compareSeries(a, b) { return b.total - a.total || a.key.localeCompare(b.key); }
function utcMidnight(now) { const date = new Date(now); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function monthDayLabel(time) { return new Date(time).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function monthLabel(date) { return date.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }); }
function dateLabel(date, withYear) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}
