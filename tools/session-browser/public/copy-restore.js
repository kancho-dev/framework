import { flashButton } from '/shared/browser/clipboard.js';

export function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function restoreCommand(detail) {
  if (detail.source === 'pi') return `pi --session ${shellQuote(detail.path)}`;
  if (detail.source === 'opencode') return `opencode --session ${shellQuote(detail.id)} ${shellQuote(detail.cwd || '.')}`;
  if (detail.source === 'codex') return `codex resume ${shellQuote(detail.id)}`;
  // Claude Code sub-agent (sidechain) sessions are not independently resumable; hide the button.
  if (detail.source === 'claude-code') return detail.isSidechain ? '' : `claude --resume ${shellQuote(detail.id)}`;
  return '';
}

export async function copyRestoreCommand(detail, button) {
  const command = detail ? restoreCommand(detail) : '';
  if (!command) return;
  await copyText(command);
  flashButton(button, 'Copied', 1400);
}

export async function copyAndFlash(text, button) {
  await copyText(text);
  flashButton(button, 'Copied', 1400);
}
