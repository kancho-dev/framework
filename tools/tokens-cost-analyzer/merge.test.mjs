import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeReports } from './merge.mjs';

function record({ machineId = 'workstation', sessionId = 'session-a', messageId = 'uuid-1', source = 'claude-code', ...rest } = {}) {
  return {
    source,
    sessionId,
    messageId,
    timestamp: '2026-08-06T09:00:00.000Z',
    unitId: `${machineId}/${source}/${sessionId}/${messageId}`,
    sourceKey: machineId,
    workspaceId: 'framework',
    identityClass: 'native',
    totalTokens: 100,
    recordedCost: 1,
    estimatedCost: null,
    ...rest,
  };
}

function local({ machineId = 'workstation', records = [record()], ...rest } = {}) {
  return { machineId, reportId: 'report-local', generatedAt: '2026-08-06T11:00:00.000Z', currency: 'USD', coverageMode: 'full-history', records, ...rest };
}

function source({ id = 'laptop', machineId = id, records = [], generatedAt = '2026-08-06T10:00:00.000Z', ...stateRest } = {}) {
  return {
    records,
    state: {
      id, sourceKey: machineId, reportId: `report-${machineId}`, state: 'ok', included: true, detail: null,
      generatedAt, currency: 'USD', coverageMode: 'full-history', records: records.length, ...stateRest,
    },
  };
}

const tokensOf = (records) => records.reduce((total, r) => total + (Number(r.totalTokens) || 0), 0);
const costOf = (records) => records.reduce((total, r) => total + (Number(r.recordedCost) || 0), 0);

test('a fresh local report and a fresh source sum with no drops', () => {
  const remote = [record({ machineId: 'laptop', sessionId: 'session-b' })];
  const { records, merge } = mergeReports({ local: local(), external: [source({ records: remote })] });

  assert.equal(records.length, 2);
  assert.equal(tokensOf(records), 200);
  assert.deepEqual(merge.duplicatesDropped, {});
  assert.equal(merge.crossMachineDuplicatesDropped, 0);
  assert.deepEqual(merge.totalsInclude, ['workstation', 'laptop']);
  assert.deepEqual(merge.totalsExclude, []);
  assert.deepEqual(merge.warnings, []);
});

test('importing the same report twice gives the same totals as importing it once', () => {
  const remote = [record({ machineId: 'laptop', sessionId: 'session-b' })];
  const once = mergeReports({ local: local(), external: [source({ records: remote })] });
  const twice = mergeReports({ local: local(), external: [source({ records: remote }), source({ id: 'laptop-again', machineId: 'laptop', records: remote })] });

  assert.equal(tokensOf(twice.records), tokensOf(once.records), 're-fetching a source is idempotent');
  assert.deepEqual(twice.records, once.records);
});

test('a second source presenting a seen machine is skipped wholesale with one warning', () => {
  const remote = [record({ machineId: 'laptop', sessionId: 'session-b' })];
  const { merge } = mergeReports({
    local: local(),
    external: [source({ records: remote }), source({ id: 'laptop-alias', machineId: 'laptop', records: remote })],
  });

  const skipped = merge.sources.find((row) => row.id === 'laptop-alias');
  assert.equal(skipped.included, false);
  assert.equal(skipped.detail, 'duplicate machine');
  assert.equal(skipped.records, 0);
  assert.equal(merge.warnings.filter((w) => /duplicate machine/.test(w)).length, 1);
});

test('overlapping periods need no period arithmetic, because dedup is per record', () => {
  const shared = record({ machineId: 'laptop', sessionId: 'session-b' });
  const older = record({ machineId: 'laptop', sessionId: 'session-c', timestamp: '2026-08-01T09:00:00.000Z' });
  const { records } = mergeReports({
    local: local({ records: [record({ timestamp: '2026-08-03T09:00:00.000Z' })] }),
    external: [source({ records: [shared, older] })],
  });

  assert.equal(records.length, 3);
  assert.deepEqual(records.map((r) => r.timestamp), ['2026-08-01T09:00:00.000Z', '2026-08-03T09:00:00.000Z', '2026-08-06T09:00:00.000Z'], 'records are ordered deterministically');
});

test('a session copied between two machines is dropped once with one aggregated warning', () => {
  // Same contentKey, different machine prefixes: exactly what unitId cannot catch.
  const copies = Array.from({ length: 500 }, (_, index) => record({ machineId: 'laptop', messageId: `uuid-${index}` }));
  const locals = Array.from({ length: 500 }, (_, index) => record({ messageId: `uuid-${index}` }));
  const { records, merge } = mergeReports({ local: local({ records: locals }), external: [source({ records: copies })] });

  assert.equal(records.length, 500, 'each copied record is counted once');
  assert.equal(merge.crossMachineDuplicatesDropped, 500);
  const aggregated = merge.warnings.filter((w) => /seen on more than one machine/.test(w));
  assert.equal(aggregated.length, 1, 'one aggregated warning, never one per record');
  assert.match(aggregated[0], /500 records/);
  assert.match(aggregated[0], /laptop, workstation/);
});

test('cross-machine duplicates are detected for adapters with native ids and no fingerprint', () => {
  // The regression guard for the cross-machine duplicate defect: keying on contentFingerprint
  // silently matched nothing for Claude Code and OpenCode.
  for (const adapter of ['claude-code', 'opencode']) {
    const mine = record({ source: adapter });
    const theirs = record({ source: adapter, machineId: 'laptop' });
    assert.equal(mine.contentFingerprint, undefined, 'these adapters carry no fingerprint discriminator');

    const { records, merge } = mergeReports({ local: local({ records: [mine] }), external: [source({ records: [theirs] })] });
    assert.equal(records.length, 1, adapter);
    assert.equal(merge.crossMachineDuplicatesDropped, 1, adapter);
  }
});

test('a local record is never displaced, even by a fresher external report', () => {
  const mine = record({ totalTokens: 100 });
  const theirs = record({ machineId: 'laptop', totalTokens: 999 });
  const { records } = mergeReports({
    local: local({ records: [mine], generatedAt: '2026-08-01T00:00:00.000Z' }),
    external: [source({ records: [theirs], generatedAt: '2026-08-06T23:00:00.000Z' })],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].sourceKey, 'workstation', 'local always wins, whatever a remote clock claims');
});

test('exact duplicates within one source are dropped and counted per source', () => {
  const duplicated = [record({ machineId: 'laptop' }), record({ machineId: 'laptop' })];
  const { records, merge } = mergeReports({ local: local({ records: [] }), external: [source({ records: duplicated })] });

  assert.equal(records.length, 1);
  assert.deepEqual(merge.duplicatesDropped, { laptop: 1 });
});

test('records with no resolvable identity are excluded and counted, never guessed', () => {
  // Built by deletion rather than by overriding the factory's arguments, whose
  // defaults would quietly fill the very fields this rule is about.
  const without = (field, sessionId) => { const value = record({ machineId: 'laptop', sessionId }); delete value[field]; return value; };
  const broken = [without('sessionId', 'session-x'), without('timestamp', 'session-y'), without('unitId', 'session-z')];
  const { records, merge } = mergeReports({ local: local(), external: [source({ records: broken })] });

  assert.equal(merge.unidentifiableExcluded, 3);
  assert.equal(tokensOf(records), 100, 'totals are unaffected by what was excluded');
});

test('a source in another currency contributes tokens but never money', () => {
  const theirs = [record({ machineId: 'laptop-eu', sessionId: 'session-b', totalTokens: 50, recordedCost: 7 })];
  const { records, merge } = mergeReports({
    local: local(),
    external: [source({ id: 'laptop-eu', records: theirs, currency: 'EUR' })],
  });

  assert.equal(tokensOf(records), 150, 'token counts are currency-free and stay trustworthy');
  assert.equal(costOf(records), 1, 'no EUR amount enters a USD total, and nothing is converted');
  const imported = records.find((r) => r.sourceKey === 'laptop-eu');
  assert.equal(imported.recordedCost, null);
  assert.equal(imported.costExcluded, true);
  assert.match(merge.warnings.join(' '), /EUR.*USD/);
  assert.deepEqual(merge.totalsExclude, []);
  const row = merge.sources.find((r) => r.id === 'laptop-eu');
  assert.equal(row.costsExcluded, true);
  // The totals disclosure names the reason, so it must be structured data rather
  // than something step 9 has to parse back out of the prose warning.
  assert.equal(row.costsExcludedReason, 'currency mismatch (EUR vs USD)');
});

test('a limited source is included but makes the whole aggregate limited', () => {
  const { records, merge } = mergeReports({
    local: local(),
    external: [source({ records: [record({ machineId: 'laptop', sessionId: 'session-b' })], coverageMode: 'limited' })],
  });

  assert.equal(records.length, 2, 'incompleteness taints the aggregate rather than excluding the source');
  assert.equal(merge.coverageMode, 'limited');
  assert.match(merge.warnings.join(' '), /laptop.*limited history/);
});

test('a source excluded upstream is listed with its reason and contributes nothing', () => {
  const excluded = source({ id: 'laptop', records: [record({ machineId: 'laptop' })], included: false, state: 'incompatible', detail: 'the report uses schemaVersion 99' });
  const { records, merge } = mergeReports({ local: local(), external: [excluded] });

  assert.equal(records.length, 1);
  assert.deepEqual(merge.totalsExclude, [{ sourceKey: 'laptop', reason: 'the report uses schemaVersion 99' }]);
  assert.equal(merge.sources.find((row) => row.id === 'laptop').records, 0);
  assert.deepEqual(merge.warnings, ['laptop: excluded from totals — the report uses schemaVersion 99'], 'an excluded source must warn, not only be listed');
});

test('a disabled source is listed without a warning, unlike other exclusions', () => {
  const off = source({ id: 'laptop', records: [], included: false, state: 'disabled', detail: 'this source is turned off in sources.json' });
  const unreachable = source({ id: 'desktop', machineId: 'desktop', records: [], included: false, state: 'unreachable', detail: 'ssh could not connect to the host' });
  const { merge } = mergeReports({ local: local(), external: [off, unreachable] });

  assert.equal(merge.warnings.length, 1, 'the user turned the disabled one off; it is not news');
  assert.match(merge.warnings[0], /desktop: excluded from totals/);
  assert.equal(merge.totalsExclude.length, 2, 'both are still listed as contributing nothing');
});

test('records that are not even objects are counted as excluded, not silently dropped', () => {
  const { records, merge } = mergeReports({ local: local({ records: [record(), null, 42, 'nope'] }) });

  assert.equal(records.length, 1);
  assert.equal(merge.unidentifiableExcluded, 3, 'unidentifiable records are excluded and counted');
});

test('local is source zero and merge is deterministic regardless of source order', () => {
  const alpha = source({ id: 'alpha', records: [record({ machineId: 'alpha', sessionId: 'session-x' })] });
  const beta = source({ id: 'beta', records: [record({ machineId: 'beta', sessionId: 'session-y' })] });
  const forwards = mergeReports({ local: local(), external: [alpha, beta] });
  const backwards = mergeReports({ local: local(), external: [beta, alpha] });

  assert.deepEqual(forwards.records, backwards.records);
  assert.deepEqual(forwards.merge.sources.map((row) => row.id), ['this machine', 'alpha', 'beta']);
  assert.equal(forwards.merge.sources[0].isLocal, true);
});

test('every merged record carries a sourceKey', () => {
  const { records } = mergeReports({
    local: local({ records: [{ ...record(), sourceKey: undefined }] }),
    external: [source({ records: [record({ machineId: 'laptop', sessionId: 'session-b' })] })],
  });

  assert.equal(records.length, 2);
  assert.ok(records.every((r) => typeof r.sourceKey === 'string' && r.sourceKey), 'the By Workspace rollup groups on machineId/workspaceId');
});

test('with no external sources the local records pass through untouched', () => {
  const records = [record(), record({ sessionId: 'session-b' })];
  const merged = mergeReports({ local: local({ records }) });

  assert.deepEqual(merged.records, records.slice().sort((a, b) => a.unitId.localeCompare(b.unitId)));
  assert.deepEqual(merged.merge.totalsExclude, []);
  assert.deepEqual(merged.merge.warnings, []);
  assert.equal(merged.merge.coverageMode, 'full-history');
});

test('a malformed load costs that source its records, not the whole merge', () => {
  const probes = [
    { name: 'no arguments', input: undefined },
    { name: 'null local', input: { local: null, external: [] } },
    { name: 'garbage records', input: { local: { machineId: 'workstation', records: [null, 42, record()] } } },
    { name: 'load without a state', input: { local: local(), external: [{ records: [record({ machineId: 'laptop' })] }] } },
    { name: 'load without records', input: { local: local(), external: [{ state: { id: 'x', sourceKey: 'x', included: true } }] } },
    { name: 'external not an array', input: { local: local(), external: 'nope' } },
  ];

  for (const { name, input } of probes) {
    const merged = mergeReports(input);
    assert.ok(Array.isArray(merged.records), name);
    assert.ok(Array.isArray(merged.merge.sources), name);
  }

  const salvaged = mergeReports({ local: { machineId: 'workstation', records: [null, 42, record()] } });
  assert.equal(salvaged.records.length, 1, 'the usable local record survives its malformed neighbours');
});

// The Analyzer's package version is stamped as `generatorVersion` on every record's `derivation`,
// so machines upgrade at different times and a merge routinely spans versions. Nothing about that
// may gate the merge: `generatorVersion` is provenance and a local cache key, never a compatibility
// contract — the compatibility contract is the independently versioned `report.v1.json` schema.
test('records derived by different generator versions still merge', () => {
  const older = record({ machineId: 'laptop', messageId: 'uuid-old', derivation: { generatorVersion: '0.6.0', pricingFingerprint: 'sha256:p' } });
  const newer = record({ messageId: 'uuid-new', derivation: { generatorVersion: '1.0.0', pricingFingerprint: 'sha256:p' } });

  const merged = mergeReports({ local: local({ records: [newer] }), external: [source({ id: 'laptop', records: [older] })] });

  assert.equal(merged.records.length, 2, 'a version difference excludes nothing');
  assert.deepEqual(
    merged.records.map((r) => r.derivation.generatorVersion).sort(),
    ['0.6.0', '1.0.0'],
    'both derivations survive the merge with their own provenance intact',
  );
});
