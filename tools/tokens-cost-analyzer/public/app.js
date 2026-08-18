import { createDailyUsageHeatmap } from '/shared/browser/daily-usage-heatmap.js';
import { escapeHtml } from '/shared/browser/dom.js';
import { formatDateTime, formatTokens, money } from '/shared/browser/format.js';
import { sessionBrowserHrefFor, storeSessionBrowserSelection } from '/shared/browser/session-links.js';
import { provenanceLabel, scopeMismatchWarning, sessionLinkFor, sourceRows, totalsDisclosure } from './provenance.js';
import { BUCKETS, buildUsageBreakdown, bucketMode, dailySeries, DEFAULT_BUCKET, DEFAULT_GROUPING, DEFAULT_METRIC, GROUPINGS, isCostMetric, METRICS, metricMode, metricValue, OTHER, seriesSlots, unpricedRecords, usageFilterOptions, zeroMetricCopy } from './usage-breakdown.js';
import { createMorphCommit } from '/shared/browser/refresh-commit.js';
import { createRefreshCoordinator } from '/shared/refresh-coordinator.mjs';
import { breakdownFooterModel } from './breakdown-footer.js';
import { createFilterPopovers } from './filter-popovers.js';
import { filterBarModel, panelFilterState } from './usage-filter-bar.js';
import { persistUsageFilters, restoreUsageFilters } from './usage-filter-continuity.js';
import { refreshStatus, reportRequestUrl, startAutomaticRefresh, statusRequestUrl } from './refresh.js';
import { createSourceStatusPoller } from './source-status.js';
import { workspaceFilterForTool } from '/shared/browser/workspace-tools.js';

const AUTO_REFRESH_MS = 10 * 60 * 1000;
// The shared machine/workspace cohort lives outside the DOM because the report
// is committed by morphing a freshly rendered tree: a selection read back from
// the markup would not survive a background refresh.
const state = {
  data: null,
  usageFilters: { sources: new Set(), models: new Set(), machineIds: new Set(), workspaceKeys: new Set() },
  usageFilterScope: null,
  // Bucket, grouping, and metric are the breakdown's own controls, not part of
  // the shared cohort: they change how this one panel composes the same records.
  // `offset` counts whole windows back from the latest one.
  breakdown: { bucket: DEFAULT_BUCKET, groupBy: DEFAULT_GROUPING, metric: DEFAULT_METRIC, offset: 0 },
  // The footer disclosure is DOM state the morph would discard, so like the
  // breakdown's own controls it is held here: a reader who opened the
  // explanation must not have it shut on them by a background refresh.
  footerNoteOpen: false,
};
const dailyUsageHeatmap = createDailyUsageHeatmap({ showYearSwitcher: true });
const $ = (selector, root = document) => root.querySelector(selector);
const workspaceEl = $('#workspace-name');
const reportEl = $('#report');
const tokenAnalyzerWorkspaceFilter = workspaceFilterForTool('tokens-cost-analyzer');
window.FrameworkWorkspaceBadge?.set(workspaceEl, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace', workspaceFilter: tokenAnalyzerWorkspaceFilter });
$('#refresh').addEventListener('click', () => refresh.request({ reason: 'manual', force: true }));
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-session-browser-path]');
  if (!link) return;
  // The selection is scoped by workspace root, so a cross-workspace link
  // must store it under the *target* root or the session opens in the wrong one.
  storeSessionBrowserSelection(link.dataset.sessionBrowserPath, link.dataset.sessionTopicId, { workspaceRoot: link.dataset.workspaceRoot || state.data?.workspaceRoot });
});
const commitReport = createMorphCommit({
  root: reportEl,
  render: ({ data }) => {
    state.data = data;
    restoreUsageFilterState(data.workspaceRoot);
    const next = reportEl.cloneNode(true);
    render(data, next);
    return next;
  },
});
const refresh = createRefreshCoordinator({
  fetchData: fetchReport,
  onStatus: ({ phase, error }) => {
    const statusEl = $('#status');
    const status = refreshStatus(phase, error);
    statusEl.textContent = status.text;
    statusEl.classList.toggle('hidden', !status.visible);
  },
});
// The per-source labels are kept current by the cheap status endpoint,
// and the expensive report request happens once, when the last flight settles.
const sourceStatus = createSourceStatusPoller({
  fetchStatus: async () => {
    const res = await fetch(statusRequestUrl(location.search));
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  },
  onUpdate: applyInFlight,
  onSettled: () => refresh.request({ reason: 'poll' }),
});
refresh.registerCommitUnit({
  key: 'report',
  commit: async (transaction) => {
    await commitReport(transaction);
    const data = transaction.data;
    dailyUsageHeatmap.bind($('#daily-usage'));
    window.FrameworkWorkspaceBadge?.set(workspaceEl, { root: data.workspaceRoot, tooltipPrefix: 'Workspace', workspaceFilter: tokenAnalyzerWorkspaceFilter });
    // Per-source ages and coverage replace the old single-report status line.
    $('#status').classList.add('hidden');
    sourceStatus.sync(data.merge?.sources || []);
  },
});

/**
 * Only the flag is taken from a poll. Every number on the page — the
 * totals, the charts, the per-source Records column — keeps coming from the
 * last complete merged snapshot, so nothing on screen is ever assembled from a
 * subset of machines. The status payload's own record count is pre-dedup and
 * deliberately ignored here for the same reason.
 */
function applyInFlight(sources) {
  const rows = state.data?.merge?.sources;
  if (!rows) return;
  const inFlight = new Set(sources.filter((source) => source.refreshing).map((source) => source.id));
  state.data.merge.sources = rows.map((row) => ({ ...row, refreshing: !row.isLocal && inFlight.has(row.id) }));
  renderSourceCard(state.data.merge, reportEl);
}
refresh.request({ reason: 'initial' });
startAutomaticRefresh(refresh, AUTO_REFRESH_MS);

async function fetchReport({ signal, force, reason }) {
  const res = await fetch(reportRequestUrl(location.search, { force, reason }), { signal });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function render(data, root = document) {
  renderWarnings([...(data.warnings || []), scopeMismatchWarning(data.linkTargets)].filter(Boolean), root);
  renderSourceCard(data.merge, root);
  renderTotals(data.totals, data.subscriptions?.currency || 'EUR', root);
  renderMonthly(data.monthly || [], data.subscriptions?.currency || 'EUR', root);
  renderFilteredUsage(data, root);
  renderBars('#subscription-chart', (data.subscriptions?.byService || []).slice(0, 8).map((r) => ({ key: r.service, amount: r.amount })), 'amount', (row) => money(row.amount, data.subscriptions?.currency || 'EUR'), root);
  renderDrivers('#drivers', data.topDrivers || [], root);
  renderDrivers('#message-drivers', data.topMessageDrivers || [], root);
  renderTrustInspector(data.trustIssues || [], root);
}

function renderWarnings(warnings, root) {
  const el = $('#warnings', root);
  el.classList.toggle('hidden', warnings.length === 0);
  el.innerHTML = warnings.length ? `<strong>Trust flags</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
}

function renderSourceCard(merge, root) {
  const disclosure = totalsDisclosure(merge);
  $('#totals-disclosure', root).textContent = disclosure || '';
  $('#source-card', root).innerHTML = sourceRows(merge?.sources || []).map((row) => `<article class="source-row ${row.tone}${row.refreshing ? ' refreshing' : ''}">
      <div class="source-row-head">
        <div class="source-name"><strong title="${escapeHtml(row.key)}">${escapeHtml(row.name)}</strong><span class="source-identity">${escapeHtml(row.identity)}</span>${row.note ? `<span class="source-note ${row.noteTone}" title="${escapeHtml(row.note)}">${escapeHtml(row.note)}</span>` : ''}</div>
        <span class="source-state"><i class="dot ${row.tone}"></i>${escapeHtml(row.state)}${row.refreshing ? '<em class="source-refreshing">Refreshing…</em>' : ''}</span>
      </div>
      <div class="source-facts">
        <div class="source-fact"><span>Report</span><strong title="${escapeHtml(row.generatedAt ? formatDateTime(row.generatedAt) : '')}">${escapeHtml(row.reportAge || 'unknown')}</strong></div>
        <div class="source-fact"><span>Connection</span><strong title="${escapeHtml(row.lastSuccessAt ? formatDateTime(row.lastSuccessAt) : '')}">${escapeHtml(row.fetchLabel)}</strong></div>
        <div class="source-fact"><span>Contribution</span><strong>${row.records} ${row.records === 1 ? 'record' : 'records'}</strong></div>
      </div>
    </article>`).join('') || '<p class="status">No sources.</p>';
}

function renderTotals(totals, subCurrency, root) {
  $('#totals', root).innerHTML = [
    metric('Tokens', formatTokens(totals.tokens), `${totals.records} normalized records`),
    metric('Recorded cost', money(totals.recordedCost, 'USD'), 'native tool/provider facts'),
    metric('Estimated cost', money(totals.estimatedCost, 'USD'), 'local pricing table'),
    metric('Subscriptions', money(totals.subscriptionCost, subCurrency), 'private monthly spend'),
    metric('Unknown cost', String(totals.unknownCostRecords), 'records needing attention'),
  ].join('');
}

function renderMonthly(monthly, currency, root) {
  const max = Math.max(1, ...monthly.map((m) => m.estimatedCost + m.subscriptionCost));
  const recent = monthly.slice(-18);
  $('#monthly-chart', root).innerHTML = recent.map((m) => {
    const estimated = barHeight(m.estimatedCost, max);
    const subscription = barHeight(m.subscriptionCost, max);
    const totalHeight = Math.min(100, estimated + subscription);
    return `<div class="month" title="${m.month}\nToken usage ${formatTokens(m.tokens)}\nEstimated token cost ${money(m.estimatedCost, 'USD')}\nNative recorded cost ${money(m.recordedCost, 'USD')}\nSubscriptions ${money(m.subscriptionCost, currency)}\nEffective subscription / 1M tokens ${m.effectiveSubscriptionPer1M == null ? 'unknown' : money(m.effectiveSubscriptionPer1M, currency)}">
      <div class="stack">
        <span class="token-label" style="bottom:${totalHeight}%">${unitMarkup(formatTokens(m.tokens))}</span>
        <div class="seg subscription" style="height:${subscription}%">${m.subscriptionCost > 0 ? `<span>${compactCurrency(m.subscriptionCost, currency)}</span>` : ''}</div>
        <div class="seg estimated" style="height:${estimated}%">${m.estimatedCost > 0 ? `<span>${compactCurrency(m.estimatedCost, 'USD')}</span>` : ''}</div>
      </div>
      <label>${m.month}</label>
    </div>`;
  }).join('');
}

// The warning yellow is deliberately absent: it belongs to Unknown alone, and a
// tool wearing it would read as a data-quality flag.
const SERIES_COLORS = ['#9cdcfe', '#7ee787', '#c678dd', '#ff9f7b', '#79c0ff', '#f78bd2', '#8ddfd0', '#b3a4ff'];
const OTHER_COLOR = '#6b7280';
const UNKNOWN_COLOR = '#f2cc60';

/**
 * Slots come from the pure module; this only maps a slot to a colour. `Other`
 * and `Unknown` keep reserved colours so neither can be mistaken for a tool.
 */
function seriesColor(group, slots) {
  if (group.key === OTHER) return OTHER_COLOR;
  if (group.unknown) return UNKNOWN_COLOR;
  return SERIES_COLORS[(slots.get(group.key) ?? 0) % SERIES_COLORS.length];
}

/**
 * The views that follow the shared cohort. They are rendered together, from one
 * filter selection and one cell set, so the heatmap and the breakdown can never
 * be looking at different subsets of the records.
 */
function renderFilteredUsage(data, root) {
  const usage = data.usage || { cells: [], undatedTokens: 0, undatedRecords: 0 };
  const filters = selectedFilters();
  const model = filterBarModel(usageFilterOptions(usage.cells), state.usageFilters);
  renderFilterBar(model, root);
  // The heatmap's own summary statistics are derived from the rows it is given,
  // so the chart and the averages beside it describe the same cohort.
  dailyUsageHeatmap.render($('#daily-usage', root), dailySeries(usage.cells, filters));
  renderUsageBreakdown(data, usage, filters, root);
}

/**
 * The analysis-context bar. Both the per-facet triggers and the narrow-screen
 * combined trigger are rendered every time from one model, so the two never
 * disagree about what is selected; CSS decides which is on screen.
 */
function renderFilterBar(model, root) {
  const state_ = panelFilterState(model);
  // The bar is addressed in the live document, never in `root`: it lives in the
  // sticky header, and only `#report` is rendered detached and morphed in.
  for (const facet of model.facets) {
    $(`#usage-filter-${facet.name}-trigger`).innerHTML = triggerContent(facet, model);
    $(`#usage-filter-${facet.name}s`).innerHTML = optionListHtml(facet, model);
  }
  $('#usage-filter-all-trigger').innerHTML = triggerContent(model.combined, model);
  $('#usage-filter-all').innerHTML = model.facets.map((facet) => optionListHtml(facet, model, true)).join('');
  $('#usage-filter-active-trigger').innerHTML = `<span>Filters · <span class="filter-count">${model.count}</span></span><i class="chevron" aria-hidden="true"></i><span class="sr-only"> active</span>`;
  $('#usage-filter-active').innerHTML = activeFilterHtml(model);
  $('#usage-filter-clear').disabled = !model.active;
  for (const selector of ['#daily-filter-state', '#breakdown-filter-state']) {
    const el = $(selector, root);
    el.classList.toggle('hidden', !state_.active);
    if (!state_.active) continue;
    el.title = state_.title;
    el.textContent = state_.label;
  }
}

// The trigger says what the control is and what is selected before it is
// opened; the chevron says it opens. `title` carries the one scope statement.
function triggerContent(facet, model) {
  return `<span>${escapeHtml(facet.label)}</span><i class="chevron" aria-hidden="true"></i><span class="sr-only">${escapeHtml(model.affects)}</span>`;
}

function optionListHtml(facet, model, withHeading = false) {
  const heading = `<div class="filter-options-head">${escapeHtml(withHeading ? facet.title : 'Select any')}<span title="${escapeHtml(model.affects)}">${escapeHtml(model.totalsLabel)}</span></div>`;
  const rows = facet.options.map((option) => `<label class="filter-option${option.stale ? ' stale' : ''}"><input type="checkbox" data-breakdown-filter="${facet.name}" value="${escapeHtml(option.value)}"${option.checked ? ' checked' : ''}><span title="${escapeHtml(option.label)}">${escapeHtml(option.label)}</span><em>${option.stale ? 'not in report' : formatTokens(option.tokens)}</em></label>`).join('');
  return heading + (rows || '<p class="status">No values.</p>');
}

function chipHtml(chip) {
  return `<button type="button" class="filter-chip${chip.stale ? ' stale' : ''}" data-filter-chip="${chip.name}" value="${escapeHtml(chip.value)}" title="${escapeHtml(chip.remove)}" aria-label="${escapeHtml(chip.remove)}">${escapeHtml(chip.label)}<i aria-hidden="true">×</i></button>`;
}

function activeFilterHtml(model) {
  if (!model.active) return `<p class="active-filter-empty">No active filters</p>`;
  return model.activeGroups.map((group) => `<section class="active-filter-group"><h3>${escapeHtml(group.title)}</h3><div class="active-filter-chips">${group.chips.map(chipHtml).join('')}</div></section>`).join('');
}

function renderUsageBreakdown(data, usage, filters, root) {
  const { bucket, groupBy, metric, offset } = state.breakdown;
  const breakdown = buildUsageBreakdown(usage.cells, { bucket, groupBy, metric, offset, ...filters });
  const slots = seriesSlots(usage.cells, groupBy);
  const currency = costCurrency(data.merge);
  renderBreakdownControls(breakdown, currency, root);
  renderBreakdownChart(breakdown, slots, currency, root);
  renderBreakdownLegend(breakdown, slots, currency, root);
  renderBreakdownFooter(breakdownFooterModel({ breakdown, usage, merge: data.merge, currency, format: { tokens: formatTokens, money } }), root);
}

/**
 * The currency of the *estimate*, taken from the local source rather than
 * assumed: merge excludes costs from sources that disagree with it, so it is
 * the only currency that can appear in a record-level stack. Subscription
 * currency is deliberately not consulted; it never enters this panel.
 */
function costCurrency(merge) {
  return (merge?.sources || []).find((source) => source.isLocal)?.currency || 'USD';
}

/** The selected metric, formatted. Money is never printed for token counts. */
function formatMetric(amount, metric, currency) {
  return isCostMetric(metric) ? money(amount, currency) : formatTokens(amount);
}
function metricText(entry, metric, currency) { return formatMetric(metricValue(entry, metric), metric, currency); }

/**
 * Bucket and grouping are segmented choices rather than menus: there are three
 * of each, and a control the reader can see the alternatives of explains the
 * chart better than one that hides them. The range is text, not a control —
 * each grain has one deterministic window.
 */
function renderBreakdownControls(breakdown, currency, root) {
  // Each metric carries its own definition on the option itself rather than in a
  // permanent note beside the control: the sentence only matters while the reader
  // is choosing, and only for the option under the pointer or the focus ring.
  $('#breakdown-metric', root).innerHTML = segmentedHtml('metric', METRICS, state.breakdown.metric, (value) => metricNote(value, currency));
  $('#breakdown-bucket', root).innerHTML = segmentedHtml('bucket', BUCKETS, state.breakdown.bucket);
  $('#breakdown-group', root).innerHTML = segmentedHtml('group', GROUPINGS, state.breakdown.groupBy);
  // The window is always spelled out; the grain's own phrasing is kept only for
  // the latest window, where "last 24 weeks" is the thing the reader asked for.
  const mode = bucketMode(breakdown.bucket);
  $('#breakdown-range', root).textContent = breakdown.navigation.isLatest
    ? `${mode.rangeLabel} · ${breakdown.rangeLabel}`
    : breakdown.rangeLabel;
  renderBreakdownNav(breakdown, mode, root);
}

/**
 * `Previous` steps one whole window and never skips an empty one, so it stays
 * available whenever any earlier usage exists in the current cohort — an empty
 * historical window is an answer, not a dead end. `Next`/`Latest` do nothing on
 * the latest window; there is nothing after it to reach.
 *
 * All three are always rendered and disabled when unavailable, never removed:
 * a control that vanishes moves the two beside it, so the button under the
 * pointer changes identity between clicks.
 */
function renderBreakdownNav(breakdown, mode, root) {
  const { canPrevious, canNext } = breakdown.navigation;
  const step = `${mode.count} ${mode.noun}${mode.count === 1 ? '' : 's'}`;
  $('#breakdown-nav', root).innerHTML = [
    navButton('previous', '‹ Previous', canPrevious ? `Back one whole window of ${step}` : 'No earlier usage in this cohort', canPrevious),
    navButton('next', 'Next ›', canNext ? `Forward one whole window of ${step}` : 'Already at the latest window', canNext),
    navButton('latest', 'Latest', canNext ? `Return to the ${mode.rangeLabel}` : 'Already at the latest window', canNext),
  ].join('');
}

function navButton(action, label, title, enabled) {
  return `<button type="button" class="nav-step" data-breakdown-nav="${action}" title="${escapeHtml(title)}"${enabled ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(label)}</button>`;
}

function segmentedHtml(name, modes, selected, help) {
  return Object.entries(modes).map(([value, mode]) => {
    // The help text is inside the button, not an `aria-label`: a label would
    // replace the visible word, and a pointer tooltip alone reaches nobody
    // driving this with a keyboard or a screen reader.
    const text = help?.(value, mode);
    return `<button type="button" class="segment${value === selected ? ' selected' : ''}" data-breakdown-${name}="${value}"${text ? ` title="${escapeHtml(text)}"` : ''} aria-pressed="${value === selected}">${escapeHtml(mode.label)}${text ? `<span class="sr-only"> — ${escapeHtml(text)}</span>` : ''}</button>`;
  }).join('');
}

/**
 * The metric's own note, which is where the currency is stated. A cost stack
 * without a visible currency invites the reader to supply their own.
 */
function metricNote(metric, currency) {
  const mode = metricMode(metric);
  return mode.kind === 'cost' ? `${mode.note} · ${currency}` : mode.note;
}

function renderBreakdownChart(breakdown, slots, currency, root) {
  const el = $('#breakdown-chart', root);
  const mode = bucketMode(breakdown.bucket);
  const window_ = breakdown.navigation.isLatest ? mode.rangeLabel : breakdown.rangeLabel;
  if (breakdown.empty) {
    const escape = breakdown.navigation.canPrevious ? ' Earlier usage exists — use Previous to step back.' : '';
    el.innerHTML = `<p class="status">No records match these filters in the ${escapeHtml(window_)}. Clear a filter or change the bucket to widen the view.${escape}</p>`;
    return;
  }
  // A zero-valued window has nothing to stack whether that zero is real or
  // unavailable. `zeroMetricCopy` names which one; availability is not inferred
  // from the sum.
  if (breakdown.metricTotal === 0) {
    const why = zeroMetricCopy(breakdown, window_, (metric) => (isCostMetric(metric) ? money(0, currency) : `${formatTokens(0)} tokens`));
    el.innerHTML = `<p class="status">${escapeHtml(why)} Switch metric to see this usage.</p>`;
    return;
  }
  const max = Math.max(1, ...breakdown.bucketTotals);
  const metric = breakdown.metric;
  el.innerHTML = breakdown.buckets.map((bucket, position) => {
    const total = breakdown.bucketTotals[position];
    const segments = breakdown.series.map((group) => ({ group, value: group.values[position] })).filter((entry) => metricValue(entry.value, metric) > 0);
    const stack = segments.map(({ group, value }) => `<div class="seg" style="height:${(metricValue(value, metric) / max) * 94}%;background:${seriesColor(group, slots)}" title="${escapeHtml(segmentTitle(bucket, mode, group.key, value, total, metric, currency))}"></div>`).join('');
    // The bar's own total, above the stack, in the metric being drawn — the same
    // idiom as the monthly cockpit. An empty bucket gets no label: a `0` on an
    // absent bar is noise, and the gap is already the answer.
    const totalLabel = total > 0 ? `<span class="token-label" style="bottom:${(total / max) * 94}%">${unitMarkup(barTotalLabel(total, metric, currency))}</span>` : '';
    const label = `<label>${escapeHtml(bucket.label)}</label>`;
    return `<div class="month" title="${escapeHtml(`${bucket.range}\n${formatMetric(total, metric, currency)} total`)}">
      <div class="stack">${totalLabel}${stack}</div>${label}
    </div>`;
  }).join('');
}

/**
 * The tooltip carries both costs whichever metric is drawn, because the question
 * a cost stack provokes is "compared to what". Missing values are named
 * unavailable rather than shown as zero money, and a currency exclusion is
 * reported as its own line so it is not read as a pricing gap.
 */
function segmentTitle(bucket, mode, key, value, bucketTotal, metric, currency) {
  const unpriced = unpricedRecords(value, metric);
  return [
    bucket.range,
    `${key}: ${metricText(value, metric, currency)} ${metricMode(metric).noun}`,
    `${bucketTotal ? Math.round((metricValue(value, metric) / bucketTotal) * 100) : 0}% of the ${mode.noun} · ${value.records} records`,
    `tokens: ${formatTokens(value.tokens)}`,
    `recorded cost: ${costText(value, 'recordedCost', currency)}`,
    `estimated cost: ${costText(value, 'estimatedCost', currency)}`,
    `${value.unknownCostRecords} records with unknown/unpriced cost`,
    ...(unpriced ? [`${unpriced} records carry no ${metricMode(metric).noun}`] : []),
    ...(value.costExcludedRecords ? [`${value.costExcludedRecords} records excluded from cost for currency mismatch (${formatTokens(value.costExcludedTokens)} tokens still counted)`] : []),
    `machines: ${value.machines.join(', ')}`,
    `workspaces: ${value.workspaces.join(', ')}`,
  ].join('\n');
}

// `$0.00` is a claim that something was free; a record with no priced cost has
// not made that claim, so the absence is spelled out.
function costText(value, field, currency) {
  const priced = Number(value[field === 'recordedCost' ? 'recordedCostRecords' : 'estimatedCostRecords']) || 0;
  return priced ? money(value[field], currency) : 'unavailable';
}

/**
 * A series whose records carry no price is labelled unpriced, not `$0.00`: the
 * legend is where a reader compares tools, and a formatted zero there would
 * read as the cheapest tool rather than as the one nothing could price.
 */
function renderBreakdownLegend(breakdown, slots, currency, root) {
  const metric = breakdown.metric;
  const groups = breakdown.series.map((group) => {
    const value = seriesPriced(group, metric) ? formatMetric(group.total, metric, currency) : `unpriced · ${formatTokens(group.tokens)} tokens`;
    return `<span title="${escapeHtml(`${formatTokens(group.tokens)} tokens · ${group.totals.records} records`)}"><i class="dot" style="background:${seriesColor(group, slots)}"></i>${escapeHtml(group.key)} · ${escapeHtml(value)}</span>`;
  }).join('');
  const total = breakdown.metricUnavailable ? 'unavailable' : formatMetric(breakdown.metricTotal, metric, currency);
  $('#breakdown-legend', root).innerHTML = `${groups}<strong class="breakdown-total" title="Selected window total">Total · ${escapeHtml(total)}</strong>`;
}

function seriesPriced(group, metric) {
  return !isCostMetric(metric) || (Number(group.totals?.[metricMode(metric).records]) || 0) > 0;
}

/**
 * Standing explanations fold away; anything true only of *this* cohort stays on
 * screen. A caveat a reader has to open a disclosure to find is a caveat that
 * was not made, so the split is by permanence, not by length.
 */
function renderBreakdownFooter({ notes, warnings }, root) {
  const paragraphs = (lines) => lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  $('#breakdown-footer', root).innerHTML = [
    notes.length ? `<details class="footer-note" data-footer-note${state.footerNoteOpen ? ' open' : ''}><summary>How to read these numbers</summary>${paragraphs(notes)}</details>` : '',
    paragraphs(warnings),
  ].join('');
}

function nextOffset(offset, action) {
  if (action === 'latest') return 0;
  if (action === 'next') return Math.max(0, offset - 1);
  return offset + 1;
}

function selectedFilters() {
  return { sources: [...state.usageFilters.sources], models: [...state.usageFilters.models], machineIds: [...state.usageFilters.machineIds], workspaceKeys: [...state.usageFilters.workspaceKeys] };
}
function restoreUsageFilterState(scope) {
  if (state.usageFilterScope === scope) return;
  state.usageFilterScope = scope;
  state.usageFilters = restoreUsageFilters(localStorage, scope) || { sources: new Set(), models: new Set(), machineIds: new Set(), workspaceKeys: new Set() };
}
function saveUsageFilterState() { persistUsageFilters(localStorage, state.usageFilterScope, state.usageFilters); }
const FACET_SETS = { source: 'sources', model: 'models', machine: 'machineIds', workspace: 'workspaceKeys' };
function facetSet(name) { return state.usageFilters[FACET_SETS[name]]; }

document.addEventListener('change', (event) => {
  const input = event.target.closest('[data-breakdown-filter]');
  if (!input || !state.data) return;
  const selected = facetSet(input.dataset.breakdownFilter);
  if (input.checked) selected.add(input.value); else selected.delete(input.value);
  saveUsageFilterState();
  renderFilteredUsage(state.data, document);
});
// Delegated for the same reason the session links are: a refresh commits a
// morphed tree, and a listener bound to today's button node may not survive it.
document.addEventListener('click', (event) => {
  popovers.outsideClick(event.target);
  if (!state.data) return;
  const chip = event.target.closest('[data-filter-chip]');
  if (chip) {
    facetSet(chip.dataset.filterChip).delete(chip.getAttribute('value'));
    saveUsageFilterState();
    renderFilteredUsage(state.data, document);
    return;
  }
  const segment = event.target.closest('[data-breakdown-bucket],[data-breakdown-group],[data-breakdown-metric],[data-breakdown-nav]');
  if (segment) {
    if (segment.disabled) return;
    const { breakdownBucket, breakdownGroup, breakdownMetric, breakdownNav } = segment.dataset;
    // Changing the grain returns to the latest window. Window N of weeks has no
    // honest counterpart in months, and silently landing somewhere unrelated is
    // worse than the one predictable place the reader can always name.
    if (breakdownBucket) Object.assign(state.breakdown, { bucket: breakdownBucket, offset: 0 });
    else if (breakdownGroup) state.breakdown.groupBy = breakdownGroup;
    // Metric changes what is measured, not which records are in view, so the
    // window stays put: the reader is comparing the same period's cost.
    else if (breakdownMetric) state.breakdown.metric = breakdownMetric;
    else state.breakdown.offset = nextOffset(state.breakdown.offset, breakdownNav);
    renderFilteredUsage(state.data, document);
    return;
  }
  if (!event.target.closest('#usage-filter-clear')) return;
  for (const key of Object.values(FACET_SETS)) state.usageFilters[key].clear();
  saveUsageFilterState();
  renderFilteredUsage(state.data, document);
});

const popovers = createFilterPopovers({
  menus: () => [...document.querySelectorAll('[data-facet-menu]')],
  focusTrigger: (menu) => menu.querySelector('summary')?.focus(),
});
// `toggle` does not bubble, so the one place to hear every menu is the capture
// phase; a menu that just opened closes the others.
document.addEventListener('toggle', (event) => {
  const menu = event.target.closest?.('[data-facet-menu]');
  if (menu?.open) popovers.exclusive(menu);
  const note = event.target.closest?.('[data-footer-note]');
  if (note) state.footerNoteOpen = note.open;
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && popovers.escape()) event.preventDefault();
});

function renderBars(selector, rows, field, labelFn, root) {
  const max = Math.max(1, ...rows.map((r) => Number(r[field]) || 0));
  $(selector, root).innerHTML = rows.map((row) => `<div class="bar-row"><div class="name" title="${escapeHtml(row.key)}">${escapeHtml(row.key)}</div><div class="bar"><div class="fill" style="width:${Math.max(2, ((Number(row[field]) || 0) / max) * 100)}%"></div></div><div class="amount">${labelFn(row)}</div></div>`).join('') || '<p class="status">No data yet.</p>';
}

/**
 * A row links only when this Cockpit can actually reach the session, and
 * a cross-workspace link carries `?workspace=<id>` so the Session Browser opens
 * in the target workspace rather than reinterpreting the path in this one.
 */
function sessionLinkAttributes(record) {
  const link = sessionLinkFor(record, {
    machineId: state.data?.linkTargets?.machineId,
    workspaces: state.data?.linkTargets?.workspaces || [],
    workspaceRoot: state.data?.workspaceRoot,
    cockpitWorkspaces: window.__FRAMEWORK_COCKPIT__?.workspaces || [],
  }, (row) => sessionBrowserHrefFor(row, { fallbackRoute: '../sessions/' }));
  if (!link) return null;
  return `href="${escapeHtml(link.href)}" data-session-browser-path="${escapeHtml(record.sessionBrowserPath)}" data-session-topic-id="${escapeHtml(record.sessionTopicId || '')}" data-workspace-root="${escapeHtml(link.root)}"`;
}

// A top-drivers table is scanned, not read, so an
// unmarked row would be assumed local.
function provenanceMarker(record) {
  return `<span class="pill provenance" title="${escapeHtml(provenanceLabel(record))}">${escapeHtml(record.workspaceId || 'unknown-workspace')}</span>`;
}

function renderTrustInspector(issues, root) {
  const panel = $('#trust-inspector-panel', root);
  const el = $('#trust-inspector', root);
  panel.classList.toggle('hidden', issues.length === 0);
  el.innerHTML = issues.map((issue) => {
    const model = issue.modelLabel || issue.model || 'unknown-model';
    const link = sessionLinkAttributes(issue);
    const title = `${issue.source || 'unknown'} · ${issue.date || 'unknown'} · ${model}`;
    const reasons = (issue.warnings || []).map((warning) => `<span class="pill warn">${escapeHtml(warning)}</span>`).join('');
    const details = `<div class="inspector-main"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><small>${escapeHtml(issue.sessionRef || issue.sessionId || '')}${issue.messageId ? ` · message ${escapeHtml(issue.messageId)}` : ''}</small></div><div class="pills">${provenanceMarker(issue)}<span class="pill">${formatTokens(issue.totalTokens || 0)}</span>${reasons}<span class="pill">alias ${escapeHtml(issue.model || 'unknown')}</span></div>`;
    return link ? `<a class="inspector-row" ${link}>${details}</a>` : `<article class="inspector-row">${details}</article>`;
  }).join('');
}

function renderDrivers(selector, drivers, root) {
  $(selector, root).innerHTML = drivers.map((r) => {
    const model = r.modelLabel || r.model || 'unknown-model';
    const count = r.recordCount ? `<span class="pill">${r.recordCount} records</span>` : '';
    const body = `<div class="driver-top"><span>${escapeHtml(r.date || 'unknown')}</span><span>${escapeHtml(r.source || '')}</span></div><strong title="${escapeHtml(model)}">${escapeHtml(model)}</strong><div class="pills">${provenanceMarker(r)}<span class="pill">${formatTokens(r.totalTokens || 0)}</span><span class="pill">recorded ${money(r.recordedCost, 'USD')}</span><span class="pill ${r.estimatedCost == null ? 'warn' : ''}">estimated ${money(r.estimatedCost, 'USD')}</span>${count}<span class="pill ${r.confidence === 'unknown' ? 'warn' : ''}">${escapeHtml(r.confidence || 'unknown')}</span></div>`;
    const link = sessionLinkAttributes(r);
    return link ? `<a class="driver driver-link" ${link} title="Open in Session Browser">${body}</a>` : `<article class="driver">${body}</article>`;
  }).join('');
}

function metric(label, value, note) { return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
/**
 * Compact by construction: 24 bars cannot each carry `$1,234.56`. Tokens
 * already compact themselves above a million; money is compacted here so a
 * dense window keeps its labels readable and its bars distinguishable. The
 * exact amount stays one hover away in the bar's own tooltip.
 */
function barTotalLabel(total, metric, currency) {
  return isCostMetric(metric) ? compactCurrency(total, currency) : formatTokens(total);
}

/**
 * A compact total's magnitude suffix, set apart from its digits. In a monospace
 * face at chart size `1.3B` reads as `1.38`, which is a chart that lies by a
 * factor of a billion; the suffix gets its own gap and its own weight so it can
 * only be read as a unit. Anything without a trailing letter passes through.
 */
function unitMarkup(label) {
  const [, digits, unit] = /^(.*?)([A-Za-z]+)$/.exec(label) || [];
  return unit ? `${escapeHtml(digits)}<i>${escapeHtml(unit)}</i>` : escapeHtml(label);
}

function compactCurrency(value, currency) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 1 }).format(amount);
}
function barHeight(value, max) {
  const amount = Number(value) || 0;
  if (amount <= 0) return 0;
  return 7 + (amount / Math.max(1, max)) * 72;
}
