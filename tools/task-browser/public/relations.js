export function currentTags(form) {
  return [...form.querySelectorAll('.remove-tag')].map((button) => button.dataset.tag);
}

export function relationFieldFromLabel(label) {
  return { 'blocked by': 'blockedBy', parent: 'parent', child: 'children', related: 'related' }[label] || null;
}

export function taskKeyFromRelationInput(value, tasks) {
  const query = String(value || '').trim().toLowerCase();
  if (!query) return '';
  const matches = tasks.filter((task) => relationSearchValues(task).some((item) => item === query));
  if (matches.length === 1) return matches[0].key;
  const partial = tasks.filter((task) => relationSearchValues(task).some((item) => item.includes(query)));
  return partial.length === 1 ? partial[0].key : '';
}

export function relationInput(form, field) {
  return form.querySelector(`[name="relation-${CSS.escape(field)}"]`);
}

export function addRelationPatch(task, field, relatedKey) {
  if (field === 'parent') return { parent: relatedKey };
  const current = task?.metadata?.[field] || [];
  return { [field]: [...new Set([...current, relatedKey])] };
}

export function removeRelationPatch(task, label, relatedKey) {
  const field = relationFieldFromLabel(label);
  if (!field) return null;
  if (field === 'parent') return { parent: null };
  const current = task?.metadata?.[field] || [];
  return { [field]: current.filter((entry) => entry !== relatedKey) };
}

function relationSearchValues(task) {
  return [task.key, task.metadata?.displayId, task.title].map((item) => String(item || '').toLowerCase());
}
