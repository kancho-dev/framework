export const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };

export function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function sortTasks(status, tasks) {
  return [...tasks].sort((a, b) => status === 'done' ? compareDone(a, b) : compareActive(a, b));
}

function compareActive(a, b) {
  return compareNullableNumber(a.metadata?.order, b.metadata?.order, true)
    || compareNumber(priorityRank[a.metadata?.priority] ?? 99, priorityRank[b.metadata?.priority] ?? 99)
    || compareDateDesc(a.latestRunAt, b.latestRunAt)
    || compareNumber(displayNumber(b), displayNumber(a))
    || a.key.localeCompare(b.key);
}

function compareDone(a, b) {
  return compareRunPresence(a, b) || compareDateDesc(a.latestRunAt, b.latestRunAt) || compareNumber(displayNumber(b), displayNumber(a)) || a.key.localeCompare(b.key);
}

function compareNullableNumber(a, b, nullLast) {
  const aNum = Number.isFinite(a) ? a : null;
  const bNum = Number.isFinite(b) ? b : null;
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
  if (aNum === null && bNum !== null) return nullLast ? 1 : -1;
  if (aNum !== null && bNum === null) return nullLast ? -1 : 1;
  return 0;
}

function compareNumber(a, b) { return a === b ? 0 : a - b; }
function compareDateDesc(a, b) { return (Date.parse(b || '') || 0) - (Date.parse(a || '') || 0); }
function compareRunPresence(a, b) { return a.hasRunLogs === b.hasRunLogs ? 0 : a.hasRunLogs ? -1 : 1; }

export function displayNumber(task) {
  return Number(String(task.metadata?.displayId || '').replace(/\D/g, '')) || 0;
}
