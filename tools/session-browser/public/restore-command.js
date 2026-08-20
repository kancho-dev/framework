export function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

export function restoreCommand(detail) {
  if (detail?.archived || detail?.machineId) return '';
  if (detail.source === 'pi') return `pi --session ${shellQuote(detail.path)}`;
  if (detail.source === 'opencode') return `opencode --session ${shellQuote(detail.id)} ${shellQuote(detail.cwd || '.')}`;
  if (detail.source === 'codex') return `codex resume ${shellQuote(detail.id)}`;
  if (detail.source === 'claude-code') return detail.isSidechain ? '' : `claude --resume ${shellQuote(detail.id)}`;
  return '';
}
