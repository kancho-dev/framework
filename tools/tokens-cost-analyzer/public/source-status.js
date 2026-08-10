// The client half of the in-flight flag: poll the cheap status endpoint
// *only* while a source is genuinely in flight, and ask for the full report
// exactly once when the last flight settles.
//
// The two properties worth stating, because both are ways this could quietly
// become the thing the design rejected:
//
// - Polling is entered only from observed server state — a row that says it is
//   refreshing — and left as soon as no row says so. There is no optimistic
//   timer anywhere: a label clears because the server stopped reporting a
//   flight, never because enough time passed.
// - The expensive request happens once per refresh completion, not once per
//   tick. Polling `/api/report` instead would pay a full merge every second,
//   making the tool slowest exactly while the user is watching it.

const DEFAULT_INTERVAL_MS = 1000;

export function anyRefreshing(sources) {
  return (sources || []).some((source) => source?.refreshing === true);
}

/**
 * `sync` is called with whatever the last render knows; the poller decides
 * whether that means "keep watching" or "we are done". Callers never start or
 * stop it directly, so the two cannot get out of step.
 */
export function createSourceStatusPoller({
  fetchStatus,
  onUpdate = () => {},
  onSettled = () => {},
  onError = () => {},
  intervalMs = DEFAULT_INTERVAL_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let timer = null;
  let ticking = false;

  function sync(sources) {
    if (anyRefreshing(sources)) start();
    else stop();
  }

  function start() {
    if (timer != null || ticking) return;
    timer = schedule(tick, intervalMs);
  }

  function stop() {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  }

  async function tick() {
    timer = null;
    ticking = true;
    let sources;
    try {
      sources = (await fetchStatus())?.sources || [];
      onUpdate(sources);
    } catch (error) {
      // A failed poll is not a failed refresh. Report it and keep watching:
      // giving up here would strand a row on "Refreshing…" for ever.
      ticking = false;
      onError(error);
      start();
      return;
    }
    ticking = false;
    if (anyRefreshing(sources)) { start(); return; }
    // The settled edge: the flights this poller was watching are over, so the
    // new snapshot is worth fetching — once. A failure here is the report
    // request's own problem and must not restart polling, which would retry it
    // every second against a server that just refused.
    try {
      await onSettled();
    } catch (error) {
      onError(error);
    }
  }

  return { sync, stop };
}
