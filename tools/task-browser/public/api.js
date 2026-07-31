import { els } from './dom-elements.js';
import { state } from './state.js';

export async function fetchTasks() {
  const res = await fetch('api/tasks');
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  return res.json();
}

export async function fetchPreview(key, path, kind) {
  const query = new URLSearchParams({ key, path });
  const res = await fetch(`api/${kind === 'run' ? 'run-file' : 'task-file'}?${query}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Preview failed: ${res.status}`);
  return data;
}

export async function saveSteeringNotes(key, content, revision) {
  const res = await fetch('api/steering-notes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, content, revision }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `Steering Notes save failed: ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const task = state.tasks.find((item) => item.key === key);
  if (task) {
    task.steeringNotes = data.steeringNotes;
    task.hasPendingSteeringNotes = Boolean(data.steeringNotes.content.trim());
  }
  return data.steeringNotes;
}

export async function saveMetadata(key, patch) {
  const res = await fetch('api/task-metadata', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, metadata: patch }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Metadata save failed: ${res.status}`);
  const task = state.tasks.find((item) => item.key === key);
  if (task) task.metadata = data.metadata;
  els.status.textContent = `Saved metadata for ${key}.`;
}
