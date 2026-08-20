export function createImmutableSourceMemo() {
  const states = new Map();

  function load(state, entry, retrying = false) {
    state.retrying = retrying;
    state.promise = new Promise((resolve) => setImmediate(resolve))
      .then(entry.load)
      .then((value) => {
        state.status = 'fulfilled';
        state.value = value;
        state.error = null;
        state.retrying = false;
      })
      .catch((error) => {
        state.status = 'rejected';
        state.error = error;
        state.observed = false;
        state.retrying = false;
      });
  }

  function start(entry) {
    const state = {
      status: 'pending',
      value: null,
      error: null,
      observed: false,
      retrying: false,
      immutable: entry.immutable !== false,
    };
    load(state, entry);
    states.set(entry.key, state);
    return state;
  }

  function snapshot(entries) {
    const activeKeys = new Set(entries.map(({ key }) => key));
    for (const key of states.keys()) if (!activeKeys.has(key)) states.delete(key);

    const results = [];
    let loading = false;
    for (const entry of entries) {
      let state = states.get(entry.key);
      if (!state) state = start(entry);
      if (state.status === 'pending') loading = true;
      else if (state.status === 'fulfilled') results.push({ entry, status: 'fulfilled', value: state.value });
      else {
        results.push({ entry, status: 'rejected', reason: state.error });
        if (!state.observed) state.observed = true;
        else if (!state.retrying) load(state, entry, true);
      }

      if (!state.immutable && state.status === 'fulfilled') states.delete(entry.key);
    }
    return { loading, results };
  }

  return Object.freeze({ snapshot, get size() { return states.size; } });
}
