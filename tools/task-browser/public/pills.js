import { escapeHtml } from '/shared/browser/dom.js';
import { projectColor } from './state.js';
import { nextActorIcon } from './next-actor.js';

function metaIcon(label) {
  const icons = { status: '◉', priority: '◆', type: '▣' };
  return icons[label] || '•';
}

export function metaPill(label, text, cls = '') {
  return `<span class="meta-pill ${cls}" title="${escapeHtml(label)}: ${escapeHtml(text)}"><span aria-label="${escapeHtml(label)}">${metaIcon(label)}</span><strong>${escapeHtml(text)}</strong></span>`;
}

export function editableMetaPill(label, value, options, cls = '') {
  return `<label class="meta-pill editable ${cls}" title="Edit ${escapeHtml(label)}"><span aria-label="${escapeHtml(label)}">${metaIcon(label)}</span><select name="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
}

export function editableNextActorPill(value) {
  const actor = value === 'operator' || value === 'agent' ? value : '';
  const options = [['', 'Next actor: Unset'], ['operator', 'Next actor: Operator'], ['agent', 'Next actor: Agent']];
  const icon = actor ? nextActorIcon(actor) : '◇';
  return `<label class="meta-pill editable next-actor-editor ${actor || 'unset'}" title="Edit next actor"><span class="next-actor-editor-icon" aria-hidden="true">${icon}</span><select name="nextActor" aria-label="Next actor">${options.map(([option, label]) => `<option value="${option}" ${option === actor ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

export function labelPill(text) {
  return `<span class="label-pill" title="tag: ${escapeHtml(text)}"><span aria-label="tag">⌁</span><strong>${escapeHtml(text)}</strong></span>`;
}

export function projectPill(project) {
  const color = projectColor(project);
  return `<span class="project-pill" style="--project-color:${color}; --project-bg:${color}22; --project-border:${color}66" title="project: ${escapeHtml(project)}"><span aria-label="project">▰</span><strong>${escapeHtml(project)}</strong></span>`;
}
