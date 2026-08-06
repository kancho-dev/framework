import { sortForBoardOrder } from './board-ordering.js';


export function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function sortTasks(status, tasks) {
  return [...tasks].sort(status === 'done' ? compareDone : sortForBoardOrder);
}

function compareDone(a, b) {
  return compareRunPresence(a, b) || compareDateDesc(a.latestRunAt, b.latestRunAt) || compareNumber(displayNumber(b), displayNumber(a)) || a.key.localeCompare(b.key);
}

function compareNumber(a, b) { return a === b ? 0 : a - b; }
function compareDateDesc(a, b) { return (Date.parse(b || '') || 0) - (Date.parse(a || '') || 0); }
function compareRunPresence(a, b) { return a.hasRunLogs === b.hasRunLogs ? 0 : a.hasRunLogs ? -1 : 1; }

export function displayNumber(task) {
  return Number(String(task.metadata?.displayId || '').replace(/\D/g, '')) || 0;
}
