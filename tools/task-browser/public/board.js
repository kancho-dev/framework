import { escapeHtml } from '/shared/browser/dom.js';
import { els } from './dom-elements.js';
import { state, projectColor, selectedTask } from './state.js';
import { sortTasks } from './task-utils.js';
import { matches } from './filters.js';
import { metaPill, labelPill, projectPill } from './pills.js';
import { nextActorBadge } from './next-actor.js';
import { pendingSteeringIndicator } from './steering-notes.js';

export function captureBoardScroll() {
  return { left: els.board.scrollLeft, top: els.board.scrollTop, columns: columnScrollPositions() };
}

function columnScrollPositions() {
  return Object.fromEntries([...els.board.querySelectorAll('.column[data-status]')].map((column) => [column.dataset.status, column.scrollTop]));
}

export function restoreBoardScroll(scroll) {
  els.board.scrollLeft = scroll.left;
  els.board.scrollTop = scroll.top;
  for (const column of els.board.querySelectorAll('.column[data-status]')) column.scrollTop = scroll.columns[column.dataset.status] || 0;
}

export function renderBoard(visible) {
  els.board.innerHTML = state.statuses.filter((status) => state.selectedStatuses.has(status)).map((status) => renderColumn(status, sortTasks(status, visible.filter((task) => task.metadata?.status === status)))).join('');
}

function renderColumn(status, tasks) {
  return `<section class="column" data-status="${escapeHtml(status)}"><h3>${escapeHtml(status)} <span>${tasks.length}</span></h3><div class="drop-zone" data-status="${escapeHtml(status)}">${tasks.map(renderCard).join('') || '<p class="muted">No tasks</p>'}</div></section>`;
}

function renderCard(task) {
  const meta = task.metadata || {};
  const active = task.key === state.selectedKey ? ' active' : '';
  const tags = (meta.tags || []).slice(0, 4).map((tag) => labelPill(tag)).join('');
  const steering = pendingSteeringIndicator(task.hasPendingSteeringNotes);
  return `<button class="task-card${active}" draggable="true" data-key="${escapeHtml(task.key)}"><div class="card-top"><span class="card-identity"><span class="display-id">${escapeHtml(meta.displayId)}</span>${nextActorBadge(meta.nextActor)}${steering}</span>${projectPill(task.project)}</div><span class="card-slug" title="${escapeHtml(task.slug)}">${escapeHtml(task.slug)}</span><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.nextSteps || task.handoff || task.purpose || 'No handoff summary.')}</p><div class="card-meta">${metaPill('priority', meta.priority, `priority ${meta.priority}`)}${metaPill('type', meta.type, 'type')}${tags}</div></button>`;
}

export function showSelectedTaskInBoard() {
  const task = selectedTask();
  if (!task) return;
  els.filter.value = '';
  els.projectFilter.value = 'all';
  els.priorityFilter.value = 'all';
  if (task.metadata?.status) state.selectedStatuses.add(task.metadata.status);
  state.revealSelectedInBoard = true;
}

export function scrollSelectedCardIntoView() {
  if (!state.revealSelectedInBoard || !state.selectedKey) return;
  state.revealSelectedInBoard = false;
  const card = els.board.querySelector(`.task-card[data-key="${CSS.escape(state.selectedKey)}"]`);
  card?.scrollIntoView({ block: 'center', inline: 'center' });
}

export function shouldRevealRestoredSelection(continuityKey) {
  const key = localStorage.getItem(continuityKey);
  return Boolean(key && key === state.selectedKey && state.tasks.some((task) => task.key === key && matches(task)));
}
