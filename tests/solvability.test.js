'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { verifyLevel, verifyCampaign } = require('../tools/verify-levels');

test('solvability gate certifies every level with its original difficulty and a replayable route', () => {
  const before = JSON.stringify(CAMPAIGN);
  const report = verifyCampaign();
  assert.deepEqual(report.errors, []);
  assert.equal(report.summary.ok, true);
  assert.equal(report.summary.passed, 999);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.totalTurns, CAMPAIGN.reduce((sum, level) => sum + level.par, 0));
  assert.equal(report.levels.at(-1).id, 999);
  assert.ok(report.levels.every(level => level.stars === 3 && !level.revived && level.minimumPlayingEnergy > 0));
  assert.equal(JSON.stringify(CAMPAIGN), before, 'verification must not adjust maps, budgets or solutions');
});

test('solvability gate rejects corrupt routes, insufficient light and impossible targets', () => {
  for (const [change, expected] of [
    [{ budget: CAMPAIGN[0].budget - 5 }, /light ran out/],
    [{ solution: [] }, /missing winning route/],
    [{ solution: ['teleport'] }, /invalid action/],
    [{ solution: ['up'] }, /blocked action/],
    [{ solution: CAMPAIGN[0].solution.slice(0, -1) }, /does not finish delivery/],
    [{ solution: [...CAMPAIGN[0].solution, 'wait'] }, /already won/],
    [{ letters: [...CAMPAIGN[0].letters, 0] }, /does not finish delivery/],
    [{ seals: [...CAMPAIGN[0].seals, 0] }, /does not finish delivery/],
    [{ par: CAMPAIGN[0].par - 1 }, /three-star target/]
  ]) {
    assert.throws(() => verifyLevel({ ...CAMPAIGN[0], ...change }), expected);
  }
  // A late route is geometrically solvable but cannot afford one extra wait.
  const late = CAMPAIGN[998];
  assert.throws(() => verifyLevel({ ...late, solution: ['wait', ...late.solution] }), /light ran out/);
});

test('solvability gate cannot pass an incomplete campaign or silently skip a broken level', () => {
  assert.equal(verifyCampaign([]).summary.ok, false);
  assert.equal(verifyCampaign(CAMPAIGN.slice(0, -1)).summary.ok, false);
  const broken = CAMPAIGN.map(level => ({ ...level }));
  broken[0].budget = 1;
  broken[997].solution = [];
  broken[998].id = 998;
  const report = verifyCampaign(broken);
  assert.equal(report.summary.ok, false);
  assert.equal(report.summary.failed, 3);
  assert.deepEqual(report.levels.filter(level => level.status === 'failed').map(level => level.id), [1, 998, 998]);
  assert.equal(report.levels[996].status, 'passed', 'audit continues through the last levels after an earlier failure');
});
