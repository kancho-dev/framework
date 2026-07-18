const ICONS = {
  operator: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="5" r="2.5"/><path d="M3.5 14c.2-3 1.7-4.5 4.5-4.5s4.3 1.5 4.5 4.5z"/></svg>',
  agent: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3" y="4" width="10" height="8" rx="2"/><path d="M8 1.5V4M1.5 7.5H3m10 0h1.5M6 10.25h4"/><circle cx="6" cy="7.5" r=".8"/><circle cx="10" cy="7.5" r=".8"/></svg>',
};

export function nextActorLabel(actor) {
  if (actor === 'operator') return 'Next action: Operator';
  if (actor === 'agent') return 'Next action: Agent';
  return null;
}

export function nextActorIcon(actor) {
  return ICONS[actor] || '';
}

export function nextActorBadge(actor) {
  const label = nextActorLabel(actor);
  if (!label) return '';
  return `<span class="next-actor-badge ${actor}" role="img" aria-label="${label}" title="${label}">${nextActorIcon(actor)}</span>`;
}
