// The analysis-context bar's view model. The bar lives in the sticky dashboard
// header, so its labels must say what the control is and what is selected
// *before* it is opened — the previous panel relied on prose beside the control,
// which stops working the moment the affected views scroll out of sight.
//
// Pure and HTML-free: `app.js` owns the markup, this owns what the markup says.

// One scope statement for the whole dashboard. Repeating it per panel added
// text without making the interaction clearer, so it is stated once, here.
export const AFFECTS_COPY = 'Affects Daily token usage and Usage breakdown. Sources, monthly spend, subscriptions and the all-time cards are never filtered.';
// Selector totals are all-record token usage, never the current cohort: they are
// orientation ("where does my usage live?"), and a denominator that moved with
// the selection would make the list unreadable while filtering.
export const TOTALS_LABEL = 'all-record tokens';

// Ordered what-ran then where-it-ran, which is how the cohort reads aloud:
// "these tools on these models, on these machines, in these workspaces".
const FACETS = [
  { name: 'source', title: 'Agent tools', singular: 'agent tool', source: 'sources' },
  { name: 'model', title: 'Models', singular: 'model', source: 'models' },
  { name: 'machine', title: 'Machines', singular: 'machine', source: 'machines' },
  { name: 'workspace', title: 'Workspaces', singular: 'workspace', source: 'workspaces' },
];

/**
 * @param options  `usageFilterOptions` output: the full facet lists with
 *                 all-record token totals.
 * @param selection `{ machineIds: Set, workspaceKeys: Set }` — the live cohort.
 */
export function filterBarModel(options = {}, selection = {}) {
  const facets = FACETS.map((facet) => buildFacet(facet, options[facet.source] || [], selected(selection, facet.name)));
  const count = facets.reduce((total, facet) => total + facet.count, 0);
  return {
    facets,
    chips: facets.flatMap((facet) => facet.options.filter((option) => option.checked).map((option) => chip(facet, option))),
    active: count > 0,
    count,
    combined: { name: 'all', title: 'Filters', label: triggerLabel('Filters', count), count },
    affects: AFFECTS_COPY,
    totalsLabel: TOTALS_LABEL,
  };
}

function buildFacet(facet, available, chosen) {
  const options = available.map((option) => ({ ...option, checked: chosen.has(option.value) }));
  // A value that vanished from the report (a source removed, a workspace
  // renamed) would otherwise filter everything to nothing with no visible cause
  // and no way to clear it. It stays selectable so the user can take it off.
  const missing = [...chosen].filter((value) => !available.some((option) => option.value === value));
  const all = [...options, ...missing.map((value) => ({ value, label: value, tokens: 0, checked: true, stale: true }))];
  return { ...facet, options: all, count: chosen.size, total: available.length, label: triggerLabel(facet.title, chosen.size) };
}

/** `Machines · All` before it is touched, `Machines · 2 selected` after. */
function triggerLabel(title, count) { return `${title} · ${count ? `${count} selected` : 'All'}`; }

function chip(facet, option) {
  return { name: facet.name, value: option.value, label: option.label, stale: Boolean(option.stale), remove: `Remove ${facet.singular} filter ${option.label}` };
}

const SELECTION_KEYS = { source: 'sources', model: 'models', machine: 'machineIds', workspace: 'workspaceKeys' };

function selected(selection, name) {
  const set = selection[SELECTION_KEYS[name]];
  return set instanceof Set ? set : new Set(set || []);
}

/**
 * The filtered panels' own state — a description, not a control. The badge
 * stands for the whole cohort, so sending a click to one facet would name an
 * arbitrary part of what it describes; the header remains the only place a
 * cohort is edited.
 */
export function panelFilterState(model) {
  return model.active ? { active: true, label: `Filtered · ${model.count}`, title: model.affects } : { active: false };
}
