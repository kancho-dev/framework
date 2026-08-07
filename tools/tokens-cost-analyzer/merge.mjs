import { contentKeyFor } from './report-contract.mjs';

// §5 merge semantics over loaded records. Pure given its inputs, and every
// outcome lands in the returned `merge` block rather than being thrown: the
// local report is merged first and can never be displaced by an external one.

export function mergeReports({ local, external = [] } = {}) {
  const localLoad = localSourceLoad(local);
  external = (Array.isArray(external) ? external : []).map(normalizeLoad);
  const context = { warnings: [], crossMachineDuplicatesDropped: 0, unidentifiableExcluded: 0, coverageLimited: localLoad.state.coverageMode === 'limited' };
  const admitted = admit(localLoad, orderSources(external), context);
  const records = collectRecords(admitted, context);
  dropCrossMachineDuplicates(records, admitted, context);

  const kept = records.filter((record) => !record.dropped).map((record) => record.value);
  return {
    records: kept.sort(byTimestampThenUnitId),
    merge: {
      sources: admitted.map((load) => sourceRow(load, kept)),
      totalsInclude: admitted.filter((load) => load.included).map((load) => load.state.sourceKey),
      totalsExclude: admitted.filter((load) => !load.included).map((load) => ({ sourceKey: load.state.sourceKey ?? load.state.id, reason: load.exclusion })),
      duplicatesDropped: countBy(admitted, (load) => load.duplicatesDropped),
      crossMachineDuplicatesDropped: context.crossMachineDuplicatesDropped,
      unidentifiableExcluded: context.unidentifiableExcluded,
      coverageMode: context.coverageLimited ? 'limited' : 'full-history',
      warnings: context.warnings,
    },
  };
}

/**
 * §5.3: a source presenting an already-seen `reportId` or `machineId` is the
 * same machine reached twice, and is skipped wholesale *before* record merging
 * rather than deduplicated record by record.
 */
function admit(localLoad, externalLoads, context) {
  const seenReports = new Set([localLoad.state.reportId].filter(Boolean));
  const seenMachines = new Set([localLoad.state.sourceKey].filter(Boolean));
  const admitted = [prepare(localLoad, { included: true, isLocal: true })];

  for (const load of externalLoads) {
    if (!load.state.included) {
      const reason = load.state.detail || load.state.state;
      // §5.8 requires an excluded source to warn, and §8.3 keeps totals
      // exclusions in the warnings list — only per-source *stale* warnings are
      // absorbed by the card. A disabled source is the documented exception:
      // §6 lists it without a warning, because the user turned it off.
      if (load.state.state !== 'disabled') context.warnings.push(`${load.state.id}: excluded from totals — ${reason}`);
      admitted.push(prepare(load, { included: false, exclusion: reason }));
      continue;
    }
    const duplicate = seenReports.has(load.state.reportId) || seenMachines.has(load.state.sourceKey);
    if (duplicate) {
      context.warnings.push(`${load.state.id}: duplicate machine — this source reports the same machine as one already merged, so it was skipped entirely.`);
      admitted.push(prepare(load, { included: false, exclusion: 'duplicate machine' }));
      continue;
    }
    if (load.state.reportId) seenReports.add(load.state.reportId);
    if (load.state.sourceKey) seenMachines.add(load.state.sourceKey);
    admitted.push(prepare(load, admissionFor(load, localLoad, context)));
  }
  return admitted;
}

/**
 * §5.7 and §5.9: a currency mismatch removes money but keeps tokens, which stay
 * trustworthy because token counts are currency-free; a limited source is
 * included but makes the aggregate limited, since incompleteness is contagious.
 */
function admissionFor(load, localLoad, context) {
  if (load.state.coverageMode === 'limited') {
    context.coverageLimited = true;
    context.warnings.push(`${load.state.id}: this source covers a limited history, so the combined totals are not full-history.`);
  }
  const localCurrency = localLoad.state.currency;
  if (load.state.currency && localCurrency && load.state.currency !== localCurrency) {
    context.warnings.push(`${load.state.id}: costs are in ${load.state.currency} while local costs are in ${localCurrency}; its token counts are included but its costs are not, and no conversion is ever applied.`);
    return { included: true, costsExcluded: true, costsExcludedReason: `currency mismatch (${load.state.currency} vs ${localCurrency})` };
  }
  return { included: true };
}

/**
 * §5.1/§5.2/§5.6: local first and never displaced; a repeated `unitId` is
 * dropped, which is what makes re-fetching a source idempotent; a record with
 * no resolvable identity is excluded rather than guessed into place.
 */
function collectRecords(admitted, context) {
  const seenUnitIds = new Set();
  const collected = [];
  for (const load of admitted) {
    if (!load.included) continue;
    context.unidentifiableExcluded += load.malformedRecords;
    for (const record of load.records) {
      const contentKey = identifiable(record) ? contentKeyOrNull(record) : null;
      if (!contentKey) {
        context.unidentifiableExcluded += 1;
        continue;
      }
      if (seenUnitIds.has(record.unitId)) {
        load.duplicatesDropped += 1;
        continue;
      }
      seenUnitIds.add(record.unitId);
      collected.push({ value: load.costsExcluded ? withoutCosts(record) : record, contentKey, load, dropped: false });
    }
  }
  return collected;
}

/**
 * §5.5: the one case `unitId` cannot catch, because it is `sourceKey`-prefixed
 * by design — the same session copied or synced between two machines. Keyed on
 * `contentKey`, which is machine-independent and defined for every adapter, and
 * warned about **once in aggregate**: a user syncing a project directory would
 * otherwise face thousands of identical lines and learn to ignore the list.
 */
function dropCrossMachineDuplicates(records, admitted, context) {
  const freshness = new Map(admitted.map((load) => [load, Date.parse(load.state.generatedAt) || 0]));
  const byContentKey = new Map();
  for (const record of records) {
    const existing = byContentKey.get(record.contentKey);
    if (!existing) {
      byContentKey.set(record.contentKey, record);
      continue;
    }
    if (existing.load === record.load) continue;
    const winner = crossMachineWinner(existing, record, freshness);
    const loser = winner === existing ? record : existing;
    loser.dropped = true;
    byContentKey.set(record.contentKey, winner);
    context.crossMachineDuplicatesDropped += 1;
    machinesInvolved(context).add(existing.load.state.sourceKey).add(record.load.state.sourceKey);
  }
  if (context.crossMachineDuplicatesDropped) {
    const machines = [...machinesInvolved(context)].filter(Boolean).sort().join(', ');
    context.warnings.push(`${context.crossMachineDuplicatesDropped} records were seen on more than one machine (${machines}); the copy from the machine with the freshest report is counted once and the others are dropped.`);
  }
}

/**
 * §5.5 keeps the freshest machine's occurrence, but §5.1 is the stronger rule:
 * a local record is never displaced, whatever an external report's age claims.
 * That also keeps the outcome independent of remote clock skew.
 */
function crossMachineWinner(existing, candidate, freshness) {
  if (existing.load.isLocal) return existing;
  if (candidate.load.isLocal) return candidate;
  return freshness.get(candidate.load) > freshness.get(existing.load) ? candidate : existing;
}

function sourceRow(load, kept) {
  return {
    ...load.state,
    included: load.included,
    costsExcluded: Boolean(load.costsExcluded),
    // §8.4's totals disclosure names the reason, so it must be readable from
    // structured data rather than parsed back out of the prose warning.
    costsExcludedReason: load.costsExcludedReason ?? null,
    detail: load.included ? load.state.detail : (load.exclusion ?? load.state.detail),
    duplicatesDropped: load.duplicatesDropped,
    // §8.3's Records column is the contributed count *after* dedup, which the
    // per-source pre-dedup count on the loaded state cannot express.
    records: load.included ? kept.filter((record) => record.sourceKey === load.state.sourceKey).length : 0,
  };
}

/**
 * Step 8 merges below the request handler's catch, so a malformed load must
 * cost that source its records rather than taking the whole response down.
 */
function normalizeLoad(load) {
  const records = recordsOf(load?.records);
  return {
    records,
    malformedRecords: malformedCount(load?.records, records),
    state: { id: 'unknown source', included: false, detail: 'this source produced no usable state', ...load?.state },
  };
}

function recordsOf(records) {
  return (Array.isArray(records) ? records : []).filter((record) => record && typeof record === 'object');
}

// §5.6 excludes unidentifiable records **and counts them**, so an entry that is
// not even an object is counted rather than quietly filtered away.
function malformedCount(raw, kept) {
  return Array.isArray(raw) ? raw.length - kept.length : 0;
}

function localSourceLoad(local) {
  const machineId = local?.machineId ?? null;
  const records = recordsOf(local?.records);
  return {
    malformedRecords: malformedCount(local?.records, records),
    records: records.map((record) => (record.sourceKey === machineId ? record : { ...record, sourceKey: machineId })),
    state: {
      id: local?.id || 'this machine',
      type: 'local',
      sourceKey: machineId,
      reportId: local?.reportId ?? null,
      state: 'ok',
      included: true,
      detail: null,
      generatedAt: local?.generatedAt ?? null,
      currency: local?.currency ?? null,
      coverageMode: local?.coverageMode ?? 'full-history',
      lastSuccessAt: null,
      reportAgeHours: null,
      fetchAgeHours: null,
      staleReport: false,
      staleFetch: false,
      fromCache: false,
      isLocal: true,
      records: records.length,
    },
  };
}

function prepare(load, admission) {
  return { records: load.records, state: load.state, duplicatesDropped: 0, exclusion: null, costsExcluded: false, costsExcludedReason: null, malformedRecords: load.malformedRecords || 0, ...admission };
}

function withoutCosts(record) {
  return { ...record, recordedCost: null, estimatedCost: null, costExcluded: true };
}

/**
 * §5.6 is checked on the fields themselves, not inferred from `contentKeyFor`:
 * that helper treats a present `unitId` as authoritative and would happily
 * derive a key for a record missing the very ids this rule excludes.
 */
function identifiable(record) {
  return Boolean(record?.sessionId && record?.timestamp && record?.unitId);
}

function contentKeyOrNull(record) {
  try {
    return contentKeyFor(record);
  } catch {
    return null;
  }
}

function machinesInvolved(context) {
  context.machines ??= new Set();
  return context.machines;
}

function orderSources(external) {
  return [...external].sort((a, b) => String(a.state?.sourceKey ?? a.state?.id ?? '').localeCompare(String(b.state?.sourceKey ?? b.state?.id ?? '')));
}

function byTimestampThenUnitId(a, b) {
  return String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')) || String(a.unitId ?? '').localeCompare(String(b.unitId ?? ''));
}

function countBy(admitted, valueOf) {
  const counts = {};
  for (const load of admitted) {
    const value = valueOf(load);
    if (value) counts[load.state.sourceKey ?? load.state.id] = value;
  }
  return counts;
}
