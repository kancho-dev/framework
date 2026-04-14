function truncate(value, maxLength = 160) {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatTimestamp(value) {
  if (!value) return '—';
  return new Date(value).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

module.exports = {
  truncate,
  formatTimestamp,
};
