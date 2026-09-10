'use strict';

const { DIRECTIONS, neighbor } = require('./engine');

// This only rules out definite dead ends after a bridge has torn. Ignoring
// wind pushes and future bridge damage gives an optimistic reachable area,
// so a connected route is not a promise that the remaining delivery is solvable.
function isReviveRouteBlocked(level, state) {
  if (!level || !state || !(level.bridges || []).some(cell => !(state.bridges || []).includes(cell))) return false;

  const reachable = new Set([state.player]), queue = [state.player];
  for (let index = 0; index < queue.length; index++) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const next = neighbor(level, queue[index], direction, state);
      if (next !== null && !reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  // The echo can still collect stamps from the last three landing cells,
  // including a cell that the courier can no longer reach across a torn bridge.
  const queuedEcho = state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);
  const required = [level.exit, ...state.letters, ...state.seals.filter(cell => !queuedEcho.includes(cell))];
  return required.some(cell => !reachable.has(cell));
}

module.exports = { isReviveRouteBlocked };
