export function sessionBrowserRoute(fallback = '../sessions/') {
  return window.__FRAMEWORK_COCKPIT__?.tools?.find((tool) => tool.id === 'session-browser')?.route || fallback;
}

export function sessionBrowserScope(workspaceRoot, fallback = location.pathname) {
  return workspaceRoot || fallback;
}

export function storeSessionBrowserSelection(path, topicId, options = {}) {
  if (!path) return;
  const scope = sessionBrowserScope(options.workspaceRoot, options.fallbackScope);
  localStorage.setItem(`framework.session-browser.selectedPath:${scope}`, path);
  const topicKey = `framework.session-browser.selectedTopic:${scope}:${path || 'none'}`;
  if (topicId) localStorage.setItem(topicKey, topicId);
  else localStorage.removeItem(topicKey);
}

export function sessionBrowserHrefFor(record, options = {}) {
  return record?.sessionBrowserPath ? sessionBrowserRoute(options.fallbackRoute) : '';
}
