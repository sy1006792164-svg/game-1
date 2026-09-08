'use strict';

// A complete legal winning route proves solvability. Replay every action with
// the shipped engine and starting light; never search with an enlarged budget,
// revive, repair a map, or silently skip a blocked action to make a route pass.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS, createState, step, stars } = require('../src/engine');

const ENCODE = { up: 'U', down: 'D', left: 'L', right: 'R', wait: 'W' };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function verifyLevel(level) {
  const check = (ok, message) => assert.ok(ok, `Level ${level.id}: ${message}`);
  check(Number.isInteger(level.budget) && level.budget > 0, 'invalid starting light');
  check(Number.isInteger(level.par) && level.par > 0, 'invalid three-star target');
  check(Array.isArray(level.solution) && level.solution.length > 0, 'missing winning route');
  let state = createState(level);
  let minimumPlayingEnergy = state.energy;
  const events = { wind: 0, light: 0, bridge: 0, letter: 0, seal: 0, wait: 0 };
  for (const [index, action] of level.solution.entries()) {
    const label = `step ${index + 1} (${action})`;
    check(ACTIONS.includes(action), `${label}: invalid action`);
    check(state.status === 'playing' && state.energy > 0, `${label}: route already ${state.status}`);
    const result = step(level, state, action);
    check(result.moved, `${label}: blocked action`);
    check(result.state.turn === index + 1, `${label}: turn did not advance exactly once`);
    for (const event of result.events) {
      if (Object.prototype.hasOwnProperty.call(events, event.type)) events[event.type]++;
    }
    state = result.state;
    check(!state.revived, `${label}: revival is required`);
    check(state.status !== 'failed', `${label}: light ran out before delivery`);
    check(state.energy >= 0, `${label}: negative light`);
    if (state.status === 'playing') minimumPlayingEnergy = Math.min(minimumPlayingEnergy, state.energy);
  }
  check(state.status === 'won', 'route does not finish delivery');
  check(state.player === level.exit && !state.letters.length && !state.seals.length, 'delivery is incomplete');
  check(state.turn === level.par && stars(level, state) === 3, 'route does not meet the three-star target');
  check(!state.lights.length, 'route skips a budgeted lamp');
  return {
    id: level.id, title: level.title, status: 'passed',
    width: level.width, height: level.height, budget: level.budget, par: level.par, undo: level.undo,
    turns: state.turn, remainingEnergy: state.energy, minimumPlayingEnergy,
    stars: stars(level, state), revived: state.revived,
    lettersRemaining: state.letters.length, sealsRemaining: state.seals.length,
    events, solution: level.solution.map(action => ENCODE[action]).join(''),
    levelSha256: digest(JSON.stringify(level))
  };
}

function verifyCampaign(levels = require('../src/levels').CAMPAIGN) {
  const errors = [];
  if (levels.length !== 999) errors.push(`Expected all 999 levels, received ${levels.length}`);
  const campaignSha256 = digest(JSON.stringify(levels));
  const results = levels.map((level, index) => {
    try {
      assert.equal(level.id, index + 1, 'Campaign IDs must be consecutive');
      return verifyLevel(level);
    } catch (error) {
      return { id: level.id, title: level.title, status: 'failed', error: error.message };
    }
  });
  if (digest(JSON.stringify(levels)) !== campaignSha256) errors.push('Verification mutated campaign data');
  const passed = results.filter(result => result.status === 'passed');
  return {
    method: 'Every stored winning route replayed through the real engine with its original budget',
    campaignSha256,
    summary: {
      total: levels.length, passed: passed.length, failed: results.length - passed.length,
      totalTurns: passed.reduce((sum, result) => sum + result.turns, 0),
      zeroEnergyWins: passed.filter(result => result.remainingEnergy === 0).length,
      ok: !errors.length && passed.length === levels.length
    },
    errors, levels: results
  };
}

function assertCampaignSolvable() {
  const report = verifyCampaign();
  if (!report.summary.ok) {
    const failures = report.levels.filter(level => level.status === 'failed').map(level => level.error);
    throw new Error('Campaign solvability verification failed:\n' + report.errors.concat(failures).join('\n'));
  }
  return report;
}

module.exports = { verifyLevel, verifyCampaign, assertCampaignSolvable };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'work', 'solvability-report.json');
  const report = verifyCampaign();
  report.verifiedAt = new Date().toISOString();
  report.sourceSha256 = Object.fromEntries(['src/engine.js', 'src/levels.js', 'src/levels-extra.js'].map(file =>
    [file, digest(fs.readFileSync(path.join(root, file)))]));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  for (const error of report.errors) console.error(error);
  for (const level of report.levels.filter(level => level.status === 'failed')) console.error(level.error);
  console.log(`${report.summary.ok ? 'PASS' : 'FAIL'} ${report.summary.passed}/${report.summary.total} levels; ` +
    `${report.summary.totalTurns} legal turns; no revival; original difficulty. Report: ${output}`);
  if (!report.summary.ok) process.exitCode = 1;
}
