import { els } from './dom-elements.js';
import { state, selectedTask, selectTaskKey, continuityKey, persistSelectedKey } from './state.js';
import { unique, sortTasks } from './task-utils.js';
import { restoreFilters, persistFilters, resetFilters, renderStatusFilters, matches, fillSelect } from './filters.js';
import { captureBoardScroll, restoreBoardScroll, renderBoard, showSelectedTaskInBoard as revealSelectedTaskInBoard, scrollSelectedCardIntoView, shouldRevealRestoredSelection } from './board.js';
import { captureDetailFocus, restoreDetailFocus, renderDetail, renderDetailStatic, renderDetailMetadata, renderDetailSteering, attachDetailAutocompletes, continuePrompt } from './detail.js';
import { captureDetailViewState, restoreDetailViewState } from './detail-view-state.js';
import { fetchPreview, fetchTasks, moveBoardTask, saveMetadata, saveSteeringNotes } from './api.js';
import { boardDropMode, columnDragScrollDelta, hasOrderingFilters, insertionIndex, shouldClearDropFeedback } from './board-drag.js';
import { renderMarkdown } from './markdown.js';
import { outlineEntries } from './reader-outline.js';
import { editSteeringDraft, savedSteeringDraft } from './steering-notes.js';
import { addRelationPatch, currentTags, relationInput, removeRelationPatch, taskKeyFromRelationInput } from './relations.js';
import { clearRequestedSelection, requestedSelection } from './selection.js';
import { copyText as copyClipboardText, flashButton } from '/shared/browser/clipboard.js';
import { formatToolTitle } from '/shared/browser/format.js';
import { createRefreshInteractionRegistry } from '/shared/browser/refresh-interactions.js';
import { createRefreshCoordinator } from '/shared/refresh-coordinator.mjs';
import { workspaceFilterForTool } from '/shared/browser/workspace-tools.js';

const taskBrowserWorkspaceFilter = workspaceFilterForTool('task-browser');
window.FrameworkWorkspaceBadge?.set(els.workspaceName, { placeholder: 'Loading workspace…', tooltipPrefix: 'Workspace', workspaceFilter: taskBrowserWorkspaceFilter });

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

function reconcileSelectedTask() {
  if (state.selectedKey && !state.tasks.some((task) => task.key === state.selectedKey)) {
    state.selectedKey = null;
    persistSelectedKey();
  }
  document.body.classList.toggle('detail-open', Boolean(state.selectedKey));
}

let appliedGeneration = 0;
function applyRefreshData({ data, generation, reason }) {
  if (appliedGeneration >= generation) return;
  appliedGeneration = generation;
  Object.assign(state, data);
  if (state.selectedStatuses.size === 0) state.selectedStatuses = new Set(data.statuses.filter((status) => !['done', 'paused'].includes(status)));
  restoreSelectedKey();
  reconcileSelectedTask();
  document.title = formatToolTitle(data.workspaceName, 'Tasks');
  window.FrameworkWorkspaceBadge?.set(els.workspaceName, { name: data.workspaceName, root: data.workspaceRoot, tooltipPrefix: 'Workspace', workspaceFilter: taskBrowserWorkspaceFilter });
  fillSelect(els.projectFilter, unique(data.tasks.map((task) => task.project)), 'All projects');
  fillSelect(els.priorityFilter, data.priorities, 'All priorities');
  restoreFilters();
  renderStatusFilters();
  if (reason !== 'poll' && shouldRevealRestoredSelection(continuityKey())) state.revealSelectedInBoard = true;
}

function orderingDisabled() {
  return hasOrderingFilters({ query: els.filter.value, project: els.projectFilter.value, priority: els.priorityFilter.value });
}

function renderTaskCountStatus() {
  const visible = state.tasks.filter(matches);
  const dragStatus = orderingDisabled() ? ' • filtered: cross-column status moves enabled; reordering disabled' : '';
  els.status.textContent = `${visible.length} of ${state.tasks.length} tasks • metadata: ${state.metadataPath}${dragStatus}`;
}

function renderBoardUnit(transaction, boardScroll = captureBoardScroll()) {
  applyRefreshData(transaction);
  const visible = state.tasks.filter(matches);
  renderTaskCountStatus();
  renderBoard(visible, { orderingDisabled: orderingDisabled() });
  if (!state.revealSelectedInBoard) restoreBoardScroll(boardScroll);
  requestAnimationFrame(scrollSelectedCardIntoView);
}

const refresh = createRefreshCoordinator({
  fetchData: fetchTasks,
  onStatus: ({ phase, error }) => {
    if (phase === 'loading') els.status.textContent = 'Scanning tasks…';
    if (phase === 'refreshing') els.status.textContent = 'Refreshing tasks…';
    if (phase === 'update-ready') els.status.textContent = 'Fresh task data is ready; finish the active interaction to update.';
    if (phase === 'committed') renderTaskCountStatus();
    if (phase === 'error') els.status.textContent = error.message;
  },
});
function releaseUnit(key) {
  refresh.release(key).catch((error) => { els.status.textContent = error.message; });
}
const boardInteractions = createRefreshInteractionRegistry({ root: els.board, onRelease: () => releaseUnit('board') });
const metadataInteractions = createRefreshInteractionRegistry({ root: els.detailMeta, onRelease: () => releaseUnit('detail-metadata') });
const steeringInteractions = createRefreshInteractionRegistry({ root: els.steeringNotes, onRelease: () => releaseUnit('detail-steering') });
refresh.registerCommitUnit({ key: 'board', isDeferred: () => boardInteractions.isDeferred(els.board), commit: async (transaction) => renderBoardUnit(transaction) });
function hasStaticDetailSelection() {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return false;
  const contains = (root, node) => root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
  if (!contains(els.detail, selection.anchorNode) || !contains(els.detail, selection.focusNode)) return false;
  return !contains(els.detailMeta, selection.anchorNode)
    && !contains(els.detailMeta, selection.focusNode)
    && !contains(els.steeringNotes, selection.anchorNode)
    && !contains(els.steeringNotes, selection.focusNode);
}

let staticDetailSelectionActive = false;
document.addEventListener('selectionchange', () => {
  const active = hasStaticDetailSelection();
  if (staticDetailSelectionActive && !active) releaseUnit('detail');
  staticDetailSelectionActive = active;
});
function preserveDetailViewState(render) {
  const viewState = captureDetailViewState({ key: state.selectedKey, pane: els.detailPane, steeringRoot: els.steeringNotes });
  render();
  restoreDetailViewState(viewState, { key: state.selectedKey, pane: els.detailPane, steeringRoot: els.steeringNotes });
}

refresh.registerCommitUnit({
  key: 'detail',
  isDeferred: () => Boolean(selectedTask()) && hasStaticDetailSelection(),
  commit: async (transaction) => preserveDetailViewState(() => { applyRefreshData(transaction); renderDetailStatic(selectedTask()); }),
});
refresh.registerCommitUnit({
  key: 'detail-metadata',
  isDeferred: () => metadataInteractions.isDeferred(els.detailMeta),
  commit: async (transaction) => preserveDetailViewState(() => {
    applyRefreshData(transaction);
    const focus = captureDetailFocus();
    window.FrameworkAutocomplete?.cleanup(els.detailMeta);
    renderDetailMetadata(selectedTask());
    attachDetailAutocompletes();
    restoreDetailFocus(focus);
  }),
});
refresh.registerCommitUnit({
  key: 'detail-steering',
  isDeferred: () => steeringInteractions.isDeferred(els.steeringNotes)
    || els.steeringNotes.contains(document.activeElement)
    || Boolean(state.selectedKey && state.steeringDrafts[state.selectedKey]?.dirty),
  commit: async (transaction) => preserveDetailViewState(() => { applyRefreshData(transaction); renderDetailSteering(selectedTask()); }),
});

function render({ preserveScroll = null } = {}) {
  const boardScroll = preserveScroll === true ? captureBoardScroll() : preserveScroll;
  const focus = captureDetailFocus();
  const visible = state.tasks.filter(matches);
  reconcileSelectedTask();
  renderTaskCountStatus();
  renderBoard(visible, { orderingDisabled: orderingDisabled() });
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
let draggingKey = null;
function clearBoardDropFeedback() {
  els.board.querySelectorAll('.column.drop-target').forEach((column) => column.classList.remove('drop-target'));
  els.board.querySelectorAll('.insertion-target').forEach((target) => target.remove());
  els.board.querySelectorAll('.task-card.dragging').forEach((card) => card.classList.remove('dragging'));
}

els.board.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.task-card');
  if (!card) return;
  draggingKey = card.dataset.key;
  card.classList.add('dragging');
  event.dataTransfer.setData('text/plain', draggingKey);
  event.dataTransfer.effectAllowed = 'move';
});
els.board.addEventListener('dragover', (event) => {
  const zone = event.target.closest('.drop-zone');
  if (!zone || !draggingKey) return;
  const task = state.tasks.find((item) => item.key === draggingKey);
  const mode = boardDropMode({ filtered: orderingDisabled(), sourceStatus: task?.metadata?.status, destinationStatus: zone.dataset.status });
  if (mode === 'disabled') {
    clearBoardDropFeedback();
    els.status.textContent = zone.dataset.status === 'done'
      ? 'Done tasks are sorted by recency and cannot be reordered. Drag to another column to change status.'
      : 'Clear search, project, and priority filters to reorder within a column.';
    return;
  }
  event.preventDefault();
  clearBoardDropFeedback();
  els.board.querySelector(`.task-card[data-key="${CSS.escape(draggingKey)}"]`)?.classList.add('dragging');
  zone.closest('.column')?.classList.add('drop-target');
  if (mode === 'status-only') {
    els.status.textContent = `Drop to change status to ${zone.dataset.status}; order will stay unchanged.`;
    event.dataTransfer.dropEffect = 'move';
    return;
  }
  const column = zone.closest('.column');
  const columnBounds = column.getBoundingClientRect();
  column.scrollTop += columnDragScrollDelta({ pointerY: event.clientY, top: columnBounds.top, bottom: columnBounds.bottom });
  const cards = [...zone.querySelectorAll('.task-card')].map((card) => {
    const bounds = card.getBoundingClientRect();
    return { key: card.dataset.key, element: card, top: bounds.top, height: bounds.height };
  });
  const index = insertionIndex(cards, event.clientY, draggingKey);
  const candidates = cards.filter((card) => card.key !== draggingKey);
  const target = document.createElement('div');
  target.className = 'insertion-target';
  target.dataset.index = String(index);
  target.setAttribute('aria-hidden', 'true');
  if (candidates[index]) zone.insertBefore(target, candidates[index].element);
  else zone.append(target);
  event.dataTransfer.dropEffect = 'move';
});
els.board.addEventListener('dragleave', (event) => {
  if (shouldClearDropFeedback({ eventTargetIsBoard: event.target === els.board, relatedTargetInside: Boolean(event.relatedTarget && els.board.contains(event.relatedTarget)) })) clearBoardDropFeedback();
});
els.board.addEventListener('dragend', () => { draggingKey = null; clearBoardDropFeedback(); });
els.board.addEventListener('drop', async (event) => {
  const zone = event.target.closest('.drop-zone');
  const target = zone?.querySelector('.insertion-target');
  const key = draggingKey || event.dataTransfer.getData('text/plain');
  const task = state.tasks.find((item) => item.key === key);
  const mode = boardDropMode({ filtered: orderingDisabled(), sourceStatus: task?.metadata?.status, destinationStatus: zone?.dataset.status });
  if (!zone || (!target && mode !== 'status-only')) return;
  event.preventDefault();
  const index = target ? Number(target.dataset.index) : null;
  draggingKey = null;
  clearBoardDropFeedback();
  if (!task) return;
  try {
    if (mode === 'status-only') await saveMetadata(key, { status: zone.dataset.status });
    else await moveBoardTask(key, zone.dataset.status, index);
    render({ preserveScroll: true });
  } catch (error) {
    els.status.textContent = `${error.message} Board placement was not changed.`;
  }
});

els.refresh.addEventListener('click', () => refresh.request({ reason: 'manual', force: true }));
setInterval(() => {
  if (els.autoRefresh.checked) refresh.request({ reason: 'poll' });
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

let readerReturnFocus = null;

function setOutlineOpen(open) {
  els.reader.classList.toggle('outline-open', open);
  els.readerOutlineToggle.setAttribute('aria-expanded', String(open));
  els.readerOutline.inert = !open;
}

function buildReaderOutline() {
  const headings = [...els.readerContent.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const entries = outlineEntries(headings);
  els.readerOutlineList.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reader-outline-empty';
    empty.textContent = 'No headings in this document.';
    els.readerOutlineList.append(empty);
    return;
  }
  entries.forEach((entry, index) => {
    headings[index].id = entry.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'reader-outline-item';
    button.dataset.level = String(entry.level);
    button.textContent = entry.text;
    button.title = entry.text;
    button.addEventListener('click', () => headings[index].scrollIntoView({ behavior: 'smooth', block: 'start' }));
    els.readerOutlineList.append(button);
  });
}

function setReaderBackgroundInert(inert) {
  document.querySelector('.tasks-pane').inert = inert;
  els.detailPane.inert = inert;
}

function returnFocusTarget() {
  if (!readerReturnFocus) return null;
  return [...els.detail.querySelectorAll('.open-preview')].find((button) => button.dataset.previewKind === readerReturnFocus.kind && button.dataset.previewPath === readerReturnFocus.path);
}

function closeReader() {
  if (els.reader.classList.contains('hidden')) return;
  els.reader.classList.add('hidden');
  setReaderBackgroundInert(false);
  returnFocusTarget()?.focus();
  readerReturnFocus = null;
}

async function openReader(button) {
  const task = selectedTask();
  if (!task) return;
  readerReturnFocus = { kind: button.dataset.previewKind, path: button.dataset.previewPath };
  els.reader.classList.remove('hidden');
  setOutlineOpen(false);
  els.readerOutlineList.replaceChildren();
  setReaderBackgroundInert(true);
  els.readerTask.textContent = `${task.metadata?.displayId || ''} · ${task.slug}`;
  els.readerTitle.textContent = button.querySelector('strong')?.textContent || button.dataset.previewPath;
  els.readerPath.textContent = button.dataset.previewKind === 'run' ? `runs/${button.dataset.previewPath}` : button.dataset.previewPath;
  els.readerContent.innerHTML = '<p class="muted">Loading preview…</p>';
  els.closeReader.focus();
  try {
    const preview = await fetchPreview(task.key, button.dataset.previewPath, button.dataset.previewKind);
    els.readerPath.textContent = preview.path;
    els.readerContent.innerHTML = renderMarkdown(preview.content) || '<p class="muted">This Markdown file is empty.</p>';
    buildReaderOutline();
  } catch (error) {
    els.readerContent.innerHTML = `<p class="reader-error"></p>`;
    els.readerContent.querySelector('p').textContent = error.message;
    buildReaderOutline();
  }
}

function closeDetail() {
  closeReader();
  selectTaskKey(null);
  const url = clearRequestedSelection(new URL(location.href));
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  render();
}

els.closeDetail.addEventListener('click', closeDetail);
els.closeReader.addEventListener('click', closeReader);
els.readerOutlineToggle.addEventListener('click', () => setOutlineOpen(!els.reader.classList.contains('outline-open')));
els.readerOutlineClose.addEventListener('click', () => {
  setOutlineOpen(false);
  els.readerOutlineToggle.focus();
});
els.readerContent.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-code');
  if (!button) return;
  const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
  await copyClipboardText(code);
  flashButton(button);
});
let readerPointerDownOnBackdrop = false;
els.reader.addEventListener('mousedown', (event) => { readerPointerDownOnBackdrop = event.target === els.reader; });
els.reader.addEventListener('click', (event) => {
  if (event.target === els.reader && readerPointerDownOnBackdrop) closeReader();
  readerPointerDownOnBackdrop = false;
  if (els.reader.classList.contains('outline-open')
    && !event.target.closest('#reader-outline, #reader-outline-toggle')) setOutlineOpen(false);
});
els.detail.addEventListener('click', (event) => {
  const preview = event.target.closest('.open-preview');
  if (preview) openReader(preview);
});
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
    render({ preserveScroll: true });
    releaseUnit('detail-steering');
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
  const readerOpen = !els.reader.classList.contains('hidden');
  if (event.key === 'Escape') {
    if (readerOpen && els.reader.classList.contains('outline-open')) {
      setOutlineOpen(false);
      els.readerOutlineToggle.focus();
    } else if (readerOpen) closeReader();
    else if (state.selectedKey) closeDetail();
    return;
  }
  if (event.key !== 'Tab' || !readerOpen) return;
  const focusable = [...els.reader.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.closest('[inert]'));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

for (const select of [els.projectFilter, els.priorityFilter]) {
  window.FrameworkSelect?.attach(select, { maxVisible: 12 });
}

refresh.request({ reason: 'initial' });
