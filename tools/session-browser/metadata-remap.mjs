export function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeMetadataEntry(value) {
  const entry = object(value);
  const tags = [...new Set((Array.isArray(entry.tags) ? entry.tags : []).map((tag) => String(tag || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return {
    bookmarked: Boolean(entry.bookmarked),
    tags,
    savedTopics: object(entry.savedTopics),
  };
}

export function mergeMetadataEntries(currentValue, archivedValue) {
  const current = normalizeMetadataEntry(currentValue);
  const archived = normalizeMetadataEntry(archivedValue);
  const conflicts = [];
  const savedTopics = { ...archived.savedTopics, ...current.savedTopics };
  for (const id of Object.keys(archived.savedTopics)) {
    if (Object.hasOwn(current.savedTopics, id)
      && JSON.stringify(current.savedTopics[id]) !== JSON.stringify(archived.savedTopics[id])) {
      conflicts.push({ field: 'savedTopics', id, current: current.savedTopics[id], archived: archived.savedTopics[id] });
    }
  }
  return {
    entry: {
      bookmarked: current.bookmarked || archived.bookmarked,
      tags: [...new Set([...current.tags, ...archived.tags])].sort((a, b) => a.localeCompare(b)),
      savedTopics,
    },
    conflicts,
  };
}

export function hasContent(entry) {
  return entry.bookmarked || entry.tags.length > 0 || Object.keys(entry.savedTopics).length > 0;
}

export async function remapMetadata(metadata, resolveTarget) {
  if (typeof resolveTarget !== 'function') throw new TypeError('resolveTarget must be a function');
  const inputSessions = object(metadata?.sessions);
  const sessions = { ...inputSessions };
  const rewrites = [];
  const unmatched = [];
  const conflicts = [];

  for (const [sourceKey, sourceValue] of Object.entries(inputSessions)) {
    const resolution = await resolveTarget(sourceKey);
    const targetKey = typeof resolution === 'string' ? resolution : resolution?.targetKey;
    if (!targetKey || targetKey === sourceKey) {
      if (resolution?.reason) unmatched.push({ sourceKey, reason: resolution.reason });
      continue;
    }
    const merged = mergeMetadataEntries(sessions[targetKey], sourceValue);
    if (hasContent(merged.entry)) sessions[targetKey] = merged.entry;
    else delete sessions[targetKey];
    delete sessions[sourceKey];
    rewrites.push({ sourceKey, targetKey });
    conflicts.push(...merged.conflicts.map((conflict) => ({ sourceKey, targetKey, ...conflict })));
  }

  return {
    metadata: { ...object(metadata), version: Math.max(Number(metadata?.version || 1), 3), sessions },
    rewrites,
    unmatched,
    conflicts,
    changed: JSON.stringify(sessions) !== JSON.stringify(inputSessions),
  };
}
