import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyUsageHeatmap } from './daily-usage-heatmap.js';

function fakeRoot() {
  return {
    innerHTML: '',
    listener: null,
    addEventListener(_type, listener) { this.listener = listener; },
    contains() { return true; },
  };
}

const daily = [
  { date: '2024-01-01', tokens: 100, records: 2 },
  { date: '2025-01-01', tokens: 300, records: 3 },
];

test('year-switching heatmap preserves its selected year across data renders', () => {
  const root = fakeRoot();
  const heatmap = createDailyUsageHeatmap({ showYearSwitcher: true });
  heatmap.render(root, daily);
  assert.equal(heatmap.selectedYear, 2025);
  assert.match(root.innerHTML, /300 across 1 active UTC days/);
  assert.match(root.innerHTML, /data-daily-year="2024"/);

  const button = { dataset: { dailyYear: '2024' }, closest: () => button };
  root.listener({ target: button });
  assert.equal(heatmap.selectedYear, 2024);
  assert.match(root.innerHTML, /100 across 1 active UTC days/);

  heatmap.render(root, [...daily, { date: '2025-01-02', tokens: 50, records: 1 }]);
  assert.equal(heatmap.selectedYear, 2024);
  assert.match(root.innerHTML, /100 across 1 active UTC days/);
});

test('year controls bind after a detached render is committed into the live host', () => {
  const detached = fakeRoot();
  const live = fakeRoot();
  const heatmap = createDailyUsageHeatmap({ showYearSwitcher: true });
  heatmap.render(detached, daily);
  live.innerHTML = detached.innerHTML;
  heatmap.bind(live);

  const button = { dataset: { dailyYear: '2024' }, closest: () => button };
  live.listener({ target: button });
  assert.equal(heatmap.selectedYear, 2024);
  assert.match(live.innerHTML, /100 across 1 active UTC days/);
});

test('overflowing current-year heatmap reveals today with next-week context', () => {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const scroll = { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 };
  const todayCell = { offsetLeft: 450, offsetWidth: 11 };
  const contextCell = { offsetLeft: 464, offsetWidth: 11 };
  const root = {
    ...fakeRoot(),
    querySelector(selector) {
      if (selector === '.heatmap-scroll') return scroll;
      if (selector === `[data-date="${today}"]`) return todayCell;
      if (selector === `[data-date="${nextWeek}"]`) return contextCell;
      return null;
    },
  };
  const heatmap = createDailyUsageHeatmap({ showYearSwitcher: false });
  heatmap.render(root, [{ date: today, tokens: 42, records: 1 }]);

  assert.equal(scroll.scrollLeft, 175);
  assert.match(root.innerHTML, new RegExp(`data-date="${today}"`));
});

test('fixed-year heatmap renders the current year without year controls', () => {
  const year = new Date().getUTCFullYear();
  const root = fakeRoot();
  const heatmap = createDailyUsageHeatmap({ showYearSwitcher: false });
  heatmap.render(root, [{ date: `${year}-02-03`, tokens: 42, records: 1 }]);

  assert.equal(heatmap.selectedYear, year);
  assert.match(root.innerHTML, /42 across 1 active UTC days/);
  assert.doesNotMatch(root.innerHTML, /data-daily-year/);
  assert.match(root.innerHTML, /Average\/day/);
  assert.match(root.innerHTML, /heatmap-legend/);
});
