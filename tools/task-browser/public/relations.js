import { els } from './dom-elements.js';
import { state, selectedTask } from './state.js';

export function currentTags(form) {
  return [...form.querySelectorAll('.remove-tag')].map((button) => button.dataset.tag);
}

export function relationFieldFromLabel(label) {
  return { 'blocked by': 'blockedBy', parent: 'parent', child: 'children', related: 'related' }[label] || null;
}

export function taskKeyFromRelationInput(value) {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return '';
  const matches = state.tasks.filter((task) => [task.key, task.metadata?.displayId, task.title].some((item) => String(item || '').toLowerCase() === query));
  if (matches.length === 1) return matches[0].key;
  const partial = state.tasks.filter((task) => [task.key, task.metadata?.displayId, task.title].some((item) => String(item || '').toLowerCase().includes(query)));
  return partial.length === 1 ? partial[0].key : '';
}

export async function addRelation(form, field, saveMetadataPatch) {
  const input = form.querySelector(`[name="relation-${CSS.escape(field)}"]`);
  const value = taskKeyFromRelationInput(input?.value);
  if (!value) {
    els.status.textContent = 'Choose a single matching task by ID, key, or title.';
    return;
  }
  const task = selectedTask();
  if (field === 'parent') await saveMetadataPatch(form, { parent: value });
  else {
    const current = task?.metadata?.[field] || [];
    await saveMetadataPatch(form, { [field]: [...new Set([...current, value])] });
  }
  if (input) input.value = '';
}

export async function removeRelation(form, label, key, saveMetadataPatch) {
  const field = relationFieldFromLabel(label);
  if (!field) return;
  const task = selectedTask();
  if (field === 'parent') await saveMetadataPatch(form, { parent: null });
  else {
    const current = task?.metadata?.[field] || [];
    await saveMetadataPatch(form, { [field]: current.filter((entry) => entry !== key) });
  }
}
