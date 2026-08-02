import morphdom from '../vendor/morphdom-2.7.8/morphdom-esm.js';

const adapters = new Map();

export function registerStateAdapter(name, adapter) {
  if (!name || adapters.has(name)) throw new Error(`State adapter must be uniquely named: ${name}`);
  if (typeof adapter?.capture !== 'function' || typeof adapter?.restore !== 'function') {
    throw new TypeError(`State adapter ${name} requires capture and restore functions`);
  }
  adapters.set(name, adapter);
  return () => adapters.delete(name);
}

function stateKey(node) {
  return node.id ? `id:${node.id}` : node.dataset.stateKey ? `state:${node.dataset.stateKey}` : null;
}

export function assertUniqueStateKeys(root) {
  const seen = new Map();
  for (const node of [root, ...root.querySelectorAll('[id], [data-state-key]')]) {
    for (const key of [node.id, node.dataset.stateKey].filter(Boolean)) {
      if (seen.has(key)) throw new Error(`Duplicate refresh key: ${key}`);
      seen.set(key, node);
    }
  }
}

function captureState(root) {
  const captured = [];
  for (const node of root.querySelectorAll('[data-state-adapter]')) {
    const adapter = adapters.get(node.dataset.stateAdapter);
    if (!adapter) throw new Error(`Unknown state adapter: ${node.dataset.stateAdapter}`);
    const key = stateKey(node);
    if (!key) throw new Error(`Adapted node requires id or data-state-key: ${node.dataset.stateAdapter}`);
    captured.push({ adapter, key, value: adapter.capture(node) });
  }
  return captured;
}

function findByKey(root, key) {
  const [kind, value] = key.split(/:(.*)/s, 2);
  if (kind === 'id') {
    const node = root.ownerDocument.getElementById(value);
    return node && root.contains(node) ? node : null;
  }
  return [...root.querySelectorAll('[data-state-key]')].find((node) => node.dataset.stateKey === value) ?? null;
}

function restoreState(root, captured) {
  for (const item of captured) {
    const node = findByKey(root, item.key);
    if (node) item.adapter.restore(node, item.value);
  }
}

function morphKey(node) {
  return node.id || node.dataset?.stateKey;
}

export function createMorphCommit({ root, render, commitData = () => {}, measure = () => {}, assertKeys = true }) {
  if (!root || typeof render !== 'function') throw new TypeError('Morph commit requires root and render');

  return async ({ data, reason }) => {
    commitData(data);
    const rendered = render({ data, reason });
    if (assertKeys) {
      assertUniqueStateKeys(root);
      if (rendered?.querySelectorAll) assertUniqueStateKeys(rendered);
    }
    const captured = captureState(root);
    morphdom(root, rendered, { getNodeKey: morphKey });
    restoreState(root, captured);
    await measure();
  };
}
