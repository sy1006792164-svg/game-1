'use strict';

const { DIRECTIONS, neighbor, step } = require('./engine');
const { ITEMS, itemTargets, itemAction } = require('./items');
const queuedEchoCells = state => state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);

// This only rules out definite dead ends after a bridge has torn. Follow wind
// landings because a forced push can prevent returning through an open corridor.
// Future bridge damage is still optimistic, so reachable targets do not promise
// that one route can collect them all within the remaining energy.
function reachableLandings(level, state, initialCells = [state.player]) {
  const reachable = new Set(initialCells), queue = [...reachable];
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

  return reachable;
}

function targetsReachable(level, state, reachable) {
  // The echo can still collect stamps from the last three landing cells,
  // including a cell that the courier can no longer reach across a torn bridge.
  const queuedEcho = queuedEchoCells(state);
  const required = [level.exit, ...state.seals.filter(cell => !queuedEcho.includes(cell))];
  if (required.some(cell => !reachable.has(cell))) return false;
  const stranded = state.letters.filter(cell => !reachable.has(cell));
  if (!stranded.length) return true;
  // Only already earned kites count; a potential future advertisement is not
  // an owned tool. Each stranded letter needs its own charge and valid range.
  return stranded.length <= (state.inventory && state.inventory.kite || 0) && stranded.every(letter => [...reachable].some(player =>
    itemTargets(level, { ...state, player, status: 'playing' }, 'kite').includes(letter)));
}

function tornRouteBlocked(level, state) {
  if (!(level.bridges || []).some(cell => !(state.bridges || []).includes(cell))) return false;
  return repairsBlocked(level, state, reachableLandings(level, state));
}

function repairsBlocked(level, state, reachable) {
  if (targetsReachable(level, state, reachable)) return false;
  // Try each single repair that can be reached before spending the pack.
  // Each branch retains the existing optimistic treatment of later bridge
  // damage; this is a dead-end filter, not a full route or energy solver.
  const repairs = new Set();
  for (const player of reachable) {
    for (const cell of itemTargets(level, { ...state, player, status: 'playing' }, 'bridge')) repairs.add(cell);
  }
  for (const cell of repairs) {
    const repaired = { ...state, bridges: (state.bridges || []).concat(cell),
      inventory: { ...state.inventory, bridge: state.inventory.bridge - 1 } };
    // Repair can change a forced wind landing. Keep all places that could be
    // visited (and targets collected) before it, instead of restarting from
    // the old player cell in the changed topology.
    if (!repairsBlocked(level, repaired, reachableLandings(level, repaired, reachable))) return false;
  }
  return true;
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
  // A tool may need to be used before the first departure, while a nearby
  // letter or torn bridge is still in range. Each branch removes a letter or
  // restores a bridge, so depth is bounded by the map's remaining targets.
  for (const id of ['kite', 'bridge']) {
    for (const cell of itemTargets(level, active, id)) {
      const result = step(level, active, itemAction(id, cell));
      if (result.moved && (result.state.status === 'won' ||
          currentBridgeDepartureBlocked(level, result.state) === false)) return false;
    }
  }
  return true;
}

function isReviveRouteBlocked(level, state, options = {}) {
  if (!level || !state) return false;
  if (options.canAcquireItems === true) {
    const inventory = { ...state.inventory };
    for (const item of ITEMS) {
      if (level.id >= item.unlock && item.id !== 'oil') inventory[item.id] = Math.max(inventory[item.id] || 0,
        item.id === 'kite' ? state.letters.length : (level.bridges || []).length);
    }
    // This only allows the offer of a relight. The player must still complete
    // each separate tool video; this hypothetical stock is never granted.
    state = { ...state, inventory };
  }
  const departureBlocked = currentBridgeDepartureBlocked(level, state);
  return departureBlocked === null ? tornRouteBlocked(level, state) : departureBlocked;
}

module.exports = { isReviveRouteBlocked };
