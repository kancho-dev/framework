// §8 provenance model. Pure functions over the merged payload so the status
// card's colour invariant and the deep-link capability rule are unit-testable
// without a browser — they are the two places a merged view can lie to a user.

/**
 * §8.3 traffic lights encode *trust in the totals*, not liveness:
 * red = a number is missing, amber = included but not current, green = fresh.
 * A currency-excluded source is red even though its tokens are included,
 * because its money is what went missing (§8.3's "currency-excluded" row).
 */
export function sourceTone(source) {
  // A source the user turned off is not a fault: §6 lists it without even a
  // warning, and §8.3's red list does not include it. Red here would train the
  // user to ignore the colour they most need to notice.
  if (source.state === 'disabled') return 'off';
  if (!source.included || source.costsExcluded) return 'red';
  if (source.staleReport || source.staleFetch || source.coverageMode === 'limited') return 'amber';
  return 'green';
}

export function sourceRows(sources = [], { now = Date.now() } = {}) {
  return sources.map((source) => ({
    key: sourceLabel(source),
    isLocal: Boolean(source.isLocal),
    tone: sourceTone(source),
    state: stateWord(source),
    // The local row carries no precomputed age — its ages are only meaningful
    // against the reader's clock, and §8.3 gives it a row like any other.
    reportAge: relativeAge(source.reportAgeHours ?? ageHours(source.generatedAt, now)),
    generatedAt: source.generatedAt ?? null,
    lastSuccessAt: source.lastSuccessAt ?? null,
    // A local scan and a `file` source are never "reached" over a transport,
    // so an age here would invent a fetch that never happened.
    fetchAge: source.isLocal || source.type === 'file' ? null : relativeAge(source.fetchAgeHours),
    records: Number(source.records) || 0,
    note: sourceNote(source),
  }));
}

function sourceLabel(source) {
  if (source.isLocal) return `${source.sourceKey || 'this machine'} · this workspace`;
  return source.sourceKey ? `${source.sourceKey} (${source.id})` : String(source.id ?? 'unknown source');
}

function stateWord(source) {
  if (!source.included) return source.state === 'disabled' ? 'disabled' : `excluded — ${source.state}`;
  if (source.costsExcluded) return 'costs excluded';
  if (source.staleReport || source.staleFetch) return 'included, not current';
  if (source.coverageMode === 'limited') return 'included, limited history';
  return 'ok';
}

/**
 * §6.1: the four age combinations are different situations, and collapsing them
 * into one "stale" would report *we could not check* as *nothing changed*.
 */
function sourceNote(source) {
  if (source.costsExcludedReason) return `costs not counted: ${source.costsExcludedReason}`;
  if (!source.included) return source.detail || null;
  if (source.staleReport && source.staleFetch) return 'we have not been able to check this machine; its last known data is included.';
  if (source.staleReport) return 'reachable, but nothing newer has happened there; past usage is included.';
  if (source.staleFetch) return 'included from the last known good report; we could not reach this machine.';
  if (source.fromCache && source.state !== 'ok') return `using a recent cached report; latest refresh attempt failed (${source.state}).`;
  if (source.coverageMode === 'limited') return 'covers a limited history, so combined totals are not full-history.';
  return null;
}

function ageHours(timestamp, now) {
  const parsed = Date.parse(timestamp ?? '');
  return Number.isFinite(parsed) ? (now - parsed) / 3_600_000 : null;
}

// A remote clock ahead of the local one yields a negative age (§6.1's clock
// anomaly); rendering "-3h ago" would read as a bug rather than as skew.
export function relativeAge(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  const value = Number(hours);
  if (value < 0) return 'just now';
  if (value < 1) return 'under an hour ago';
  if (value < 24) return `${Math.round(value)}h ago`;
  return `${Math.round(value / 24)}d ago`;
}

/**
 * §8.2's one capability rule: a row links if and only if the session it points
 * at is reachable from this Cockpit. Locality is not the test — registration
 * is — and every missing condition fails closed to an inert labelled row.
 */
export function linkTarget(record, context = {}) {
  const { machineId, workspaces = [], workspaceRoot, cockpitWorkspaces = [] } = context;
  if (!record?.sessionBrowserPath) return null;
  if (!machineId || record.sourceKey !== machineId) return null;
  const root = workspaces.find((workspace) => workspace.id === record.workspaceId)?.root;
  if (!root) return null;
  // The current workspace keeps linking exactly as it does today; anything else
  // must be a Cockpit workspace with Session Browser actually enabled.
  if (root === workspaceRoot) return { root, workspaceId: null };
  const cockpit = cockpitWorkspaces.find((workspace) => workspace.root === root && workspace.tools?.['session-browser'] === true);
  return cockpit ? { root, workspaceId: cockpit.id } : null;
}

/**
 * The href half of the §8.2 rule, kept here rather than in `app.js` so the
 * "this row points at nothing addressable" case is testable alongside the
 * capability cases. `hrefFor` is the shared session-link resolver.
 */
export function sessionLinkFor(record, context, hrefFor) {
  const target = linkTarget(record, context);
  if (!target) return null;
  const href = hrefFor(record);
  if (!href) return null;
  return { href: target.workspaceId ? withWorkspace(href, target.workspaceId) : href, root: target.root };
}

function withWorkspace(href, workspaceId) {
  const [beforeHash, hash = ''] = href.split('#', 2);
  const [path, query = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('workspace', workspaceId);
  return `${path}?${params}${hash ? `#${hash}` : ''}`;
}

/**
 * §8.2's silent-failure guard: when the artifact was scanned under scopes this
 * install no longer resolves, no row links and nothing says why. Say why.
 */
export function scopeMismatchWarning(linkTargets) {
  const unresolved = linkTargets?.unresolvedWorkspaces || [];
  if (!unresolved.length) return null;
  return `Session links are unavailable for ${unresolved.join(', ')}: this analysis was scanned under a workspace layout that no longer matches local configuration. Re-run the analysis to restore them.`;
}

export function provenanceLabel(record) {
  const machineId = record?.sourceKey || 'unknown-machine';
  const workspaceId = record?.workspaceId || 'unknown-workspace';
  return `${machineId}/${workspaceId}`;
}

/**
 * §8.4: never a bare total when something was left out of it. Reads the
 * structured merge block rather than parsing the prose warnings.
 */
export function totalsDisclosure(merge) {
  if (!merge?.sources?.length) return null;
  const included = merge.sources.filter((source) => source.included);
  const parts = [`Totals include ${included.length} of ${merge.sources.length} workspaces.`];
  for (const source of merge.sources.filter((source) => !source.included)) {
    parts.push(`${source.id} excluded: ${source.detail || source.state}.`);
  }
  for (const source of included.filter((source) => source.costsExcluded)) {
    parts.push(`${source.id} contributes tokens but no costs: ${source.costsExcludedReason}.`);
  }
  if (merge.unidentifiableExcluded) parts.push(`${merge.unidentifiableExcluded} records were excluded for lacking a usable identity.`);
  return parts.join(' ');
}

/**
 * §5.9's contagion sets `limited` with no local limit, because the limit
 * belongs to another machine's scan. Rendering "latest null" would read as a
 * bug rather than as an imported source covering only part of its history.
 */
export function analysisLabel(analysis) {
  if (analysis?.mode === 'limited') {
    return analysis.limit == null
      ? 'limited history — a source covers only part of its history'
      : `limited to latest ${analysis.limit} sessions/files per source`;
  }
  return analysis?.mode === 'full-history' ? 'full-history' : 'analysis scope unknown';
}
