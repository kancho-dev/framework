export function hasOrderingFilters({ query, project, priority }) {
  return Boolean(String(query || '').trim() || (project && project !== 'all') || (priority && priority !== 'all'));
}

export function boardDropMode({ filtered, sourceStatus, destinationStatus }) {
  if (destinationStatus === 'done') return sourceStatus === 'done' ? 'disabled' : 'status-only';
  if (!filtered) return 'reorder';
  return sourceStatus === destinationStatus ? 'disabled' : 'status-only';
}

export function shouldClearDropFeedback({ eventTargetIsBoard, relatedTargetInside }) {
  return eventTargetIsBoard && !relatedTargetInside;
}

export function columnDragScrollDelta({ pointerY, top, bottom, edgeSize = 64, maxStep = 20 }) {
  if (pointerY < top + edgeSize) return -Math.ceil(maxStep * Math.min(1, (top + edgeSize - pointerY) / edgeSize));
  if (pointerY > bottom - edgeSize) return Math.ceil(maxStep * Math.min(1, (pointerY - (bottom - edgeSize)) / edgeSize));
  return 0;
}

export function insertionIndex(cards, pointerY, draggedKey) {
  const candidates = cards.filter((card) => card.key !== draggedKey);
  const index = candidates.findIndex((card) => pointerY < card.top + (card.height / 2));
  return index < 0 ? candidates.length : index;
}
