import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { usageCells } from '../rollups.mjs';
import { breakdownFooterModel, BREAKDOWN_COPY } from './breakdown-footer.js';
import { buildUsageBreakdown } from './usage-breakdown.js';

const NOW = Date.parse('2026-08-13T12:00:00Z');
const format = { tokens: (value) => `${Number(value) || 0}`, money: (value) => `$${(Number(value) || 0).toFixed(2)}` };

function record(overrides = {}) {
  return { date: '2026-08-10', source: 'claude-code', sourceKey: 'machine-a', workspaceId: 'ws-1', totalTokens: 100, estimatedCost: 0.5, ...overrides };
}

function source(overrides = {}) {
  return { id: 'local', name: 'local', included: true, isLocal: true, records: 1, reportAge: 'just now', ...overrides };
}

function model(records, { metric = 'tokens', merge = { sources: [source()] }, usage = {} } = {}) {
  const breakdown = buildUsageBreakdown(usageCells(records).cells, { now: NOW, metric });
  return breakdownFooterModel({ breakdown, usage, merge, currency: 'USD', format });
}

test('standing explanation is a note; nothing about this cohort is', () => {
  const footer = model([record()]);
  assert.deepEqual(footer.notes, [BREAKDOWN_COPY], 'the only foldable line is the one true of every window');
  assert.ok(footer.warnings.every((line) => line !== BREAKDOWN_COPY));
});

test('a cost metric folds its definition away but never its coverage', () => {
  const footer = model([
    record({ estimatedCost: 0.5 }),
    record({ source: 'codex', estimatedCost: null }),
    record({ source: 'pi', estimatedCost: null, costExcluded: true }),
  ], { metric: 'estimatedCost' });
  assert.equal(footer.notes.length, 2);
  assert.match(footer.notes[1], /Estimated cost \(USD\) comes from the local pricing table/, 'what the metric is stays standing copy');
  assert.match(footer.warnings.join(' '), /1 of the 3 records in view carry no estimated cost/);
  assert.match(footer.warnings.join(' '), /1 records \(100 tokens\) come from a source whose costs were excluded/);
});

test('every cohort-specific caveat stays visible', () => {
  const merge = {
    unidentifiableExcluded: 2,
    sources: [source(), source({ id: 'remote', name: 'remote', isLocal: false, included: false, state: 'Stale', detail: 'report is stale' })],
  };
  const footer = model([record({ source: null, estimatedCost: null })], { metric: 'estimatedCost', merge, usage: { undatedRecords: 3, undatedTokens: 42 } });
  const visible = footer.warnings.join(' ');
  assert.match(visible, /1 of 2 sources included/, 'excluded sources are a warning, not a note');
  assert.match(visible, /2 records were excluded for lacking a usable identity/);
  assert.match(visible, /Coverage caveats still apply/);
  assert.match(visible, /100 tokens have no agent tool attribution/);
  assert.match(visible, /records in view have unknown or unpriced cost/);
  assert.match(visible, /3 records carry no usable date \(42 tokens\)/);
  assert.equal(footer.notes.length, 2, 'the disclosure holds only the two standing explanations');
});

// A static guard, like the header-pinning rule: the disclosure only helps if
// warnings stay outside it, and that is invisible once the panel renders.
test('only the notes are collapsible in the rendered footer', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const render = app.slice(app.indexOf('function renderBreakdownFooter'));
  const body = render.slice(0, render.indexOf('\n}'));
  assert.match(body, /<details class="footer-note"[^>]*>.*paragraphs\(notes\)/s, 'notes fold away');
  assert.doesNotMatch(body.replace(/<details[\s\S]*?<\/details>`/, ''), /warnings[\s\S]*<details/, 'warnings are never inside the disclosure');
  assert.match(body, /paragraphs\(warnings\)/);
});

// The metric definitions moved from a permanent note into the options; a
// tooltip alone would strand keyboard and screen-reader readers.
test('each metric option carries its own accessible definition', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /breakdown-metric-note/, 'the permanent note beside the control is gone');
  assert.match(app, /segmentedHtml\('metric', METRICS, state\.breakdown\.metric, \(value\) => metricNote\(value, currency\)\)/);
  const segmented = app.slice(app.indexOf('function segmentedHtml'));
  assert.match(segmented.slice(0, segmented.indexOf('\n}')), /title="\$\{escapeHtml\(text\)\}[\s\S]*sr-only/, 'the help text is both a tooltip and part of the accessible name');
});

// The footer lives inside `#report`, which is committed by morphing a freshly
// rendered tree, so an opened disclosure is DOM state a refresh would discard.
// Verified in Chromium before and after this guard existed.
test('the disclosure survives a refresh because its state lives outside the DOM', () => {
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /footerNoteOpen: false/, 'the open state is held in `state`, not read back from the markup');
  assert.match(app, /data-footer-note\$\{state\.footerNoteOpen \? ' open' : ''\}/, 'every render re-applies it');
  assert.match(app, /\[data-footer-note\]'\);\s*\n\s*if \(note\) state\.footerNoteOpen = note\.open;/, 'and the toggle writes it back');
});
