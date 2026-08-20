import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  archivalNote,
  archivalProvenanceText,
  machineFilterOptions,
  matchesMachineFilter,
  originTooltip,
  relationTooltip,
} from './archival-ui.js';

test('machine filtering distinguishes current and named archived machines', () => {
  const sessions = [
    { id: 'live' },
    { id: 'old-b', machineId: 'b', machineLabel: 'Beta' },
    { id: 'old-a', machineId: 'a', machineLabel: 'Alpha' },
  ];
  assert.deepEqual(machineFilterOptions(sessions), [['a', 'Alpha'], ['b', 'Beta']]);
  assert.equal(matchesMachineFilter(sessions[0], 'current'), true);
  assert.equal(matchesMachineFilter(sessions[1], 'current'), false);
  assert.equal(matchesMachineFilter(sessions[1], 'b'), true);
  assert.equal(matchesMachineFilter(sessions[0], 'all'), true);
});

test('archival copy preserves original-path truth and non-resumable rationale', () => {
  const archived = { machineId: 'old', machineLabel: 'Old machine', originalCwd: '/old/work', retiredAt: '2026-08-01' };
  assert.equal(originTooltip(archived), '/old/work — Old machine');
  assert.equal(archivalProvenanceText(archived), 'archived · Old machine · read-only · cannot resume');
  assert.equal(archivalProvenanceText({}), '');
  assert.match(archivalNote(archived), /Archived from Old machine, retired 2026-08-01/);
  assert.match(archivalNote(archived), /cannot resume it/);
  assert.equal(originTooltip({ cwd: '/live/work' }), '/live/work');
});

test('relations name an unknown working directory honestly', () => {
  assert.equal(relationTooltip({ name: 'Child', cwd: '' }), 'Child · working directory unknown');
});
