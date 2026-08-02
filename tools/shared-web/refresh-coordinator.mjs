const REASONS = new Set(['initial', 'manual', 'poll', 'focus', 'mutation']);

export function createRefreshCoordinator({ fetchData, isValid = () => true, getIdentity = () => undefined, onStatus = () => {} }) {
  if (typeof fetchData !== 'function') throw new TypeError('fetchData is required');

  const units = new Map();
  let generation = 0;
  let running = null;
  let queuedPoll = null;
  let lastError = null;

  function status(phase, extra = {}) {
    onStatus({ phase, generation, error: lastError, ...extra });
  }

  function registerCommitUnit({ key, commit, isDeferred = () => false }) {
    if (!key || units.has(key)) throw new Error(`Commit unit key must be unique: ${key}`);
    if (typeof commit !== 'function') throw new TypeError(`Commit unit ${key} requires commit`);
    const unit = { key, commit, isDeferred, pending: null };
    units.set(key, unit);
    return () => units.delete(key);
  }

  function identityIsCurrent(identity) {
    return Object.is(identity, getIdentity());
  }

  async function commitUnit(unit, transaction) {
    if (unit.isDeferred()) {
      unit.pending = transaction;
      status('update-ready', { unit: unit.key, reason: transaction.reason });
      return 'deferred';
    }
    if (!identityIsCurrent(transaction.identity)) return 'identity-vanished';
    unit.pending = null;
    await unit.commit(transaction);
    return 'committed';
  }

  async function release(key) {
    const unit = units.get(key);
    if (!unit) throw new Error(`Unknown commit unit: ${key}`);
    if (!unit.pending || unit.isDeferred()) return false;
    const transaction = unit.pending;
    unit.pending = null;
    if (!identityIsCurrent(transaction.identity)) {
      status('idle', { unit: key, dropped: 'identity-vanished' });
      return false;
    }
    await unit.commit(transaction);
    status('committed', { unit: key, reason: transaction.reason });
    return true;
  }

  async function run(request) {
    const controller = new AbortController();
    const current = { ...request, controller };
    running = current;
    lastError = null;
    status(request.reason === 'initial' ? 'loading' : 'refreshing', { reason: request.reason });

    try {
      const data = await fetchData({ signal: controller.signal, force: request.force, identity: request.identity });
      if (request.generation !== generation || controller.signal.aborted) return;
      if (!identityIsCurrent(request.identity)) {
        status('idle', { reason: request.reason, dropped: 'identity-mismatch' });
        return;
      }
      if (!isValid(data)) throw new Error('Refresh response failed validation');

      const transaction = { data, reason: request.reason, identity: request.identity, generation: request.generation };
      const results = await Promise.all([...units.values()].map((unit) => commitUnit(unit, transaction)));
      status(results.includes('deferred') ? 'update-ready' : 'committed', { reason: request.reason });
    } catch (error) {
      if (controller.signal.aborted || request.generation !== generation) return;
      lastError = error;
      status('error', { reason: request.reason });
    } finally {
      if (running === current) running = null;
      if (queuedPoll) {
        const poll = queuedPoll;
        queuedPoll = null;
        start(poll);
      }
    }
  }

  function start({ reason, force = false }) {
    if (!REASONS.has(reason)) throw new Error(`Unknown refresh reason: ${reason}`);
    if (reason === 'poll' && running) {
      queuedPoll = { reason, force, identity: getIdentity() };
      return running.promise;
    }

    generation += 1;
    if (running) running.controller.abort();
    const request = { generation, reason, force, identity: getIdentity() };
    const promise = run(request);
    if (running?.generation === request.generation) running.promise = promise;
    return promise;
  }

  function request(options) {
    return start(options);
  }

  function startPolling(intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('Polling interval must be positive');
    const timer = setInterval(() => request({ reason: 'poll' }), intervalMs);
    return () => clearInterval(timer);
  }

  return { registerCommitUnit, request, release, startPolling };
}
