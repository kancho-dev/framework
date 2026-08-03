import { escapeHtml } from '/shared/browser/dom.js';
import { els } from './dom-elements.js';
import { state } from './state.js';
import { unique, displayNumber } from './task-utils.js';
import { matches } from './filters.js';
import { editableMetaPill, editableNextActorPill, labelPill, projectPill } from './pills.js';
import { steeringDisclosureOpen, syncSteeringDraft } from './steering-notes.js';

export function captureDetailFocus() {
  const active = document.activeElement;
  const form = active?.closest?.('.inline-metadata-editor');
  if (!form || (active.name !== 'newTag' && !String(active.name || '').startsWith('relation-'))) return null;
  return { key: form.dataset.key, name: active.name, start: active.selectionStart, end: active.selectionEnd };
}

export function restoreDetailFocus(focus) {
  if (!focus || focus.key !== state.selectedKey) return;
  const input = els.detailMeta.querySelector(`[name="${CSS.escape(focus.name)}"]`);
  if (!input) return;
  input.focus();
  if (Number.isInteger(focus.start) && Number.isInteger(focus.end)) input.setSelectionRange(focus.start, focus.end);
}

export function renderDetail(task) {
  renderDetailStatic(task);
  renderDetailMetadata(task);
  renderDetailSteering(task);
}

export function renderDetailStatic(task) {
  els.detailPane.classList.toggle('hidden', !task);
  if (!task) return;
  const meta = task.metadata || {};
  els.detailKey.innerHTML = `<span class="display-id">${escapeHtml(meta.displayId)}</span>${projectPill(task.project)}<span>${escapeHtml(task.slug)}</span>`;
  els.detailTitle.textContent = task.title;
  els.taskFiles.innerHTML = renderFiles(task.artifacts || []);
  els.detailPurpose.textContent = task.purpose || 'No purpose section found.';
  els.detailNextSteps.textContent = task.nextSteps || 'No next steps section found.';
  els.detailSuccess.textContent = task.success || 'No success/acceptance section found.';
  els.detailRuns.innerHTML = renderRuns(task.runs || []);
  els.detailHistory.innerHTML = renderHistory(task.metadataHistory || []);
}

export function renderDetailMetadata(task) {
  if (!task) {
    els.detailMeta.innerHTML = '';
    return;
  }
  const meta = task.metadata || {};
  const primaryMeta = [editableMetaPill('status', meta.status, state.statuses, `status ${meta.status}`), editableMetaPill('priority', meta.priority, state.priorities, `priority ${meta.priority}`), editableMetaPill('type', meta.type, typeOptions(meta.type), 'type'), editableNextActorPill(meta.nextActor)].join('');
  const filterNotice = matches(task) ? '' : '<div class="detail-notice">Selected task is hidden by current board filters. <button type="button" class="show-selected-in-board">Show in board</button></div>';
  els.detailMeta.innerHTML = `<form class="inline-metadata-editor" data-refresh-scope="defer" data-refresh-defer="incidental" data-key="${escapeHtml(task.key)}">${filterNotice}<div class="meta-line primary-meta-line"><div>${primaryMeta}</div><label class="order-editor">Order <input name="order" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(meta.order ?? '')}"></label></div>${renderTagEditor(meta.tags || [])}${renderRelationsAndAction(meta, task)}</form>`;
}

export function renderDetailSteering(task) {
  const renderedKey = els.steeringNotes.querySelector('.steering-notes-editor')?.dataset.key;
  const livePreference = task && renderedKey === task.key ? els.steeringNotesDisclosure.open : undefined;
  if (!task) {
    els.steeringNotes.innerHTML = '';
    return;
  }
  els.steeringNotes.innerHTML = renderSteeringNotes(task);
  const draft = state.steeringDrafts[task.key];
  els.steeringNotesDisclosure.open = steeringDisclosureOpen({ preference: livePreference, pending: task.hasPendingSteeringNotes, dirty: draft?.dirty });
  els.steeringNotesDisclosure.querySelector('.steering-summary-state').textContent = task.hasPendingSteeringNotes ? 'Pending for next run' : 'No note pending';
}

function renderSteeringNotes(task) {
  const draft = syncSteeringDraft(state.steeringDrafts, task);
  const disabled = draft.dirty ? '' : ' disabled';
  const status = draft.message || (draft.state === 'saved' ? 'Saved guidance is pending.' : 'No guidance is pending.');
  return `<form class="steering-notes-editor" data-refresh-scope="defer" data-refresh-defer="authored" data-key="${escapeHtml(task.key)}">
    <label for="steering-notes-input">Guidance for the next Task Run</label>
    <textarea id="steering-notes-input" name="steeringNotes" maxlength="16000" rows="5">${escapeHtml(draft.content)}</textarea>
    <div class="steering-actions"><button type="submit" class="save-steering"${disabled}>Save</button><button type="button" class="clear-steering"${draft.content ? '' : ' disabled'}>Clear</button><span class="steering-state ${escapeHtml(draft.state)}" role="status" aria-live="polite">${escapeHtml(status)}</span></div>
  </form>`;
}

function typeOptions(current) {
  return unique([...state.tasks.map((task) => task.metadata?.type), current, 'implementation', 'review', 'research', 'design', 'maintenance', 'release']);
}

function allTaskTags() {
  return unique(state.tasks.flatMap((task) => task.metadata?.tags || [])).sort((a, b) => a.localeCompare(b));
}

function renderTagEditor(tags) {
  const pills = tags.map((tag) => `<span class="label-pill tag-pill"><span aria-label="tag">⌁</span><strong>${escapeHtml(tag)}</strong><button class="remove-tag" type="button" data-tag="${escapeHtml(tag)}" title="Remove tag ${escapeHtml(tag)}">×</button></span>`).join('');
  const draft = state.selectedKey ? state.tagDrafts[state.selectedKey] || '' : '';
  return `<div class="meta-line tags-line"><div class="tag-list">${pills || '<span class="muted compact">No tags</span>'}</div><div class="tag-controls"><div class="tag-add"><input name="newTag" placeholder="Add tag…" value="${escapeHtml(draft)}"><button type="submit">Add</button></div></div></div>`;
}

function renderRelationsAndAction(meta, task) {
  const items = [
    ...relationItems('blocked by', meta.blockedBy || []),
    ...relationItems('blocks', meta.blocks || []),
    ...relationItems('parent', meta.parent ? [meta.parent] : []),
    ...relationItems('child', meta.children || []),
    ...relationItems('related', meta.related || []),
  ].join('');
  const editLabel = state.relationEditorOpen ? 'Done' : 'Edit';
  return `<div class="meta-line relation-action-line"><div class="relation-line">${items || '<span class="muted compact">No relationships</span>'}</div><div class="relationship-actions"><button type="button" class="compact-action toggle-relations" aria-expanded="${state.relationEditorOpen}">✎ ${editLabel}</button><div class="prompt-action"><button type="button" class="compact-action copy-resume">Copy task prompt</button><span class="prompt-preview">${escapeHtml(continuePrompt(task))}</span></div></div></div>${state.relationEditorOpen ? renderRelationshipEditor() : ''}`;
}

function renderRelationshipEditor() {
  return `<div class="relationship-editor">
    ${relationAdder('parent', 'Set parent')}
    ${relationAdder('children', 'Add child')}
    ${relationAdder('related', 'Add related')}
    ${relationAdder('blockedBy', 'Add blocker')}
  </div>`;
}

function relationAdder(field, label) {
  const value = state.selectedKey ? state.relationDrafts[`${state.selectedKey}:${field}`] || '' : '';
  return `<div class="relationship-field"><label>${escapeHtml(label)}<input name="relation-${escapeHtml(field)}" placeholder="#37, key, or title…" value="${escapeHtml(value)}"></label><button type="button" class="compact-action ${field === 'parent' ? 'set-parent' : 'add-relation'}" data-field="${escapeHtml(field)}">${field === 'parent' ? 'Set' : 'Add'}</button></div>`;
}

function relationOptions(currentKey) {
  return state.tasks.filter((task) => task.key !== currentKey).sort((a, b) => displayNumber(a) - displayNumber(b) || a.key.localeCompare(b.key));
}

function relationAutocompleteOptions(currentKey) {
  return relationOptions(currentKey).map((task) => ({ value: task.metadata?.displayId || task.key, label: `${task.key} · ${task.title}` }));
}

export function attachDetailAutocompletes() {
  const form = els.detailMeta.querySelector('.inline-metadata-editor');
  if (!form) return;
  window.FrameworkAutocomplete?.attach(form.querySelector('input[name="newTag"]'), { options: () => allTaskTags(), maxVisible: 12 });
  for (const input of form.querySelectorAll('input[name^="relation-"]')) {
    window.FrameworkAutocomplete?.attach(input, { options: () => relationAutocompleteOptions(form.dataset.key), maxVisible: 12, minWidth: 420 });
  }
}

function relationItems(label, keys) {
  if (keys.length === 0) return [];
  const links = keys.map((key) => {
    const task = state.tasks.find((item) => item.key === key);
    const text = task?.metadata?.displayId || key;
    const action = task ? `data-related-key="${escapeHtml(key)}"` : '';
    const canRemove = ['blocked by', 'parent', 'child', 'related'].includes(label);
    const removable = task && canRemove ? `<button class="relation-remove" type="button" data-remove-relation="${escapeHtml(label)}" data-related-key="${escapeHtml(key)}" title="Remove ${escapeHtml(label)} ${escapeHtml(key)}">×</button>` : '';
    return `<span class="relation-item"><button class="relation-link" type="button" ${action} title="${escapeHtml(key)}">${escapeHtml(text)}</button>${removable}</span>`;
  }).join('<span class="relation-separator">,</span>');
  return [`<span class="relation-pill" title="${escapeHtml(label)}"><span>${escapeHtml(label)}</span><strong>${links}</strong></span>`];
}

function renderRuns(runs) {
  if (runs.length === 0) return '<p class="muted">No run logs found.</p>';
  return runs.map((run) => `<article class="timeline-item"><div class="timeline-dot"></div><button type="button" class="timeline-card open-preview" data-preview-kind="run" data-preview-path="${escapeHtml(run.file)}"><strong>${escapeHtml(run.title)}</strong></button></article>`).join('');
}

function renderFiles(files) {
  if (files.length === 0) return '<p class="muted">No task files found.</p>';
  return files.map((file) => {
    const contents = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(file.path)}</span>`;
    if (!file.previewable) return `<div class="file-card">${contents}</div>`;
    return `<button type="button" class="file-card open-preview" data-preview-kind="file" data-preview-path="${escapeHtml(file.path)}">${contents}</button>`;
  }).join('');
}

function renderHistory(events) {
  if (events.length === 0) return '<p class="muted">No metadata history yet.</p>';
  return events.map((event) => {
    const fields = Object.keys(event.changes || {});
    const title = formatHistoryTitle(event, fields);
    const details = fields.map((field) => `<span class="history-change ${field === 'status' ? 'status-change' : ''}">${escapeHtml(field)}: <strong>${escapeHtml(formatHistoryValue(event.changes[field]?.before))}</strong> → <strong>${escapeHtml(formatHistoryValue(event.changes[field]?.after))}</strong></span>`).join('');
    return `<article class="history-item ${fields.includes('status') ? 'has-status' : ''}"><div><strong>${title}</strong><p>${details}</p><span>${escapeHtml(historyMeta(event))}</span></div></article>`;
  }).join('');
}

function formatHistoryTitle(event, fields) {
  const when = event.timestamp ? new Date(event.timestamp).toLocaleString() : 'unknown time';
  if (event.changes?.status) return `Status ${event.changes.status.before || 'unset'} → ${event.changes.status.after || 'unset'} • ${when}`;
  return `${fields.join(', ') || 'metadata'} changed • ${when}`;
}
function formatHistoryValue(value) { return Array.isArray(value) ? value.join(', ') || '[]' : value ?? 'null'; }
function historyMeta(event) { return [event.actor, event.role, event.sessionTool, event.sessionId, event.source].filter(Boolean).join(' • ') || 'unknown source'; }

export function continuePrompt(task) {
  const prompt = `Use task-pickup skill for task ${task.key}`;
  const status = String(task.metadata?.status || '').toLowerCase();
  const type = String(task.metadata?.type || '').toLowerCase();
  if (status === 'review') return `${prompt} as an Oracle and use review-and-test skill`;
  if (type === 'implementation' && ['active', 'planned'].includes(status)) {
    return `${prompt} as a Builder. Understand the task and check if it's ready for implementation from a senior developer point of view. If it's ready start implementation and if not let's clarify what's not clear`;
  }
  return prompt;
}
