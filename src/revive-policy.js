'use strict';

const { DIRECTIONS, neighbor } = require('./engine');

// This only rules out definite dead ends after a bridge has torn. Follow wind
// landings because a forced push can prevent returning through an open corridor.
// Future bridge damage is still optimistic, so reachable targets do not promise
// that one route can collect them all within the remaining energy.
function isReviveRouteBlocked(level, state) {
  if (!level || !state || !(level.bridges || []).some(cell => !(state.bridges || []).includes(cell))) return false;

  const reachable = new Set([state.player]), queue = [state.player];
  function add(cell) {
    if (!reachable.has(cell)) { reachable.add(cell); queue.push(cell); }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const entered = neighbor(level, queue[index], direction, state);
      if (entered === null) continue;
      const wind = level.winds && level.winds[entered];
      const pushed = wind ? neighbor(level, entered, wind, state) : null;
      add(pushed === null ? entered : pushed);
      // A currently intact bridge may tear later and stop this wind push.
      // Include that possible landing too: rejecting a usable relight is worse
      // than retaining one whose full solution is not proven by this check.
      if (pushed !== null && (state.bridges || []).includes(pushed)) add(entered);
    }
  }

  // The echo can still collect stamps from the last three landing cells,
  // including a cell that the courier can no longer reach across a torn bridge.
  const queuedEcho = state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);
  const required = [level.exit, ...state.letters, ...state.seals.filter(cell => !queuedEcho.includes(cell))];
  return required.some(cell => !reachable.has(cell));
}

module.exports = { isReviveRouteBlocked };
