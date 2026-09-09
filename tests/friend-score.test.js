'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignScore } = require('../src/friend-score');
const { CAMPAIGN } = require('../src/levels');

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
