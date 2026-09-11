'use strict';

const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('./levels');

function campaignRecord(profile, id) {
  const completed = profile && profile.completed;
  if (!completed || typeof completed !== 'object' || Array.isArray(completed) ||
      !Object.prototype.hasOwnProperty.call(completed, id)) return null;
  const record = completed[id];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Number.isInteger(record.stars) && record.stars >= 1 && record.stars <= 3 &&
    Number.isInteger(record.bestTurns) && record.bestTurns >= 1 && record.bestTurns <= 100000 ? record : null;
}

// Derive progress from real campaign routes; archived and unknown IDs cannot count.
// The album caches this result with the store revision, so drawing does not scan 999 saves per frame.
function getCampaignProgress(profile) {
  const chapters = chapterNames.map((name, index) => {
    const levels = CAMPAIGN.slice(index * PER_CHAPTER, (index + 1) * PER_CHAPTER);
    return { index, name, levels, firstId: levels[0].id, lastId: levels[levels.length - 1].id,
      count: levels.length, completedCount: 0, perfectCount: 0, stars: 0, maxStars: levels.length * 3, remainingStars: 0 };
  });
  const progress = { stars: 0, completedCount: 0, perfectCount: 0, replayLevels: [], chapters };
  for (const level of CAMPAIGN) {
    const record = campaignRecord(profile, String(level.id));
    if (!record) continue;
    const chapter = chapters[level.chapter];
    chapter.completedCount++; chapter.stars += record.stars;
    progress.completedCount++; progress.stars += record.stars;
    if (record.stars === 3) { chapter.perfectCount++; progress.perfectCount++; }
    else progress.replayLevels.push(level);
  }
  for (const chapter of chapters) chapter.remainingStars = chapter.maxStars - chapter.stars;
  return progress;
}

module.exports = { campaignRecord, getCampaignProgress };
