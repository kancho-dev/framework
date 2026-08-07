import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisLabel, linkTarget, provenanceLabel, relativeAge, scopeMismatchWarning, sessionLinkFor, sourceRows, sourceTone, totalsDisclosure } from './provenance.js';

function source(overrides = {}) {
  return { id: 'laptop', sourceKey: 'laptop', type: 'ssh', state: 'ok', included: true, costsExcluded: false, costsExcludedReason: null, detail: null, coverageMode: 'full-history', staleReport: false, staleFetch: false, reportAgeHours: 0.2, fetchAgeHours: 0.2, records: 3, ...overrides };
}

// §8.3's colour invariant: amber is not a degraded red. Asserted as a matrix
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

test('no excluded source renders amber and no fully included source renders red', () => {
  const rows = sourceRows([
    source({ included: false, state: 'unreachable', detail: 'host unreachable' }),
    source({ id: 'stale', sourceKey: 'stale', staleReport: true }),
    source({ id: 'local', isLocal: true, type: 'local' }),
  ]);
  assert.deepEqual(rows.map((row) => row.tone), ['red', 'amber', 'green']);
  assert.deepEqual(rows.map((row) => `${row.tone}:${row.state}`), ['red:excluded — unreachable', 'amber:included, not current', 'green:ok']);
  assert.equal(rows[0].note, 'host unreachable', 'a red row says which number is missing and why');
  assert.equal(rows[2].isLocal, true);
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

// §8.2's seven cases. The rule fails closed: an unreachable link is worse than
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

  assert.match(text, /Totals include 2 of 3 workspaces\./);
  assert.match(text, /nas excluded: host unreachable\./);
  assert.match(text, /laptop-eu contributes tokens but no costs: currency mismatch \(EUR vs USD\)\./);
  assert.match(text, /2 records were excluded for lacking a usable identity\./);
  assert.equal(totalsDisclosure(null), null);
});

test('contagious limited coverage never renders a null limit', () => {
  assert.equal(analysisLabel({ mode: 'limited', limit: null }), 'limited history — a source covers only part of its history');
  assert.equal(analysisLabel({ mode: 'limited', limit: 8 }), 'limited to latest 8 sessions/files per source');
  assert.equal(analysisLabel({ mode: 'full-history' }), 'full-history');
  assert.equal(analysisLabel(null), 'analysis scope unknown');
});
