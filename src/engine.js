'use strict';

const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });
const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'wait']);
const STAR_TWO_MARGIN = 2;

/** A paper bridge that the courier has already stepped off is a wall for the rest of the route. */
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
  if ((level.walls || []).indexOf(next) >= 0 || collapsed(level, state, next)) return null;
  return next;
}

function createState(level) {
  const startsOnLight = (level.lights || []).indexOf(level.start) >= 0;
  const state = {
    levelId: level.id,
    player: level.start,
    echo: null,
    history: [level.start],
    turn: 0,
    energy: level.budget + (startsOnLight ? 3 : 0),
    letters: (level.letters || []).filter(cell => cell !== level.start),
    seals: (level.seals || []).slice(),
    lights: (level.lights || []).filter(cell => cell !== level.start),
    bridges: (level.bridges || []).slice(),
    status: 'playing',
    revived: false,
    reviveCount: 0
  };
  if (state.player === level.exit && !state.letters.length && !state.seals.length) state.status = 'won';
  else if (state.energy <= 0) state.status = 'failed';
  return state;
}

/** A valid wait also returns moved:true: the turn, lantern and echo advance. */
function step(level, state, action) {
  if (!state || state.status !== 'playing' || ACTIONS.indexOf(action) < 0) {
    return { state, moved: false, events: [] };
  }
  const destination = action === 'wait' ? state.player : neighbor(level, state.player, action, state);
  if (destination === null) return { state, moved: false, events: [{ type: 'blocked', cell: state.player }] };

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
  // Entering a wind tile pushes once. Waiting does not re-trigger the tile.
  const wind = action !== 'wait' && level.winds && level.winds[destination];
  if (wind) {
    const pushed = neighbor(level, destination, wind, state);
    if (pushed !== null) {
      next.player = pushed;
      events.push({ type: 'wind', cell: pushed });
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
    next.letters = next.letters.filter(cell => cell !== next.player);
    events.push({ type: 'letter', cell: next.player });
  }
  if (next.echo !== null && next.seals.indexOf(next.echo) >= 0) {
    next.seals = next.seals.filter(cell => cell !== next.echo);
    events.push({ type: 'seal', cell: next.echo });
  }
  if (next.lights.indexOf(next.player) >= 0) {
    next.lights = next.lights.filter(cell => cell !== next.player);
    next.energy += 3;
    events.push({ type: 'light', cell: next.player });
  }
  // Reaching the goal on the final unit of light is still a win.
  if (next.player === level.exit && !next.letters.length && !next.seals.length) {
    next.status = 'won';
    events.push({ type: 'win', cell: next.player });
  } else if (next.energy <= 0) {
    next.status = 'failed';
    events.push({ type: 'fail', cell: next.player });
  }
  return { state: next, moved: true, events };
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
function replay(level, actions, revivalHistory) {
  if (!Array.isArray(actions)) throw new Error('invalid history');
  const history = normalizeReviveHistory(revivalHistory, actions.length);
  let revivalIndex = 0;
  let state = createState(level);
  for (let index = 0; index <= actions.length; index++) {
    if (history[revivalIndex] === index) {
      if (state.status !== 'failed') throw new Error('invalid revive');
      state = revive(level, state);
      revivalIndex++;
    }
    if (index === actions.length) break;
    const result = step(level, state, actions[index]);
    if (!result.moved) throw new Error('invalid action');
    state = result.state;
  }
  return state;
}

function reviveEnergy(level) { return Math.max(8, Math.ceil(level.budget * 0.5)); }

function revive(level, state) {
  if (!state || state.status !== 'failed') return state;
  return { ...state, energy: reviveEnergy(level), status: 'playing', revived: true, reviveCount: state.reviveCount + 1 };
}

/** Three stars at the verified minimum, two within a short margin, one for any other delivery. */
function stars(level, state) {
  const par = Math.max(1, level.par || level.budget);
  const earned = state.turn <= par ? 3 : state.turn <= par + STAR_TWO_MARGIN ? 2 : 1;
  return state.revived ? Math.min(2, earned) : earned;
}

module.exports = { ACTIONS, DIRECTIONS, STAR_TWO_MARGIN, createState, step, replay, normalizeReviveHistory, reviveEnergy, revive, stars, neighbor };
