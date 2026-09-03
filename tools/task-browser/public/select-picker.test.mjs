import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { attachDeferredSelectPicker, handleDeferredSelectPicker } from './select-picker.js';

function fixture({ type, detail = 1, button = 0, supported = true, matches = true }) {
  const calls = [];
  const select = {
    focus: () => calls.push('focus'),
    ...(supported ? { showPicker: () => calls.push('showPicker') } : {}),
  };
  const event = {
    type,
    detail,
    button,
    target: { closest: (selector) => {
      calls.push(selector);
      return matches ? select : null;
    } },
    preventDefault: () => calls.push('preventDefault'),
  };
  return { event, calls };
}

function wiredFixture(name, { primary = true } = {}) {
  const listeners = new Map();
  const calls = [];
  const select = {
    name,
    focus: () => calls.push('focus'),
    showPicker: () => calls.push('showPicker'),
  };
  const container = {
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  attachDeferredSelectPicker(container);
  const dispatch = (type) => {
    let prevented = false;
    listeners.get(type)({
      type,
      button: 0,
      detail: 1,
      target: { closest: (selector) => selector === '.primary-meta-line select' && primary ? select : null },
      preventDefault: () => { prevented = true; calls.push(`prevent:${type}`); },
    });
    return prevented;
  };
  return { calls, dispatch };
}

test('primary mouse opening is deferred until click completes the initiating press', () => {
  const down = fixture({ type: 'mousedown' });
  assert.equal(handleDeferredSelectPicker(down.event), true);
  assert.deepEqual(down.calls, ['.primary-meta-line select', 'preventDefault']);

  const click = fixture({ type: 'click' });
  assert.equal(handleDeferredSelectPicker(click.event), true);
  assert.deepEqual(click.calls, ['.primary-meta-line select', 'preventDefault', 'focus', 'showPicker']);
});

test('actual delegated wiring covers every primary metadata field and excludes unrelated selects', () => {
  for (const name of ['status', 'priority', 'type', 'nextActor']) {
    const { calls, dispatch } = wiredFixture(name);
    assert.equal(dispatch('mousedown'), true, `${name} must suppress picker opening before release`);
    assert.deepEqual(calls, ['prevent:mousedown']);
    assert.equal(dispatch('click'), true, `${name} must open only after the completed click`);
    assert.deepEqual(calls, ['prevent:mousedown', 'prevent:click', 'focus', 'showPicker']);
  }

  for (const name of ['project-filter', 'priority-filter', 'unrelated']) {
    const { calls, dispatch } = wiredFixture(name, { primary: false });
    assert.equal(dispatch('mousedown'), false);
    assert.equal(dispatch('click'), false);
    assert.deepEqual(calls, []);
  }
});

test('application wiring and rendered field composition keep all four selects inside the guarded line', () => {
  const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const detailSource = readFileSync(new URL('./detail.js', import.meta.url), 'utf8');
  const primaryMeta = detailSource.match(/const primaryMeta = \[(.*?)\]\.join\(''\);/s)?.[1] || '';

  assert.ok(/attachDeferredSelectPicker\(els\.detailMeta\)/.test(appSource), 'detail metadata root must attach the picker guard');
  assert.ok(/editableMetaPill\('status'/.test(primaryMeta), 'status must render in the guarded line');
  assert.ok(/editableMetaPill\('priority'/.test(primaryMeta), 'priority must render in the guarded line');
  assert.ok(/editableMetaPill\('type'/.test(primaryMeta), 'type must render in the guarded line');
  assert.ok(/editableNextActorPill\(meta\.nextActor\)/.test(primaryMeta), 'next actor must render in the guarded line');
  assert.ok(/<div class="meta-line primary-meta-line"><div>\$\{primaryMeta\}<\/div>/.test(detailSource), 'primary fields must share the guarded wrapper');
  assert.ok(!/attachDeferredSelectPicker\(els\.(?:projectFilter|priorityFilter)\)/.test(appSource), 'filter selects must not attach the picker guard');
});

test('keyboard, non-primary, unsupported, and unrelated interactions retain their defaults', () => {
  for (const options of [
    { type: 'click', detail: 0 },
    { type: 'mousedown', button: 1 },
    { type: 'mousedown', supported: false },
    { type: 'click', supported: false },
    { type: 'mousedown', matches: false },
  ]) {
    const { event, calls } = fixture(options);
    assert.equal(handleDeferredSelectPicker(event), false);
    assert.deepEqual(calls, ['.primary-meta-line select']);
  }
});
