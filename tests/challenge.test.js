'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN, getDaily } = require('../src/levels');
const { createState, step, stars } = require('../src/engine');
const { getChallenge, CHALLENGE_VERSION, TARGET_RESERVE } = require('../src/challenge');

function follow(level) {
  let state = createState(level);
  for (const [index, action] of level.solution.entries()) {
    assert.equal(state.status, 'playing', `${level.id}: cannot continue step ${index}`);
    const result = step(level, state, action);
    assert.equal(result.moved, true, `${level.id}: blocked at step ${index}`);
    state = result.state;
  }
  assert.equal(state.status, 'won', `${level.id}: challenge witness must win`);
  assert.equal(state.revived, false);
  assert.equal(stars(level, state), 3);
  return state;
}

function verifyChallenge(level, minimumReduction = 2) {
  const snapshot = JSON.stringify(level);
  const challenge = getChallenge(level);
  assert.equal(challenge.id, level.id);
  assert.equal(challenge.challenge, true);
  assert.equal(challenge.revision, `${level.revision}-challenge-${CHALLENGE_VERSION}`);
  assert.equal(challenge.standardRevision, level.revision);
  assert.equal(challenge.standardBudget, level.budget);
  assert.equal(challenge.par, level.par);
  assert.equal(challenge.title, level.title);
  assert.equal(challenge.chapter, level.chapter);
  for (const key of ['width', 'height', 'start', 'exit', 'walls', 'letters', 'seals', 'winds', 'lights', 'solution']) {
    assert.deepEqual(challenge[key], level[key], `${level.id}: changed ${key}`);
  }
  const standardFinal = follow(level);
  const final = follow(challenge);
  assert.equal(final.turn, level.par);
  assert.equal(final.energy, challenge.challengeReserve);
  assert.ok(challenge.budget <= level.budget - minimumReduction, `${level.id}: budget must tighten`);
  assert.ok(final.energy < standardFinal.energy, `${level.id}: route reserve must shrink`);
  assert.ok(final.energy >= TARGET_RESERVE && final.energy <= 3, `${level.id}: reserve must stay compact`);
  assert.deepEqual(getChallenge(level), challenge, `${level.id}: challenge must be deterministic`);
  assert.deepEqual(getChallenge(challenge), challenge, `${level.id}: conversion must be idempotent`);
  assert.equal(JSON.stringify(level), snapshot, `${level.id}: mutated source`);
  return challenge;
}

test('all 30 campaign challenges preserve the route and remain solvable without revival', () => {
  assert.equal(CAMPAIGN.length, 30);
  for (const level of CAMPAIGN) verifyChallenge(level);
});

test('the three tutorial challenges stay solvable with a one-turn reserve', () => {
  assert.deepEqual(CAMPAIGN.slice(0, 3).map(level => getChallenge(level).budget), [5, 7, 10]);
  for (const level of CAMPAIGN.slice(0, 3)) assert.equal(follow(getChallenge(level)).energy, 1);
});

test('60 deterministic daily challenges tighten budgets while preserving solvability', () => {
  let oneTurnReserves = 0;
  let totalReduction = 0;
  for (let index = 0; index < 60; index++) {
    const key = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
    const level = getDaily(key);
    const challenge = verifyChallenge(level, 1);
    if (challenge.challengeReserve === 1) oneTurnReserves++;
    totalReduction += level.budget - challenge.budget;
    assert.deepEqual(getChallenge(getDaily(key)), challenge);
  }
  assert.ok(oneTurnReserves >= 45, 'most daily routes should finish with just one spare turn');
  assert.ok(totalReduction >= 60 * 2.5, 'daily initial energy should fall by at least 2.5 turns on average');
});

test('daily routes already at their prefix survival floor are kept playable', () => {
  for (const key of ['2026-03-15', '2026-07-23', '2026-12-26']) {
    const level = getDaily(key);
    const challenge = getChallenge(level);
    assert.equal(challenge.budget, level.budget, `${key}: cannot reduce below the survival floor`);
    follow(challenge);
  }
});

test('late lamps require enough prefix energy and off-route lamps grant no budget discount', () => {
  const level = {
    id: 'late-lamp', revision: 'test', width: 9, height: 2, walls: [],
    start: 0, exit: 8, letters: [], seals: [], winds: {}, lights: [7, 10],
    budget: 11, par: 8, solution: Array(8).fill('right')
  };
  const challenge = getChallenge(level);
  assert.equal(challenge.budget, 7, 'must reach the lamp on turn seven');
  assert.equal(challenge.challengeReserve, 2, 'prefix safety overrides the one-turn target');
  assert.deepEqual(follow(challenge).lights, [10], 'unvisited lamp cannot fund the known route');
  let state = createState({ ...challenge, budget: 6 });
  for (let index = 0; index < 6; index++) state = step(challenge, state, 'right').state;
  assert.equal(state.status, 'failed', 'one lower initial budget fails before the late lamp');
});

test('wind transit lamps are skipped and starting lamps are counted exactly once', () => {
  const level = {
    id: 'wind-lamps', revision: 'test', width: 5, height: 2, walls: [],
    start: 0, exit: 4, letters: [], seals: [], winds: { 1: 'right' }, lights: [1, 2],
    budget: 6, par: 3, solution: Array(3).fill('right')
  };
  const challenge = getChallenge(level);
  assert.equal(challenge.budget, 1);
  assert.deepEqual(follow(challenge).lights, [1]);
  const startLamp = getChallenge({ ...level, winds: {}, lights: [0], exit: 3 });
  assert.equal(startLamp.budget, 1);
  assert.equal(follow(startLamp).energy, 1);
});

test('derived arrays and wind maps can be changed without mutating the original level', () => {
  const level = CAMPAIGN[24];
  const snapshot = JSON.stringify(level);
  const challenge = getChallenge(level);
  for (const key of ['walls', 'letters', 'seals', 'lights', 'solution']) challenge[key].pop();
  challenge.winds[999] = 'up';
  challenge.budget = 999;
  assert.equal(JSON.stringify(level), snapshot);
  follow(getChallenge(level));
});

test('content revision changes derive a fresh challenge revision', () => {
  const original = getChallenge(CAMPAIGN[0]);
  const revised = getChallenge({ ...CAMPAIGN[0], revision: 'future' });
  assert.notEqual(original.revision, revised.revision);
  assert.equal(revised.revision, `future-challenge-${CHALLENGE_VERSION}`);
});

test('invalid route witnesses cannot produce misleading challenge budgets', () => {
  assert.throws(() => getChallenge({ ...CAMPAIGN[0], solution: [] }), /non-empty verified solution/);
  assert.throws(() => getChallenge({ ...CAMPAIGN[0], solution: ['up'] }), /Invalid challenge solution/);
  assert.throws(() => getChallenge({ ...CAMPAIGN[0], solution: ['right'] }), /Unfinished challenge solution/);
});
