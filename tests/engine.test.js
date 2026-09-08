'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, createState, step, replay, revive, stars, STAR_TWO_MARGIN } = require('../src/engine');
const { CAMPAIGN, getDaily, chapterNames, CONTENT_VERSION, PER_CHAPTER, reserveFor, undoFor } = require('../src/levels');
const { solve } = require('../tools/solve');

function board(overrides = {}) {
  return { id: 'test', title: 'Test', chapter: 0, width: 6, height: 6, walls: [], start: 0, exit: 35, letters: [], seals: [], winds: {}, lights: [], budget: 30, par: 10, brief: '', solution: [], ...overrides };
}

function follow(level, actions) {
  let state = createState(level);
  for (const [index, action] of actions.entries()) {
    assert.equal(state.status, 'playing', `${level.id}: route continues after ${state.status}, step ${index}`);
    const result = step(level, state, action);
    assert.equal(result.moved, true, `${level.id}: blocked witness at step ${index}, action ${action}`);
    state = result.state;
  }
  return state;
}

function checkLevel(level) {
  const size = level.width * level.height;
  const cells = [level.start, level.exit, ...level.letters, ...level.seals, ...level.lights, ...Object.keys(level.winds).map(Number)];
  for (const cell of cells) {
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < size, `${level.id}: invalid cell ${cell}`);
    assert.ok(!level.walls.includes(cell), `${level.id}: object inside wall ${cell}`);
  }
  for (const action of level.solution) assert.ok(ACTIONS.includes(action));
  const state = follow(level, level.solution);
  assert.equal(state.status, 'won', `${level.id}: witness failed`);
  assert.equal(state.player, level.exit);
  assert.equal(state.letters.length + state.seals.length, 0);
  assert.equal(state.turn, level.par);
  assert.equal(stars(level, state), 3);
  return state;
}

test('all 120 campaign witnesses win without revival and fill twenty chapters of six', () => {
  assert.equal(CAMPAIGN.length, 120);
  assert.equal(PER_CHAPTER, 6);
  assert.equal(chapterNames.length, CAMPAIGN.length / PER_CHAPTER);
  assert.equal(new Set(CAMPAIGN.map(level => level.solution.join(','))).size, CAMPAIGN.length);
  assert.equal(new Set(CAMPAIGN.map(level => JSON.stringify([level.walls, level.start, level.exit, level.letters, level.seals, level.winds, level.lights]))).size, CAMPAIGN.length);
  for (const [index, level] of CAMPAIGN.entries()) {
    assert.equal(level.id, index + 1);
    assert.equal(level.revision, CONTENT_VERSION);
    assert.equal(level.chapter, Math.floor(index / PER_CHAPTER));
    assert.equal(level.undo, undoFor(index));
    assert.equal(level.width, level.height);
    assert.equal(level.width, index < 54 ? 6 : index < 84 ? 7 : 8, `${level.id}: board size grows by chapter`);
    checkLevel(level);
    if (index >= 3) assert.ok(new Set(level.solution).size >= 3, `${level.id}: route should use turns`);
  }
});

test('the campaign has independently optimal targets and a tight, sustained light budget', () => {
  assert.equal(CONTENT_VERSION, '4');
  assert.equal(STAR_TWO_MARGIN, 2);
  assert.deepEqual(CAMPAIGN.slice(0, 3).map(level => level.par), [4, 6, 9]);
  assert.deepEqual([reserveFor(0), reserveFor(3), reserveFor(6), reserveFor(17), reserveFor(18), reserveFor(119)], [null, 3, 2, 2, 1, 1]);
  for (const level of CAMPAIGN) {
    const shortest = solve(level);
    assert.ok(shortest, `${level.id}: independent solver exhausted`);
    assert.equal(shortest.length, level.par, `${level.id}: three-star target must equal the independent minimum`);
    const final = follow(level, level.solution);
    const reserve = reserveFor(level.id - 1);
    // A late lamp can force one extra starting unit so the route survives until the lamp; never more.
    if (level.id >= 4) assert.ok(final.energy >= reserve && final.energy <= reserve + 1, `${level.id}: reserve ${final.energy} must be the chapter margin ${reserve} after collected lamps`);
    if (level.id >= 19) assert.equal(final.energy, 1, `${level.id}: from route 19 exactly one spare turn remains`);
    if (level.id >= 7 && level.id <= 30) assert.ok(level.par >= 23, `${level.id}: chapter 2+ should require a planned route`);
    if (level.id >= 19 && level.id <= 30) assert.ok(level.par >= 30, `${level.id}: later maps should sustain difficulty`);
    if (level.id >= 31) assert.ok(level.par >= (level.width === 6 ? 28 : level.width === 7 ? 36 : 44), `${level.id}: generated ${level.width}x${level.width} route too short (${level.par})`);
    if (level.id >= 31) assert.ok(level.letters.length >= 3 && level.letters.length === level.seals.length, `${level.id}: generated routes carry matched letters and stamps`);
    if (level.id >= 61) assert.ok(level.letters.length >= 4, `${level.id}: later generated routes carry at least four letters`);
    if (level.id >= 4) {
      const junctions = Array.from({length: level.width * level.height}, (_, cell) => cell).filter(cell => {
        if (level.walls.includes(cell)) return false;
        const x = cell % level.width;
        const y = Math.floor(cell / level.width);
        return [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]].filter(([nx, ny]) =>
          nx >= 0 && nx < level.width && ny >= 0 && ny < level.height && !level.walls.includes(ny * level.width + nx)
        ).length >= 3;
      });
      if (level.id <= 6) assert.equal(junctions.length, level.id - 2, `${level.id}: introductory choices should increase one junction at a time`);
      else assert.ok(junctions.length >= 3, `${level.id}: difficulty must include genuine route choices`);
    }
  }
});

test('wind lessons exercise real wind pushes and lamp chapters use their planned supplies', () => {
  for (const level of CAMPAIGN.slice(12)) {
    let state = createState(level);
    const windTurns = [];
    for (const action of level.solution) {
      const result = step(level, state, action);
      state = result.state;
      if (result.events.some(event => event.type === 'wind')) windTurns.push(state.turn);
    }
    assert.ok(windTurns.length > 0, `${level.id}: wind should influence the optimal witness`);
    if (level.id === 13) assert.ok(windTurns[0] <= 4, 'the first wind lesson must demonstrate its push promptly');
    if (level.id >= 19) {
      assert.equal(level.lights.length, 2);
      assert.equal(state.lights.length, 0, `${level.id}: budgeted lamps should be collected on the witness`);
    }
  }
});

test('daily maps are deterministic, independent, varied and solvable across 60 dates', () => {
  const signatures = new Set();
  for (let index = 0; index < 60; index++) {
    const key = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
    const level = getDaily(key);
    assert.equal(level.revision, CONTENT_VERSION);
    assert.equal(level.letters.length, 3);
    assert.equal(level.seals.length, 3);
    assert.deepEqual(getDaily(key), level);
    const final = checkLevel(level);
    assert.ok(final.energy >= 1 && final.energy <= 3, `${key}: daily reserve should stay tight`);
    signatures.add(JSON.stringify([level.walls, level.start, level.exit, level.letters, level.seals]));
  }
  assert.equal(signatures.size, 60);
  const mutated = getDaily('2028-02-29');
  mutated.letters.pop(); mutated.walls.push(100); mutated.solution.pop();
  checkLevel(getDaily('2028-02-29'));
});

test('blocked moves and illegal actions do not consume a turn or mutate state', () => {
  const level = board({ walls: [1] });
  const state = createState(level);
  for (const action of ['left', 'up', 'right', 'teleport', null, undefined, '__proto__']) {
    const result = step(level, state, action);
    assert.equal(result.moved, false);
    assert.equal(result.state, state);
    assert.equal(state.turn, 0);
    assert.equal(state.energy, 30);
    assert.deepEqual(state.history, [0]);
  }
  const rightEdge = createState(board({ start: 5 }));
  assert.equal(step(board(), rightEdge, 'right').moved, false, 'must not wrap across rows');
});

test('echo arrives at the start on action three and follows action one on action four', () => {
  const level = board({ seals: [0, 1], letters: [2] });
  let state = createState(level);
  state = step(level, state, 'right').state;
  assert.equal(state.echo, null);
  state = step(level, state, 'right').state;
  assert.equal(state.echo, null);
  assert.deepEqual(state.letters, []);
  assert.deepEqual(state.seals, [0, 1]);
  state = step(level, state, 'wait').state;
  assert.equal(state.echo, 0);
  assert.deepEqual(state.seals, [1]);
  state = step(level, state, 'down').state;
  assert.equal(state.echo, 1);
  assert.deepEqual(state.seals, []);
  assert.deepEqual(state.history, [0, 1, 2, 2, 8]);
});

test('wait consumes light, advances echo and can complete a delivery', () => {
  const level = board({ start: 0, exit: 1, seals: [1], budget: 4 });
  const state = follow(level, ['right', 'wait', 'wait', 'wait']);
  assert.equal(state.status, 'won');
  assert.equal(state.energy, 0);
  assert.equal(state.echo, 1);
});

test('wind pushes once; only final positions collect objects or enter history', () => {
  const level = board({ winds: { 1: 'right', 2: 'down' }, letters: [1, 2], seals: [1, 2] });
  let state = createState(level);
  const result = step(level, state, 'right');
  state = result.state;
  assert.equal(state.player, 2, 'the second wind must not chain');
  assert.deepEqual(state.history, [0, 2]);
  assert.deepEqual(state.letters, [1], 'transit cells do not collect');
  assert.ok(result.events.some(event => event.type === 'wind'));
  state = step(level, state, 'wait').state;
  assert.equal(state.player, 2, 'waiting does not re-trigger the wind');
  state = step(level, state, 'wait').state;
  state = step(level, state, 'wait').state;
  assert.deepEqual(state.seals, [1]);
});

test('blocked wind stops on its tile and does not cancel the valid action', () => {
  const level = board({ walls: [2], winds: { 1: 'right' }, letters: [1] });
  const result = step(level, createState(level), 'right');
  assert.equal(result.moved, true);
  assert.equal(result.state.player, 1);
  assert.equal(result.state.turn, 1);
  assert.deepEqual(result.state.letters, []);
});

test('each light can be collected only once and can rescue the last energy unit', () => {
  const level = board({ lights: [1], budget: 1 });
  let state = step(level, createState(level), 'right').state;
  assert.equal(state.energy, 3);
  assert.equal(state.status, 'playing');
  assert.deepEqual(state.lights, []);
  state = step(level, state, 'left').state;
  state = step(level, state, 'right').state;
  assert.equal(state.energy, 1);
  state = step(level, state, 'wait').state;
  assert.equal(state.status, 'failed');
});

test('starting objects are collected consistently; seals still wait for echo', () => {
  const level = board({ letters: [0, 1], lights: [0], seals: [0], budget: 1 });
  const state = createState(level);
  assert.equal(state.energy, 4);
  assert.deepEqual(state.letters, [1]);
  assert.deepEqual(state.lights, []);
  assert.deepEqual(state.seals, [0]);
  assert.equal(createState(board({ start: 0, exit: 0, letters: [0], budget: 0 })).status, 'won');
});

test('win wins over energy failure; merely reaching exit does not finish an incomplete delivery', () => {
  const winLevel = board({ exit: 1, letters: [1], budget: 1 });
  assert.equal(step(winLevel, createState(winLevel), 'right').state.status, 'won');
  const incomplete = board({ exit: 1, letters: [2], budget: 1 });
  assert.equal(step(incomplete, createState(incomplete), 'right').state.status, 'failed');
  const unsealed = board({ exit: 1, seals: [1], budget: 1 });
  assert.equal(step(unsealed, createState(unsealed), 'right').state.status, 'failed');
});

test('finished states ignore input, revival is one-time and preserves the route', () => {
  const level = board({ budget: 1 });
  const failed = step(level, createState(level), 'right').state;
  const snapshot = JSON.stringify(failed);
  assert.equal(step(level, failed, 'right').state, failed);
  const revived = revive(level, failed);
  assert.equal(revived.energy, 8);
  assert.equal(revived.status, 'playing');
  assert.equal(revived.revived, true);
  assert.equal(revived.player, failed.player);
  assert.deepEqual(revived.history, failed.history);
  assert.equal(JSON.stringify(failed), snapshot);
  assert.equal(revive(level, revived), revived);
  const failedAgain = { ...revived, status: 'failed', energy: 0 };
  assert.equal(revive(level, failedAgain), failedAgain);
  assert.equal(revive(board({ budget: 30 }), failed).energy, 15);
  assert.equal(revive(level, createState(level)).revived, false);
  const won = { ...failed, status: 'won' };
  assert.equal(revive(level, won), won);
});

test('steps leave their inputs unchanged and serializable for local saves', () => {
  const level = board({ letters: [1], seals: [0], lights: [1] });
  const state = createState(level);
  const snapshot = JSON.stringify(state);
  Object.freeze(state.history); Object.freeze(state.letters); Object.freeze(state.seals); Object.freeze(state.lights); Object.freeze(state);
  const next = step(level, state, 'right').state;
  assert.equal(JSON.stringify(state), snapshot);
  assert.notEqual(next, state);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});

test('three-star targets and revival cap apply at their exact boundaries', () => {
  const level = board({ par: 10 });
  assert.equal(stars(level, { turn: 10, revived: false }), 3);
  assert.equal(stars(level, { turn: 11, revived: false }), 2);
  assert.equal(stars(level, { turn: 12, revived: false }), 2);
  assert.equal(stars(level, { turn: 13, revived: false }), 1);
  assert.equal(stars(level, { turn: 15, revived: false }), 1);
  assert.equal(stars(board({ par: 40 }), { turn: 42, revived: false }), 2, 'the margin is absolute, not proportional');
  assert.equal(stars(board({ par: 40 }), { turn: 43, revived: false }), 1);
  assert.equal(stars(level, { turn: 10, revived: true }), 2);
  assert.equal(stars(level, { turn: 15, revived: true }), 1);
});

test('paper bridges tear once the courier leaves them and never block the echo', () => {
  // S = . B . E in one row: cells 0..4, the bridge is cell 2.
  const level = board({ width: 5, height: 1, start: 0, exit: 4, bridges: [2], seals: [2], budget: 20 });
  let state = createState(level);
  assert.deepEqual(state.bridges, [2]);
  state = step(level, state, 'right').state;
  state = step(level, state, 'right').state;
  assert.equal(state.player, 2);
  assert.deepEqual(state.bridges, [2], 'standing on a bridge keeps it intact');
  state = step(level, state, 'wait').state;
  assert.deepEqual(state.bridges, [2], 'waiting on a bridge does not tear it');
  const leave = step(level, state, 'right');
  state = leave.state;
  assert.deepEqual(state.bridges, []);
  assert.ok(leave.events.some(event => event.type === 'bridge' && event.cell === 2));
  const back = step(level, state, 'left');
  assert.equal(back.moved, false, 'a torn bridge is a wall');
  assert.equal(back.state, state);
  state = step(level, state, 'wait').state;
  assert.equal(state.echo, 2, 'the echo still walks the torn bridge');
  assert.deepEqual(state.seals, [], 'and still collects there');
  state = step(level, state, 'right').state;
  assert.equal(state.status, 'won');
});

test('wind cannot push the courier onto a torn bridge and cannot tear a bridge it only crosses', () => {
  // Row: S(0) B(1) W>(2) .(3) with the wind on cell 2 pushing right.
  const level = board({ width: 4, height: 1, start: 0, exit: 3, bridges: [1], winds: { 2: 'right' }, budget: 20 });
  let state = createState(level);
  state = step(level, state, 'right').state;
  state = step(level, state, 'right').state;
  assert.equal(state.player, 3, 'entering the wind tile pushes to the exit cell');
  assert.deepEqual(state.bridges, [], 'leaving the bridge tore it even though the same turn also blew the courier onward');
  // Two rows of five. Top row: .(0) bridge(1) wind<(2) .(3) .(4); bottom row is a bypass with the exit at 8.
  const pushed = board({ width: 5, height: 2, start: 9, exit: 8, letters: [0], bridges: [1], winds: { 2: 'left' }, budget: 20 });
  let other = createState(pushed);
  other = step(pushed, other, 'up').state;
  other = step(pushed, other, 'left').state;
  assert.equal(other.player, 3);
  other = step(pushed, other, 'left').state;
  assert.equal(other.player, 1, 'wind carries the courier onto an intact bridge');
  assert.deepEqual(other.bridges, [1]);
  const bounce = step(pushed, other, 'right').state;
  assert.equal(bounce.player, 1, 'a wind tile that blows the courier straight back leaves them on the bridge');
  assert.deepEqual(bounce.bridges, [1], 'the bridge only tears once the courier actually ends the turn elsewhere');
  other = step(pushed, other, 'left').state;
  assert.deepEqual(other.bridges, []);
  assert.equal(step(pushed, other, 'right').moved, false);
  other = step(pushed, other, 'down').state;
  other = step(pushed, other, 'right').state;
  other = step(pushed, other, 'right').state;
  const blocked = step(pushed, other, 'up');
  assert.equal(blocked.moved, true);
  assert.equal(blocked.state.player, 2, 'the wind tile is entered but the push toward the torn bridge is cancelled');
  assert.ok(!blocked.events.some(event => event.type === 'wind'));
});

test('replay rebuilds any state from its action history and rejects impossible histories', () => {
  const level = board({ letters: [1], budget: 3 });
  const direct = step(level, step(level, createState(level), 'right').state, 'wait').state;
  assert.deepEqual(replay(level, ['right', 'wait']), direct);
  assert.deepEqual(replay(level, []), createState(level));
  assert.throws(() => replay(level, ['up']), /invalid action/);
  const failed = replay(level, ['right', 'wait', 'wait']);
  assert.equal(failed.status, 'failed');
  assert.throws(() => replay(level, ['right', 'wait'], 1), /invalid revive/);
  const revived = replay(level, ['right', 'wait', 'wait', 'right'], 3);
  assert.equal(revived.revived, true);
  assert.equal(revived.turn, 4);
  assert.deepEqual(revived.history, [0, 1, 1, 1, 2]);
});

test('bridge routes tear every bridge on their witness and cannot be crossed twice', () => {
  const bridged = CAMPAIGN.filter(level => level.bridges.length);
  assert.deepEqual(bridged.filter(level => level.id <= 30).map(level => level.id), [16, 20, 21, 25, 27, 28, 29]);
  assert.ok(CAMPAIGN.slice(36).every(level => level.bridges.length >= 1), 'every generated route from chapter 7 on has a paper bridge');
  assert.ok(CAMPAIGN.slice(54).every(level => level.bridges.length === 2), 'the bigger boards carry two paper bridges');
  for (const level of bridged) {
    for (const cell of level.bridges) {
      assert.ok(!level.walls.includes(cell) && !level.letters.includes(cell) && !level.seals.includes(cell) && !level.lights.includes(cell) && !level.winds[cell], `${level.id}: a bridge is plain floor`);
      assert.ok(cell !== level.start && cell !== level.exit, `${level.id}: start and exit are never bridges`);
    }
    const final = follow(level, level.solution);
    assert.equal(final.status, 'won');
    assert.deepEqual(final.bridges, [], `${level.id}: the shortest route uses its paper bridge`);
    if (level.id > 30) continue;
    const noBridge = { ...level, walls: level.walls.concat(level.bridges), bridges: [] };
    assert.equal(solve(noBridge) === null || solve(noBridge).length >= level.par, true, `${level.id}: closing the bridge must not reveal a shorter route`);
  }
});
