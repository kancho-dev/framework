import { escapeHtml } from '/shared/browser/dom.js';
import { formatDateTime, formatTokens, money } from '/shared/browser/format.js';
import { sessionBrowserHrefFor, storeSessionBrowserSelection } from '/shared/browser/session-links.js';

const state = { data: null, dailyYear: null };
const statusEl = document.querySelector('#status');
const workspaceEl = document.querySelector('#workspace-name');
const tokenAnalyzerWorkspaceFilter = (workspace) => workspace?.tools?.['tokens-cost-analyzer'] === true;
window.FrameworkWorkspaceBadge?.set(workspaceEl, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace', workspaceFilter: tokenAnalyzerWorkspaceFilter });
document.querySelector('#refresh').addEventListener('click', () => load(true));
document.addEventListener('click', (event) => {
  const yearLink = event.target.closest('[data-daily-year]');
  if (yearLink) {
    renderDaily(state.data?.daily || [], Number(yearLink.dataset.dailyYear));
    return;
  }
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
    statusEl.textContent = `Generated ${formatDateTime(state.data.generatedAt)} · ${analysisLabel(state.data.analysis)} · ${state.data.workspaceRoot}`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  }
}

function render(data) {
  renderWarnings(data.warnings || []);
  renderTotals(data.totals, data.subscriptions?.currency || 'EUR');
  renderMonthly(data.monthly || [], data.subscriptions?.currency || 'EUR');
  renderDaily(data.daily || []);
  renderSourceUsage(data.bySource || [], data.totals?.tokens || 0);
  renderBars('#model-chart', (data.byModel || []).slice(0, 5), 'tokens', (row) => formatTokens(row.tokens));
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
  const max = Math.max(1, ...monthly.map((m) => m.estimatedCost + m.subscriptionCost));
  const recent = monthly.slice(-18);
  document.querySelector('#monthly-chart').innerHTML = recent.map((m) => {
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

function renderDaily(daily, selectedYear = null) {
  const years = [...new Set(daily.map((row) => Number(row.date.slice(0, 4))))].filter(Boolean).sort((a, b) => b - a);
  const requestedYear = selectedYear || state.dailyYear;
  const year = years.includes(requestedYear) ? requestedYear : (years[0] || new Date().getUTCFullYear());
  state.dailyYear = year;

  const usage = new Map(daily.filter((row) => row.date.startsWith(`${year}-`)).map((row) => [row.date, row]));
  const activeTokens = [...usage.values()].map((row) => row.tokens).filter((tokens) => tokens > 0).sort((a, b) => a - b);
  const thresholds = [0.25, 0.5, 0.75].map((ratio) => activeTokens[Math.floor((activeTokens.length - 1) * ratio)] || 0);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const cells = Array.from({ length: (start.getUTCDay() + 6) % 7 }, () => '<i class="day empty"></i>');
  let activeDays = 0;
  let yearTokens = 0;
  for (let date = start; date < end; date = new Date(date.getTime() + 86400000)) {
    const key = date.toISOString().slice(0, 10);
    const row = usage.get(key) || { tokens: 0, records: 0 };
    const level = row.tokens === 0 ? 0 : 1 + thresholds.filter((threshold) => row.tokens > threshold).length;
    activeDays += row.tokens > 0 ? 1 : 0;
    yearTokens += row.tokens;
    const dayLabel = `${formatTokens(row.tokens)} on ${key} · ${row.records} records`;
    cells.push(`<i class="day level-${level}" title="${dayLabel}" aria-label="${dayLabel}" tabindex="0"></i>`);
  }
  const legendLabels = [
    '0 tokens',
    `More than 0, up to ${thresholds[0].toLocaleString()} tokens`,
    `More than ${thresholds[0].toLocaleString()}, up to ${thresholds[1].toLocaleString()} tokens`,
    `More than ${thresholds[1].toLocaleString()}, up to ${thresholds[2].toLocaleString()} tokens`,
    `More than ${thresholds[2].toLocaleString()} tokens`,
  ];
  const legend = legendLabels.map((label, level) => `<i class="day level-${level}" title="${label}" aria-label="${label}" tabindex="0"></i>`).join('');
  const yearLinks = years.map((value) => `<button class="heatmap-year${value === year ? ' active' : ''}" data-daily-year="${value}"${value === year ? ' aria-current="true"' : ''}>${value}</button>`).join('');
  document.querySelector('#daily-heatmap').innerHTML = `<div class="heatmap-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="heatmap-scroll"><div class="heatmap-grid">${cells.join('')}</div></div><div class="heatmap-footer"><div class="heatmap-years">${yearLinks}</div><div class="heatmap-legend"><span>Less</span>${legend}<span>More</span></div></div>`;
  document.querySelector('#daily-summary').textContent = `${formatTokens(yearTokens)} across ${activeDays} active UTC days`;
  renderDailyStats([...usage.values()], yearTokens, activeDays);
}

function renderDailyStats(rows, totalTokens, activeDays) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]?.date;
  const last = sorted.at(-1)?.date;
  const calendarDays = first && last ? Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000) + 1 : 0;
  const byDate = new Map(sorted.map((row) => [row.date, row.tokens]));
  const end = last ? Date.parse(`${last}T00:00:00Z`) : 0;
  const windowTokens = (startOffset) => Array.from({ length: 30 }, (_, index) => new Date(end - (startOffset + index) * 86400000).toISOString().slice(0, 10)).reduce((sum, date) => sum + (byDate.get(date) || 0), 0);
  const recent = end ? windowTokens(0) : 0;
  const previous = end ? windowTokens(30) : 0;
  const change = previous ? `${recent >= previous ? '+' : ''}${Math.round((recent - previous) / previous * 100)}%` : '—';
  document.querySelector('#daily-stats').innerHTML = [
    compactStat('Average/day', formatTokens(calendarDays ? totalTokens / calendarDays : 0), `${calendarDays} observed calendar days`),
    compactStat('Average/active day', formatTokens(activeDays ? totalTokens / activeDays : 0), `${activeDays} days with usage`),
    compactStat('Recent 30-day change', change, 'Latest 30 calendar days versus the prior 30'),
  ].join('');
}

function renderSourceUsage(rows, totalTokens) {
  renderBars('#source-chart', rows, 'tokens', (row) => `${formatTokens(row.tokens)} · ${totalTokens ? Math.round(row.tokens / totalTokens * 100) : 0}%`);
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

function analysisLabel(analysis) {
  if (analysis?.mode === 'limited') return `limited to latest ${analysis.limit} sessions/files per source`;
  if (analysis?.mode === 'full-history') return 'full-history';
  return 'analysis scope unknown';
}
function metric(label, value, note) { return `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`; }
function compactStat(label, value, details) { return `<span class="daily-stat" title="${details}" aria-label="${label}: ${value}. ${details}" tabindex="0"><span>${label}:</span> <strong>${value}</strong></span>`; }
function compactCurrency(value, currency) { return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0); }
function barHeight(value, max) { return Math.max(value > 0 ? 6 : 0, (Number(value) || 0) / max * 88); }
