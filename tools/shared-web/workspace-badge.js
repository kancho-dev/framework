(() => {
  function workspaceNameFromPath(path, fallback = 'Workspace') {
    return String(path || '').split('/').filter(Boolean).at(-1) || fallback;
  }

  function setWorkspaceBadge(element, options = {}) {
    if (!element) return;
    const {
      name,
      root,
      placeholder = 'Loading workspace…',
      tooltipPrefix = 'Workspace',
      unavailable = false,
    } = options;
    const label = unavailable ? 'Workspace unavailable' : (name || workspaceNameFromPath(root, placeholder));
    element.textContent = label;
    element.title = root ? `${tooltipPrefix}: ${root}` : tooltipPrefix;
    element.setAttribute('aria-label', element.title);
  }

  window.FrameworkWorkspaceBadge = { set: setWorkspaceBadge, workspaceNameFromPath };
})();
