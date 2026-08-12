const steeringTextarea = (root) => root?.querySelector?.('textarea[name="steeringNotes"]') ?? null;

export function captureDetailViewState({ key, pane, steeringRoot }) {
  const textarea = steeringTextarea(steeringRoot);
  return {
    key,
    drawerScrollTop: pane?.scrollTop ?? 0,
    textareaHeight: textarea?.style.height ?? null,
    textareaScrollTop: textarea?.scrollTop ?? null,
  };
}

export function restoreDetailViewState(captured, { key, pane, steeringRoot }) {
  if (!captured || captured.key !== key) return false;
  const textarea = steeringTextarea(steeringRoot);
  if (textarea && captured.textareaHeight !== null) textarea.style.height = captured.textareaHeight;
  if (textarea && captured.textareaScrollTop !== null) textarea.scrollTop = captured.textareaScrollTop;
  if (pane) pane.scrollTop = captured.drawerScrollTop;
  return true;
}
