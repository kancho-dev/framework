// Rollups derived from records, shared by the analyzer (which writes the local
// artifact) and the server (which re-derives them over merged records). One
// definition, because a daily total that disagreed between the two would be
// invisible until a user compared the widget with the dashboard.

export function dailyUsage(records) {
  const byDay = new Map();
  for (const record of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date || '')) continue;
    const current = byDay.get(record.date) || { date: record.date, tokens: 0, records: 0 };
    current.tokens += Number(record.totalTokens) || 0;
    current.records += 1;
    byDay.set(record.date, current);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * §8.1's By Workspace rollup. The displayed key is `machineId/workspaceId`:
 * `sourceKey` comes from merge, `workspaceId` from the producing machine's
 * scan-time attribution, and under §4.1 the rows sum exactly to the total.
 */
export function workspaceKey(record) {
  const machineId = record.sourceKey || 'unknown-machine';
  const workspaceId = record.workspaceId || 'unknown-workspace';
  return `${machineId}/${workspaceId}`;
}

export function summarize(normalized, daily, subscriptions, merge = null) {
  const records = normalized.records || [];
  const byMonth = group(records, (r) => (r.date || 'unknown').slice(0, 7));
  const monthly = [...byMonth.entries()].map(([month, rows]) => {
    const tokens = sum(rows, 'totalTokens');
    const recorded = sum(rows, 'recordedCost');
    const estimated = sum(rows, 'estimatedCost');
    const subscription = subscriptions.byMonth.find((m) => m.month === month)?.amount || 0;
    return { month, tokens, recordedCost: round(recorded), estimatedCost: round(estimated), subscriptionCost: subscription, effectiveSubscriptionPer1M: tokens ? round(subscription / (tokens / 1_000_000)) : null };
  }).sort((a, b) => a.month.localeCompare(b.month));
  return {
    generatedAt: normalized.generatedAt,
    workspaceRoot: normalized.workspaceRoot,
    analysis: aggregateAnalysis(normalized.analysis, merge),
    totals: {
      records: records.length,
      tokens: sum(records, 'totalTokens'),
      recordedCost: round(sum(records, 'recordedCost')),
      estimatedCost: round(sum(records, 'estimatedCost')),
      unknownCostRecords: records.filter(isUnknownCost).length,
      subscriptionCost: subscriptions.total,
    },
    warnings: [...warnings(normalized.warnings || [], records, subscriptions, normalized.analysis), ...(merge?.warnings || [])],
    byModel: rows(group(records, (r) => r.modelLabel || r.model || 'unknown-model')),
    bySource: rows(group(records, (r) => r.source || 'unknown-source')),
    byWorkspace: rows(group(records, workspaceKey)),
    merge,
    monthly,
    daily,
    subscriptions,
    topDrivers: sessionDrivers(records).slice(0, 12),
    topMessageDrivers: records.slice().sort(compareTopDrivers).slice(0, 12),
    trustIssues: trustIssues(records).slice(0, 50),
  };
}

// A currency-excluded record has no cost *by decision*, not for want of pricing
// (§5.7). Counting it as unknown/unpriced would report a deliberate exclusion
// as a data-quality problem.
function isUnknownCost(record) {
  return !record.costExcluded && record.recordedCost == null && record.estimatedCost == null;
}

function aggregateAnalysis(analysis, merge) {
  const base = analysis || { mode: 'unknown', limit: null, limitScope: 'unknown' };
  return merge?.coverageMode === 'limited' && base.mode !== 'limited' ? { ...base, mode: 'limited' } : base;
}

function trustIssues(records) {
  return records
    .filter((record) => isUnknownCost(record) || (record.warnings || []).length)
    .sort(compareTopDrivers)
    .map((record) => ({
      source: record.source,
      sourceKey: record.sourceKey,
      workspaceId: record.workspaceId,
      date: record.date,
      sessionId: record.sessionId,
      messageId: record.messageId,
      sessionRef: record.sessionRef,
      sessionBrowserPath: record.sessionBrowserPath,
      sessionTopicId: record.sessionTopicId,
      provider: record.provider,
      model: record.model,
      variant: record.variant,
      modelLabel: record.modelLabel,
      totalTokens: record.totalTokens,
      recordedCost: record.recordedCost,
      estimatedCost: record.estimatedCost,
      confidence: record.confidence,
      warnings: issueReasons(record),
    }));
}

function issueReasons(record) {
  const reasons = [...(record.warnings || [])];
  if (isUnknownCost(record) && !reasons.includes('unknown/unpriced cost')) reasons.push('unknown/unpriced cost');
  return reasons;
}

function topDriverCost(record) { return Math.max(Number(record.recordedCost) || 0, Number(record.estimatedCost) || 0); }
function compareTopDrivers(a, b) { return topDriverCost(b) - topDriverCost(a) || (Number(b.totalTokens) || 0) - (Number(a.totalTokens) || 0); }
function sessionDrivers(records) {
  const bySession = new Map();
  for (const record of records) {
    // Keyed by machine too: a session synced across two machines is two rows,
    // not one row wearing the first machine's provenance — which §8.2 would
    // then happily link, sending half its records to a local Session Browser.
    const key = `${record.sourceKey || 'unknown-machine'}:${record.source || 'unknown'}:${record.sessionId || record.sessionRef || 'unknown'}`;
    // §8.2 decides linkability per row, so a session rollup must keep the
    // provenance of the records it folded rather than losing it to the sum.
    const current = bySession.get(key) || { source: record.source, sourceKey: record.sourceKey, workspaceId: record.workspaceId, sessionId: record.sessionId, sessionRef: record.sessionRef, sessionBrowserPath: record.sessionBrowserPath, date: record.date, model: record.model, modelLabel: record.modelLabel, totalTokens: 0, recordedCost: 0, estimatedCost: 0, recordCount: 0, confidence: record.confidence };
    current.totalTokens += Number(record.totalTokens) || 0;
    current.recordedCost += Number(record.recordedCost) || 0;
    current.estimatedCost += Number(record.estimatedCost) || 0;
    current.recordCount += 1;
    current.date = [current.date, record.date].filter(Boolean).sort()[0] || null;
    current.modelLabel ||= record.modelLabel;
    current.model ||= record.model;
    if (current.confidence === 'unknown' && record.confidence) current.confidence = record.confidence;
    bySession.set(key, current);
  }
  return [...bySession.values()]
    .map((driver) => ({ ...driver, recordedCost: driver.recordedCost || null, estimatedCost: driver.estimatedCost || null }))
    .sort(compareTopDrivers);
}

function rows(map) { return [...map.entries()].map(([key, records]) => ({ key, records: records.length, tokens: sum(records, 'totalTokens'), recordedCost: round(sum(records, 'recordedCost')), estimatedCost: round(sum(records, 'estimatedCost')), unknown: records.filter(isUnknownCost).length })).sort((a, b) => b.tokens - a.tokens); }
function warnings(adapterWarnings, records, subscriptions, analysis = null) {
  const result = adapterWarnings.map((w) => `${w.source}: ${w.warning}`);
  if (analysis?.mode === 'limited') result.push(`Analysis is limited to the latest ${analysis.limit} sessions/files per source; totals are not full-history.`);
  const unknown = records.filter(isUnknownCost).length;
  if (unknown) result.push(`${unknown} records have unknown/unpriced cost`);
  const unpriced = records.filter((r) => (r.warnings || []).includes('unpriced model')).length;
  if (unpriced) result.push(`${unpriced} records use unpriced models`);
  const currencies = subscriptions?.currencies || [];
  if (currencies.length > 1) result.push(`Subscription records use multiple currencies (${currencies.join(', ')}); token estimates are USD pricing-table estimates, so subscription totals are not directly comparable until records are normalized manually.`);
  else if (currencies.length === 1 && currencies[0] !== 'USD') result.push(`Subscription records are in ${currencies[0]} while token estimates are USD pricing-table estimates; compare trends only, not combined totals, until subscription records are manually converted to USD.`);
  return result;
}
function group(items, keyFn) { const map = new Map(); for (const item of items) { const key = keyFn(item); if (!map.has(key)) map.set(key, []); map.get(key).push(item); } return map; }
function sum(items, field) { return items.reduce((total, item) => total + (Number(item[field]) || 0), 0); }
export function round(value) { return Math.round((Number(value) || 0) * 1000000) / 1000000; }
