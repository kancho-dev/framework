import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { atomicWrite, temporaryPathFor } from './atomic-write.mjs';

const execFileAsync = promisify(execFile);
const moduleUrl = import.meta.url;
const rounds = 20;

// One writer process: writes a single repeated character so any interleaving
// with the other writer is visible as mixed content in the published target.
const writerSource = `
  import { atomicWrite } from ${JSON.stringify(fileURLToPath(new URL('./atomic-write.mjs', moduleUrl)))};
  const [target, filler] = process.argv.slice(2);
  const content = filler.repeat(2_000_000);
  for (let round = 0; round < ${rounds}; round += 1) await atomicWrite(target, content);
`;

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'atomic-write-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('the temp path is unique per process', () => {
  assert.equal(temporaryPathFor('/out/daily.json'), `/out/daily.json.${process.pid}.tmp`);
});

test('a single write publishes the content and leaves no temp file behind', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'daily.json');
    await atomicWrite(target, '{"ok":true}');
    assert.equal(await readFile(target, 'utf8'), '{"ok":true}');
    assert.deepEqual(await readdir(dir), ['daily.json']);
  });
});

test('two processes sharing one output directory cannot publish a corrupt artifact', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'normalized.json');
    const writer = join(dir, 'writer.mjs');
    await atomicWrite(writer, writerSource);

    await Promise.all([
      execFileAsync(process.execPath, [writer, target, 'a']),
      execFileAsync(process.execPath, [writer, target, 'b']),
    ]);

    const published = await readFile(target, 'utf8');
    const filler = published[0];
    assert.ok(filler === 'a' || filler === 'b');
    assert.equal(published.length, 2_000_000, 'published artifact is a whole write, not a truncated one');
    assert.ok(!published.includes(filler === 'a' ? 'b' : 'a'), 'published artifact mixes both writers');
  });
});
