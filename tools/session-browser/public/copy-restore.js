import { flashButton } from '/shared/browser/clipboard.js';
import { restoreCommand } from './restore-command.js';

export { restoreCommand, shellQuote } from './restore-command.js';

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
