import { rename, writeFile } from 'node:fs/promises';

// The temp name carries the pid: two analyzers sharing one --out would otherwise
// interleave into one temp file and each rename a partial write over the target.
export function temporaryPathFor(path) {
  return `${path}.${process.pid}.tmp`;
}

export async function atomicWrite(path, content) {
  const temporaryPath = temporaryPathFor(path);
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, path);
}
