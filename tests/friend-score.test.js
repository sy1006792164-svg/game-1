'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignScore } = require('../src/friend-score');
const { CAMPAIGN } = require('../src/levels');
const { getCampaignProgress } = require('../src/campaign-progress');

test('friend totals include existing local campaign bests and exclude other modes and malformed records', () => {
  const progress = { completed: { 1: { stars: 3, bestTurns: 4 }, 2: { stars: 2, bestTurns: 6 },
    3: { stars: 4, bestTurns: 5 }, 4: { stars: 3, bestTurns: -1 }, 1000: { stars: 3, bestTurns: 1 } },
    daily: { '2026-09-09': { stars: 3, bestTurns: 1 } }, totalWins: 99 };
  assert.deepEqual(campaignScore(progress, { nickName: '邮差甲', avatarUrl: 'https://thirdwx.qlogo.cn/a' }),
    { stars: 5, completed: 2, turns: 10, name: '邮差甲', avatarUrl: 'https://thirdwx.qlogo.cn/a' });
});

test('all 999 native campaign bests fit the friend score and an empty save never invents a rank', () => {
  const completed = Object.fromEntries(CAMPAIGN.map(level => [level.id, { stars: 3, bestTurns: level.solution.length }]));
  assert.deepEqual(campaignScore({ completed }), { stars: 2997, completed: 999, turns: 59240, name: '我', avatarUrl: '' });
  assert.equal(campaignScore(null).completed, 0);
  assert.equal(campaignScore({ completed: Object.create({ 1: { stars: 3, bestTurns: 4 } }) }).completed, 0);
});

test('campaign summaries and ranking reject the same malformed score containers and zero-turn wins', () => {
  const valid = { stars: 3, bestTurns: CAMPAIGN[0].par };
  const arrayRecord = Object.assign([], valid), arrayCompleted = [];
  arrayCompleted[1] = valid;
  const cases = [null, { completed: null }, { completed: 'invalid' },
    { completed: arrayCompleted }, { completed: { 1: arrayRecord } },
    { completed: Object.create({ 1: valid }) },
    { completed: { 1: { stars: 3, bestTurns: 0 } } },
    { completed: { 1: { stars: 3, bestTurns: 1.5 } } },
    { completed: { 1: { stars: 3, bestTurns: 100001 } } },
    { completed: { 1: valid, 2: { stars: 3, bestTurns: 0 }, 1000: valid },
      daily: { '2026-09-07': valid } }];
  for (const profile of cases) {
    const ranking = campaignScore(profile), progress = getCampaignProgress(profile);
    assert.equal(ranking.stars, progress.stars);
    assert.equal(ranking.completed, progress.completedCount);
    const expected = profile === cases[cases.length - 1] ? 1 : 0;
    assert.equal(ranking.completed, expected);
    assert.equal(ranking.turns, expected * valid.bestTurns);
  }
});
