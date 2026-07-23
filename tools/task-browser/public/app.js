import { els } from './dom-elements.js';
import { state, selectedTask, selectTaskKey, continuityKey, persistSelectedKey } from './state.js';
import { unique, sortTasks } from './task-utils.js';
import { restoreFilters, persistFilters, resetFilters, renderStatusFilters, matches, fillSelect } from './filters.js';
import { captureBoardScroll, restoreBoardScroll, renderBoard, showSelectedTaskInBoard as revealSelectedTaskInBoard, scrollSelectedCardIntoView, shouldRevealRestoredSelection } from './board.js';
import { captureDetailFocus, isEditingAutocompleteInput, restoreDetailFocus, renderDetail, attachDetailAutocompletes, continuePrompt } from './detail.js';
import { fetchTasks, saveMetadata, saveSteeringNotes } from './api.js';
import { editSteeringDraft, savedSteeringDraft } from './steering-notes.js';
import { addRelationPatch, currentTags, relationInput, removeRelationPatch, taskKeyFromRelationInput } from './relations.js';
import { clearRequestedSelection, requestedSelection } from './selection.js';

window.FrameworkWorkspaceBadge?.set(els.workspaceName, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace' });

function restoreSelectedKey() {
  if (state.selectedKey) return;
  const requested = requestedSelection();
  if (requested.key && state.tasks.some((item) => item.key === requested.key)) {
    state.selectedKey = requested.key;
    persistSelectedKey();
    showSelectedTaskInBoard();
    return;
  }
  if (requested.status && state.statuses.includes(requested.status)) {
    const candidate = sortTasks(requested.status, state.tasks.filter((task) => task.metadata?.status === requested.status))[0];
    if (candidate) {
      state.selectedKey = candidate.key;
      persistSelectedKey();
      showSelectedTaskInBoard();
      return;
    }
  }
  const key = localStorage.getItem(continuityKey());
  if (state.tasks.some((item) => item.key === key)) state.selectedKey = key;
}

function showSelectedTaskInBoard() {
  revealSelectedTaskInBoard();
  persistFilters();
  renderStatusFilters();
}

async function load() {
  els.status.textContent = 'Scanning tasks…';
  await loadTasks({ preserveScroll: true });
}

async function loadTasks({ preserveScroll = false, revealRestoredSelection = true } = {}) {
  if (isEditingAutocompleteInput()) return;
  const boardScroll = preserveScroll ? captureBoardScroll() : null;
  const data = await fetchTasks();
  Object.assign(state, data);
  if (state.selectedStatuses.size === 0) state.selectedStatuses = new Set(data.statuses.filter((status) => !['done', 'paused'].includes(status)));
  restoreSelectedKey();
  document.title = `${data.workspaceName} - Tasks`;
  window.FrameworkWorkspaceBadge?.set(els.workspaceName, { name: data.workspaceName, root: data.workspaceRoot, tooltipPrefix: 'Workspace' });
  renderStatusFilters();
  fillSelect(els.projectFilter, unique(data.tasks.map((task) => task.project)), 'All projects');
  fillSelect(els.priorityFilter, data.priorities, 'All priorities');
  restoreFilters();
  renderStatusFilters();
  if (revealRestoredSelection && shouldRevealRestoredSelection(continuityKey())) state.revealSelectedInBoard = true;
  render({ preserveScroll: boardScroll });
}

function render({ preserveScroll = null } = {}) {
  const boardScroll = preserveScroll === true ? captureBoardScroll() : preserveScroll;
  const focus = captureDetailFocus();
  const visible = state.tasks.filter(matches);
  if (state.selectedKey && !state.tasks.some((task) => task.key === state.selectedKey)) {
    state.selectedKey = null;
    persistSelectedKey();
  }
  document.body.classList.toggle('detail-open', Boolean(state.selectedKey));
  els.status.textContent = `${visible.length} of ${state.tasks.length} tasks • metadata: ${state.metadataPath}`;
  renderBoard(visible);
  window.FrameworkAutocomplete?.cleanup(els.detailMeta);
  renderDetail(selectedTask());
  attachDetailAutocompletes();
  restoreDetailFocus(focus);
  if (boardScroll && !state.revealSelectedInBoard) restoreBoardScroll(boardScroll);
  requestAnimationFrame(scrollSelectedCardIntoView);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
  els.status.textContent = 'Copied task prompt.';
}

async function saveMetadataPatch(form, patch) {
  await saveMetadata(form.dataset.key, patch);
  render({ preserveScroll: true });
}

els.board.addEventListener('click', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  selectTaskKey(card.dataset.key);
  render({ preserveScroll: true });
});
els.board.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  event.dataTransfer.setData('text/plain', card.dataset.key);
  event.dataTransfer.effectAllowed = 'move';
});
els.board.addEventListener('dragover', (event) => {
  const zone = event.target.closest('.drop-zone');
  els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
  if (!zone) return;
  event.preventDefault();
  zone.closest('.column')?.classList.add('drop-target');
  event.dataTransfer.dropEffect = 'move';
});
els.board.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget || !els.board.contains(event.relatedTarget)) els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
});
els.board.addEventListener('drop', async (event) => {
  const zone = event.target.closest('.drop-zone');
  if (!zone) return;
  event.preventDefault();
  els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
  const key = event.dataTransfer.getData('text/plain');
  const task = state.tasks.find((item) => item.key === key);
  if (!task || task.metadata?.status === zone.dataset.status) return;
  try {
    await saveMetadata(key, { status: zone.dataset.status });
    render({ preserveScroll: true });
  } catch (error) {
    els.status.textContent = error.message;
  }
});

els.refresh.addEventListener('click', () => load().catch((error) => { els.status.textContent = error.message; }));
setInterval(() => {
  if (!els.autoRefresh.checked) return;
  loadTasks({ preserveScroll: true, revealRestoredSelection: false }).catch((error) => { els.status.textContent = error.message; });
}, 10_000);
els.filter.addEventListener('input', () => { persistFilters(); render(); });
els.statusFilter.addEventListener('change', (event) => {
  if (event.target.type !== 'checkbox') return;
  if (event.target.checked) state.selectedStatuses.add(event.target.value);
  else state.selectedStatuses.delete(event.target.value);
  persistFilters();
  render();
});
els.projectFilter.addEventListener('change', () => { persistFilters(); render(); });
els.priorityFilter.addEventListener('change', () => { persistFilters(); render(); });
els.clear.addEventListener('click', () => { resetFilters(); render(); });

function closeDetail() {
  selectTaskKey(null);
  const url = clearRequestedSelection(new URL(location.href));
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  render();
}

els.closeDetail.addEventListener('click', closeDetail);
els.detailMeta.addEventListener('input', (event) => {
  const form = event.target.closest('.inline-metadata-editor');
  if (!form) return;
  if (event.target.name === 'newTag') state.tagDrafts[form.dataset.key] = event.target.value;
  if (String(event.target.name || '').startsWith('relation-')) state.relationDrafts[`${form.dataset.key}:${event.target.name.replace('relation-', '')}`] = event.target.value;
});
els.detailMeta.addEventListener('change', (event) => {
  const form = event.target.closest('.inline-metadata-editor');
  if (!form || event.target.name === 'newTag' || String(event.target.name || '').startsWith('relation-')) return;
  if (event.target.name === 'order' && !event.target.validity.valid) {
    els.status.textContent = 'Order must be a positive whole number.';
    return;
  }
  const value = event.target.name === 'order' ? event.target.value || null : event.target.value;
  saveMetadataPatch(form, { [event.target.name]: value }).catch((error) => { els.status.textContent = error.message; });
});
els.detailMeta.addEventListener('click', (event) => {
  const showSelected = event.target.closest('.show-selected-in-board');
  if (showSelected) {
    showSelectedTaskInBoard();
    render({ preserveScroll: true });
    return;
  }
  const toggleRelations = event.target.closest('.toggle-relations');
  if (toggleRelations) {
    state.relationEditorOpen = !state.relationEditorOpen;
    render({ preserveScroll: true });
    return;
  }
  const copy = event.target.closest('.copy-resume');
  if (copy) {
    const task = selectedTask();
    if (task) copyText(continuePrompt(task));
    return;
  }
  const form = event.target.closest('.inline-metadata-editor');
  const setParent = event.target.closest('.set-parent');
  if (form && setParent) {
    addRelation(form, 'parent');
    return;
  }
  const addRelationButton = event.target.closest('.add-relation');
  if (form && addRelationButton) {
    addRelation(form, addRelationButton.dataset.field);
    return;
  }
  const removeRelationButton = event.target.closest('.relation-remove');
  if (form && removeRelationButton) {
    removeRelation(form, removeRelationButton.dataset.removeRelation, removeRelationButton.dataset.relatedKey);
    return;
  }
  const relation = event.target.closest('[data-related-key]');
  if (relation) {
    selectTaskKey(relation.dataset.relatedKey);
    render({ preserveScroll: true });
    return;
  }
  const button = event.target.closest('.remove-tag');
  if (!button) return;
  const tagForm = button.closest('.inline-metadata-editor');
  saveMetadataPatch(tagForm, { tags: currentTags(tagForm).filter((tag) => tag !== button.dataset.tag) }).catch((error) => { els.status.textContent = error.message; });
});
function addRelation(form, field) {
  const input = relationInput(form, field);
  const relatedKey = taskKeyFromRelationInput(input?.value, state.tasks);
  if (!relatedKey) {
    els.status.textContent = 'Choose a single matching task by ID, key, or title.';
    return;
  }
  saveMetadataPatch(form, addRelationPatch(selectedTask(), field, relatedKey))
    .then(() => { if (input) input.value = ''; })
    .catch((error) => { els.status.textContent = error.message; });
}

function removeRelation(form, label, relatedKey) {
  const patch = removeRelationPatch(selectedTask(), label, relatedKey);
  if (!patch) return;
  saveMetadataPatch(form, patch).catch((error) => { els.status.textContent = error.message; });
}

els.steeringNotesDisclosure.addEventListener('toggle', () => {
  if (state.selectedKey) state.steeringOpen[state.selectedKey] = els.steeringNotesDisclosure.open;
});

els.steeringNotes.addEventListener('input', (event) => {
  if (event.target.name !== 'steeringNotes') return;
  const form = event.target.closest('.steering-notes-editor');
  state.steeringDrafts[form.dataset.key] = editSteeringDraft(state.steeringDrafts[form.dataset.key], event.target.value);
  form.querySelector('.save-steering').disabled = false;
  const status = form.querySelector('.steering-state');
  status.className = 'steering-state dirty';
  status.textContent = 'Unsaved draft.';
});

async function persistSteeringNotes(form, content) {
  const key = form.dataset.key;
  const draft = state.steeringDrafts[key];
  try {
    const note = await saveSteeringNotes(key, content, draft.revision);
    state.steeringDrafts[key] = savedSteeringDraft(note);
    state.steeringOpen[key] = Boolean(note.content.trim());
    render({ preserveScroll: true });
  } catch (error) {
    draft.state = error.status === 409 ? 'conflict' : 'error';
    draft.message = error.message;
    render({ preserveScroll: true });
  }
}

els.steeringNotes.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target.closest('.steering-notes-editor');
  persistSteeringNotes(form, form.elements.steeringNotes.value);
});
els.steeringNotes.addEventListener('click', (event) => {
  const clear = event.target.closest('.clear-steering');
  if (!clear) return;
  persistSteeringNotes(clear.closest('.steering-notes-editor'), '');
});

els.detailMeta.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target.closest('.inline-metadata-editor');
  const input = form.querySelector('input[name="newTag"]');
  const tag = input.value.trim();
  if (!tag) return;
  state.tagDrafts[form.dataset.key] = '';
  saveMetadataPatch(form, { tags: [...new Set([...currentTags(form), tag])] }).catch((error) => { els.status.textContent = error.message; });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.selectedKey) closeDetail();
});

for (const select of [els.projectFilter, els.priorityFilter]) {
  window.FrameworkSelect?.attach(select, { maxVisible: 12 });
}

load().catch((error) => { els.status.textContent = error.message; });
