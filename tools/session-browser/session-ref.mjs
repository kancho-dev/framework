import { resolve } from 'node:path';

const SOURCES = new Set(['pi', 'opencode', 'codex', 'claude-code']);
const MACHINE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const REF_PATTERN = /^(pi|opencode|codex|claude-code)(?:@([a-z0-9][a-z0-9._-]*))?:(.+)$/i;

export function parseSessionRef(ref) {
  if (typeof ref !== 'string') return null;
  const match = ref.match(REF_PATTERN);
  if (!match) return null;
  return Object.freeze({ source: match[1].toLowerCase(), machineId: match[2] || null, value: match[3] });
}

export function formatSessionRef(source, value, machineId = null) {
  if (!SOURCES.has(source)) throw new Error(`Unknown session source: ${source}`);
  if (machineId !== null && !MACHINE_ID.test(machineId)) throw new Error(`Invalid machine id: ${machineId}`);
  const ref = String(value || '');
  if (!ref) throw new Error('Session ref value is required');
  return `${source}${machineId ? `@${machineId}` : ''}:${ref}`;
}

export function isSourceRef(ref, source) {
  return parseSessionRef(ref)?.source === source;
}

export function sessionKey(sessionOrPath) {
  if (typeof sessionOrPath === 'string') {
    if (parseSessionRef(sessionOrPath)) return sessionOrPath;
    return formatSessionRef('pi', resolve(sessionOrPath));
  }

  const source = SOURCES.has(sessionOrPath?.source) ? sessionOrPath.source : 'pi';
  const path = String(sessionOrPath?.path || '');
  const parsedPath = parseSessionRef(path);
  const pathRef = parsedPath?.source === source ? parsedPath : null;
  const declaredMachine = sessionOrPath?.machineId || null;
  if (declaredMachine && pathRef?.machineId && declaredMachine !== pathRef.machineId) {
    throw new Error(`Session machine id conflicts with path namespace: ${declaredMachine} !== ${pathRef.machineId}`);
  }
  const machineId = declaredMachine || pathRef?.machineId || null;
  const rawValue = source === 'pi'
    ? pathRef?.value || path
    : sessionOrPath?.id ? String(sessionOrPath.id) : pathRef?.value || path;
  const value = source === 'pi' ? resolve(rawValue) : rawValue;
  return formatSessionRef(source, value, machineId);
}
