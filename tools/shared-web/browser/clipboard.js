export async function copyText(text) {
  await navigator.clipboard.writeText(String(text ?? ''));
}

export function flashButton(button, label = 'Copied', ms = 1200) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = label;
  clearTimeout(button.__frameworkFlashTimer);
  button.__frameworkFlashTimer = setTimeout(() => { button.textContent = original; }, ms);
}
