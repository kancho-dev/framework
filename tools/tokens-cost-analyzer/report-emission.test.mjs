import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { SCHEMA, SCHEMA_VERSION, validateReport } from './report-contract.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const encodePi = (path) => `-${resolve(path).replaceAll('/', '-')}--`;

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'tokens-emit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeJsonl(path, entries) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

async function writeSelfConfig(outDir, self) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'sources.json'), JSON.stringify({ schemaVersion: 1, self }));
}

async function analyze(scanRoot, outDir, sourceArgs, env = {}) {
  await execFileAsync(process.execPath, [join(here, 'analyze.mjs'), '--workspace', scanRoot, '--out', outDir, ...sourceArgs], { env: { ...process.env, ...env } });
  return JSON.parse(await readFile(join(outDir, 'report.v1.json'), 'utf8'));
}

const claudeEntry = (uuid, cwd, tokens) => ({
  type: 'assistant', uuid, cwd, timestamp: '2026-01-02T03:04:05.000Z',
  message: { model: 'claude-test', usage: { input_tokens: tokens, output_tokens: 0 } },
});

test('emits a valid v1 report whose origin lists only the workspaces present', async (t) => {
  const root = await workspace(t);
  const claudeRoot = join(root, 'claude');
  await writeJsonl(join(claudeRoot, 'p', 's.jsonl'), [claudeEntry('a1', root, 10)]);

  const report = await analyze(root, join(root, 'out'), ['--source', 'claude-code', '--claude-root', claudeRoot]);

  assert.equal(report.schema, SCHEMA);
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(validateReport(report).ok, true, validateReport(report).error);
  assert.deepEqual(report.origin.workspaces, [report.records[0].workspaceId]);
  assert.equal(report.report.coverage.earliestRecordDate, '2026-01-02');
  assert.equal(report.report.coverage.latestRecordDate, '2026-01-02');
});

// Run duration has to be observable from the run itself, or growth over time is
// only ever anecdotal.
test('reports run duration, split by source and emission', async (t) => {
  const root = await workspace(t);
  const claudeRoot = join(root, 'claude');
  await writeJsonl(join(claudeRoot, 'p', 's.jsonl'), [claudeEntry('a1', root, 10)]);

  const { stdout } = await execFileAsync(process.execPath, [
    join(here, 'analyze.mjs'), '--workspace', root, '--out', join(root, 'out'),
    '--source', 'claude-code', '--claude-root', claudeRoot,
  ]);

  const timing = stdout.split('\n').find((line) => line.startsWith('Timing:'));
  assert.ok(timing, `no timing line in output: ${stdout}`);
  assert.match(timing, /^Timing: total \d+ ms \(scan \d+ ms, claude-code \d+ ms, emit \d+ ms\)$/);
});

test('the report carries no absolute local paths or pricing path', async (t) => {
  const root = await workspace(t);
  const piRoot = join(root, 'pi');
  await writeJsonl(join(piRoot, encodePi(root), 's.jsonl'), [
    { type: 'message', id: 'assistant-1', timestamp: '2026-01-02T03:04:05.000Z', message: { role: 'assistant', model: 'm', usage: { input: 5, output: 1 } } },
  ]);

  const outDir = join(root, 'out');
  // The scan root stands in as HOME so redaction is exercised on paths the
  // fixture actually owns rather than vacuously passing outside the real home.
  const report = await analyze(root, outDir, ['--source', 'pi', '--pi-root', piRoot], { HOME: root });
  const serialized = JSON.stringify(report);

  assert.equal(serialized.includes(root), false, 'the home directory must be redacted out of the artifact');
  assert.equal(serialized.includes(homedir()), false);
  assert.equal(report.report.pricingSources.every(({ fingerprint }) => /^sha256:[a-f0-9]{64}$/.test(fingerprint)), true);
  assert.equal(report.report.pricingSources.some((source) => 'path' in source), false);
  // Pi's session path is the one browser reference that embeds a home directory.
  assert.match(report.records[0].sessionBrowserPath, /^~\//);
});

test('nested workspaces partition the same scan without changing the total', async (t) => {
  const root = await workspace(t);
  const claudeRoot = join(root, 'claude');
  const nested = join(root, 'work', 'client-x');
  await writeJsonl(join(claudeRoot, 'p', 's.jsonl'), [
    claudeEntry('a1', root, 10),
    claudeEntry('a2', nested, 20),
    claudeEntry('a3', join(nested, 'repo'), 30),
  ]);
  const sourceArgs = ['--source', 'claude-code', '--claude-root', claudeRoot];

  const catchAllOnly = await analyze(root, join(root, 'out-a'), sourceArgs);
  const outDir = join(root, 'out-b');
  await writeSelfConfig(outDir, { machineId: 'workstation', root, catchAllId: 'home', workspaces: [{ id: 'client', root: nested }] });
  const partitioned = await analyze(root, outDir, sourceArgs);

  const total = (report) => report.records.reduce((sum, record) => sum + record.totalTokens, 0);
  assert.equal(total(catchAllOnly), 60);
  assert.equal(total(partitioned), total(catchAllOnly), 'adding a nested workspace must change attribution only');
  assert.equal(partitioned.records.length, catchAllOnly.records.length);

  const byWorkspace = new Map();
  for (const record of partitioned.records) byWorkspace.set(record.workspaceId, (byWorkspace.get(record.workspaceId) || 0) + record.totalTokens);
  assert.deepEqual([...byWorkspace.entries()].sort(), [['client', 50], ['home', 10]]);
  assert.equal([...byWorkspace.values()].reduce((a, b) => a + b, 0), total(partitioned), 'byWorkspace rows must sum to the overall total');
  assert.deepEqual(partitioned.origin.workspaces, ['client', 'home']);
});

test('records outside the scan root are not collected, and unmatched ones fall to the catch-all', async (t) => {
  const root = await workspace(t);
  const claudeRoot = join(root, 'claude');
  const inside = join(root, 'nested');
  await writeJsonl(join(claudeRoot, 'p', 's.jsonl'), [
    claudeEntry('a1', inside, 10),
    claudeEntry('a2', join(root, '..', 'outside-the-root'), 99),
  ]);

  const outDir = join(root, 'out');
  await writeSelfConfig(outDir, { machineId: 'workstation', root, catchAllId: 'home', workspaces: [{ id: 'other', root: join(root, 'other') }] });
  const report = await analyze(root, outDir, ['--source', 'claude-code', '--claude-root', claudeRoot]);

  assert.equal(report.records.length, 1, 'the out-of-root record is not collected at all');
  assert.equal(report.records[0].workspaceId, 'home');
});

test('identity is machine-scoped, and a positional id is never classed native', async (t) => {
  const root = await workspace(t);
  const claudeRoot = join(root, 'claude');
  const codexRoot = join(root, 'codex');
  await writeJsonl(join(claudeRoot, 'p', 's.jsonl'), [
    claudeEntry('a1', root, 10),
    // No `uuid`: the adapter falls back to a positional messageId, which is not
    // a durable source id (design §3.3).
    { type: 'assistant', cwd: root, timestamp: '2026-01-02T03:04:06.000Z', message: { model: 'claude-test', usage: { input_tokens: 11, output_tokens: 0 } } },
  ]);
  await writeJsonl(join(codexRoot, 'rollout-c.jsonl'), [
    { type: 'session_meta', payload: { id: 'codex-session', cwd: root, model_provider: 'openai' }, timestamp: '2026-01-02T03:04:07.000Z' },
    { type: 'event_msg', timestamp: '2026-01-02T03:04:08.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } } } },
    { type: 'event_msg', timestamp: '2026-01-02T03:04:08.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } } } },
  ]);

  const outDir = join(root, 'out');
  await writeSelfConfig(outDir, { machineId: 'workstation', root, catchAllId: 'home', workspaces: [] });
  const report = await analyze(root, outDir, ['--codex-root', codexRoot, '--claude-root', claudeRoot, '--pi-root', join(root, 'absent-pi'), '--opencode-db', join(root, 'absent.db')]);

  const byMessageId = (id) => report.records.find((record) => record.messageId === id);
  assert.equal(validateReport(report).ok, true, validateReport(report).error);
  assert.equal(report.records.every((record) => record.unitId.startsWith('workstation/')), true);

  assert.equal(byMessageId('a1').identityClass, 'native');
  assert.equal(byMessageId('a1').unitId, 'workstation/claude-code/s/a1');
  assert.equal(byMessageId('claude-entry-1').identityClass, 'fingerprint', 'a positional fallback is not a native id');

  const codexRecords = report.records.filter((record) => record.source === 'codex');
  assert.equal(codexRecords.length, 2);
  assert.equal(codexRecords.every((record) => record.identityClass === 'fingerprint'), true);
  // Two identical turns in one session stay two records, ordinal-suffixed in file order.
  assert.equal(codexRecords[0].contentFingerprint, codexRecords[1].contentFingerprint);
  assert.equal(new Set(codexRecords.map((record) => record.unitId)).size, 2);
  assert.match(codexRecords[1].unitId, /-2$/);

  const derivations = new Set(report.records.map((record) => JSON.stringify(record.derivation)));
  assert.equal(derivations.size, 1, 'one pricing table and generator version priced this scan');
  assert.match([...derivations][0], /"pricingFingerprint":"sha256:[a-f0-9]{64}"/);
});

test('a repeated scan of unchanged sessions reproduces every unit id', async (t) => {
  const root = await workspace(t);
  const codexRoot = join(root, 'codex');
  await writeJsonl(join(codexRoot, 'rollout-c.jsonl'), [
    { type: 'session_meta', payload: { id: 'codex-session', cwd: root, model_provider: 'openai' }, timestamp: '2026-01-02T03:04:07.000Z' },
    { type: 'event_msg', timestamp: '2026-01-02T03:04:08.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } } } },
    { type: 'event_msg', timestamp: '2026-01-02T03:04:08.000Z', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } } } },
  ]);
  const sourceArgs = ['--source', 'codex', '--codex-root', codexRoot];

  const first = await analyze(root, join(root, 'out-1'), sourceArgs);
  const second = await analyze(root, join(root, 'out-2'), sourceArgs);

  assert.deepEqual(second.records.map((record) => record.unitId), first.records.map((record) => record.unitId));
  assert.notEqual(first.report.reportId, second.report.reportId, 'each generation is its own report');
});

test('the orphaned normalized.json is removed on the next scan', async (t) => {
  const root = await workspace(t);
  const outDir = join(root, 'out');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'normalized.json'), '{"records":[]}');

  await analyze(root, outDir, ['--source', 'pi', '--pi-root', join(root, 'absent-pi')]);

  await assert.rejects(readFile(join(outDir, 'normalized.json'), 'utf8'), /ENOENT/);
});
