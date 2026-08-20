import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { formatSessionRef, isSourceRef, parseSessionRef, sessionKey } from './session-ref.mjs';

test('current-machine refs retain their existing shape', () => {
  assert.deepEqual(parseSessionRef('codex:abc-123'), { source: 'codex', machineId: null, value: 'abc-123' });
  assert.equal(formatSessionRef('claude-code', 'session-id'), 'claude-code:session-id');
  assert.equal(sessionKey('/tmp/session.jsonl'), `pi:${resolve('/tmp/session.jsonl')}`);
  assert.equal(sessionKey({ source: 'opencode', id: 'session-id' }), 'opencode:session-id');
});

test('legacy refs encode and parse the machine namespace for every source', () => {
  for (const source of ['pi', 'opencode', 'codex', 'claude-code']) {
    const value = source === 'pi' ? '/archive/pi/session.jsonl' : 'session-id';
    const ref = formatSessionRef(source, value, 'old-linux');
    assert.equal(ref, `${source}@old-linux:${value}`);
    assert.deepEqual(parseSessionRef(ref), { source, machineId: 'old-linux', value });
    assert.equal(isSourceRef(ref, source), true);
  }
});

test('legacy and live sessions with the same source ref have distinct keys', () => {
  const live = sessionKey({ source: 'codex', id: 'same-id' });
  const archived = sessionKey({ source: 'codex', machineId: 'old-linux', id: 'same-id' });

  assert.equal(live, 'codex:same-id');
  assert.equal(archived, 'codex@old-linux:same-id');
  assert.notEqual(live, archived);
});

test('session keys recover the machine namespace from a namespaced path', () => {
  assert.equal(
    sessionKey({ source: 'codex', id: 'same-id', path: 'codex@old-linux:same-id' }),
    'codex@old-linux:same-id',
  );
  assert.equal(
    sessionKey({ source: 'codex', path: 'codex@old-linux:same-id' }),
    'codex@old-linux:same-id',
  );
});

test('conflicting declared and path machine ids are rejected', () => {
  assert.throws(
    () => sessionKey({ source: 'codex', machineId: 'new-machine', id: 'same-id', path: 'codex@old-machine:same-id' }),
    /machine id conflicts/,
  );
});

test('pi legacy keys retain the real archive path', () => {
  const path = '/archive/old/pi/session.jsonl';
  assert.equal(sessionKey({ source: 'pi', machineId: 'old-linux', id: 'pi-session-id', path }), `pi@old-linux:${path}`);
  assert.equal(sessionKey(`pi@old-linux:${path}`), `pi@old-linux:${path}`);
});

test('invalid namespaces are not treated as refs', () => {
  for (const ref of ['codex@:id', 'codex@../old:id', 'unknown@old:id', 'codex@old:', 'codex']) {
    assert.equal(parseSessionRef(ref), null);
  }
  assert.throws(() => formatSessionRef('codex', 'id', '../old'), /Invalid machine id/);
});
