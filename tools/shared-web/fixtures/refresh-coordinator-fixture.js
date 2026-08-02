import { assertUniqueStateKeys, createMorphCommit, registerStateAdapter } from '../browser/refresh-commit.js';
import { createRefreshInteractionRegistry } from '../browser/refresh-interactions.js';
import { createRefreshCoordinator } from '../refresh-coordinator.mjs';

registerStateAdapter('focused-input', {
  capture(node) {
    return { focused: document.activeElement === node, value: node.value, start: node.selectionStart, end: node.selectionEnd };
  },
  restore(node, state) {
    node.value = state.value;
    if (state.focused) {
      node.focus();
      node.setSelectionRange(state.start, state.end);
    }
  },
});
registerStateAdapter('disclosure', {
  capture: (node) => node.open,
  restore: (node, open) => { node.open = open; },
});

const results = document.querySelector('#results');
const fixtureBaseline = {
  target: document.querySelector('#target').outerHTML,
  integration: document.querySelector('#integration').outerHTML,
};
let runNumber = 0;

function resetFixture() {
  getSelection().removeAllRanges();
  document.querySelector('#long-transcript')?.remove();
  for (const [id, html] of Object.entries(fixtureBaseline)) {
    const template = document.createElement('template');
    template.innerHTML = html;
    document.querySelector(`#${id}`).replaceWith(template.content.firstElementChild);
  }
}

function record(name, passed, detail = '') {
  const item = document.createElement('li');
  item.className = passed ? 'pass' : 'fail';
  item.textContent = `${passed ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`;
  results.append(item);
}

function renderedTarget() {
  const template = document.createElement('template');
  template.innerHTML = `<section id="target" data-state-key="fixture:target">
    <label>Draft <input id="draft" data-state-adapter="focused-input" value="new server value"></label>
    <details id="details" data-state-adapter="disclosure"><summary>Disclosure updated</summary><p>Nested <strong>rendered Markdown</strong></p></details>
    <div id="scroll"><span>Updated horizontally scrollable keyed content</span></div>
    <p id="selection" data-refresh-scope="defer" data-refresh-defer="incidental">Select this stable text across a refresh.</p>
  </section>`;
  return template.content.firstElementChild;
}

async function run() {
  results.replaceChildren();
  delete document.body.dataset.fixtureDone;
  resetFixture();
  runNumber += 1;
  const target = document.querySelector('#target');
  const input = document.querySelector('#draft');
  const details = document.querySelector('#details');
  const scroll = document.querySelector('#scroll');
  const selectionNode = document.querySelector('#selection').firstChild;
  input.focus();
  input.value = 'local draft';
  input.setSelectionRange(2, 7);
  details.open = true;
  scroll.scrollLeft = 180;

  let measuredAfterRestore = false;
  const commit = createMorphCommit({
    root: target,
    render: renderedTarget,
    measure: () => {
      const measuredInput = document.querySelector('#draft');
      measuredAfterRestore = measuredInput.value === 'local draft' && measuredInput.selectionStart === 2;
    },
  });
  await commit({ data: {}, reason: 'manual' });

  const nextInput = document.querySelector('#draft');
  record('focused node identity', nextInput === input && document.activeElement === input);
  record('input value and caret', input.value === 'local draft' && input.selectionStart === 2 && input.selectionEnd === 7);
  record('horizontal scroll', document.querySelector('#scroll').scrollLeft === 180);
  record('disclosure state', document.querySelector('#details').open);
  record('measurement runs after restore', measuredAfterRestore);
  record('nested rendered Markdown', document.querySelector('#details strong')?.textContent === 'rendered Markdown');

  input.blur();
  const range = document.createRange();
  range.setStart(selectionNode, 0);
  range.setEnd(selectionNode, 6);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  let released;
  const registry = createRefreshInteractionRegistry({ root: document, onRelease: () => { released = integrationRefresh.release('integration'); } });
  record('incidental selection defers its unit', registry.isDeferred(target));
  await commit({ data: {}, reason: 'poll' });
  record('text selection', selection.toString() === 'Select');
  selection.removeAllRanges();

  const integrationRoot = document.querySelector('#integration');
  const integrationInput = document.querySelector('#integration-input');
  const baselineValue = document.querySelector('#integration-value').textContent;
  const refreshedValue = `${baselineValue}:refreshed:${runNumber}`;
  const integrationRefresh = createRefreshCoordinator({ fetchData: async () => refreshedValue });
  integrationRefresh.registerCommitUnit({
    key: 'integration',
    isDeferred: () => registry.isDeferred(integrationRoot),
    commit: createMorphCommit({
      root: integrationRoot,
      render: ({ data }) => {
        const next = integrationRoot.cloneNode(true);
        next.querySelector('#integration-value').textContent = data;
        return next;
      },
    }),
  });
  integrationInput.focus();
  record('clean authored focus does not defer', !registry.isDeferred(integrationRoot));
  registry.beginInteraction('dirty-draft', { scope: integrationRoot });
  await integrationRefresh.request({ reason: 'poll' });
  record('dirty authored state defers coordinator commit', document.querySelector('#integration-value').textContent === baselineValue);
  registry.endInteraction('dirty-draft');
  await released;
  const releasedValue = document.querySelector('#integration-value').textContent;
  record('save releases while focus remains', releasedValue === refreshedValue && releasedValue !== baselineValue && document.activeElement === integrationInput);

  registry.beginInteraction('modal');
  record('scope-less interaction defers', registry.isDeferred(integrationRoot));
  registry.endInteraction('modal');
  integrationInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
  integrationInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
  record('repeated pointerdown is idempotent', registry.isDeferred(integrationRoot));
  integrationInput.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
  registry.destroy();

  const duplicate = renderedTarget();
  duplicate.querySelector('#details').dataset.stateKey = 'fixture:target';
  let duplicateFailed = false;
  try { assertUniqueStateKeys(duplicate); } catch { duplicateFailed = true; }
  record('duplicate key fails fast', duplicateFailed);

  const transcript = document.createElement('section');
  transcript.id = 'long-transcript';
  const messages = Array.from({ length: 4_000 }, (_, index) =>
    `<article data-state-key="message:${index}"><header>Message ${index}</header><details><summary>Tool call</summary><pre>${'content '.repeat(35)}${index}</pre></details></article>`
  ).join('');
  transcript.innerHTML = messages;
  document.body.append(transcript);
  const updatedTranscript = transcript.cloneNode(true);
  updatedTranscript.querySelector('[data-state-key="message:3999"] pre').append(' updated');
  const started = performance.now();
  const longCommit = createMorphCommit({ root: transcript, render: () => updatedTranscript });
  await longCommit({ data: {}, reason: 'mutation' });
  const elapsed = performance.now() - started;
  const performanceLimitMs = 250;
  record('long transcript morph stays under regression limit', elapsed >= 0.05 && elapsed < performanceLimitMs, `${elapsed.toFixed(1)} ms / ${performanceLimitMs} ms`);
  transcript.remove();
  const summary = { passes: results.querySelectorAll('.pass').length, failures: results.querySelectorAll('.fail').length };
  document.body.dataset.fixtureDone = 'true';
  return summary;
}

let executing = false;
async function execute(count = 1) {
  if (executing) return;
  executing = true;
  const summaries = [];
  try {
    for (let index = 0; index < count; index += 1) summaries.push(await run());
  } catch (error) {
    record('fixture execution', false, error.message);
    summaries.push({ passes: results.querySelectorAll('.pass').length, failures: results.querySelectorAll('.fail').length });
    document.body.dataset.fixtureDone = 'true';
  } finally {
    document.body.dataset.fixtureRuns = summaries.map(({ passes, failures }) => `${passes}/${failures}`).join(',');
    executing = false;
  }
}
document.querySelector('#run').addEventListener('click', () => execute());
const autorun = Number.parseInt(new URL(location.href).searchParams.get('autorun'), 10);
if (autorun > 0) execute(autorun);
