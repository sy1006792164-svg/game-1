'use strict';

// Independent difficulty audit. Run `node tools/difficulty-qa.js [daily-count]`.
// Defaults to 1,000 days, with an engine-based BFS separate from levels.js.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { CAMPAIGN, getDaily, CONTENT_VERSION, PER_CHAPTER } = require('../src/levels');
const { createState, step } = require('../src/engine');
const { solve } = require('./solve');

// Release 1 snapshot for the hand-made routes: [shortest witness turns, starting light, remaining light].
// Generated routes (31+) have no release-1 counterpart and report null there.
const BASELINE = [[4,8,4],[6,10,4],[9,15,6],[12,20,8],[7,12,5],[10,16,6],[18,25,7],[17,23,6],[22,30,8],[17,23,6],[23,32,9],[22,30,8],[9,13,4],[18,25,7],[21,29,8],[18,25,7],[21,29,8],[23,32,9],[20,27,10],[19,26,10],[18,25,7],[19,26,10],[22,30,11],[22,30,11],[21,29,11],[21,29,11],[26,36,13],[23,32,12],[22,30,14],[25,34,12]];

function audit(level) {
  assert.equal(level.revision, CONTENT_VERSION);
  const shortest = solve(level);
  assert.ok(shortest, `${level.id}: reference solver found no route`);
  assert.equal(shortest.length, level.par, `${level.id}: par is not the true minimum`);
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
  assert.deepEqual(state.bridges, [], `${level.id}: every paper bridge is used by the witness`);
  return { turns: state.turn, budget: level.budget, reserve: state.energy, bridges: level.bridges.length };
}

const campaign = CAMPAIGN.map((level, index) => {
  const result = audit(level);
  const [oldTurns, oldBudget, oldReserve] = BASELINE[index] || [null, null, null];
  return { id: level.id, oldTurns, ...result, oldBudget, oldReserve };
});
const dailyCount = process.argv[2] === undefined ? 1000 : Number(process.argv[2]);
assert.ok(Number.isInteger(dailyCount) && dailyCount > 0 && dailyCount <= 10000, 'daily-count must be an integer from 1 to 10000');
const generationMs = [];
const dailyResults = [];
const signatures = new Set();
const began = performance.now();
for (let index = 0; index < dailyCount; index++) {
  const key = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
  const started = performance.now();
  const level = getDaily(key);
  generationMs.push(performance.now() - started);
  assert.deepEqual(getDaily(key), level, `${key}: generation is not deterministic`);
  assert.equal(level.letters.length, 3);
  assert.equal(level.seals.length, 3);
  signatures.add(JSON.stringify([level.walls, level.start, level.exit, level.letters, level.seals, level.winds]));
  const result = audit(level);
  assert.ok(result.reserve >= 1 && result.reserve <= 3, `${key}: unexpected reserve ${result.reserve}`);
  dailyResults.push(result);
}
assert.equal(signatures.size, dailyCount, 'duplicate daily map');
const average = values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100;
const aggregate = rows => ({ minTurns: Math.min(...rows.map(row => row.turns)), maxTurns: Math.max(...rows.map(row => row.turns)), meanTurns: average(rows.map(row => row.turns)), meanBudget: average(rows.map(row => row.budget)), meanReserve: average(rows.map(row => row.reserve)) });
generationMs.sort((a,b) => a-b);
console.log(JSON.stringify({
  contentVersion: CONTENT_VERSION,
  campaign,
  chapters: Array.from({length: CAMPAIGN.length / PER_CHAPTER}, (_, index) => {
    const rows = campaign.slice(index * PER_CHAPTER, index * PER_CHAPTER + PER_CHAPTER), old = rows.filter(row => row.oldTurns !== null);
    return { chapter: index + 1, size: CAMPAIGN[index * PER_CHAPTER].width, ...aggregate(rows), oldMeanTurns: old.length ? average(old.map(row => row.oldTurns)) : null, oldMeanReserve: old.length ? average(old.map(row => row.oldReserve)) : null };
  }),
  daily: { count: dailyCount, unique: signatures.size, independentMinimumVerified: dailyCount, ...aggregate(dailyResults), generationMeanMs: average(generationMs), generationP95Ms: Math.round(generationMs[Math.floor((generationMs.length - 1) * 0.95)] * 100) / 100, generationMaxMs: Math.round(generationMs[generationMs.length - 1] * 100) / 100, auditSeconds: Math.round((performance.now() - began) / 10) / 100 }
}, null, 2));
