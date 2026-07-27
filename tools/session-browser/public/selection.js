const SESSION_PARAMS = ['selectSession', 'session'];
const TOPIC_PARAMS = ['selectTopic', 'topic'];

export function requestedSelection(url = new URL(location.href)) {
  return url.searchParams.get('selectSession') || url.searchParams.get('session');
}

export function requestedTopic(url = new URL(location.href)) {
  return url.searchParams.get('selectTopic') || url.searchParams.get('topic');
}

export function nearestScrollTop(scrollTop, containerTop, containerBottom, itemTop, itemBottom) {
  if (itemTop < containerTop) return Math.max(0, scrollTop - (containerTop - itemTop));
  if (itemBottom > containerBottom) return scrollTop + (itemBottom - containerBottom);
  return scrollTop;
}

export function clearStaleRequestedSelection(url, selectedPath) {
  const requestedPath = requestedSelection(url);
  if (!requestedPath || requestedPath === selectedPath) return false;
  for (const param of [...SESSION_PARAMS, ...TOPIC_PARAMS]) url.searchParams.delete(param);
  return true;
}
