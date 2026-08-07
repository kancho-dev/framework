import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';

// The only module that touches the network. Every function here returns a typed
// result instead of throwing, so no external source can reach the request
// handler's catch and take local records down with it (design §6, §9.5).

export const MAX_REPORT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 10;
export const MAX_TIMEOUT_SECONDS = 300;
const SOURCE_TYPES = ['ssh', 'file'];
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
    return { ok: true, value: { ...common, host: source.host, remotePath: source.remotePath } };
  }
  if (!safeArgument(source.path, PATH_PATTERN)) return invalid(`${at('path')} is invalid`);
  return { ok: true, value: { ...common, path: source.path } };
}

export async function fetchSource(source, options = {}) {
  const validation = validateSourceEntry(source, options.index ?? 0);
  if (!validation.ok) return validation;
  const entry = validation.value;
  return entry.type === 'ssh' ? fetchOverSsh(entry, options) : fetchFromFile(entry, options);
}

async function fetchOverSsh(source, { executor = defaultExecutor, maxBytes = MAX_REPORT_BYTES } = {}) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${Math.ceil(source.timeoutSeconds)}`,
    source.host,
    'cat',
    source.remotePath,
  ];
  let result;
  try {
    // A hard local timeout on top of ConnectTimeout: a connection can establish
    // and then stall mid-stream, which ConnectTimeout alone never catches.
    result = await executor('ssh', args, { timeout: source.timeoutSeconds * 1000, maxBuffer: maxBytes, encoding: 'utf8' });
  } catch (error) {
    return failure(...executorFailure(error));
  }
  if (result?.timedOut) return failure('unreadable', 'the source stopped responding before the report finished transferring');
  if (result?.truncated) return failure('unreadable', `the report exceeds the ${maxBytes} byte limit`);
  if (result?.spawnError) return failure(...spawnFailure(result.spawnError));
  if (result?.code) return failure(...sshExitFailure(result.code, result.stderr));
  return bytes(result?.stdout, maxBytes);
}

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
  if (stats.size > maxBytes) return failure('unreadable', `the report exceeds the ${maxBytes} byte limit`);
  try {
    return bytes(await readFileText(path, maxBytes), maxBytes);
  } catch (error) {
    return failure(error?.code === 'ENOENT' ? 'missing' : 'unreadable', errnoDetail(error));
  }
}

function bytes(text, maxBytes) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (Buffer.byteLength(value) > maxBytes) return failure('unreadable', `the report exceeds the ${maxBytes} byte limit`);
  if (!value.trim()) return failure('invalid', 'the source returned an empty report');
  return { ok: true, text: value };
}

/**
 * SSH stderr can echo usernames, hostnames, and key paths, so it is classified
 * into a state here and never carried into the returned detail (design §7).
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

function executorFailure(error) {
  if (error?.killed || error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
    return ['unreadable', 'the source stopped responding before the report finished transferring'];
  }
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return ['unreadable', 'the report exceeds the configured size limit'];
  return spawnFailure(error?.code);
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
 * substitute this to drive every §6 failure state without a network.
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
