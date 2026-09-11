'use strict';

const { DIRECTIONS, neighbor, step } = require('./engine');
const queuedEchoCells = state => state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);

// This only rules out definite dead ends after a bridge has torn. Follow wind
// landings because a forced push can prevent returning through an open corridor.
// Future bridge damage is still optimistic, so reachable targets do not promise
// that one route can collect them all within the remaining energy.
function tornRouteBlocked(level, state) {
  if (!(level.bridges || []).some(cell => !(state.bridges || []).includes(cell))) return false;
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
  const queuedEcho = queuedEchoCells(state);
  const required = [level.exit, ...state.letters, ...state.seals.filter(cell => !queuedEcho.includes(cell))];
  return required.some(cell => !reachable.has(cell));
}

// Standing on an intact bridge is a commitment that the current topology does
// not reveal: the bridge tears on the first real departure. Try only those
// immediate departures, then reuse the conservative reachability check. This
// catches definite cut-offs without searching the full puzzle state space.
function currentBridgeDepartureBlocked(level, state) {
  const bridge = state.player;
  if (!(level.bridges || []).includes(bridge) || !(state.bridges || []).includes(bridge)) return null;
  // If the courier is already at the post office, waiting can let the queued
  // echo collect the last stamps without ever tearing the bridge.
  if (state.player === level.exit && !state.letters.length &&
      state.seals.every(cell => queuedEchoCells(state).includes(cell))) return false;
  const active = { ...state, status: 'playing', energy: 2 };
  for (const direction of Object.keys(DIRECTIONS)) {
    const result = step(level, active, direction);
    if (!result.moved || (result.state.bridges || []).includes(bridge)) continue;
    if (result.state.status === 'won' || !tornRouteBlocked(level, result.state)) return false;
  }
  return true;
}

function isReviveRouteBlocked(level, state) {
  if (!level || !state) return false;
  const departureBlocked = currentBridgeDepartureBlocked(level, state);
  return departureBlocked === null ? tornRouteBlocked(level, state) : departureBlocked;
}

module.exports = { isReviveRouteBlocked };
