// The Usage breakdown's trust footer, as a view model rather than markup.
//
// The footer answers two different kinds of question and they must not share a
// fate. `notes` are standing explanations — what the panel measures, what a
// cost metric is and is not — true of every window, so they may be folded away
// behind a disclosure. `warnings` are true only of *this* cohort and window:
// unpriced records, currency exclusions, excluded sources, stale coverage,
// unattributed tokens, undated records. A caveat a reader must open something
// to find is a caveat that was not made, so nothing in `warnings` is ever
// collapsible, and the split is by permanence, not by length.
//
// Pure and HTML-free, like `usage-filter-bar.js`: `app.js` owns the markup and
// injects its formatters, this owns what the markup says.

import { sourceRows, totalsDisclosure } from './provenance.js';
import { bucketMode, groupingMode, metricMode, unknownAttributionTokens } from './usage-breakdown.js';

export const BREAKDOWN_COPY = 'Usage grouped from normalized local session records. Tool and model totals are descriptive; jobs and adapter semantics may differ.';

/**
 * `format` carries the two renderers the copy needs (`tokens`, `money`), which
 * is the only thing this module borrows from the view.
 */
export function breakdownFooterModel({ breakdown, usage = {}, merge, currency, format }) {
  const cost = costLines(breakdown, currency, format);
  const notes = [BREAKDOWN_COPY, ...cost.notes];
  const warnings = [...cost.warnings];

  const disclosure = totalsDisclosure(merge);
  if (disclosure) warnings.push(disclosure);

  const unhealthy = sourceRows(merge?.sources || []).filter((row) => row.tone === 'amber' || row.tone === 'red');
  if (unhealthy.length) warnings.push(`Coverage caveats still apply to this view: ${unhealthy.map((row) => `${row.name} (${row.state.toLowerCase()}, report ${row.reportAge})`).join('; ')}.`);

  if (breakdown.series.some((group) => group.unknown)) {
    warnings.push(`${format.tokens(unknownAttributionTokens(breakdown))} tokens have no ${groupingMode(breakdown.groupBy).noun} attribution and stay visible as their own series.`);
  }
  if (breakdown.totals.unknownCostRecords) warnings.push(`${breakdown.totals.unknownCostRecords} of the ${breakdown.totals.records} records in view have unknown or unpriced cost.`);
  if (usage.undatedRecords) warnings.push(`${usage.undatedRecords} records carry no usable date (${format.tokens(usage.undatedTokens)} tokens) and cannot appear on the ${bucketMode(breakdown.bucket).noun} axis.`);

  return { notes, warnings };
}

/**
 * What a cost stack is and is not. The definition is standing copy; how much of
 * *this* window could actually be priced is not, so the counts stay visible
 * while the definition folds away.
 */
function costLines(breakdown, currency, format) {
  const mode = metricMode(breakdown.metric);
  if (mode.kind !== 'cost') return { notes: [], warnings: [] };
  const totals = breakdown.totals;
  const warnings = [];
  const notes = [`Estimated cost (${currency}) comes from the local pricing table, not from an invoice. It is not spend, and subscription spend is never included in record-level breakdowns. Native recorded cost stays visible per segment and in the all-time totals; it is not a stack of its own because too few records carry it.`];
  if (totals.unpricedRecords) warnings.push(`${totals.unpricedRecords} of the ${totals.records} records in view carry no ${mode.noun}; their tokens stay in the cohort and their cost stays unknown rather than being drawn as ${format.money(0, currency)}.`);
  if (totals.costExcludedRecords) warnings.push(`${totals.costExcludedRecords} records (${format.tokens(totals.costExcludedTokens)} tokens) come from a source whose costs were excluded for currency mismatch. Their tokens are counted; no converted ${currency} amount exists for them and none is invented.`);
  return { notes, warnings };
}
