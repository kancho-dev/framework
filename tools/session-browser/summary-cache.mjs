import { stat } from 'node:fs/promises';

// Linux stamps inode times from a coarse clock, so writes landing in the same
// tick share an mtime even at nanosecond resolution. A same-size rewrite that
// close to our stat would otherwise be invisible, so an observation taken while
// the file could still be changing is recorded as unsafe to reuse.
export const RACY_WINDOW_MS = 20;

async function observe(path) {
  const info = await stat(path, { bigint: true });
  const mtimeMs = Number(info.mtimeNs / 1_000_000n);
  return { version: `${info.mtimeNs}:${info.size}`, racy: Date.now() - mtimeMs <= RACY_WINDOW_MS };
}

/**
 * Memoizes per-file session summaries so a repeated list scan only re-parses
 * transcripts whose bytes changed. Parsing every file on every poll is what
 * saturates the event loop and delays concurrent detail requests.
 *
 * Freshness contract: a summary is reused only when the file's mtime and size
 * are unchanged *and* the cached observation was taken outside the timestamp
 * race window. A file being actively appended to is therefore re-parsed until
 * it settles, which is correct and costs one file per scan.
 */
export function createSummaryCache() {
  const cached = new Map();

  const keyFor = (path, provenance) => `${provenance}\0${path}`;

  return {
    async summarize(path, load, { provenance = 'default' } = {}) {
      const { version, racy } = await observe(path);
      const key = keyFor(path, provenance);
      const hit = cached.get(key);
      if (hit && !hit.racy && hit.version === version) return hit.summary;
      const summary = await load(path);
      cached.set(key, { version, racy, summary });
      return summary;
    },

    prune(paths, { provenance = 'default' } = {}) {
      const keep = new Set(paths.map((path) => keyFor(path, provenance)));
      const prefix = `${provenance}\0`;
      for (const key of cached.keys()) {
        if (key.startsWith(prefix) && !keep.has(key)) cached.delete(key);
      }
    },

    get size() {
      return cached.size;
    },
  };
}

/**
 * Runs `work` once for a given key while it is in flight, so overlapping
 * callers share one scan instead of each paying for a full one.
 */
export function createSingleFlight() {
  const inFlight = new Map();

  return function singleFlight(key, work) {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = (async () => work())().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
