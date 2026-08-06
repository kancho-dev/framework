function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };

function displayNumber(task) {
  return Number(String(task.metadata?.displayId || '').replace(/\D/g, '')) || 0;
}

export function sortForBoardOrder(a, b) {
  const aOrder = positiveInteger(a.metadata?.order);
  const bOrder = positiveInteger(b.metadata?.order);
  if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
  if (aOrder === null && bOrder !== null) return 1;
  if (aOrder !== null && bOrder === null) return -1;
  return (priorityRank[a.metadata?.priority] ?? 99) - (priorityRank[b.metadata?.priority] ?? 99)
    || (Date.parse(b.latestRunAt || '') || 0) - (Date.parse(a.latestRunAt || '') || 0)
    || displayNumber(b) - displayNumber(a)
    || a.key.localeCompare(b.key);
}

function forwardPlan(destination, index, moving) {
  let order = positiveInteger(destination[index - 1]?.metadata?.order) ?? 0;
  const changes = [{ key: moving.key, metadata: { status: moving.metadata?.status, order: ++order } }];
  for (let cursor = index; cursor < destination.length; cursor += 1) {
    const current = positiveInteger(destination[cursor].metadata?.order);
    if (current !== null && current > order) break;
    changes.push({ key: destination[cursor].key, metadata: { order: ++order } });
  }
  return changes;
}

function backwardPlan(destination, index, moving) {
  const next = positiveInteger(destination[index]?.metadata?.order);
  if (next === null) return null;
  let order = next;
  const changes = [{ key: moving.key, metadata: { status: moving.metadata?.status, order: --order } }];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const current = positiveInteger(destination[cursor].metadata?.order);
    if (current !== null && current < order) break;
    order -= 1;
    if (order < 1) return null;
    changes.push({ key: destination[cursor].key, metadata: { order } });
  }
  return order >= 1 ? changes : null;
}

export function planBoardMove(tasks, { key, status, index }) {
  if (status === 'done') throw new Error('Done destination does not support ordering');
  const moving = tasks.find((task) => task.key === key);
  if (!moving) throw new Error(`Unknown task: ${key}`);
  const destination = tasks.filter((task) => task.key !== key && task.metadata?.status === status).sort(sortForBoardOrder);
  if (!Number.isInteger(index) || index < 0 || index > destination.length) throw new Error('Invalid destination index');

  const previous = positiveInteger(destination[index - 1]?.metadata?.order);
  const next = positiveInteger(destination[index]?.metadata?.order);
  let order = null;
  if (previous === null && next === null) order = 1;
  else if (previous === null && next > 1) order = next - 1;
  else if (next === null && previous !== null) order = previous + 1;
  else if (previous !== null && next - previous > 1) order = previous + 1;

  const statusPatch = moving.metadata?.status === status ? {} : { status };
  if (order !== null) return [{ key, metadata: { ...statusPatch, order } }];

  const candidateMoving = { ...moving, metadata: { ...moving.metadata, status } };
  const forward = forwardPlan(destination, index, candidateMoving);
  const backward = backwardPlan(destination, index, candidateMoving);
  const selected = backward && backward.length < forward.length ? backward : forward;
  selected[0].metadata = { ...statusPatch, order: selected[0].metadata.order };
  return selected;
}
