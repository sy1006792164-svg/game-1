'use strict';

const { CAMPAIGN } = require('./levels');
const { campaignRecord } = require('./campaign-progress');

// Existing campaign progress is sufficient for the native friend leaderboard.
// Ignore archived modes and unknown levels; retries retain each local best.
function campaignScore(profile, userInfo) {
  const result = { stars: 0, completed: 0, turns: 0,
    name: userInfo && typeof userInfo.nickName === 'string' ? userInfo.nickName : '我',
    avatarUrl: userInfo && typeof userInfo.avatarUrl === 'string' ? userInfo.avatarUrl : '' };
  CAMPAIGN.forEach(level => {
    const record = campaignRecord(profile, level.id);
    if (!record) return;
    result.stars += record.stars; result.completed++; result.turns += record.bestTurns;
  });
  return result;
}

module.exports = { campaignScore };
