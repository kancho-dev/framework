(() => {
  const instances = new WeakMap();
  let openInstance = null;
  let nextId = 1;

  function attach(select, config = {}) {
    if (!select) return null;
    instances.get(select)?.destroy();
    const maxVisible = Number(config.maxVisible || 12);
    const minWidth = Number(config.minWidth || 0);
    const wrapper = document.createElement('div');
    wrapper.className = 'fw-select';
    if (select.id) wrapper.dataset.selectId = select.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fw-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    const menuId = `fw-select-${nextId++}`;
    menu.id = menuId;
    menu.className = 'fw-select-menu hidden';
    menu.setAttribute('role', 'listbox');
    button.setAttribute('aria-controls', menuId);
    select.classList.add('fw-select-native');
    select.after(wrapper);
    wrapper.append(select, button);
    document.body.appendChild(menu);

    const observer = new MutationObserver(refresh);
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled', 'label', 'value'] });

    const instance = { select, wrapper, button, menu, activeIndex: -1, options: [], refresh, destroy };
    instances.set(select, instance);

    function readOptions() {
      return [...select.options].map((option, index) => ({
        index,
        value: option.value,
        label: option.textContent || option.label || option.value,
        disabled: option.disabled,
        selected: option.selected,
      }));
    }

    function selectedOption() {
      return readOptions().find((option) => option.selected) || readOptions()[0];
    }

    function syncButton() {
      const selected = selectedOption();
      button.textContent = selected?.label || '';
      button.title = selected?.label || '';
      button.disabled = select.disabled;
      button.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || selected?.label || 'Select');
    }

    function optionContentWidth() {
      const longest = readOptions().reduce((max, option) => Math.max(max, (option.label || '').length), 0);
      return Math.min(720, Math.ceil(longest * 8 + 45));
    }

    function positionMenu() {
      const rect = button.getBoundingClientRect();
      const itemHeight = 30;
      const maxHeight = maxVisible * itemHeight + 8;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < Math.min(maxHeight, 120) && spaceAbove > spaceBelow;
      const contentWidth = config.fitContent === false ? 0 : optionContentWidth();
      const width = Math.min(Math.max(rect.width, minWidth, contentWidth), window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = openAbove ? 'auto' : `${Math.round(rect.bottom + 4)}px`;
      menu.style.bottom = openAbove ? `${Math.round(window.innerHeight - rect.top + 4)}px` : 'auto';
      menu.style.width = `${Math.round(width)}px`;
      menu.style.setProperty('--fw-select-visible', String(maxVisible));
    }

    function renderMenu({ preserveScroll = false } = {}) {
      const previousScrollTop = menu.scrollTop;
      instance.options = readOptions();
      const selectedIndex = instance.options.findIndex((option) => option.selected);
      if (instance.activeIndex < 0) instance.activeIndex = Math.max(0, selectedIndex);
      instance.activeIndex = Math.max(0, Math.min(instance.activeIndex, instance.options.length - 1));
      positionMenu();
      menu.innerHTML = instance.options.map((option, index) => `
        <button id="${menuId}-option-${index}" type="button" role="option" aria-selected="${option.selected ? 'true' : 'false'}" class="fw-select-option${index === instance.activeIndex ? ' active' : ''}${option.selected ? ' selected' : ''}" data-index="${index}" ${option.disabled ? 'disabled' : ''} title="${escapeHtml(option.label)}">
          <span>${escapeHtml(option.label)}</span>
        </button>`).join('');
      menu.classList.remove('hidden');
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-activedescendant', `${menuId}-option-${instance.activeIndex}`);
      if (preserveScroll && previousScrollTop > 0) menu.scrollTop = previousScrollTop;
      else menu.querySelector('.fw-select-option.active')?.scrollIntoView({ block: 'nearest' });
      openInstance = instance;
    }

    function open() {
      if (select.disabled) return;
      closeOpen(instance);
      const selectedIndex = readOptions().findIndex((option) => option.selected);
      instance.activeIndex = Math.max(0, selectedIndex);
      renderMenu();
    }

    function close() {
      menu.classList.add('hidden');
      menu.innerHTML = '';
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-activedescendant');
      if (openInstance === instance) openInstance = null;
    }

    function choose(index) {
      const option = instance.options[index];
      if (!option || option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncButton();
      close();
    }

    function move(delta) {
      if (!instance.options.length) return;
      let next = instance.activeIndex;
      for (let step = 0; step < instance.options.length; step += 1) {
        next = Math.max(0, Math.min(instance.options.length - 1, next + delta));
        if (!instance.options[next]?.disabled) break;
      }
      instance.activeIndex = next;
      renderMenu();
    }

    function refresh() {
      syncButton();
      if (!menu.classList.contains('hidden')) renderMenu({ preserveScroll: true });
    }

    function onKeydown(event) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && menu.classList.contains('hidden')) {
        event.preventDefault();
        open();
        return;
      }
      if (menu.classList.contains('hidden')) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Home') { event.preventDefault(); instance.activeIndex = 0; renderMenu(); }
      else if (event.key === 'End') { event.preventDefault(); instance.activeIndex = instance.options.length - 1; renderMenu(); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(instance.activeIndex); }
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }

    function onMenuClick(event) {
      const item = event.target.closest('.fw-select-option');
      if (item) choose(Number(item.dataset.index));
    }
    function onWindowChange() { if (!menu.classList.contains('hidden')) positionMenu(); }

    button.addEventListener('click', () => (menu.classList.contains('hidden') ? open() : close()));
    button.addEventListener('keydown', onKeydown);
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', onMenuClick);
    select.addEventListener('change', syncButton);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    syncButton();

    function destroy() {
      observer.disconnect();
      button.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
      select.removeEventListener('change', syncButton);
      select.classList.remove('fw-select-native');
      wrapper.before(select);
      wrapper.remove();
      menu.remove();
      instances.delete(select);
      if (openInstance === instance) openInstance = null;
    }

    return instance;
  }

  function closeOpen(except) {
    if (openInstance && openInstance !== except) openInstance.destroyed ? openInstance = null : openInstance.menu.classList.add('hidden');
    if (openInstance && openInstance !== except) {
      openInstance.button.setAttribute('aria-expanded', 'false');
      openInstance.button.removeAttribute('aria-activedescendant');
      openInstance = null;
    }
  }

  document.addEventListener('mousedown', (event) => {
    if (!openInstance) return;
    if (openInstance.wrapper.contains(event.target) || openInstance.menu.contains(event.target)) return;
    openInstance.menu.classList.add('hidden');
    openInstance.button.setAttribute('aria-expanded', 'false');
    openInstance.button.removeAttribute('aria-activedescendant');
    openInstance = null;
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function refreshAll() {
    for (const instance of instances.values?.() || []) instance.refresh();
  }

  const attached = new Set();
  const originalAttach = attach;
  function trackedAttach(select, config = {}) {
    const instance = originalAttach(select, config);
    if (instance) attached.add(instance);
    return instance;
  }

  function refreshAttached() {
    for (const instance of [...attached]) {
      if (!document.contains(instance.select)) attached.delete(instance);
      else instance.refresh();
    }
  }

  window.FrameworkSelect = { attach: trackedAttach, refreshAll: refreshAttached };
})();
