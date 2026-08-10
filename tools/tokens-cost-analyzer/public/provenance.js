// The provenance model. Pure functions over the merged payload so the status
// card's colour invariant and the deep-link capability rule are unit-testable
// without a browser — they are the two places a merged view can lie to a user.

/**
 * The traffic lights encode *trust in the totals*, not liveness:
 * red = a number is missing, amber = included but not current, green = fresh.
 * A currency-excluded source is red even though its tokens are included,
 * because its money is what went missing.
 */
export function sourceTone(source) {
  // A source the user turned off is not a fault: it is listed without even a
  // warning and is never red. Red here would train the user to ignore the
  // colour they most need to notice.
  if (source.state === 'disabled') return 'off';
  if (!source.included || source.costsExcluded) return 'red';
  // Deliberately *after* the exclusion checks: an archived report that is
  // missing, unreadable, or on an incompatible schema is a real fault and stays
  // red. Only a working one is archival-neutral.
  if (source.state === 'archived') return 'archive';
  if (source.staleReport || source.staleFetch || source.coverageMode === 'limited') return 'amber';
  return 'green';
}

export function sourceRows(sources = [], { now = Date.now() } = {}) {
  return sources.map((source) => ({
    key: sourceLabel(source),
    name: source.sourceKey || String(source.id ?? 'unknown source'),
    identity: source.isLocal ? 'local machine' : (source.sourceKey ? String(source.id ?? 'configured source') : 'configured source'),
    isLocal: Boolean(source.isLocal),
    tone: sourceTone(source),
    state: stateWord(source),
    // Additive and orthogonal. It sits *beside* the state word rather
    // than replacing it, so a refreshing source keeps reporting its current
    // truth — the guarantee that keeps the state word worth reading.
    refreshing: source.refreshing === true,
    // The local row carries no precomputed age — its ages are only meaningful
    // against the reader's clock, and it gets a row like any other.
    reportAge: relativeAge(source.reportAgeHours ?? ageHours(source.generatedAt, now)),
    generatedAt: source.generatedAt ?? null,
    lastSuccessAt: source.lastSuccessAt ?? null,
    // A local scan and a `file` source are never "reached" over a transport,
    // so an age here would invent a fetch that never happened.
    fetchAge: source.isLocal || source.type === 'file' || source.type === 'archived' ? null : relativeAge(source.fetchAgeHours),
    // What to print when there is no fetch age, decided here for the same reason
    // `noteTone` is: it is a judgement about what a row means, not a template
    // detail. "never reached" is true of a source we failed to contact, but on a
    // local file it describes a transport that was never going to happen and
    // reads as a fault on a row that is working exactly as intended.
    fetchLabel: fetchLabel(source),
    records: Number(source.records) || 0,
    note: sourceNote(source),
    // The note's treatment is decided here rather than in the template, because
    // "which colour explains this row" is the same judgement as `sourceTone`
    // and must not drift from it. Default is the warning treatment.
    noteTone: noteTone(source),
  }));
}

/**
 * A healthy archived source is neutral, and its explanation has to look neutral
 * too: an archival note in the warning treatment says "degraded" in colour while
 * saying "will not change" in words. A *broken* archive keeps the warning
 * treatment, because that one really is a fault.
 */
function fetchLabel(source) {
  if (source.isLocal) return 'local';
  if (source.type === 'archived') return 'archived file';
  if (source.type === 'file') return 'local file';
  const age = relativeAge(source.fetchAgeHours);
  return age || 'never reached';
}

function noteTone(source) {
  const tone = sourceTone(source);
  if (tone === 'green') return 'info';
  if (tone === 'archive') return 'archive';
  return '';
}

function sourceLabel(source) {
  if (source.isLocal) return `${source.sourceKey || 'this machine'} · this workspace`;
  return source.sourceKey ? `${source.sourceKey} (${source.id})` : String(source.id ?? 'unknown source');
}

function stateWord(source) {
  if (!source.included) return source.state === 'disabled' ? 'disabled' : `excluded · ${source.state}`;
  if (source.costsExcluded) return 'costs excluded';
  if (source.state === 'archived') return 'archived';
  if (source.staleReport || source.staleFetch) return 'not current';
  if (source.coverageMode === 'limited') return 'limited history';
  if (source.fromCache && source.state !== 'ok') return 'current · cached';
  return 'current';
}

/**
 * The four age combinations are different situations, and collapsing them
 * into one "stale" would report *we could not check* as *nothing changed*.
 */
function sourceNote(source) {
  if (source.costsExcludedReason) return `costs not counted: ${source.costsExcludedReason}`;
  if (!source.included) return source.detail || null;
  if (source.state === 'archived') return 'archived report from a retired machine; its history is included and will not change.';
  if (source.staleReport && source.staleFetch) return 'we have not been able to check this machine; its last known data is included.';
  if (source.staleReport) return 'reachable, but nothing newer has happened there; past usage is included.';
  if (source.staleFetch) return 'included from the last known good report; we could not reach this machine.';
  if (source.fromCache && source.state !== 'ok') return `Latest refresh failed (${source.state}); using the recent cached report.`;
  if (source.coverageMode === 'limited') return 'covers a limited history, so combined totals are not full-history.';
  return null;
}

function ageHours(timestamp, now) {
  const parsed = Date.parse(timestamp ?? '');
  return Number.isFinite(parsed) ? (now - parsed) / 3_600_000 : null;
}

// A remote clock ahead of the local one yields a negative age (clock skew);
// rendering "-3h ago" would read as a bug rather than as skew.
export function relativeAge(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  const value = Number(hours);
  if (value < 0) return 'just now';
  if (value < 1) return 'under an hour ago';
  if (value < 24) return `${Math.round(value)}h ago`;
  return `${Math.round(value / 24)}d ago`;
}

/**
 * The one capability rule: a row links if and only if the session it points
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
 * The href half of that rule, kept here rather than in `app.js` so the
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
 * The silent-failure guard: when the artifact was scanned under scopes this
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
 * Never a bare total when something was left out of it. Reads the
 * structured merge block rather than parsing the prose warnings.
 */
export function totalsDisclosure(merge) {
  if (!merge?.sources?.length) return null;
  const included = merge.sources.filter((source) => source.included);
  const parts = [`${included.length} of ${merge.sources.length} sources included.`];
  for (const source of merge.sources.filter((source) => !source.included)) {
    parts.push(`${source.id} excluded: ${source.detail || source.state}.`);
  }
  for (const source of included.filter((source) => source.costsExcluded)) {
    parts.push(`${source.id} contributes tokens but no costs: ${source.costsExcludedReason}.`);
  }
  if (merge.unidentifiableExcluded) parts.push(`${merge.unidentifiableExcluded} records were excluded for lacking a usable identity.`);
  return parts.join(' ');
}
