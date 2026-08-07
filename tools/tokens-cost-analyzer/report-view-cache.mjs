import { readFile, stat } from 'node:fs/promises';

/**
 * Why this exists: `report.v1.json` is the full record archive — around 100 MB
 * on an established workspace — and every request re-read and re-parsed it to
 * rebuild an identical view. Measured on 42k records, that parse is ~0.5 s while
 * the aggregation over the parsed records is ~20 ms, so the parse *was* the
 * request-time cost. Analysis runs at most every nine minutes; requests are far
 * more frequent, so the artifact is unchanged for the overwhelming majority of
 * reads.
 *
 * Correctness rule: the view is cached only when the artifact provably did not
 * move underneath the read. `mtimeMs` and `size` are sampled before and after,
 * and a disagreement means the bytes just read may already be superseded — that
 * view is returned for this request but never retained. Serving a stale cost as
 * current is worse than re-parsing.
 */
export function createReportViewCache({ readFileImpl = readFile, statImpl = stat } = {}) {
  let entry = null;
  return async function readReportView(path, build) {
    const before = await signature(statImpl, path);
    if (entry && entry.path === path && entry.signature === before) return entry.value;
    const value = build(JSON.parse(await readFileImpl(path, 'utf8')));
    const after = await signature(statImpl, path);
    entry = after === before ? { path, signature: after, value } : null;
    return value;
  };
}

async function signature(statImpl, path) {
  const { mtimeMs, size } = await statImpl(path);
  return `${mtimeMs}:${size}`;
}
