'use strict';

const { createState, step, DIRECTIONS } = require('./engine');
const { gateStatus } = require('./route-mechanics');

/** Keep the actual action/state pairs so placement never invents a playable route. */
function routeTrace(level, actions = level.solution) {
  const probe = { ...level, budget: actions.length + 1 }, trace = [];
  let state = createState(probe);
  for (const action of actions) {
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Blocked mechanic witness: ' + level.id);
    trace.push({ before: state, after: result.state, action, events: result.events });
    state = result.state;
  }
  if (state.status !== 'won') throw new Error('Unfinished mechanic witness: ' + level.id);
  return trace;
}

function freeCells(level, trace) {
  const occupied = new Set([level.start, level.exit, ...level.walls, ...level.letters,
    ...level.seals, ...level.bridges, ...Object.keys(level.winds).map(Number),
    ...Object.keys(level.tideGates || {}).map(Number)]);
  // A gate never silently changes the landing of an already placed wind tile.
  for (const entry of trace) {
    for (const event of entry.events) if (event.type === 'wind') occupied.add(event.cell);
  }
  return cell => cell !== null && !occupied.has(cell);
}

function entriesByCell(trace, free) {
  const cells = new Map();
  for (const entry of trace) {
    const cell = entry.after.player;
    if (cell === entry.before.player || !free(cell)) continue;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(entry);
  }
  return cells;
}

function degree(level, cell) {
  const x = cell % level.width, y = Math.floor(cell / level.width);
  return Object.values(DIRECTIONS).filter(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && nx < level.width && ny >= 0 && ny < level.height &&
      !level.walls.includes(ny * level.width + nx);
  }).length;
}

function candidateScore(level, cell, entries, proportion) {
  return (degree(level, cell) === 2 ? 20 : 0) - entries.length * 8 -
    Math.abs(entries[0].after.turn - level.solution.length * proportion);
}

function addTideGate(level, trace) {
  const candidates = [...entriesByCell(trace, freeCells(level, trace))]
    .filter(([, entries]) => entries.length <= 2 && entries[0].before.turn >= 2);
  candidates.sort(([a, entriesA], [b, entriesB]) =>
    candidateScore(level, b, entriesB, .35) - candidateScore(level, a, entriesA, .35) || a - b);
  if (!candidates.length) return false;
  const [cell, entries] = candidates[0];
  // The first encounter teaches one deliberate wait; later visits use the same clock.
  level.tideGates = { [cell]: { phase: (entries[0].after.turn + 1) % 3 } };
  const probe = { ...level, budget: level.solution.length * 3 + 1 }, actions = [];
  let state = createState(probe);
  for (const action of level.solution) {
    const delta = DIRECTIONS[action];
    const target = delta && state.player + delta[0] + delta[1] * level.width;
    if (target === cell) {
      const waits = gateStatus(level, state, cell).waitTurns;
      for (let index = 0; index < waits; index++) {
        const waited = step(probe, state, 'wait');
        if (!waited.moved) throw new Error('Blocked tide wait: ' + level.id);
        state = waited.state;
        actions.push('wait');
      }
    }
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Blocked tide witness: ' + level.id);
    state = result.state;
    actions.push(action);
  }
  if (state.status !== 'won') throw new Error('Unfinished tide witness: ' + level.id);
  level.solution = actions;
  return true;
}

function addEchoGate(level, trace) {
  const free = freeCells(level, trace);
  const candidates = [...entriesByCell(trace, free)].filter(([cell, entries]) => {
    const plate = entries[0].before.echo;
    return free(plate) && plate !== cell &&
      entries.every(entry => entry.before.echo === plate && entry.before.player !== plate);
  });
  candidates.sort(([a, entriesA], [b, entriesB]) =>
    candidateScore(level, b, entriesB, .65) - candidateScore(level, a, entriesA, .65) || a - b);
  if (!candidates.length) return false;
  const [cell, entries] = candidates[0];
  level.echoGates = { [cell]: { plate: entries[0].before.echo } };
  return true;
}

function addRouteMechanics(level) {
  if (level.id < 7) return;
  let trace = routeTrace(level);
  if (addTideGate(level, trace)) trace = routeTrace(level);
  if (level.id >= 13 && addEchoGate(level, trace)) routeTrace(level);
  level.par = level.solution.length;
}

module.exports = { addRouteMechanics, routeTrace };
