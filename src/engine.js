'use strict';

const { initialInventory, normalizeItemRewards, parseItemAction, applyItemAction } = require('./items');
const { SUPPLY_ENERGY, RELIGHT_ACTION, normalizeSupplyPolicy } = require('./supply-rules');
const { canEnter, gateStatus } = require('./route-mechanics');

const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });
const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'wait']);
const STAR_TWO_MARGIN = 2;

function isAction(action) {
  return typeof action === 'string' && (ACTIONS.indexOf(action) >= 0 || action === RELIGHT_ACTION || parseItemAction(action) !== null);
}

/** A paper bridge that the courier has stepped off stays blocked until repaired. */
function collapsed(level, state, cell) {
  return !!state && (level.bridges || []).indexOf(cell) >= 0 && (state.bridges || []).indexOf(cell) < 0;
}

function neighbor(level, cell, direction, state) {
  const delta = DIRECTIONS[direction];
  if (!delta) return null;
  const x = cell % level.width + delta[0];
  const y = Math.floor(cell / level.width) + delta[1];
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return null;
  const next = y * level.width + x;
  if ((level.walls || []).indexOf(next) >= 0 || collapsed(level, state, next) ||
      (state && !canEnter(level, state, next))) return null;
  return next;
}

function createState(level, itemRewards) {
  const startsOnNextLetter = !level.letterOrder || level.letterOrder[0] === level.start;
  const state = {
    levelId: level.id,
    player: level.start,
    echo: null,
    history: [level.start],
    turn: 0,
    energy: level.budget,
    letters: (level.letters || []).filter(cell => cell !== level.start || !startsOnNextLetter),
    seals: (level.seals || []).slice(),
    lights: [],
    bridges: (level.bridges || []).slice(),
    inventory: initialInventory(level, itemRewards),
    itemsUsed: 0,
    status: 'playing',
    revived: false,
    reviveCount: 0
  };
  if (state.player === level.exit && !state.letters.length && !state.seals.length) state.status = 'won';
  else if (state.energy <= 0) state.status = 'failed';
  return state;
}

/** A valid wait also returns moved:true: the turn, lantern and echo advance. */
function step(level, state, action, version = 2) {
  if (!state || !isAction(action)) {
    return { state, moved: false, events: [] };
  }
  if (action === RELIGHT_ACTION) {
    const oil = state.inventory && state.inventory.oil;
    if (state.status !== 'failed' || !Number.isSafeInteger(oil) || oil < 1 || oil > 4096) return { state, moved: false, events: [] };
    const next = { ...revive(level, state), inventory: { ...state.inventory, oil: oil - 1 }, itemsUsed: (state.itemsUsed || 0) + 1 };
    return { state: next, moved: true, events: [{ type: 'item', item: 'oil', cell: state.player },
      { type: 'light', cell: state.player, amount: SUPPLY_ENERGY, source: 'oil' }, { type: 'relight', cell: state.player }] };
  }
  if (state.status !== 'playing') return { state, moved: false, events: [] };
  if (parseItemAction(action)) {
    const result = applyItemAction(level, state, action, version);
    if (result.moved) finishAction(level, result.state, result.events);
    return result;
  }
  const destination = action === 'wait' ? state.player : neighbor(level, state.player, action, state);
  if (destination === null) {
    const delta = DIRECTIONS[action], x = state.player % level.width + delta[0];
    const y = Math.floor(state.player / level.width) + delta[1];
    const gate = x >= 0 && x < level.width && y >= 0 && y < level.height
      ? gateStatus(level, state, y * level.width + x) : null;
    return { state, moved: false, events: [gate && !gate.open
      ? { ...gate, type: 'gate-blocked', gate: gate.type } : { type: 'blocked', cell: state.player }] };
  }

  const next = {
    ...state,
    player: destination,
    turn: state.turn + 1,
    energy: state.energy - 1,
    history: state.history.slice(),
    letters: state.letters.slice(),
    seals: state.seals.slice(),
    lights: state.lights.slice(),
    bridges: (state.bridges || []).slice()
  };
  const events = [{ type: action === 'wait' ? 'wait' : 'move', cell: destination }];
  const enteredGate = action !== 'wait' && gateStatus(level, state, destination);
  if (enteredGate) events.push({ type: enteredGate.type + '-gate', cell: destination });
  // Entering a wind tile pushes once. Waiting does not re-trigger the tile.
  const wind = action !== 'wait' && level.winds && level.winds[destination];
  if (wind) {
    const pushed = neighbor(level, destination, wind, state);
    if (pushed !== null) {
      next.player = pushed;
      events.push({ type: 'wind', cell: pushed });
      const pushedGate = gateStatus(level, state, pushed);
      if (pushedGate) events.push({ type: pushedGate.type + '-gate', cell: pushed });
    }
  }
  if (next.player !== state.player) {
    for (const [gate, rule] of Object.entries(level.echoGates || {})) {
      if (rule.plate === next.player) events.push({ type: 'echo-plate', cell: next.player, gate: Number(gate) });
    }
  }
  // Paper bridges carry the courier once. Leaving one tears it; the echo is
  // only a memory of the route and is never blocked by the torn paper.
  if (next.player !== state.player && next.bridges.indexOf(state.player) >= 0) {
    next.bridges = next.bridges.filter(cell => cell !== state.player);
    events.push({ type: 'bridge', cell: state.player });
  }
  next.history.push(next.player);
  next.echo = next.turn >= 3 ? next.history[next.turn - 3] : null;
  if (next.echo !== null) events.push({ type: 'echo', cell: next.echo });

  if (next.letters.indexOf(next.player) >= 0) {
    const expected = level.letterOrder && level.letterOrder.find(cell => next.letters.includes(cell));
    if (!level.letterOrder || next.player === expected) {
      next.letters = next.letters.filter(cell => cell !== next.player);
      events.push({ type: 'letter', cell: next.player });
    } else events.push({ type: 'order-blocked', cell: next.player, expected });
  }
  if (next.echo !== null && next.seals.indexOf(next.echo) >= 0) {
    next.seals = next.seals.filter(cell => cell !== next.echo);
    events.push({ type: 'seal', cell: next.echo });
  }
  finishAction(level, next, events);
  return { state: next, moved: true, events };
}

// Movement and video-earned items share the same win-first completion rule.
function finishAction(level, next, events) {
  // Reaching the goal on the final unit of light is still a win.
  if (next.player === level.exit && !next.letters.length && !next.seals.length) {
    next.status = 'won';
    events.push({ type: 'win', cell: next.player });
  } else if (next.energy <= 0) {
    next.status = 'failed';
    events.push({ type: 'fail', cell: next.player });
  }
}

/** Normalize legacy single-relight saves and ordered relight histories without trusting a saved count. */
function normalizeReviveHistory(value, actionCount) {
  if (!Number.isSafeInteger(actionCount) || actionCount < 0) throw new Error('invalid revive');
  if (value == null) return [];
  const history = Array.isArray(value) ? value : [value];
  if (history.length > actionCount + 1 || Object.keys(history).length !== history.length) throw new Error('invalid revive');
  const result = [];
  let previous = -1;
  for (let index = 0; index < history.length; index++) {
    const item = Object.getOwnPropertyDescriptor(history, String(index));
    if (!item || !Object.prototype.hasOwnProperty.call(item, 'value') || !Number.isInteger(item.value) ||
        item.value <= previous || item.value > actionCount) throw new Error('invalid revive');
    previous = item.value;
    result.push(item.value);
  }
  return result;
}

/** Rebuild every relight at its recorded failed turn; accumulated turns still determine the score. */
function replay(level, actions, revivalHistory, itemRewards, supplyPolicy) {
  if (!Array.isArray(actions)) throw new Error('invalid history');
  const history = normalizeReviveHistory(revivalHistory, actions.length);
  const policy = normalizeSupplyPolicy(supplyPolicy, actions.length, history.length);
  if ((policy.legacyReviveCount && history[policy.legacyReviveCount - 1] > policy.legacyActionCount) ||
      (policy.legacyReviveCount < history.length && history[policy.legacyReviveCount] < policy.legacyActionCount) ||
      actions.slice(0, policy.legacyActionCount).includes(RELIGHT_ACTION)) throw new Error('invalid supply policy');
  let revivalIndex = 0;
  let state = createState(level, itemRewards);
  for (let index = 0; index <= actions.length; index++) {
    if (history[revivalIndex] === index) {
      if (state.status !== 'failed') throw new Error('invalid revive');
      state = revive(level, state, revivalIndex < policy.legacyReviveCount ? 1 : 2);
      revivalIndex++;
    }
    if (index === actions.length) break;
    const result = step(level, state, actions[index], index < policy.legacyActionCount ? 1 : 2);
    if (!result.moved) throw new Error('invalid action');
    state = result.state;
  }
  return state;
}

function reviveEnergy(level, version = 2) { return version === 1 ? Math.max(8, Math.ceil(level.budget * 0.5)) : SUPPLY_ENERGY; }

function revive(level, state, version = 2) {
  if (!state || state.status !== 'failed') return state;
  return { ...state, energy: reviveEnergy(level, version), status: 'playing', revived: true, reviveCount: state.reviveCount + 1 };
}

/** Three stars at the verified route target, two within a short margin. */
function stars(level, state) {
  const par = Math.max(1, level.par || level.budget);
  const earned = state.turn <= par ? 3 : state.turn <= par + STAR_TWO_MARGIN ? 2 : 1;
  return state.revived || state.itemsUsed > 0 ? Math.min(2, earned) : earned;
}

// Assisted shortcuts cannot replace a clean three-star route's best-turn record.
function scoredTurns(level, state) {
  return state.itemsUsed > 0 ? Math.max(state.turn, Math.max(1, level.par || level.budget) + 1) : state.turn;
}

module.exports = { ACTIONS, DIRECTIONS, STAR_TWO_MARGIN, SUPPLY_ENERGY, RELIGHT_ACTION, isAction, createState, step, replay, normalizeReviveHistory, normalizeItemRewards, normalizeSupplyPolicy, reviveEnergy, revive, stars, scoredTurns, neighbor };
