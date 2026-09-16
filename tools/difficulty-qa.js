'use strict';

// Run `node tools/difficulty-qa.js` to audit every shipped winning route.
// --search also searches the hand-made routes and every thirtieth generated
// map; --all searches every map. A search limit is not an unsolvability proof.
const assert = require('node:assert/strict');
const { CAMPAIGN, CONTENT_VERSION, PER_CHAPTER } = require('../src/levels');
const { difficultyProfile } = require('../src/difficulty');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');
const { bridgesRequired, HAND_MADE } = require('./generate');
const args = process.argv.slice(2), full = args.includes('--all');

// Release 1 snapshot for the hand-made routes: [shortest witness turns, starting light, remaining light].
// Generated routes (31+) have no release-1 counterpart and report null there.
const BASELINE = [[4,8,4],[6,10,4],[9,15,6],[12,20,8],[7,12,5],[10,16,6],[18,25,7],[17,23,6],[22,30,8],[17,23,6],[23,32,9],[22,30,8],[9,13,4],[18,25,7],[21,29,8],[18,25,7],[21,29,8],[23,32,9],[20,27,10],[19,26,10],[18,25,7],[19,26,10],[22,30,11],[22,30,11],[21,29,11],[21,29,11],[26,36,13],[23,32,12],[22,30,14],[25,34,12]];

function audit(level, independent = false) {
  assert.equal(level.revision, CONTENT_VERSION);
  assert.equal(level.lights.length, 0, `${level.id}: no free light pickups`);
  assert.equal(Object.keys(level.supplies || {}).length, 0, `${level.id}: no free tools`);
  let shortest = null;
  if (independent) {
    const route = solve(level, 400000);
    if (route) {
      shortest = route.length;
      assert.ok(shortest <= level.par, `${level.id}: three-star target is achievable`);
    }
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
  return { turns: state.turn, budget: level.budget, reserve: state.energy, bridges: level.bridges.length,
    independent: shortest !== null, searchRequested: independent, shortest,
    tideGates: Object.keys(level.tideGates || {}).length, echoGates: Object.keys(level.echoGates || {}).length,
    addedLetters: difficulty.addedLetters, addedSeals: difficulty.addedSeals,
    timingTargets: difficulty.timingTargets, tier: difficulty.tier, journeyPoints: difficulty.journeyPoints, recommendedItem: difficulty.recommendedItem };
}

const campaign = CAMPAIGN.map((level, index) => {
  const result = audit(level, full || args.includes('--search') && (index < HAND_MADE || (index - HAND_MADE) % 30 === 0));
  const [oldTurns, oldBudget, oldReserve] = BASELINE[index] || [null, null, null];
  return { id: level.id, oldTurns, ...result, oldBudget, oldReserve };
});
const average = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100;
const aggregate = rows => ({ minTurns: Math.min(...rows.map(row => row.turns)), maxTurns: Math.max(...rows.map(row => row.turns)), meanTurns: average(rows.map(row => row.turns)), meanBudget: average(rows.map(row => row.budget)), meanReserve: average(rows.map(row => row.reserve)) });
console.log(JSON.stringify({
  contentVersion: CONTENT_VERSION,
  campaign,
  independentlyVerified: campaign.filter(row => row.independent).length,
  routesWithTideGates: campaign.filter(row => row.tideGates).length,
  routesWithEchoGates: campaign.filter(row => row.echoGates).length,
  addedObjectives: campaign.reduce((sum, row) => sum + row.addedLetters + row.addedSeals, 0),
  routesWithTimingObjectives: campaign.filter(row => row.timingTargets > 0).length,
  stages: [[1, 30], [31, 120], [121, 360], [361, 780], [781, 999]].filter(([from]) => from <= CAMPAIGN.length).map(([from, to]) => ({ routes: from + '-' + Math.min(to, CAMPAIGN.length), size: CAMPAIGN[from - 1].width + 'x' + CAMPAIGN[from - 1].width, ...aggregate(campaign.slice(from - 1, to)) })),
  chapters: Array.from({length: Math.ceil(CAMPAIGN.length / PER_CHAPTER)}, (_, index) => {
    const rows = campaign.slice(index * PER_CHAPTER, index * PER_CHAPTER + PER_CHAPTER), old = rows.filter(row => row.oldTurns !== null);
    return { chapter: index + 1, size: CAMPAIGN[index * PER_CHAPTER].width, ...aggregate(rows), oldMeanTurns: old.length ? average(old.map(row => row.oldTurns)) : null, oldMeanReserve: old.length ? average(old.map(row => row.oldReserve)) : null };
  }),

}, null, 2));
