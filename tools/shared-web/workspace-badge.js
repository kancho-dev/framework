(() => {
  function workspaceNameFromPath(path, fallback = 'Workspace') {
    return String(path || '').split('/').filter(Boolean).at(-1) || fallback;
  }

  function setWorkspaceBadge(element, options = {}) {
    if (!element) return;
    const cockpit = window.__FRAMEWORK_COCKPIT__ || {};
    const {
      name,
      root,
      placeholder = 'Loading workspace…',
      tooltipPrefix = 'Workspace',
      unavailable = false,
      workspaces = cockpit.workspaces,
      currentWorkspace = cockpit.currentWorkspace,
      workspaceId = cockpit.workspaceId,
      onSwitch,
      workspaceFilter,
    } = options;
    const allWorkspaces = Array.isArray(workspaces) ? workspaces : [];
    const items = typeof workspaceFilter === 'function' ? allWorkspaces.filter(workspaceFilter) : allWorkspaces;
    const currentId = workspaceId || currentWorkspace?.id;
    const label = unavailable ? 'Workspace unavailable' : (name || currentWorkspace?.name || workspaceNameFromPath(root || currentWorkspace?.root, placeholder));
    const title = root || currentWorkspace?.root ? `${tooltipPrefix}: ${root || currentWorkspace.root}` : tooltipPrefix;

    element.textContent = '';
    element.title = title;
    element.setAttribute('aria-label', title);
    element.classList.toggle('switchable', items.length > 1 && !unavailable);

    if (items.length > 1 && !unavailable) {
      const select = document.createElement('select');
      select.className = 'workspace-badge-select';
      select.setAttribute('aria-label', 'Switch workspace');
      select.title = title;
      for (const workspace of items) {
        const option = document.createElement('option');
        option.value = workspace.id;
        option.textContent = workspace.name || workspace.id;
        option.selected = workspace.id === currentId;
        select.append(option);
      }
      select.addEventListener('change', () => {
        if (typeof onSwitch === 'function') return onSwitch(select.value);
        const url = new URL(window.location.href);
        url.searchParams.set('workspace', select.value);
        window.location.href = url.toString();
      });
      element.append(select);
      const instance = window.FrameworkSelect?.attach?.(select, { maxVisible: 8 });
      fitSelectToSelectedOption(select, instance?.button || null);
      return;
    }

    element.textContent = label;
  }

  function fitSelectToSelectedOption(select, button) {
    const selectedText = select.selectedOptions[0]?.textContent || select.value || '';
    const target = button || select;
    const probe = document.createElement('span');
    const style = getComputedStyle(target);
    probe.textContent = selectedText;
    probe.style.position = 'fixed';
    probe.style.inset = 'auto';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.font = style.font;
    probe.style.fontWeight = style.fontWeight;
    document.body.append(probe);
    const textWidth = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    target.style.width = `${textWidth + 34}px`;
  }

  window.FrameworkWorkspaceBadge = { set: setWorkspaceBadge, workspaceNameFromPath };
})();
