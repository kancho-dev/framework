export async function fetchSessions({ signal } = {}) {
  const res = await fetch('api/sessions', { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load sessions');
  return data;
}

export async function fetchSessionDetail(path, { signal } = {}) {
  const res = await fetch(`api/session?path=${encodeURIComponent(path)}`, { signal });
  const detail = await res.json();
  if (!res.ok) throw new Error(detail.error || 'Failed to load session');
  return detail;
}

export async function putMetadata(path, patch) {
  const res = await fetch('api/metadata', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, ...patch }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save metadata');
  return data.metadata;
}
