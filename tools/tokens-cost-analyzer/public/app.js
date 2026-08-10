import { createDailyUsageHeatmap } from '/shared/browser/daily-usage-heatmap.js';
import { escapeHtml } from '/shared/browser/dom.js';
import { formatDateTime, formatTokens, money } from '/shared/browser/format.js';
import { sessionBrowserHrefFor, storeSessionBrowserSelection } from '/shared/browser/session-links.js';
import { provenanceLabel, scopeMismatchWarning, sessionLinkFor, sourceRows, totalsDisclosure } from './provenance.js';
import { createMorphCommit } from '/shared/browser/refresh-commit.js';
import { createRefreshCoordinator } from '/shared/refresh-coordinator.mjs';
import { refreshStatus, reportRequestUrl, startAutomaticRefresh, statusRequestUrl } from './refresh.js';
import { createSourceStatusPoller } from './source-status.js';

const AUTO_REFRESH_MS = 10 * 60 * 1000;
const state = { data: null };
const dailyUsageHeatmap = createDailyUsageHeatmap({ showYearSwitcher: true });
const $ = (selector, root = document) => root.querySelector(selector);
const workspaceEl = $('#workspace-name');
const reportEl = $('#report');
const tokenAnalyzerWorkspaceFilter = (workspace) => workspace?.tools?.['tokens-cost-analyzer'] === true;
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
  dailyUsageHeatmap.render($('#daily-usage', root), data.daily || []);
  renderSourceUsage(data.bySource || [], data.totals?.tokens || 0, root);
  renderBars('#workspace-chart', data.byWorkspace || [], 'tokens', (row) => formatTokens(row.tokens), root);
  renderBars('#model-chart', (data.byModel || []).slice(0, 5), 'tokens', (row) => formatTokens(row.tokens), root);
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
        <span class="token-label" style="bottom:${totalHeight}%">${formatTokens(m.tokens)}</span>
        <div class="seg subscription" style="height:${subscription}%">${m.subscriptionCost > 0 ? `<span>${compactCurrency(m.subscriptionCost, currency)}</span>` : ''}</div>
        <div class="seg estimated" style="height:${estimated}%">${m.estimatedCost > 0 ? `<span>${compactCurrency(m.estimatedCost, 'USD')}</span>` : ''}</div>
      </div>
      <label>${m.month}</label>
    </div>`;
  }).join('');
}

function renderSourceUsage(rows, totalTokens, root) {
  renderBars('#source-chart', rows, 'tokens', (row) => `${formatTokens(row.tokens)} · ${totalTokens ? Math.round(row.tokens / totalTokens * 100) : 0}%`, root);
}

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
function compactCurrency(value, currency) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: Math.abs(amount) >= 100 ? 0 : 1 }).format(amount);
}
function barHeight(value, max) {
  const amount = Number(value) || 0;
  if (amount <= 0) return 0;
  return 7 + (amount / Math.max(1, max)) * 72;
}
