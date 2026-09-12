'use strict';

// Independent difficulty audit. Run `node tools/difficulty-qa.js [--all]`.
// Every campaign witness is replayed through the engine; the independent
// shortest-route check covers the hand-made routes plus every thirtieth
// generated route unless --all is given (hours on the 9x9 and 10x10 boards).
const assert = require('node:assert/strict');
const { CAMPAIGN, CONTENT_VERSION, PER_CHAPTER, getLegacyLevel } = require('../src/levels');
const { difficultyProfile } = require('../src/difficulty');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');
const { bridgesRequired, HAND_MADE } = require('./generate');
const args = process.argv.slice(2), full = args.includes('--all');

// Release 1 snapshot for the hand-made routes: [shortest witness turns, starting light, remaining light].
// Generated routes (31+) have no release-1 counterpart and report null there.
const BASELINE = [[4,8,4],[6,10,4],[9,15,6],[12,20,8],[7,12,5],[10,16,6],[18,25,7],[17,23,6],[22,30,8],[17,23,6],[23,32,9],[22,30,8],[9,13,4],[18,25,7],[21,29,8],[18,25,7],[21,29,8],[23,32,9],[20,27,10],[19,26,10],[18,25,7],[19,26,10],[22,30,11],[22,30,11],[21,29,11],[21,29,11],[26,36,13],[23,32,12],[22,30,14],[25,34,12]];

function audit(level, independent = true) {
  assert.equal(level.revision, CONTENT_VERSION);
  const previous = getLegacyLevel(level.id, '5');
  assert.deepEqual(level.solution, previous.solution, `${level.id}: preserves the original legal witness`);
  assert.ok(previous.letters.every(cell => level.letters.includes(cell)) && previous.seals.every(cell => level.seals.includes(cell)),
    `${level.id}: preserves every original objective, so the old shortest lower bound still applies`);
  assert.ok(level.budget < previous.budget || level.letters.length > previous.letters.length || level.seals.length > previous.seals.length,
    `${level.id}: difficulty must actually increase`);
  if (independent) {
    const shortest = solve(level, 8000000);
    assert.ok(shortest, `${level.id}: reference solver found no route`);
    assert.equal(shortest.length, level.par, `${level.id}: par is not the true minimum`);
  }
  let state = createState(level);
  for (const [index, action] of level.solution.entries()) {
    assert.equal(state.status, 'playing', `${level.id}: ended before step ${index}`);
    const result = step(level, state, action);
    assert.ok(result.moved, `${level.id}: blocked witness at step ${index}`);
    state = result.state;
  }
  assert.equal(state.status, 'won', `${level.id}: witness requires revival`);
  assert.equal(state.turn, level.par);
  assert.equal(state.revived, false);
  assert.ok(level.bridges.length - state.bridges.length >= bridgesRequired(level.bridges.length), `${level.id}: the witness tears its required paper bridges`);
  const difficulty = difficultyProfile(level);
  assert.equal(difficulty.reserve, state.energy, `${level.id}: displayed reserve matches the actual route`);
  return { turns: state.turn, budget: level.budget, reserve: state.energy, bridges: level.bridges.length, independent,
    previousBudget: previous.budget, addedLetters: difficulty.addedLetters, addedSeals: difficulty.addedSeals,
    timingTargets: difficulty.timingTargets, tier: difficulty.tier, journeyPoints: difficulty.journeyPoints, recommendedItem: difficulty.recommendedItem };
}

const campaign = CAMPAIGN.map((level, index) => {
  const result = audit(level, full || index < HAND_MADE || (index - HAND_MADE) % 30 === 0);
  const [oldTurns, oldBudget, oldReserve] = BASELINE[index] || [null, null, null];
  return { id: level.id, oldTurns, ...result, oldBudget, oldReserve };
});
const average = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100;
const aggregate = rows => ({ minTurns: Math.min(...rows.map(row => row.turns)), maxTurns: Math.max(...rows.map(row => row.turns)), meanTurns: average(rows.map(row => row.turns)), meanBudget: average(rows.map(row => row.budget)), meanReserve: average(rows.map(row => row.reserve)) });
console.log(JSON.stringify({
  contentVersion: CONTENT_VERSION,
  campaign,
  independentlyVerified: campaign.filter(row => row.independent).length,
  strengthened: campaign.filter(row => row.budget < row.previousBudget || row.addedLetters || row.addedSeals).length,
  addedObjectives: campaign.reduce((sum, row) => sum + row.addedLetters + row.addedSeals, 0),
  routesWithTimingObjectives: campaign.filter(row => row.timingTargets > 0).length,
  stages: [[1, 30], [31, 120], [121, 360], [361, 780], [781, 999]].filter(([from]) => from <= CAMPAIGN.length).map(([from, to]) => ({ routes: from + '-' + Math.min(to, CAMPAIGN.length), size: CAMPAIGN[from - 1].width + 'x' + CAMPAIGN[from - 1].width, ...aggregate(campaign.slice(from - 1, to)) })),
  chapters: Array.from({length: Math.ceil(CAMPAIGN.length / PER_CHAPTER)}, (_, index) => {
    const rows = campaign.slice(index * PER_CHAPTER, index * PER_CHAPTER + PER_CHAPTER), old = rows.filter(row => row.oldTurns !== null);
    return { chapter: index + 1, size: CAMPAIGN[index * PER_CHAPTER].width, ...aggregate(rows), oldMeanTurns: old.length ? average(old.map(row => row.oldTurns)) : null, oldMeanReserve: old.length ? average(old.map(row => row.oldReserve)) : null };
  }),

}, null, 2));
