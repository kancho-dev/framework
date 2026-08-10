import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzip } from 'node:zlib';

// The only module that touches the network. Every function here returns a typed
// result instead of throwing, so no external source can reach the request
// handler's catch and take local records down with it.

// A mature report measures ~100 MB and grows ~2.5 KB per record, so the former
// 64 MB default excluded exactly the machines this feature exists to aggregate.
// The cap's job is to bound memory against a hostile or broken source, which it
// still does at this size.
export const MAX_REPORT_BYTES = 256 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 10;
export const MAX_TIMEOUT_SECONDS = 300;
const SOURCE_TYPES = ['ssh', 'file', 'archived'];
// An archived report defaults to `archive/<id>.json` beside `cache/`, so
// retiring a machine is a copy plus three words of config. The
// two directories' roles are opposites: `cache/` is disposable, `archive/` holds
// the last copy of a decommissioned machine's history and is read-only here.
export const ARCHIVE_DIRNAME = 'archive';
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HOST_PATTERN = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/;
// `~` must be followed by `/`: a bare `~user` would otherwise expand to
// `<home>/.user` rather than that user's home directory.
const PATH_PATTERN = /^(?:~\/|\/)[A-Za-z0-9._\-/]*$/;

export function validateSourceEntry(source, index = 0) {
  const at = (field) => `sources[${index}].${field}`;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return invalid(`sources[${index}] must be an object`);
  if (!ID_PATTERN.test(source.id || '')) return invalid(`${at('id')} is invalid`);
  if (!SOURCE_TYPES.includes(source.type)) return invalid(`${at('type')} must be one of ${SOURCE_TYPES.join(', ')}`);

  const timeoutSeconds = source.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isFinite(Number(timeoutSeconds)) || Number(timeoutSeconds) <= 0 || Number(timeoutSeconds) > MAX_TIMEOUT_SECONDS) {
    return invalid(`${at('timeoutSeconds')} must be a positive number of seconds no greater than ${MAX_TIMEOUT_SECONDS}`);
  }

  const common = {
    id: source.id,
    type: source.type,
    timeoutSeconds: Number(timeoutSeconds),
    enabled: source.enabled !== false,
    includeWhenStale: source.includeWhenStale !== false,
  };

  if (source.type === 'ssh') {
    if (!safeArgument(source.host, HOST_PATTERN)) return invalid(`${at('host')} is invalid`);
    if (!safeArgument(source.remotePath, PATH_PATTERN)) return invalid(`${at('remotePath')} is invalid`);
    if (source.compress != null && typeof source.compress !== 'boolean') return invalid(`${at('compress')} must be a boolean`);
    return { ok: true, value: { ...common, host: source.host, remotePath: source.remotePath, compress: source.compress !== false } };
  }
  if (source.type === 'archived') {
    // Rejected rather than ignored: an archived source is exempt from both
    // staleness axes, so the setting could only ever be a misunderstanding.
    if (source.includeWhenStale != null) return invalid(`${at('includeWhenStale')} does not apply to an archived source`);
    if (source.path != null && !safeArgument(source.path, PATH_PATTERN)) return invalid(`${at('path')} is invalid`);
    // `includeWhenStale` is left off the validated value rather than defaulted,
    // so re-validating an already-validated archived entry stays idempotent.
    const { includeWhenStale, ...archived } = common;
    return { ok: true, value: { ...archived, path: source.path ?? null } };
  }
  if (!safeArgument(source.path, PATH_PATTERN)) return invalid(`${at('path')} is invalid`);
  return { ok: true, value: { ...common, path: source.path } };
}

export async function fetchSource(source, options = {}) {
  const validation = validateSourceEntry(source, options.index ?? 0);
  if (!validation.ok) return validation;
  const entry = validation.value;
  if (entry.type === 'ssh') return fetchOverSsh(entry, options);
  // An archived source is a local read and nothing else: same `lstat`, symlink
  // refusal, and size cap as a file source, never a transport, never compressed.
  if (entry.type !== 'archived') return fetchFromFile(entry, options);
  const path = entry.path ?? archivePath(entry.id, options.archiveDir);
  if (!path) return failure('invalid', 'an archived source needs either a path or an output directory to resolve archive/<id>.json');
  return fetchFromFile({ ...entry, path }, options);
}

// `id` is validated against the id pattern above, so it carries no separators
// and cannot escape the archive directory.
function archivePath(id, archiveDir) { return archiveDir ? resolve(archiveDir, `${id}.json`) : null; }

/**
 * Compression is a transport detail, not a contract change: still one fixed,
 * bounded, read-only remote command. A remote without `gzip` — or
 * one whose key is still `command="cat …"` — is recovered by retrying plainly
 * once, so enabling it can never make a working source stop working.
 */
async function fetchOverSsh(source, { executor = defaultExecutor, maxBytes = MAX_REPORT_BYTES } = {}) {
  const attempt = { executor, maxBytes };
  if (!source.compress) return runSshFetch(source, { ...attempt, compressed: false });
  const compressed = await runSshFetch(source, { ...attempt, compressed: true });
  if (!compressed.retryPlain) return compressed;
  return runSshFetch(source, { ...attempt, compressed: false });
}

async function runSshFetch(source, { executor, maxBytes, compressed }) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.ceil(source.timeoutSeconds)}`,
    source.host,
    ...(compressed ? ['gzip', '-c'] : ['cat']),
    source.remotePath,
  ];
  let result;
  try {
    // A hard local timeout on top of ConnectTimeout: a connection can establish
    // and then stall mid-stream, which ConnectTimeout alone never catches.
    // `maxBuffer` bounds the bytes on the wire; when those are compressed, the
    // decompressed stream needs its own bound (see `gunzipBounded`).
    result = await executor('ssh', args, { timeout: source.timeoutSeconds * 1000, maxBuffer: maxBytes, encoding: compressed ? 'buffer' : 'utf8' });
  } catch (error) {
    return failure(...executorFailure(error, maxBytes));
  }
  if (result?.timedOut) return failure('unreadable', 'the source stopped responding before the report finished transferring');
  if (result?.truncated) return failure('unreadable', oversizedDetail(maxBytes));
  if (result?.spawnError) return failure(...spawnFailure(result.spawnError));
  if (result?.code) return retryable(failure(...sshExitFailure(result.code, result.stderr)), compressed && remoteLacksGzip(result));
  return compressed ? decompress(result?.stdout, maxBytes) : bytes(result?.stdout, maxBytes);
}

async function decompress(payload, maxBytes) {
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''), 'utf8');
  // A key still restricted to `command="cat …"` ignores the requested command and
  // answers with the plain report; that is a retry, not a broken source.
  if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) return retryable(failure('unreadable', 'the remote answered uncompressed'), true);
  try {
    return bytes(await gunzipBounded(buffer, maxBytes), maxBytes);
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') return failure('unreadable', oversizedDetail(maxBytes));
    return failure('unreadable', 'the compressed report could not be decompressed');
  }
}

/**
 * The bound that keeps a size cap from becoming a decompression bomb: a few KB
 * of gzip can expand to gigabytes, so decompression aborts at the cap rather
 * than allocating past it.
 */
function gunzipBounded(buffer, maxBytes) {
  return new Promise((done, fail) => {
    gunzip(buffer, { maxOutputLength: maxBytes }, (error, output) => (error ? fail(error) : done(output.toString('utf8'))));
  });
}

function remoteLacksGzip(result) {
  return result.code === 127 || /command not found|gzip: not found|no such file or directory: gzip/i.test(String(result.stderr || ''));
}

function retryable(result, retryPlain) { return retryPlain ? { ...result, retryPlain: true } : result; }

async function fetchFromFile(source, { readFileText = readCappedFile, maxBytes = MAX_REPORT_BYTES, home = homedir() } = {}) {
  const path = expandHome(source.path, home);
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    return failure(error?.code === 'ENOENT' ? 'missing' : 'unreadable', errnoDetail(error));
  }
  if (stats.isSymbolicLink()) return failure('unreadable', 'path is a symlink, which is not followed');
  if (!stats.isFile()) return failure('unreadable', 'path is not a regular file');
  if (stats.size > maxBytes) return failure('unreadable', oversizedDetail(maxBytes, stats.size));
  try {
    return bytes(await readFileText(path, maxBytes), maxBytes);
  } catch (error) {
    return failure(error?.code === 'ENOENT' ? 'missing' : 'unreadable', errnoDetail(error));
  }
}

function bytes(text, maxBytes) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  const size = Buffer.byteLength(value);
  if (size > maxBytes) return failure('unreadable', oversizedDetail(maxBytes, size));
  if (!value.trim()) return failure('invalid', 'the source returned an empty report');
  return { ok: true, text: value };
}

/**
 * SSH stderr can echo usernames, hostnames, and key paths, so it is classified
 * into a state here and never carried into the returned detail.
 */
function sshExitFailure(code, stderr) {
  const text = String(stderr || '').toLowerCase();
  if (code === 255) {
    if (/permission denied|publickey|host key verification|batch mode|authentication/.test(text)) {
      return ['unauthorized', 'ssh refused the connection; add a key or an ssh_config entry for this host'];
    }
    return ['unreachable', 'ssh could not connect to the host'];
  }
  if (/no such file|not found/.test(text)) return ['missing', 'the remote report does not exist at the configured path'];
  if (/is a directory/.test(text)) return ['unreadable', 'the remote path is a directory, not a report file'];
  if (/permission denied/.test(text)) return ['unreadable', 'the remote report is not readable'];
  return ['unreadable', `reading the remote report failed with exit code ${code}`];
}

function executorFailure(error, maxBytes) {
  if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
    return ['unreadable', 'the source stopped responding before the report finished transferring'];
  }
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return ['unreadable', oversizedDetail(maxBytes)];
  return spawnFailure(error?.code);
}

/**
 * Recovery from an over-cap report is a single config edit, so the detail names
 * what was seen and what to change rather than only the limit.
 * An ssh transfer is cut off *at* the cap, so its true size is unknowable there
 * and the wording says so instead of inventing a number.
 */
function oversizedDetail(maxBytes, observedBytes = null) {
  const seen = observedBytes == null
    ? `the report exceeds the ${maxBytes} byte limit and the transfer was cut off there, so its full size is unknown`
    : `the report is ${observedBytes} bytes, over the ${maxBytes} byte limit`;
  return `${seen}; raise maxReportBytes in sources.json to include this source`;
}

// One classification for a failed spawn whether it surfaces as a flag or as a
// rejection: the failure is local to this machine, never a remote condition.
function spawnFailure(code) {
  if (code === 'ENOENT') return ['unreadable', 'the ssh command is not available on this machine'];
  return ['unreadable', 'ssh could not be run for this source'];
}

async function readCappedFile(path, maxBytes) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * The injected-executor contract: resolve with `{ code, stdout, stderr }` plus
 * optional `timedOut` / `truncated` / `spawnError` flags, never reject. Tests
 * substitute this to drive every failure state without a network.
 */
function defaultExecutor(file, args, options) {
  return new Promise((done) => {
    execFile(file, args, options, (error, stdout = '', stderr = '') => {
      if (!error) return done({ code: 0, stdout, stderr });
      if (error.killed || error.code === 'ETIMEDOUT') return done({ code: null, stdout, stderr, timedOut: true });
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return done({ code: null, stdout, stderr, truncated: true });
      if (Number.isInteger(error.code)) return done({ code: error.code, stdout, stderr });
      done({ code: null, stdout, stderr, spawnError: error.code || 'unknown' });
    });
  });
}

function safeArgument(value, pattern) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) return false;
  return !/[\s;|&$`<>()'"\\*?!#\n\r]/.test(value) && pattern.test(value);
}

function expandHome(path, home) { return path.startsWith('~') ? resolve(home, `.${path.slice(1)}`) : path; }
function errnoDetail(error) { return `read failed (${error?.code || 'unknown error'})`; }
function failure(state, detail) { return { ok: false, state, detail }; }
function invalid(detail) { return { ok: false, state: 'invalid', detail }; }
