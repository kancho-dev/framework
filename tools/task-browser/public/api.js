import { els } from './dom-elements.js';
import { state } from './state.js';

export async function fetchTasks() {
  const res = await fetch('api/tasks');
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return res.json();
}

export async function saveMetadata(key, patch) {
  const res = await fetch('api/task-metadata', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, metadata: patch }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Metadata save failed: ${res.status}`);
  const task = state.tasks.find((item) => item.key === key);
  if (task) task.metadata = data.metadata;
  els.status.textContent = `Saved metadata for ${key}.`;
}
