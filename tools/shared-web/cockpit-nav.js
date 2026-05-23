(() => {
  const config = window.__FRAMEWORK_COCKPIT__;
  if (!config?.enabled) return;
  const mount = document.querySelector('#cockpit-nav');
  if (!mount) return;
  const tools = Array.isArray(config.tools) ? config.tools : [];
  mount.innerHTML = `
    <nav class="cockpit-nav" aria-label="Framework Cockpit navigation">
      <button class="cockpit-menu-button" type="button" aria-expanded="false" aria-controls="cockpit-menu" title="Open Framework Cockpit menu">
        <span class="cockpit-menu-lines" aria-hidden="true"></span>
        <span class="sr-only">Open Framework Cockpit menu</span>
      </button>
      <div id="cockpit-menu" class="cockpit-menu" hidden>
        <div class="cockpit-menu-title">Framework Cockpit</div>
        ${renderHomeLink(config.current === 'home')}
        ${tools.map((tool) => renderToolLink(tool, tool.id === config.current)).join('')}
      </div>
    </nav>`;

  const button = mount.querySelector('.cockpit-menu-button');
  const menu = mount.querySelector('#cockpit-menu');
  button?.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  document.addEventListener('click', (event) => {
    if (!mount.contains(event.target)) setOpen(false);
  });

  function setOpen(open) {
    if (!button || !menu) return;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }

  function renderHomeLink(current) {
    const icon = `<img src="${escapeAttr(config.icon || '/icon.svg')}" alt="" width="24" height="24">`;
    if (current) return `<span class="cockpit-menu-item current" aria-current="page">${icon}<span>Home</span></span>`;
    return `<a class="cockpit-menu-item" href="${escapeAttr(config.home || '/')}">${icon}<span>Home</span></a>`;
  }

  function renderToolLink(tool, current) {
    const label = escapeHtml(tool.shortTitle || tool.title || tool.id);
    const icon = tool.icon ? `<img src="${escapeAttr(tool.icon)}" alt="" width="24" height="24">` : '';
    if (current) {
      return `<span class="cockpit-menu-item current" aria-current="page">${icon}<span>${label}</span></span>`;
    }
    return `<a class="cockpit-menu-item" href="${escapeAttr(tool.route)}">${icon}<span>${label}</span></a>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }
})();
