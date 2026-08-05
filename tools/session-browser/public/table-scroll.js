export function tableScrollKeys(tables) {
  const ownerCounts = new Map();
  return [...tables].map((table, index) => {
    const ownerId = table.closest('[id]')?.id;
    if (!ownerId) return `index:${index}`;
    const ordinal = (ownerCounts.get(ownerId) || 0) + 1;
    ownerCounts.set(ownerId, ordinal);
    return `${ownerId}:table:${ordinal}`;
  });
}
