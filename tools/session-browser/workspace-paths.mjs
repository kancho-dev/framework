import { resolve, sep } from 'node:path';

export function isUnderRoot(candidate, root) {
  if (!candidate || !root) return false;
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}
