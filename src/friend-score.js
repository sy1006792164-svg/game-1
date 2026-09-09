'use strict';

const { CAMPAIGN } = require('./levels');

// Existing campaign progress is sufficient for the native friend leaderboard.
// Ignore archived modes and unknown levels; retries retain each local best.
function campaignScore(profile, userInfo) {
  const completed = profile && profile.completed || {};
  const result = { stars: 0, completed: 0, turns: 0,
    name: userInfo && typeof userInfo.nickName === 'string' ? userInfo.nickName : '我',
    avatarUrl: userInfo && typeof userInfo.avatarUrl === 'string' ? userInfo.avatarUrl : '' };
  CAMPAIGN.forEach(level => {
    if (!Object.prototype.hasOwnProperty.call(completed, level.id)) return;
    const record = completed[level.id];
    if (!record || !Number.isInteger(record.stars) || record.stars < 1 || record.stars > 3 ||
        !Number.isInteger(record.bestTurns) || record.bestTurns < 1 || record.bestTurns > 100000) return;
    result.stars += record.stars; result.completed++; result.turns += record.bestTurns;
  });
  return result;
}

module.exports = { campaignScore };
