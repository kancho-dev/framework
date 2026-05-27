(() => {
  const workspaceId = window.__FRAMEWORK_WORKSPACE_ID__;
  if (!workspaceId || window.__FRAMEWORK_WORKSPACE_QUERY_PATCHED__) return;
  window.__FRAMEWORK_WORKSPACE_QUERY_PATCHED__ = true;
  const originalFetch = window.fetch.bind(window);

  function withWorkspace(input) {
    if (input instanceof Request) {
      const url = workspaceUrl(input.url);
      return url === input.url ? input : new Request(url, input);
    }
    if (typeof input !== 'string' && !(input instanceof URL)) return input;
    return workspaceUrl(String(input));
  }

  function workspaceUrl(value) {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin) return value;
    if (!url.searchParams.has('workspace')) url.searchParams.set('workspace', workspaceId);
    return typeof value === 'string' && !value.startsWith('http') && !value.startsWith('/')
      ? `${url.pathname.replace(currentDir(), '')}${url.search}${url.hash}`
      : `${url.pathname}${url.search}${url.hash}`;
  }

  function currentDir() {
    return window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname.replace(/[^/]+$/, '');
  }

  window.fetch = (input, init) => originalFetch(withWorkspace(input), init);
})();
