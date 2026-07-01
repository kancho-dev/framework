import { escapeHtml } from '/shared/browser/dom.js';
import { formatDateTime, formatTokens, money, shortMoney } from '/shared/browser/format.js';
import { sessionBrowserHrefFor, storeSessionBrowserSelection } from '/shared/browser/session-links.js';

const state = { data: null };
const statusEl = document.querySelector('#status');
const workspaceEl = document.querySelector('#workspace-name');
const tokenAnalyzerWorkspaceFilter = (workspace) => workspace?.tools?.['tokens-cost-analyzer'] === true;
window.FrameworkWorkspaceBadge?.set(workspaceEl, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace', workspaceFilter: tokenAnalyzerWorkspaceFilter });
document.querySelector('#refresh').addEventListener('click', () => load(true));
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-session-browser-path]');
  if (!link) return;
  storeSessionBrowserSelection(link.dataset.sessionBrowserPath, link.dataset.sessionTopicId, { workspaceRoot: state.data?.workspaceRoot });
});
load(false);

async function load(refresh) {
  statusEl.textContent = refresh ? 'Refreshing local analysis…' : 'Loading local analysis…';
  try {
    const params = new URLSearchParams(location.search);
    if (refresh) params.set('refresh', '1');
    const res = await fetch(`api/report${params.toString() ? `?${params}` : ''}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    state.data = await res.json();
    window.FrameworkWorkspaceBadge?.set(workspaceEl, { root: state.data.workspaceRoot, tooltipPrefix: 'Workspace', workspaceFilter: tokenAnalyzerWorkspaceFilter });
    render(state.data);
    statusEl.textContent = `Generated ${formatDateTime(state.data.generatedAt)} · ${state.data.workspaceRoot}`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
}

function render(data) {
  renderWarnings(data.warnings || []);
  renderTotals(data.totals, data.subscriptions?.currency || 'EUR');
  renderMonthly(data.monthly || [], data.subscriptions?.currency || 'EUR');
  renderBars('#model-chart', (data.byModel || []).slice(0, 8), 'tokens', (row) => formatTokens(row.tokens));
  renderBars('#subscription-chart', (data.subscriptions?.byService || []).slice(0, 8).map((r) => ({ key: r.service, amount: r.amount })), 'amount', (row) => money(row.amount, data.subscriptions?.currency || 'EUR'));
  renderDrivers('#drivers', data.topDrivers || []);
  renderDrivers('#message-drivers', data.topMessageDrivers || []);
  renderTrustInspector(data.trustIssues || []);
}

function renderWarnings(warnings) {
  const el = document.querySelector('#warnings');
  el.classList.toggle('hidden', warnings.length === 0);
  el.innerHTML = warnings.length ? `<strong>Trust flags</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
}

function renderTotals(totals, subCurrency) {
  document.querySelector('#totals').innerHTML = [
    metric('Tokens', formatTokens(totals.tokens), `${totals.records} normalized records`),
    metric('Recorded cost', money(totals.recordedCost, 'USD'), 'native tool/provider facts'),
    metric('Estimated cost', money(totals.estimatedCost, 'USD'), 'local pricing table'),
    metric('Subscriptions', money(totals.subscriptionCost, subCurrency), 'private monthly spend'),
    metric('Unknown cost', String(totals.unknownCostRecords), 'records needing attention'),
  ].join('');
}

function renderMonthly(monthly, currency) {
  const max = Math.max(1, ...monthly.map((m) => Math.max(m.estimatedCost, m.subscriptionCost)));
  const recent = monthly.slice(-18);
  document.querySelector('#monthly-chart').innerHTML = recent.map((m) => {
    const estimated = height(m.estimatedCost, max);
    const subscription = height(m.subscriptionCost, max);
    const top = Math.max(m.estimatedCost, m.subscriptionCost);
    return `<div class="month" title="${m.month}\nEstimated token cost ${money(m.estimatedCost, 'USD')}\nNative recorded cost ${money(m.recordedCost, 'USD')}\nSubscriptions ${money(m.subscriptionCost, currency)}\nEffective subscription / 1M tokens ${m.effectiveSubscriptionPer1M == null ? 'unknown' : money(m.effectiveSubscriptionPer1M, currency)}">
      <div class="stack">
        <div class="seg subscription" style="height:${subscription}px"></div>
        <div class="seg estimated" style="height:${estimated}px"></div>
      </div>
      <span class="value">${top ? shortMoney(top) : ''}</span><label>${m.month}</label>
    </div>`;
  }).join('') + `<div class="legend"><span><i class="dot" style="background:var(--accent)"></i>estimated token cost</span><span><i class="dot" style="background:var(--purple)"></i>subscriptions</span></div>`;
}

function renderBars(selector, rows, field, labelFn) {
  const max = Math.max(1, ...rows.map((r) => Number(r[field]) || 0));
  document.querySelector(selector).innerHTML = rows.map((row) => `<div class="bar-row"><div class="name" title="${escapeHtml(row.key)}">${escapeHtml(row.key)}</div><div class="bar"><div class="fill" style="width:${Math.max(2, ((Number(row[field]) || 0) / max) * 100)}%"></div></div><div class="amount">${labelFn(row)}</div></div>`).join('') || '<p class="status">No data yet.</p>';
}

function sessionBrowserHref(driver) {
  return sessionBrowserHrefFor(driver, { fallbackRoute: '../sessions/' });
}

function renderTrustInspector(issues) {
  const panel = document.querySelector('#trust-inspector-panel');
  const el = document.querySelector('#trust-inspector');
  panel.classList.toggle('hidden', issues.length === 0);
  el.innerHTML = issues.map((issue) => {
    const model = issue.modelLabel || issue.model || 'unknown-model';
    const href = sessionBrowserHref(issue);
    const title = `${issue.source || 'unknown'} · ${issue.date || 'unknown'} · ${model}`;
    const reasons = (issue.warnings || []).map((warning) => `<span class="pill warn">${escapeHtml(warning)}</span>`).join('');
    const details = `<div class="inspector-main"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><small>${escapeHtml(issue.sessionRef || issue.sessionId || '')}${issue.messageId ? ` · message ${escapeHtml(issue.messageId)}` : ''}</small></div><div class="pills"><span class="pill">${formatTokens(issue.totalTokens || 0)}</span>${reasons}<span class="pill">alias ${escapeHtml(issue.model || 'unknown')}</span></div>`;
    return href ? `<a class="inspector-row" href="${escapeHtml(href)}" data-session-browser-path="${escapeHtml(issue.sessionBrowserPath)}" data-session-topic-id="${escapeHtml(issue.sessionTopicId || '')}">${details}</a>` : `<article class="inspector-row">${details}</article>`;
  }).join('');
}

function renderDrivers(selector, drivers) {
  document.querySelector(selector).innerHTML = drivers.map((r) => {
    const model = r.modelLabel || r.model || 'unknown-model';
    const count = r.recordCount ? `<span class="pill">${r.recordCount} records</span>` : '';
    const body = `<div class="driver-top"><span>${escapeHtml(r.date || 'unknown')}</span><span>${escapeHtml(r.source || '')}</span></div><strong title="${escapeHtml(model)}">${escapeHtml(model)}</strong><div class="pills"><span class="pill">${formatTokens(r.totalTokens || 0)}</span><span class="pill">recorded ${money(r.recordedCost, 'USD')}</span><span class="pill ${r.estimatedCost == null ? 'warn' : ''}">estimated ${money(r.estimatedCost, 'USD')}</span>${count}<span class="pill ${r.confidence === 'unknown' ? 'warn' : ''}">${escapeHtml(r.confidence || 'unknown')}</span></div>`;
    const href = sessionBrowserHref(r);
    return href ? `<a class="driver driver-link" href="${escapeHtml(href)}" data-session-browser-path="${escapeHtml(r.sessionBrowserPath)}" data-session-topic-id="${escapeHtml(r.sessionTopicId || '')}" title="Open in Session Browser">${body}</a>` : `<article class="driver">${body}</article>`;
  }).join('');
}

function metric(label, value, note) { return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function height(value, max) { return Math.max(value > 0 ? 3 : 0, (Number(value) || 0) / max * 220); }
