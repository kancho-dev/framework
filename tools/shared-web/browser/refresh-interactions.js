function deferScope(node) {
  return node?.closest?.('[data-refresh-scope="defer"]') ?? null;
}

function flavor(scope) {
  const value = scope?.dataset.refreshDefer ?? 'incidental';
  if (value !== 'authored' && value !== 'incidental') throw new Error(`Unknown refresh defer flavor: ${value}`);
  return value;
}

export function createRefreshInteractionRegistry({ root = document, onRelease = () => {} } = {}) {
  const active = new Map();
  const listeners = [];

  function emitRelease(scope) {
    if (!scope || !isScopeActive(scope)) onRelease(scope);
  }

  function beginInteraction(key, { scope = null, kind = scope ? flavor(scope) : 'authored' } = {}) {
    if (!key || active.has(key)) throw new Error(`Interaction key must be unique: ${key}`);
    active.set(key, { scope, flavor: kind });
  }

  function endInteraction(key) {
    const interaction = active.get(key);
    if (!interaction) return false;
    active.delete(key);
    emitRelease(interaction.scope);
    return true;
  }

  function selectionScope() {
    const selection = root.getSelection?.() ?? root.ownerDocument?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.anchorNode) return null;
    const node = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    const scope = deferScope(node);
    return scope && flavor(scope) === 'incidental' ? scope : null;
  }

  function isScopeActive(scope) {
    if ([...active.values()].some((item) => item.scope === scope || (item.scope && scope.contains?.(item.scope)))) return true;
    if (selectionScope() === scope) return true;
    if (flavor(scope) !== 'incidental') return false;
    const documentRoot = root.nodeType === 9 ? root : root.ownerDocument;
    const focused = documentRoot?.activeElement;
    return Boolean(focused && scope.contains?.(focused));
  }

  function isDeferred(commitRoot) {
    if ([...active.values()].some((item) => item.scope === null)) return true;
    for (const scope of [commitRoot, ...commitRoot.querySelectorAll('[data-refresh-scope="defer"]')]) {
      if (scope.matches?.('[data-refresh-scope="defer"]') && isScopeActive(scope)) return true;
    }
    return false;
  }

  function listen(type, handler) {
    root.addEventListener(type, handler, true);
    listeners.push(() => root.removeEventListener(type, handler, true));
  }

  let previousSelectionScope = null;
  listen('selectionchange', () => {
    const current = selectionScope();
    if (previousSelectionScope && previousSelectionScope !== current) emitRelease(previousSelectionScope);
    previousSelectionScope = current;
  });
  listen('focusout', (event) => {
    const scope = deferScope(event.target);
    if (scope) queueMicrotask(() => emitRelease(scope));
  });
  listen('pointerdown', (event) => {
    const scope = deferScope(event.target);
    const key = `pointer:${event.pointerId}`;
    if (scope && !active.has(key)) beginInteraction(key, { scope, kind: 'incidental' });
  });
  listen('pointerup', (event) => endInteraction(`pointer:${event.pointerId}`));
  listen('pointercancel', (event) => endInteraction(`pointer:${event.pointerId}`));
  listen('dragstart', (event) => {
    const scope = deferScope(event.target);
    if (scope) beginInteraction('native-drag', { scope, kind: flavor(scope) });
  });
  listen('dragend', () => endInteraction('native-drag'));

  function destroy() {
    for (const remove of listeners) remove();
    active.clear();
  }

  return { beginInteraction, endInteraction, isDeferred, destroy };
}
