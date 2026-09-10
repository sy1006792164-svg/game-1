'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, createState, step, replay, normalizeReviveHistory, revive, stars, STAR_TWO_MARGIN } = require('../src/engine');
const { CAMPAIGN, chapterNames, CONTENT_VERSION, PER_CHAPTER, reserveFor, undoFor } = require('../src/levels');
const { solve } = require('../tools/solve');
const { tier, bridgesRequired, HAND_MADE } = require('../tools/generate');
const { playHint } = require('../src/play-guide');
const { isReviveRouteBlocked } = require('../src/revive-policy');

// The independent solver is slow on the big late boards, so it checks the hand-made routes plus every sixtieth generated route.
const independentlySolved = level => level.id <= HAND_MADE || (level.id - 1 - HAND_MADE) % 60 === 0;

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

test('all 999 campaign witnesses win without revival across 167 chapters', () => {
  assert.equal(CAMPAIGN.length, 999);
  assert.equal(PER_CHAPTER, 6);
  assert.equal(chapterNames.length, Math.ceil(CAMPAIGN.length / PER_CHAPTER));
  assert.equal(new Set(chapterNames).size, chapterNames.length, 'chapter names are unique');
  assert.ok(chapterNames.every(name => typeof name === 'string' && name.length === 4), 'chapter names are four characters');
  assert.equal(chapterNames[chapterNames.length - 1], '寄往终章');
  assert.equal(new Set(CAMPAIGN.map(level => level.title)).size, CAMPAIGN.length, 'route titles are unique');
  assert.equal(new Set(CAMPAIGN.map(level => level.solution.join(','))).size, CAMPAIGN.length);
  assert.equal(new Set(CAMPAIGN.map(level => JSON.stringify([level.walls, level.start, level.exit, level.letters, level.seals, level.winds, level.lights]))).size, CAMPAIGN.length);
  for (const [index, level] of CAMPAIGN.entries()) {
    assert.equal(level.id, index + 1);
    assert.equal(level.revision, CONTENT_VERSION);
    assert.equal(level.chapter, Math.floor(index / PER_CHAPTER));
    assert.equal(level.undo, undoFor(index));
    assert.equal(level.width, level.height);
    assert.equal(level.width, index < HAND_MADE ? 6 : tier(index).size, `${level.id}: board size follows the difficulty tier`);
    checkLevel(level);
    if (index >= 3) assert.ok(new Set(level.solution).size >= 3, `${level.id}: route should use turns`);
  }
});

test('the campaign has independently optimal targets and a tight, sustained light budget', () => {
  assert.equal(CONTENT_VERSION, '5');
  assert.equal(STAR_TWO_MARGIN, 2);
  assert.deepEqual(CAMPAIGN.slice(0, 3).map(level => level.par), [4, 6, 9]);
  assert.deepEqual([reserveFor(0), reserveFor(3), reserveFor(6), reserveFor(17), reserveFor(18), reserveFor(119), reserveFor(299), reserveFor(300), reserveFor(998)], [null, 3, 2, 2, 1, 1, 1, 0, 0]);
  for (const level of CAMPAIGN) {
    if (independentlySolved(level)) {
      const shortest = solve(level, 8000000);
      assert.ok(shortest, `${level.id}: independent solver exhausted`);
      assert.equal(shortest.length, level.par, `${level.id}: three-star target must equal the independent minimum`);
    }
    const final = follow(level, level.solution);
    const reserve = reserveFor(level.id - 1);
    // A late lamp can force one extra starting unit so the route survives until the lamp; never more.
    if (level.id >= 4) assert.ok(final.energy >= reserve && final.energy <= reserve + 1, `${level.id}: reserve ${final.energy} must be the chapter margin ${reserve} after collected lamps`);
    if (level.id >= 19 && level.id <= 300) assert.equal(final.energy, 1, `${level.id}: from route 19 exactly one spare turn remains`);
    if (level.id >= 301) assert.ok(final.energy <= 1, `${level.id}: from route 301 the budget equals the shortest route`);
    if (level.id >= 7 && level.id <= 30) assert.ok(level.par >= 23, `${level.id}: chapter 2+ should require a planned route`);
    if (level.id >= 19 && level.id <= 30) assert.ok(level.par >= 30, `${level.id}: later maps should sustain difficulty`);
    if (level.id >= 31) {
      const t = tier(level.id - 1);
      assert.ok(level.par >= t.minPar - 4, `${level.id}: generated ${level.width}x${level.width} route too short (${level.par} < ${t.minPar - 4})`);
      assert.equal(level.letters.length, t.targets, `${level.id}: letters follow the tier`);
      assert.equal(level.seals.length, t.targets, `${level.id}: stamps follow the tier`);
      assert.equal(level.bridges.length, t.bridges, `${level.id}: paper bridges follow the tier`);
      assert.equal(level.lights.length, t.lights, `${level.id}: lamps follow the tier`);
      assert.ok(Object.keys(level.winds).length >= t.winds - 1 && Object.keys(level.winds).length <= t.winds, `${level.id}: winds follow the tier`);
    }
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
  // The curve keeps climbing: each stage of the campaign averages a longer shortest route than the one before.
  const mean = levels => levels.reduce((sum, level) => sum + level.par, 0) / levels.length;
  const stages = [[31, 120], [121, 360], [361, 780], [781, 999]].map(([from, to]) => mean(CAMPAIGN.slice(from - 1, to)));
  for (let index = 1; index < stages.length; index++) assert.ok(stages[index] > stages[index - 1] + 4, `stage ${index + 1} must be clearly longer than stage ${index}: ${stages.join(', ')}`);
  assert.ok(mean(CAMPAIGN.slice(30, 120)) > mean(CAMPAIGN.slice(0, 30)), 'generated routes are longer than the hand-made tutorial');
});

test('generated stages introduce shorter routes first and late routes reject a wasted opening turn', () => {
  const mechanics = level => {
    const { size, targets, winds, bridges, lights, minPar } = tier(level.id - 1);
    return [size, targets, winds, bridges, lights, minPar, reserveFor(level.id - 1)].join('/');
  };
  for (let index = 31; index < CAMPAIGN.length; index++) {
    const before = CAMPAIGN[index - 1], level = CAMPAIGN[index];
    if (mechanics(before) === mechanics(level)) {
      assert.ok(level.par >= before.par, `${before.id} -> ${level.id}: shorter routes should come first within a stage`);
    }
  }
  for (const level of CAMPAIGN.slice(300)) {
    let state = step(level, createState(level), 'wait').state;
    for (const action of level.solution) {
      if (state.status !== 'playing') break;
      state = step(level, state, action).state;
    }
    assert.equal(state.status, 'failed', `${level.id}: one wasted opening turn must exhaust the budget`);
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
      assert.equal(level.lights.length, level.id <= 30 ? 2 : tier(level.id - 1).lights);
      assert.equal(state.lights.length, 0, `${level.id}: budgeted lamps should be collected on the witness`);
    }
  }
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

test('last-turn echo hints keep the courier heading home instead of recommending a losing wait', () => {
  const level = CAMPAIGN[300], state = replay(level, level.solution.slice(0, -1));
  assert.equal(state.energy, 1);
  assert.notEqual(state.player, level.exit);
  assert.equal(step(level, state, 'wait').state.status, 'failed');
  assert.equal(step(level, state, level.solution[level.solution.length - 1]).state.status, 'won');
  const hint = playHint({ level, state, mode: 'campaign' }, 0);
  assert.match(hint, /只剩 1 拍.*回声会收起蓝票.*前往邮局/);
  assert.doesNotMatch(hint, /等一拍|再等|等待/);
});

test('post office hints recommend only enough waiting to finish the real queued delivery', () => {
  const level = CAMPAIGN[24], actions = level.solution.slice(0, 34);
  const state = replay(level, actions);
  assert.equal(state.player, level.exit);
  assert.equal(state.letters.length, 0);
  assert.match(playHint({ level, state, mode: 'campaign' }, 0), /已到邮局，再等 2 拍/);
  assert.equal(replay(level, actions.concat('wait', 'wait')).status, 'won');

  const short = replay(level, ['wait', 'wait'].concat(actions));
  assert.equal(short.status, 'playing');
  assert.equal(short.energy, 1);
  assert.match(playHint({ level, state: short, mode: 'campaign' }, 0), /回声还需 2 拍.*拍数不够原地等齐/);
  assert.doesNotMatch(playHint({ level, state: short, mode: 'campaign' }, 0), /再等/);
  assert.equal(step(level, short, 'wait').state.status, 'failed');
});

test('waiting recommendations along all 999 real routes always complete the delivery', () => {
  let checked = 0, finalEchoTurns = 0;
  for (const level of CAMPAIGN) {
    let state = createState(level);
    for (const action of level.solution) {
      const hint = playHint({ level, state, mode: 'campaign' }, 0);
      assert.doesNotMatch(hint, /移动或等一拍都可以|向邮局走或等一拍/, level.id + ': waiting is never offered without a proven finish');
      const waiting = hint.match(/再等 (\d+) 拍/);
      if (waiting) {
        let finish = state;
        for (let turn = 0; turn < Number(waiting[1]); turn++) finish = step(level, finish, 'wait').state;
        assert.equal(finish.status, 'won', level.id + ': the recommended waits must finish within the real light budget');
        checked++;
      }
      if (state.energy === 1 && state.player !== level.exit && state.seals.includes(state.history[state.turn - 2])) {
        assert.doesNotMatch(hint, /等一拍|再等|等待/, level.id + ': the final action must still deliver');
        finalEchoTurns++;
      }
      state = step(level, state, action).state;
    }
  }
  assert.ok(checked > 0, 'real routes exercise safe waiting at the post office');
  assert.ok(finalEchoTurns > 100, 'the audit covers the late-route final-turn echo case');
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

test('finished states ignore input and each new failure can be revived without resetting the route', () => {
  const level = board({ budget: 1 });
  const failed = step(level, createState(level), 'right').state;
  const snapshot = JSON.stringify(failed);
  assert.equal(step(level, failed, 'right').state, failed);
  const revived = revive(level, failed);
  assert.equal(revived.energy, 8);
  assert.equal(revived.status, 'playing');
  assert.equal(revived.revived, true);
  assert.equal(failed.reviveCount, 0);
  assert.equal(revived.reviveCount, 1);
  assert.equal(revived.player, failed.player);
  assert.deepEqual(revived.history, failed.history);
  assert.equal(JSON.stringify(failed), snapshot);
  assert.equal(revive(level, revived), revived);
  let failedAgain = revived;
  for (let index = 0; index < revived.energy; index++) failedAgain = step(level, failedAgain, 'wait').state;
  const revivedAgain = revive(level, failedAgain);
  assert.equal(revivedAgain.status, 'playing');
  assert.equal(revivedAgain.reviveCount, 2);
  assert.equal(revivedAgain.energy, revived.energy);
  assert.equal(revivedAgain.turn, failedAgain.turn);
  assert.deepEqual(revivedAgain.history, failedAgain.history);
  assert.equal(revive(board({ budget: 30 }), failed).energy, 15);
  assert.equal(revive(level, createState(level)).revived, false);
  const won = { ...failed, status: 'won' };
  assert.equal(revive(level, won), won);
});

test('revival rejects the real level 21 dead end even after more energy is granted', () => {
  const level = CAMPAIGN[20];
  const failed = replay(level, ['left', 'right', ...Array(level.budget - 2).fill('wait')]);
  const before = JSON.stringify(failed);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.player, level.start);
  assert.deepEqual(failed.bridges, []);
  assert.equal(isReviveRouteBlocked(level, failed), true);
  assert.equal(isReviveRouteBlocked(level, revive(level, failed)), true, 'extra turns cannot repair the broken return route');
  assert.equal(JSON.stringify(failed), before, 'eligibility checks preserve the saved route');
});

test('revival does not reject routes with no torn bridge or an intact bridge under the courier', () => {
  const first = CAMPAIGN[0], bridge = CAMPAIGN[20];
  assert.equal(isReviveRouteBlocked(first, replay(first, Array(first.budget).fill('wait'))), false);
  assert.equal(isReviveRouteBlocked(bridge, createState(bridge)), false);
  const standing = replay(bridge, ['left']);
  assert.ok(standing.bridges.includes(standing.player));
  assert.equal(isReviveRouteBlocked(bridge, standing), false);
});

test('the useful side of the same torn bridge remains eligible for extra turns', () => {
  const level = CAMPAIGN[20];
  const failed = replay(level, ['left', 'left', ...Array(level.budget - 2).fill('wait')]);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.bridges, []);
  assert.equal(isReviveRouteBlocked(level, failed), false);
});

test('a real pending echo beyond torn bridges does not suppress revival', () => {
  const level = CAMPAIGN[100], actions = level.solution.slice(0, 30);
  let state = replay(level, actions);
  assert.deepEqual(state.bridges, []);
  assert.ok(state.seals.includes(45));
  assert.equal(state.history[state.turn - 2], 45, 'the oldest pending echo lands on the next action');
  assert.equal(isReviveRouteBlocked(level, state), false, 'the echo can collect the unreachable stamp');
  state = step(level, state, level.solution[30]).state;
  assert.equal(state.seals.includes(45), false);
  for (const action of level.solution.slice(31)) state = step(level, state, action).state;
  assert.equal(state.status, 'won', 'the unchanged real route can still finish');
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
  for (const reviveCount of [1, 2, 10]) {
    assert.equal(stars(level, { turn: 10, revived: true, reviveCount, energy: 999 }), 2);
    assert.equal(stars(level, { turn: 12, revived: true, reviveCount, energy: 1 }), 2);
    assert.equal(stars(level, { turn: 13, revived: true, reviveCount, energy: 999 }), 1);
  }
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
  assert.equal(revived.reviveCount, 1);
  assert.equal(revived.turn, 4);
  assert.deepEqual(revived.history, [0, 1, 1, 1, 2]);
});

test('ordered revival histories replay every completed reward and keep legacy single-revival saves', () => {
  const level = board({ letters: [1], budget: 3 });
  const actions = ['right', 'wait', 'wait', ...Array(8).fill('wait'), 'right'];
  const history = Object.freeze([3, 11]);
  const state = replay(level, actions, history);
  assert.equal(state.status, 'playing');
  assert.equal(state.reviveCount, 2);
  assert.equal(state.revived, true);
  assert.equal(state.turn, actions.length);
  assert.equal(state.energy, 7);
  assert.deepEqual(state.letters, []);
  assert.equal(replay(level, actions.slice(0, 11), history).reviveCount, 2, 'the final saved index can be a just-earned revival');
  assert.deepEqual(replay(level, actions.slice(0, 4), 3), replay(level, actions.slice(0, 4), [3]));
  assert.deepEqual(replay(level, [], null), replay(level, [], []));
  assert.throws(() => replay(level, actions, [3, 10]), /invalid revive/, 'each reward must occur at an actual failure');
  assert.throws(() => replay(level, actions, [3]), /invalid action/, 'missing later rewards cannot bypass failure');
});

test('revival history normalization rejects malformed, repeated, unordered and sparse indexes', () => {
  assert.deepEqual(normalizeReviveHistory(undefined, 0), []);
  assert.deepEqual(normalizeReviveHistory(null, 0), []);
  assert.deepEqual(normalizeReviveHistory(0, 0), [0]);
  const valid = [0, 3, 11], copied = normalizeReviveHistory(valid, 11);
  assert.deepEqual(copied, valid);
  assert.notEqual(copied, valid);
  const sparse = [3, 11]; delete sparse[0];
  for (const value of [-1, 12, 1.5, NaN, '3', {}, true, [3, 3], [11, 3], [-1], [12], [1.5], [null], sparse]) {
    assert.throws(() => normalizeReviveHistory(value, 11), /invalid revive/);
  }
  let getters = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { getters++; return 3; } });
  assert.throws(() => normalizeReviveHistory(accessor, 11), /invalid revive/);
  assert.equal(getters, 0);
  assert.throws(() => normalizeReviveHistory([], -1), /invalid revive/);
});

test('bridge routes tear their bridges on the witness and cannot be crossed twice', () => {
  const bridged = CAMPAIGN.filter(level => level.bridges.length);
  assert.deepEqual(bridged.filter(level => level.id <= 30).map(level => level.id), [16, 20, 21, 25, 27, 28, 29]);
  assert.ok(CAMPAIGN.slice(36).every(level => level.bridges.length >= 1), 'every generated route from chapter 7 on has a paper bridge');
  assert.ok(CAMPAIGN.slice(90).every(level => level.bridges.length >= 2), 'from route 91 every board carries at least two paper bridges');
  assert.ok(CAMPAIGN.slice(600).every(level => level.bridges.length === 4), 'every route from 601 carries four paper bridges');
  for (const level of bridged) {
    for (const cell of level.bridges) {
      assert.ok(!level.walls.includes(cell) && !level.letters.includes(cell) && !level.seals.includes(cell) && !level.lights.includes(cell) && !level.winds[cell], `${level.id}: a bridge is plain floor`);
      assert.ok(cell !== level.start && cell !== level.exit, `${level.id}: start and exit are never bridges`);
    }
    const final = follow(level, level.solution);
    assert.equal(final.status, 'won');
    if (level.id <= 30) assert.deepEqual(final.bridges, [], `${level.id}: the shortest route uses its paper bridge`);
    else assert.ok(level.bridges.length - final.bridges.length >= bridgesRequired(level.bridges.length), `${level.id}: the shortest route tears at least ${bridgesRequired(level.bridges.length)} paper bridges; the rest are traps`);
    if (level.id > 30) continue;
    const noBridge = { ...level, walls: level.walls.concat(level.bridges), bridges: [] };
    assert.equal(solve(noBridge) === null || solve(noBridge).length >= level.par, true, `${level.id}: closing the bridge must not reveal a shorter route`);
  }
});
