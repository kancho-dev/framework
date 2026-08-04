import { formatTokens } from './format.js';

const DAY_MS = 86400000;

export function createDailyUsageHeatmap({ showYearSwitcher = false } = {}) {
  let selectedYear = null;
  let latestRoot = null;
  let latestDaily = [];
  const boundRoots = new WeakSet();

  function bind(root) {
    if (!root || boundRoots.has(root)) return;
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-daily-year]');
      if (!button || !root.contains(button)) return;
      selectedYear = Number(button.dataset.dailyYear);
      render(root, latestDaily);
    });
    boundRoots.add(root);
    revealToday(root, selectedYear);
  }

  function render(root, daily = []) {
    if (!root) return;
    latestRoot = root;
    latestDaily = Array.isArray(daily) ? daily : [];
    bind(root);

    const years = [...new Set(latestDaily.map((row) => Number(String(row.date).slice(0, 4))))]
      .filter(Boolean)
      .sort((a, b) => b - a);
    const currentYear = new Date().getUTCFullYear();
    const requestedYear = showYearSwitcher ? selectedYear : currentYear;
    const year = showYearSwitcher
      ? (years.includes(requestedYear) ? requestedYear : (years[0] || currentYear))
      : currentYear;
    selectedYear = year;

    const usage = new Map(latestDaily.filter((row) => String(row.date).startsWith(`${year}-`)).map((row) => [row.date, row]));
    const activeTokens = [...usage.values()].map((row) => row.tokens).filter((tokens) => tokens > 0).sort((a, b) => a - b);
    const thresholds = [0.25, 0.5, 0.75].map((ratio) => activeTokens[Math.floor((activeTokens.length - 1) * ratio)] || 0);
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const cells = Array.from({ length: (start.getUTCDay() + 6) % 7 }, () => '<i class="day empty"></i>');
    let activeDays = 0;
    let yearTokens = 0;
    for (let date = start; date < end; date = new Date(date.getTime() + DAY_MS)) {
      const key = date.toISOString().slice(0, 10);
      const row = usage.get(key) || { tokens: 0, records: 0 };
      const level = row.tokens === 0 ? 0 : 1 + thresholds.filter((threshold) => row.tokens > threshold).length;
      activeDays += row.tokens > 0 ? 1 : 0;
      yearTokens += Number(row.tokens) || 0;
      const dayLabel = `${formatTokens(row.tokens)} on ${key} · ${Number(row.records) || 0} records`;
      cells.push(`<i class="day level-${level}" data-date="${key}" title="${dayLabel}" aria-label="${dayLabel}" tabindex="0"></i>`);
    }

    const legendLabels = [
      '0 tokens',
      `More than 0, up to ${thresholds[0].toLocaleString()} tokens`,
      `More than ${thresholds[0].toLocaleString()}, up to ${thresholds[1].toLocaleString()} tokens`,
      `More than ${thresholds[1].toLocaleString()}, up to ${thresholds[2].toLocaleString()} tokens`,
      `More than ${thresholds[2].toLocaleString()} tokens`,
    ];
    const legend = legendLabels.map((label, level) => `<i class="day level-${level}" title="${label}" aria-label="${label}" tabindex="0"></i>`).join('');
    const yearButtons = showYearSwitcher
      ? years.map((value) => `<button class="heatmap-year${value === year ? ' active' : ''}" data-daily-year="${value}"${value === year ? ' aria-current="true"' : ''}>${value}</button>`).join('')
      : '';

    root.innerHTML = `<div class="daily-usage-summary">${formatTokens(yearTokens)} across ${activeDays} active UTC days</div><div class="heatmap"><div class="heatmap-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div class="heatmap-scroll"><div class="heatmap-grid">${cells.join('')}</div></div><div class="heatmap-footer"><div class="heatmap-years">${yearButtons}</div><div class="heatmap-legend"><span>Less</span>${legend}<span>More</span></div></div></div><div class="daily-stats">${renderStats([...usage.values()], yearTokens, activeDays)}</div>`;
    revealToday(root, year);
  }

  return { render, bind, get selectedYear() { return selectedYear; }, get root() { return latestRoot; } };
}

function revealToday(root, year) {
  const today = new Date().toISOString().slice(0, 10);
  if (year !== Number(today.slice(0, 4))) return;
  const scroll = root.querySelector?.('.heatmap-scroll');
  const todayCell = root.querySelector?.(`[data-date="${today}"]`);
  if (!scroll || !todayCell || scroll.scrollWidth <= scroll.clientWidth) return;
  const nextWeek = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * DAY_MS).toISOString().slice(0, 10);
  const contextCell = root.querySelector?.(`[data-date="${nextWeek}"]`) || todayCell;
  scroll.scrollLeft = Math.max(0, contextCell.offsetLeft + contextCell.offsetWidth - scroll.clientWidth);
}

function renderStats(rows, totalTokens, activeDays) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]?.date;
  const last = sorted.at(-1)?.date;
  const calendarDays = first && last ? Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1 : 0;
  const byDate = new Map(sorted.map((row) => [row.date, row.tokens]));
  const end = last ? Date.parse(`${last}T00:00:00Z`) : 0;
  const windowTokens = (offset) => Array.from({ length: 30 }, (_, index) => new Date(end - (offset + index) * DAY_MS).toISOString().slice(0, 10)).reduce((sum, date) => sum + (byDate.get(date) || 0), 0);
  const recent = end ? windowTokens(0) : 0;
  const previous = end ? windowTokens(30) : 0;
  const change = previous ? `${recent >= previous ? '+' : ''}${Math.round((recent - previous) / previous * 100)}%` : '—';
  return [
    compactStat('Average/day', formatTokens(calendarDays ? totalTokens / calendarDays : 0), `${calendarDays} observed calendar days`),
    compactStat('Average/active day', formatTokens(activeDays ? totalTokens / activeDays : 0), `${activeDays} days with usage`),
    compactStat('Recent 30-day change', change, 'Latest 30 calendar days versus the prior 30'),
  ].join('');
}

function compactStat(label, value, details) {
  return `<span class="daily-stat" title="${details}" aria-label="${label}: ${value}. ${details}" tabindex="0"><span>${label}:</span> <strong>${value}</strong></span>`;
}
