import test from 'node:test';
import assert from 'node:assert/strict';
import { nextActorBadge } from './next-actor.js';

test('renders accessible icon-only Operator and Agent badges', () => {
  const operator = nextActorBadge('operator');
  const agent = nextActorBadge('agent');
  assert.match(operator, /class="next-actor-badge operator"/);
  assert.match(operator, /aria-label="Next action: Operator"/);
  assert.match(operator, /title="Next action: Operator"/);
  assert.match(operator, /<svg/);
  assert.doesNotMatch(operator, />Operator</);
  assert.match(agent, /class="next-actor-badge agent"/);
  assert.match(agent, /aria-label="Next action: Agent"/);
  assert.match(agent, /title="Next action: Agent"/);
  assert.doesNotMatch(agent, />Agent</);
});

test('renders no badge for unset or unknown actors', () => {
  assert.equal(nextActorBadge(null), '');
  assert.equal(nextActorBadge('builder'), '');
});
