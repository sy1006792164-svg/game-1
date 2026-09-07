'use strict';

const DIRECTIONS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });
const ACTIONS = Object.freeze(['up', 'down', 'left', 'right', 'wait']);

function neighbor(level, cell, direction) {
  const delta = DIRECTIONS[direction];
  if (!delta) return null;
  const x = cell % level.width + delta[0];
  const y = Math.floor(cell / level.width) + delta[1];
  if (x < 0 || x >= level.width || y < 0 || y >= level.height) return null;
  const next = y * level.width + x;
  return (level.walls || []).indexOf(next) >= 0 ? null : next;
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
    status: 'playing',
    revived: false
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
  const destination = action === 'wait' ? state.player : neighbor(level, state.player, action);
  if (destination === null) return { state, moved: false, events: [{ type: 'blocked', cell: state.player }] };

  const next = {
    ...state,
    player: destination,
    turn: state.turn + 1,
    energy: state.energy - 1,
    history: state.history.slice(),
    letters: state.letters.slice(),
    seals: state.seals.slice(),
    lights: state.lights.slice()
  };
  const events = [{ type: action === 'wait' ? 'wait' : 'move', cell: destination }];
  // Entering a wind tile pushes once. Waiting does not re-trigger the tile.
  const wind = action !== 'wait' && level.winds && level.winds[destination];
  if (wind) {
    const pushed = neighbor(level, destination, wind);
    if (pushed !== null) {
      next.player = pushed;
      events.push({ type: 'wind', cell: pushed });
    }
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

function revive(level, state) {
  if (!state || state.status !== 'failed' || state.revived) return state;
  return { ...state, energy: Math.max(8, Math.ceil(level.budget * 0.5)), status: 'playing', revived: true };
}

function stars(level, state) {
  const par = Math.max(1, level.par || level.budget);
  const earned = state.turn <= par ? 3 : state.turn <= Math.ceil(par * 1.35) ? 2 : 1;
  return state.revived ? Math.min(2, earned) : earned;
}

module.exports = { ACTIONS, DIRECTIONS, createState, step, revive, stars, neighbor };
