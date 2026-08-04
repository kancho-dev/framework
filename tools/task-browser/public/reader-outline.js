export function outlineEntries(headings) {
  return [...headings].map((heading, index) => ({
    id: `reader-heading-${index + 1}`,
    level: Number(heading.tagName.slice(1)),
    text: heading.textContent || '',
  }));
}
