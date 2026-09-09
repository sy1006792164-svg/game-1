'use strict';

const { ACTIONS, step } = require('./engine');

// First-route guidance uses the real remaining light and echo history, including
// resumed detours. Cache by immutable state so drawing never repeats the search.
const routes = new WeakMap();
const signature = state => [state.player, state.history.slice(-3).join(','),
  state.letters.join(','), state.seals.join(','), state.lights.join(','), state.bridges.join(',')].join('|');

function guideRoute(level, state) {
  const cached = routes.get(state);
  if (cached && cached.level === level) return cached.actions;
  const queue = [{ state, actions: [] }], seen = new Set([signature(state)]);
  let actions = null;
  // Only the tiny first lesson uses this search; never search later campaign maps.
  for (let head = 0; head < queue.length && head < 2000; head++) {
    const current = queue[head];
    if (current.state.status === 'won') { actions = current.actions; break; }
    if (current.state.status !== 'playing') continue;
    for (const action of ACTIONS) {
      const result = step(level, current.state, action);
      if (!result.moved || result.state.status === 'failed') continue;
      const key = signature(result.state);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ state: result.state, actions: current.actions.concat(action) });
    }
  }
  routes.set(state, { level, actions });
  return actions;
}

module.exports = { guideRoute };
