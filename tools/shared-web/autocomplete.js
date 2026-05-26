(() => {
  const instances = new WeakMap();
  const activeInstances = new Set();
  let openInstance = null;
  let nextId = 1;

  function normalizeOption(option) {
    if (typeof option === 'string') return { value: option, label: '' };
    return { value: String(option?.value || ''), label: String(option?.label || '') };
  }

  function optionMatches(option, query) {
    const text = `${option.value} ${option.label}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => text.includes(term));
  }

  function attach(input, config = {}) {
    if (!input) return null;
    instances.get(input)?.destroy();
    const maxVisible = Number(config.maxVisible || 12);
    const minWidth = Number(config.minWidth || 0);
    const menu = document.createElement('div');
    const menuId = `fw-autocomplete-${nextId++}`;
    menu.id = menuId;
    menu.className = 'fw-autocomplete hidden';
    menu.setAttribute('role', 'listbox');
    document.body.appendChild(menu);
    const instance = { input, menu, activeIndex: -1, options: [], refresh, destroy };
    instances.set(input, instance);
    activeInstances.add(instance);

    function sourceOptions() {
      const raw = typeof config.options === 'function' ? config.options(input.value) : config.options;
      return (raw || []).map(normalizeOption).filter((option) => option.value);
    }

    function filteredOptions() {
      const query = input.value.trim();
      const options = sourceOptions();
      return query ? options.filter((option) => optionMatches(option, query)) : options;
    }

    function positionMenu() {
      const rect = input.getBoundingClientRect();
      const itemHeight = 30;
      const maxHeight = maxVisible * itemHeight + 8;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openAbove = spaceBelow < Math.min(maxHeight, 120) && spaceAbove > spaceBelow;
      const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = openAbove ? 'auto' : `${Math.round(rect.bottom + 4)}px`;
      menu.style.bottom = openAbove ? `${Math.round(window.innerHeight - rect.top + 4)}px` : 'auto';
      menu.style.width = `${Math.round(width)}px`;
      menu.style.setProperty('--fw-autocomplete-visible', String(maxVisible));
    }

    function render() {
      instance.options = filteredOptions();
      instance.activeIndex = instance.options.length ? Math.max(0, Math.min(instance.activeIndex, instance.options.length - 1)) : -1;
      if (!instance.options.length) return close();
      positionMenu();
      menu.innerHTML = instance.options.map((option, index) => {
        const active = index === instance.activeIndex;
        return `
        <button id="${menuId}-option-${index}" type="button" role="option" aria-selected="${active ? 'true' : 'false'}" class="fw-autocomplete-option${active ? ' active' : ''}" data-index="${index}" title="${escapeHtml([option.value, option.label].filter(Boolean).join(' — '))}">
          <strong>${escapeHtml(option.value)}</strong>${option.label ? `<span>${escapeHtml(option.label)}</span>` : ''}
        </button>`;
      }).join('');
      menu.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', `${menuId}-option-${instance.activeIndex}`);
      menu.querySelector('.fw-autocomplete-option.active')?.scrollIntoView({ block: 'nearest' });
      openInstance = instance;
    }

    function close() {
      menu.classList.add('hidden');
      menu.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (openInstance === instance) openInstance = null;
    }

    function choose(index) {
      const option = instance.options[index];
      if (!option) return;
      input.value = option.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      config.onSelect?.(option, input);
      close();
    }

    function onInput() { instance.activeIndex = 0; render(); }
    function onFocus() { instance.activeIndex = 0; render(); }
    function refresh() {
      if (document.activeElement !== input || menu.classList.contains('hidden')) return;
      const activeValue = instance.options[instance.activeIndex]?.value;
      instance.options = filteredOptions();
      const activeMatch = activeValue ? instance.options.findIndex((option) => option.value === activeValue) : -1;
      instance.activeIndex = activeMatch >= 0 ? activeMatch : Math.max(0, Math.min(instance.activeIndex, instance.options.length - 1));
      render();
    }
    function onKeydown(event) {
      if (menu.classList.contains('hidden') && ['ArrowDown', 'ArrowUp'].includes(event.key)) render();
      if (menu.classList.contains('hidden')) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); instance.activeIndex = Math.min(instance.options.length - 1, instance.activeIndex + 1); render(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); instance.activeIndex = Math.max(0, instance.activeIndex - 1); render(); }
      else if (event.key === 'Enter' && instance.activeIndex >= 0) { event.preventDefault(); choose(instance.activeIndex); }
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }
    function onClick(event) {
      const button = event.target.closest('.fw-autocomplete-option');
      if (button) choose(Number(button.dataset.index));
    }
    function onWindowChange() { if (!menu.classList.contains('hidden')) positionMenu(); }

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', menuId);
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('keydown', onKeydown);
    menu.addEventListener('mousedown', (event) => event.preventDefault());
    menu.addEventListener('click', onClick);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    function destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
      menu.remove();
      instances.delete(input);
      activeInstances.delete(instance);
      if (openInstance === instance) openInstance = null;
    }

    return instance;
  }

  document.addEventListener('mousedown', (event) => {
    if (!openInstance) return;
    if (event.target === openInstance.input || openInstance.menu.contains(event.target)) return;
    openInstance.input.setAttribute('aria-expanded', 'false');
    openInstance.input.removeAttribute('aria-activedescendant');
    openInstance.menu.classList.add('hidden');
    openInstance = null;
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function cleanup(root = document) {
    for (const instance of [...activeInstances]) {
      if (!document.contains(instance.input) || root.contains?.(instance.input)) instance.destroy();
    }
  }

  window.FrameworkAutocomplete = { attach, cleanup };
})();
