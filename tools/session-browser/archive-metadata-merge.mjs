import { hasContent, mergeMetadataEntries, normalizeMetadataEntry, object } from './metadata-remap.mjs';
import { METADATA_VERSION } from './metadata-schema.mjs';

export function canonicalizeArchivedMetadata(snapshot) {
  const input = object(snapshot);
  const sessions = {};
  for (const [key, value] of Object.entries(object(input.sessions))) {
    const entry = normalizeMetadataEntry({
      ...object(value),
      tags: [...(Array.isArray(value?.tags) ? value.tags : []), ...(Array.isArray(value?.labels) ? value.labels : [])],
    });
    if (hasContent(entry)) sessions[key] = entry;
  }
  const metadata = { ...input, version: Math.max(Number(input.version || 1), METADATA_VERSION), sessions };
  return { metadata, canonicalized: JSON.stringify(metadata) !== JSON.stringify(snapshot) };
}

export async function mergeArchivedMetadata({ snapshot, destination, resolveTarget }) {
  if (typeof resolveTarget !== 'function') throw new TypeError('resolveTarget must be a function');
  const canonical = canonicalizeArchivedMetadata(snapshot);
  const current = canonicalizeArchivedMetadata(destination).metadata;
  const sessions = { ...object(current.sessions) };
  const eligible = [];
  const unmatched = [];
  const conflicts = [];

  for (const [sourceKey, archivedEntry] of Object.entries(canonical.metadata.sessions)) {
    const resolution = await resolveTarget(sourceKey);
    const targetKey = typeof resolution === 'string' ? resolution : resolution?.targetKey;
    if (!targetKey) {
      unmatched.push({ sourceKey, reason: resolution?.reason || 'session key is not eligible' });
      continue;
    }
    const merged = mergeMetadataEntries(sessions[targetKey], archivedEntry);
    if (hasContent(merged.entry)) sessions[targetKey] = merged.entry;
    else delete sessions[targetKey];
    eligible.push({ sourceKey, targetKey, rewritten: sourceKey !== targetKey });
    conflicts.push(...merged.conflicts.map((conflict) => ({ sourceKey, targetKey, ...conflict })));
  }

  const metadata = { ...current, version: Math.max(Number(current.version || 1), METADATA_VERSION), sessions };
  return {
    metadata,
    canonicalized: canonical.canonicalized,
    eligible,
    unmatched,
    conflicts,
    changed: JSON.stringify(metadata) !== JSON.stringify(destination),
  };
}
