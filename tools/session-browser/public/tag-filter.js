export function matchingTags(tags, query = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b)).filter((tag) => {
    const normalized = tag.toLowerCase();
    return terms.every((term) => normalized.includes(term));
  });
}

export function validTagFilter(tags, selectedTag) {
  return selectedTag !== 'all' && tags.includes(selectedTag) ? selectedTag : 'all';
}

export function matchesTagFilter(tags, selectedTag) {
  return selectedTag === 'all' || tags.includes(selectedTag);
}

export function syncTagFilterControl(input, selectedTag, { preserveQuery = false } = {}) {
  const editingQuery = preserveQuery && selectedTag === 'all' && input.value.trim();
  if (!editingQuery) input.value = selectedTag === 'all' ? '' : selectedTag;
  input.title = selectedTag === 'all' ? 'All tags' : `Filtering by ${selectedTag}`;
}
