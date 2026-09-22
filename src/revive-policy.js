'use strict';

const { DIRECTIONS, neighbor, step } = require('./engine');
const { itemTargets, itemAction } = require('./items');
const queuedEchoCells = state => state.history.slice(Math.max(0, state.turn - 2), state.turn + 1);

// This only rules out definite dead ends from torn bridges or isolated plates. Follow wind
// landings because a forced push can prevent returning through an open corridor.
// Future bridge damage is still optimistic, so reachable targets do not promise
// that one route can collect them all within the remaining energy.
function reachableLandings(level, state, initialCells = [state.player]) {
  let blocked = [], reachable;
  // A tide can be waited out. An echo gate is impossible only if its plate
  // cannot be visited and no current/queued echo can still activate it.
  // Closing one such gate may reveal another definite cut-off.
  for (;;) {
    reachable = topologyLandings(level, state, initialCells, blocked);
    const next = unavailableEchoGates(level, state, reachable);
    if (next.every(cell => blocked.includes(cell))) return reachable;
    blocked = [...new Set([...blocked, ...next])];
  }
}

function unavailableEchoGates(level, state, reachable) {
  const echoes = [state.echo, ...queuedEchoCells(state)];
  return Object.entries(level.echoGates || {}).filter(([, rule]) =>
    !reachable.has(rule.plate) && !echoes.includes(rule.plate)).map(([cell]) => Number(cell));
}

function topologyLandings(level, state, initialCells, blocked) {
  const topology = { ...level, walls: [...(level.walls || []), ...blocked], tideGates: {}, echoGates: {} };
  const reachable = new Set(initialCells), queue = [...reachable];
  function add(cell) {
    if (!reachable.has(cell)) { reachable.add(cell); queue.push(cell); }
  }
  for (let index = 0; index < queue.length; index++) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const entered = neighbor(topology, queue[index], direction, state);
      if (entered === null) continue;
      const wind = level.winds && level.winds[entered];
      const pushed = wind ? neighbor(topology, entered, wind, state) : null;
      add(pushed === null ? entered : pushed);
      // A bridge may tear later, or a timed door may close, stopping this push.
      // Include that possible landing too: rejecting a usable relight is worse
      // than retaining one whose full solution is not proven by this check.
      if (pushed !== null && ((state.bridges || []).includes(pushed) ||
          level.tideGates && level.tideGates[pushed] || level.echoGates && level.echoGates[pushed])) add(entered);
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
    // Each letter can become the next numbered delivery after earlier ones
    // are collected. This dead-end filter checks future range, not permission
    // to use a kite on every remaining letter right now.
    itemTargets(level, { ...state, player, letters: [letter], status: 'playing' }, 'kite').includes(letter)));
}

function tornRouteBlocked(level, state) {
  if (!(level.bridges || []).some(cell => !(state.bridges || []).includes(cell)) &&
      !Object.keys(level.echoGates || {}).length && !Object.keys(level.winds || {}).length) return false;
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
  const unavailable = unavailableEchoGates(level, state, reachableLandings(level, state));
  const topology = { ...level, walls: [...(level.walls || []), ...unavailable], tideGates: {}, echoGates: {} };
  for (const direction of Object.keys(DIRECTIONS)) {
    const result = step(topology, active, direction);
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

function isReviveRouteBlocked(level, state) {
  if (!level || !state) return false;
  const departureBlocked = currentBridgeDepartureBlocked(level, state);
  return departureBlocked === null ? tornRouteBlocked(level, state) : departureBlocked;
}

module.exports = { isReviveRouteBlocked };
