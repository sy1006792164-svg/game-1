'use strict';

const { getCampaignProgress } = require('./campaign-progress');

// Twenty-three keepsakes, earned only through campaign stars.
const STAMPS = Object.freeze([
  ['first-wind', '第一缕风', 1, 'leaf'], ['three-beats', '三拍之后', 3, 'echo'], ['paper-wings', '纸翼初展', 9, 'letter'],
  ['moss-letter', '苔阶来信', 18, 'tree'], ['alley-light', '巷口微光', 30, 'lamp'], ['far-wind', '随风远行', 48, 'wind'],
  ['forest-echo', '林间回响', 72, 'echo'], ['moon-route', '不迷路的月', 100, 'moon'], ['starlight', '星光邮戳', 135, 'star'],
  ['long-corridor', '长长的回廊', 175, 'home'], ['sky-letters', '满天风笺', 220, 'letter'], ['paper-bridge', '纸桥渡口', 280, 'bridge'],
  ['snow-line', '雪线邮差', 350, 'star'], ['tide-echo', '潮汐回声', 430, 'echo'], ['thousand-turns', '千折回廊', 520, 'home'],
  ['dark-alley', '暗巷灯语', 620, 'lamp'], ['wind-eye', '风眼之中', 730, 'wind'], ['star-sea', '星海长路', 850, 'moon'],
  ['lone-island', '孤岛邮局', 980, 'tree'], ['frost-night', '霜夜远信', 1120, 'letter'], ['old-town', '旧城重游', 1270, 'leaf'],
  ['lamp-river', '灯河渡口', 1430, 'bridge'], ['final-letter', '寄往终章', 1600, 'star'],
].map(([id, name, target, icon], index) => Object.freeze({ id, name, target, icon, index })));

function getAlbum(profile) {
  const progress = getCampaignProgress(profile), stars = progress.stars;
  const stamps = STAMPS.map(stamp => {
    const current = stars, goal = stamp.target;
    const previousGoal = stamp.index ? STAMPS[stamp.index - 1].target : 0;
    const stageGoal = goal - previousGoal, stageCurrent = Math.max(0, Math.min(stageGoal, current - previousGoal));
    return { ...stamp, current, goal, previousGoal, stageGoal, stageCurrent, remaining: Math.max(0, goal - current),
      owned: current >= goal, condition: '主线累计 ' + stamp.target + ' 星' };
  });
  return { stars, progress, stamps, ownedCount: stamps.filter(stamp => stamp.owned).length,
    next: stamps.find(stamp => !stamp.owned) || null, mainCount: STAMPS.length };
}

module.exports = { STAMPS, getAlbum };
