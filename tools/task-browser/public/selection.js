const SELECTION_PARAMS = ['selectTask', 'task', 'selectStatus', 'status'];

export function requestedSelection(url = new URL(location.href)) {
  return {
    key: url.searchParams.get('selectTask') || url.searchParams.get('task'),
    status: url.searchParams.get('selectStatus') || url.searchParams.get('status'),
  };
}

export function clearRequestedSelection(url) {
  for (const param of SELECTION_PARAMS) url.searchParams.delete(param);
  return url;
}
