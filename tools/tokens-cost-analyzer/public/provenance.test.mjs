import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { linkTarget, provenanceLabel, relativeAge, scopeMismatchWarning, sessionLinkFor, sourceRows, sourceTone, totalsDisclosure } from './provenance.js';

function source(overrides = {}) {
  return { id: 'laptop', sourceKey: 'laptop', type: 'ssh', state: 'ok', included: true, costsExcluded: false, costsExcludedReason: null, detail: null, coverageMode: 'full-history', staleReport: false, staleFetch: false, reportAgeHours: 0.2, fetchAgeHours: 0.2, records: 3, ...overrides };
}

// The colour invariant: amber is not a degraded red. Asserted as a matrix
// because a single wrong cell trains the user to ignore the indicator.
test('the traffic light encodes trust in the totals, not liveness', () => {
  assert.equal(sourceTone(source()), 'green');
  assert.equal(sourceTone(source({ staleReport: true })), 'amber');
  assert.equal(sourceTone(source({ staleFetch: true })), 'amber');
  assert.equal(sourceTone(source({ coverageMode: 'limited' })), 'amber');
  for (const state of ['unreachable', 'unauthorized', 'missing', 'unreadable', 'invalid', 'incompatible']) {
    assert.equal(sourceTone(source({ state, included: false })), 'red', state);
  }
  // A source the user switched off is neither a fault nor a stale inclusion.
  assert.equal(sourceTone(source({ state: 'disabled', included: false })), 'off');
  // Included in tokens, excluded from money — red, because a number is missing.
  assert.equal(sourceTone(source({ costsExcluded: true, costsExcludedReason: 'currency mismatch (EUR vs USD)' })), 'red');
});

// An archived source is a third thing — neither live-and-fresh nor
// failing — and it must never read as a machine that is perpetually stale.
test('an archived source is neutral, and a broken archived file is still red', () => {
  const archived = source({ id: 'old-laptop', sourceKey: 'old-laptop', type: 'archived', state: 'archived', fetchAgeHours: null, lastSuccessAt: null, reportAgeHours: 20000 });

  assert.equal(sourceTone(archived), 'archive');
  assert.notEqual(sourceTone(archived), 'amber', 'a two-year-old archive is not "not current"');

  // Ordered after the exclusion checks: a missing or unreadable archived file
  // is a genuine fault and keeps the colour that says so.
  for (const state of ['missing', 'unreadable', 'invalid', 'incompatible']) {
    assert.equal(sourceTone(source({ type: 'archived', state, included: false })), 'red', state);
  }

  const [row] = sourceRows([archived]);
  assert.equal(row.state, 'archived');
  assert.equal(row.tone, 'archive');
  assert.equal(row.fetchAge, null, 'nothing was ever reached, so an age here would invent a fetch');
  assert.match(row.note, /retired machine/);
  assert.equal(row.records, 3, 'its history is counted like any other source');
});

// The note is the other half of the tone: an archival explanation rendered in
// the warning treatment says "degraded" in colour while saying "will not change"
// in words, and colour is what a user reads first.
test('an archival note is presented neutrally, and a broken archive keeps the warning treatment', async () => {
  const archived = source({ id: 'old', sourceKey: 'old', type: 'archived', state: 'archived', fetchAgeHours: null, reportAgeHours: 20000 });
  const [row] = sourceRows([archived]);
  assert.equal(row.noteTone, 'archive');
  assert.notEqual(row.noteTone, '', 'the default treatment is the amber warning box');

  for (const state of ['missing', 'unreadable', 'invalid', 'incompatible']) {
    const [broken] = sourceRows([source({ type: 'archived', state, included: false, detail: `${state} detail` })]);
    assert.equal(broken.noteTone, '', `${state}: a broken archive is a fault and keeps the warning treatment`);
  }
  assert.equal(sourceRows([source()])[0].noteTone, 'info', 'a healthy live source is unchanged');

  // Asserted against the stylesheet, because the class is only half the promise.
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  const archiveRule = css.match(/\.source-note\.archive\{([^}]*)\}/);
  assert.ok(archiveRule, '.source-note.archive must exist, or the class falls back to the warning box');
  assert.doesNotMatch(archiveRule[1], /--warning|--error/, 'the archival note must not borrow a fault colour');
  assert.match(archiveRule[1], /--muted|--dim/);
});

// The note sits inline in the header row rather than in a block beneath it, so a
// card of sources costs one line per source instead of two. Asserted against the
// stylesheet because the saving is entirely a CSS property: a note that wraps
// takes the vertical space back without changing any markup.
test('a source note is inline and truncates rather than adding a line to the row', async () => {
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  const rule = css.match(/\.source-note\{([^}]*)\}/);
  assert.ok(rule, 'the base note rule exists');
  assert.match(rule[1], /white-space:nowrap/, 'a wrapping note reclaims the vertical space this layout saves');
  assert.match(rule[1], /text-overflow:ellipsis/, 'a long detail must truncate rather than push the state word off the row');
  assert.doesNotMatch(rule[1], /margin-top/, 'a top margin would put the note back on its own line');
});

test('no excluded source renders amber and no fully included source renders red', () => {
  const rows = sourceRows([
    source({ included: false, state: 'unreachable', detail: 'host unreachable' }),
    source({ id: 'stale', sourceKey: 'stale', staleReport: true }),
    source({ id: 'local', sourceKey: 'workstation', isLocal: true, type: 'local' }),
  ]);
  assert.deepEqual(rows.map((row) => row.tone), ['red', 'amber', 'green']);
  assert.deepEqual(rows.map((row) => `${row.tone}:${row.state}`), ['red:excluded · unreachable', 'amber:not current', 'green:current']);
  assert.equal(rows[0].note, 'host unreachable', 'a red row says which number is missing and why');
  assert.equal(rows[2].isLocal, true);
  assert.deepEqual(
    { name: rows[2].name, identity: rows[2].identity },
    { name: 'workstation', identity: 'local machine' },
  );

  const [unresolvedRemote] = sourceRows([source({ id: 'laptop-config', sourceKey: null, included: false, state: 'missing' })]);
  assert.deepEqual(
    { name: unresolvedRemote.name, identity: unresolvedRemote.identity },
    { name: 'laptop-config', identity: 'configured source' },
    'a source without a report identity does not repeat its config id',
  );
});

test('a recent cached report stays green but exposes the latest failed refresh', () => {
  const [row] = sourceRows([source({ state: 'unreachable', fromCache: true, detail: 'host unreachable' })]);

  assert.equal(row.tone, 'green', 'recent complete cached data remains trusted');
  assert.equal(row.state, 'current · cached');
  assert.match(row.note, /Latest refresh failed \(unreachable\).*recent cached report/);
});

test('both ages stay visible and distinguish "nothing new" from "could not check"', () => {
  const [reachable] = sourceRows([source({ staleReport: true, reportAgeHours: 50, fetchAgeHours: 0.5 })]);
  const [unreachable] = sourceRows([source({ staleReport: true, staleFetch: true, reportAgeHours: 50, fetchAgeHours: 50 })]);

  assert.equal(reachable.reportAge, '2d ago');
  assert.equal(reachable.fetchAge, 'under an hour ago');
  assert.match(reachable.note, /nothing newer has happened/);
  assert.match(unreachable.note, /have not been able to check/);
  assert.notEqual(reachable.note, unreachable.note);
});

test('the local row derives its own report age against the reader clock', () => {
  const now = Date.parse('2026-01-03T12:00:00.000Z');
  const [local] = sourceRows([source({ isLocal: true, type: 'local', reportAgeHours: null, fetchAgeHours: null, generatedAt: '2026-01-03T09:00:00.000Z' })], { now });
  assert.equal(local.reportAge, '3h ago', 'a local row must not read "refreshed unknown"');
  assert.equal(local.fetchAge, null);
});

test('a local or file source shows no fetch age, and a clock anomaly reads as just now', () => {
  const [local] = sourceRows([source({ isLocal: true, type: 'local', fetchAgeHours: null })]);
  const [file] = sourceRows([source({ type: 'file', fetchAgeHours: 3 })]);
  assert.equal(local.fetchAge, null);
  assert.equal(file.fetchAge, null);
  assert.equal(relativeAge(-3), 'just now', 'a remote clock ahead of local must not render a negative age');
  assert.equal(relativeAge(null), null);
});

// "never reached" is true of a machine we failed to contact and false of a local
// file, which was never going to be contacted. Printing it on an archived row put
// a fault word on the one source that is working exactly as designed.
test('a source with no fetch age says why, and only a real failure says "never reached"', () => {
  const label = (overrides) => sourceRows([source(overrides)])[0].fetchLabel;

  assert.equal(label({ type: 'archived', state: 'archived', fetchAgeHours: null }), 'archived file');
  assert.equal(label({ type: 'file', fetchAgeHours: 3 }), 'local file');
  assert.equal(label({ isLocal: true, type: 'local', fetchAgeHours: null }), 'local');

  assert.equal(label({ type: 'ssh', fetchAgeHours: null, state: 'unreachable', included: false }), 'never reached',
    'a machine we genuinely could not contact keeps the honest wording');
  assert.equal(label({ type: 'ssh', fetchAgeHours: 0.2 }), 'under an hour ago');

  for (const type of ['archived', 'file', 'local']) {
    assert.notEqual(label({ type, isLocal: type === 'local', fetchAgeHours: null }), 'never reached',
      `${type}: a transport that never applies must not read as a failed one`);
  }

  // The healthy shape is the easy half. A row is described by the *fault* shape
  // exactly when the wording matters most — the user is already asking what
  // broke — and that shape comes from a different constructor in `sources.mjs`.
  const faulted = (overrides) => ({ ...source(overrides), included: false, fetchAgeHours: null, lastSuccessAt: null, records: 0 });
  for (const [type, expected] of [['archived', 'archived file'], ['file', 'local file']]) {
    for (const state of ['missing', 'unreadable', 'invalid', 'disabled']) {
      assert.equal(sourceRows([faulted({ type, state })])[0].fetchLabel, expected,
        `a ${state} ${type} source was never going to be contacted, so it cannot have failed to be`);
    }
  }
});

// The session-link rule, in seven cases. The rule fails closed: an unreachable link is worse than
// a plain label, so every missing condition must yield null.
const targets = { machineId: 'workstation', workspaces: [{ id: 'framework', root: '/home/u/fw' }, { id: 'home', root: '/home/u' }], workspaceRoot: '/home/u/fw' };
const cockpit = [{ id: 'ws-fw', root: '/home/u/fw', tools: { 'session-browser': true } }, { id: 'ws-client', root: '/home/u/client', tools: { 'session-browser': true } }, { id: 'ws-nosb', root: '/home/u', tools: { 'session-browser': false } }];
const record = (overrides = {}) => ({ sourceKey: 'workstation', workspaceId: 'framework', sessionBrowserPath: '/home/u/fw/s.json', ...overrides });

test('a row links if and only if this Cockpit can reach the session', () => {
  const context = { ...targets, cockpitWorkspaces: cockpit };

  assert.deepEqual(linkTarget(record(), context), { root: '/home/u/fw', workspaceId: null }, 'the current workspace keeps linking as today');
  assert.equal(linkTarget(record({ sourceKey: 'laptop' }), context), null, 'another machine is never linkable');
  assert.equal(linkTarget(record({ workspaceId: 'home' }), context), null, 'registered workspace without Session Browser');
  assert.equal(linkTarget(record({ workspaceId: 'unknown' }), context), null, 'workspace that resolves to no local root');
  assert.equal(linkTarget(record({ sessionBrowserPath: null }), context), null, 'no session to point at');
  assert.deepEqual(linkTarget(record(), { ...targets, cockpitWorkspaces: [] }), { root: '/home/u/fw', workspaceId: null }, 'standalone (no Cockpit config) still links the current workspace');
  assert.equal(linkTarget(record(), { ...context, machineId: null }), null, 'no known machine id fails closed');
  // A local workspace this Cockpit does not manage at all — a distinct reason
  // for the lookup to fail from "registered but Session Browser disabled".
  const unregistered = { machineId: 'workstation', workspaces: [{ id: 'scratch', root: '/home/u/scratch' }], workspaceRoot: '/home/u/fw', cockpitWorkspaces: cockpit };
  assert.equal(linkTarget(record({ workspaceId: 'scratch' }), unregistered), null, 'local but unregistered workspace is inert');
});

test('a row pointing at nothing addressable stays inert even when capable', () => {
  const context = { ...targets, cockpitWorkspaces: cockpit };
  const href = () => '../sessions/';

  assert.deepEqual(sessionLinkFor(record(), context, href), { href: '../sessions/', root: '/home/u/fw' });
  assert.equal(sessionLinkFor(record(), context, () => ''), null, 'no resolvable session route ⇒ inert, not a dead anchor');
  assert.equal(sessionLinkFor(record({ sourceKey: 'laptop' }), context, href), null);
});

test('a cross-workspace link is built once, with the target workspace on the href', () => {
  const context = { machineId: 'workstation', workspaces: [{ id: 'client-x', root: '/home/u/client' }], workspaceRoot: '/home/u/fw', cockpitWorkspaces: cockpit };
  assert.deepEqual(sessionLinkFor(record({ workspaceId: 'client-x' }), context, () => '../sessions/'), { href: '../sessions/?workspace=ws-client', root: '/home/u/client' });
  assert.deepEqual(
    sessionLinkFor(record({ workspaceId: 'client-x' }), context, () => '/tools/sessions/?workspace=global'),
    { href: '/tools/sessions/?workspace=ws-client', root: '/home/u/client' },
    'the target replaces Cockpit’s current workspace instead of creating a second question mark',
  );
});

// The failure this guards is silent by nature: every link simply disappears.
test('a scope the artifact used but local configuration does not resolve is announced', () => {
  assert.match(scopeMismatchWarning({ unresolvedWorkspaces: ['kancho'] }), /Session links are unavailable for kancho.*Re-run the analysis/);
  assert.equal(scopeMismatchWarning({ unresolvedWorkspaces: [] }), null);
  assert.equal(scopeMismatchWarning(undefined), null);
});

test('a cross-workspace link carries the target workspace, not the current one', () => {
  const context = { machineId: 'workstation', workspaces: [{ id: 'client-x', root: '/home/u/client' }], workspaceRoot: '/home/u/fw', cockpitWorkspaces: cockpit };
  assert.deepEqual(linkTarget(record({ workspaceId: 'client-x' }), context), { root: '/home/u/client', workspaceId: 'ws-client' });
});

test('provenance marks a row with its machine and workspace', () => {
  assert.equal(provenanceLabel(record()), 'workstation/framework');
  assert.equal(provenanceLabel({}), 'unknown-machine/unknown-workspace');
});

test('totals disclosure names what was left out instead of showing a bare number', () => {
  const merge = { sources: [source({ id: 'this machine', isLocal: true }), source({ id: 'laptop-eu', costsExcluded: true, costsExcludedReason: 'currency mismatch (EUR vs USD)' }), source({ id: 'nas', included: false, state: 'unreachable', detail: 'host unreachable' })], unidentifiableExcluded: 2 };
  const text = totalsDisclosure(merge);

  assert.match(text, /2 of 3 sources included\./);
  assert.match(text, /nas excluded: host unreachable\./);
  assert.match(text, /laptop-eu contributes tokens but no costs: currency mismatch \(EUR vs USD\)\./);
  assert.match(text, /2 records were excluded for lacking a usable identity\./);
  assert.equal(totalsDisclosure(null), null);
});

// The additive-flag guarantee, at the render boundary this time: the flag
// must reach the row and change nothing else about it.
test('a refreshing source renders the flag and keeps every other fact identical', () => {
  const [quiet] = sourceRows([source()]);
  const [busy] = sourceRows([source({ refreshing: true })]);

  assert.equal(quiet.refreshing, false, 'absent means not refreshing');
  assert.equal(busy.refreshing, true);
  assert.deepEqual({ ...busy, refreshing: false }, quiet, 'state word, tone, both ages, records, and note are untouched');
  assert.equal(busy.state, 'current');
  assert.equal(busy.tone, 'green');

  // And it is never mistaken for a state: a source that is both stale and
  // refreshing still reports the stale truth it has.
  const [stale] = sourceRows([source({ staleFetch: true, refreshing: true })]);
  assert.equal(stale.state, 'not current');
  assert.equal(stale.tone, 'amber');
  assert.equal(stale.refreshing, true);
});

// The refreshing pulse. Asserted against the stylesheet because the requirement is
// about what the animation must *not* do, and because reduced motion has no
// existing pattern in this codebase to inherit.
test('the refreshing pulse is ambient, and reduced motion loses nothing but the motion', async () => {
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');

  const pulse = css.match(/\.source-row\.refreshing\{([^}]*)\}/);
  assert.ok(pulse, 'the pulse keys off the row class the renderer applies');
  assert.match(pulse[1], /animation:source-refresh-pulse/);
  assert.doesNotMatch(pulse[1], /opacity|filter|display|visibility/, 'the pulse must never dim or obscure the row it decorates');

  const frames = css.match(/@keyframes source-refresh-pulse\{([^@]*?)\}\n/s);
  assert.ok(frames, 'the keyframes exist');
  assert.doesNotMatch(frames[1], /--error|--warning|--success/, 'ambient reinforcement, never a tone');

  // The label is what carries the information, so suppressing the animation
  // leaves a refreshing row fully distinguishable.
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.source-row\.refreshing\{animation:none\}\}/);
  assert.match(css, /\.source-refreshing\{/, 'the text flag has its own treatment and does not depend on the animation');
});
