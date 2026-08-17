const KEYS = ['sources', 'models', 'machineIds', 'workspaceKeys'];

export function usageFilterContinuityKey(scope) {
  return `framework.tokens-cost-analyzer.filters:${scope || 'default'}`;
}

export function restoreUsageFilters(storage, scope) {
  let saved;
  try { saved = JSON.parse(storage.getItem(usageFilterContinuityKey(scope)) || 'null'); } catch { return null; }
  if (!saved || typeof saved !== 'object') return null;
  return Object.fromEntries(KEYS.map((key) => [key, new Set(Array.isArray(saved[key]) ? saved[key].filter((value) => typeof value === 'string') : [])]));
}

export function persistUsageFilters(storage, scope, filters) {
  storage.setItem(usageFilterContinuityKey(scope), JSON.stringify(Object.fromEntries(KEYS.map((key) => [key, [...(filters[key] || [])]]))));
}
