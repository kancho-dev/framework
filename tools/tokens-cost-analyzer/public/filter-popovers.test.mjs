import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFilterPopovers } from './filter-popovers.js';

// Menus stand in for `<details data-facet-menu>`: open state, containment, and
// a focusable trigger are the only DOM facts the rules depend on.
function menu(name, contents = []) {
  return { name, open: false, contains: (node) => node === name || contents.includes(node) };
}

function controller(...menus) {
  const focused = [];
  return { menus, focused, popovers: createFilterPopovers({ menus: () => menus, focusTrigger: (m) => focused.push(m.name) }) };
}

test('opening one popover closes every other', () => {
  const { menus, popovers } = controller(menu('machine'), menu('workspace'), menu('all'));
  menus[0].open = true;
  menus[1].open = true;
  assert.equal(popovers.exclusive(menus[1]), true);
  assert.deepEqual(menus.map((m) => m.open), [false, true, false]);
  assert.equal(popovers.exclusive(menus[1]), false, 'nothing left to close is not a change');
});

test('a click outside the filter controls dismisses an open popover', () => {
  const { menus, popovers } = controller(menu('machine', ['checkbox']), menu('workspace'));
  menus[0].open = true;
  assert.equal(popovers.outsideClick('checkbox'), false, 'clicking a checkbox inside the list keeps it open');
  assert.equal(menus[0].open, true);
  assert.equal(popovers.outsideClick('chart'), true);
  assert.equal(menus[0].open, false);
  assert.equal(popovers.outsideClick('chart'), false, 'nothing open, nothing to report');
});

test('Escape closes the open popover and returns focus to its trigger', () => {
  const { menus, focused, popovers } = controller(menu('machine'), menu('workspace'));
  assert.equal(popovers.escape(), false, 'Escape is not swallowed when no popover is open');
  assert.deepEqual(focused, []);
  menus[1].open = true;
  assert.equal(popovers.escape(), true);
  assert.deepEqual(menus.map((m) => m.open), [false, false]);
  assert.deepEqual(focused, ['workspace'], 'focus does not stay in a list that is gone');
});

// A static guard: the mobile rule is invisible on a desktop screen, so nothing
// but a test stops it from being dropped the next time the header is tuned.
test('the header stays pinned at phone width', () => {
  const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /header\{position:sticky/, 'the analysis context is pinned');
  const narrowBlocks = [...css.matchAll(/@media\(max-width:(\d+)px\)\{([^@]*)\}/g)].filter(([, width]) => Number(width) <= 1000);
  for (const [, width, body] of narrowBlocks) {
    assert.doesNotMatch(body, /header\{[^}]*position:(static|relative)/, `the ≤${width}px block must not unpin the header`);
  }
  assert.match(css, /@media\(max-width:600px\)\{header\{/, 'phone width shrinks the header instead of unpinning it');
});
