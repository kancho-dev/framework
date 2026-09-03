const PRIMARY_METADATA_SELECT = '.primary-meta-line select';

export function attachDeferredSelectPicker(container) {
  container.addEventListener('mousedown', handleDeferredSelectPicker);
  container.addEventListener('click', handleDeferredSelectPicker);
}

export function handleDeferredSelectPicker(event) {
  const select = event.target.closest?.(PRIMARY_METADATA_SELECT);
  if (!select || typeof select.showPicker !== 'function') return false;

  if (event.type === 'mousedown' && event.button === 0) {
    event.preventDefault();
    return true;
  }

  if (event.type === 'click' && event.detail > 0) {
    event.preventDefault();
    select.focus();
    select.showPicker();
    return true;
  }

  return false;
}
