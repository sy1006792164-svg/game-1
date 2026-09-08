'use strict';

const { CAMPAIGN } = require('./levels');
const { STAMPS } = require('./progression');

// Names and unlock thresholds stay shared with the campaign's progress goals.
const STORIES = [
  ['first-wind', 'leaf', '起点邮局 · 老邮差',
    '第一封信不必走得很快。等回声追上你，再把这阵风送到门前。',
    '信已经收到。你留下的脚步，让这条安静的路有了回声。'],
  ['three-beats', 'echo', '转角人家 · 阿禾',
    '我总在第二个转角等脚步声。能把这封信，连同三拍后的回声一起带来吗？',
    '转角响起了两串脚步。原来等待三拍，也是在和远方同行。'],
  ['paper-wings', 'letter', '岔路邮亭 · 折纸人',
    '纸翼很轻，却也会在岔路迷路。请找一条恰好的路线，让它平稳抵达。',
    '你把每个转弯都折得刚好。这只纸翼，终于学会了回家的方向。'],
  ['moss-letter', 'tree', '苔阶小屋 · 守院人',
    '院里的苔藓又长了一层。我想请你重走回廊，把两封信都送到灯下。',
    '两封信一同抵达，苔阶上没有多余的脚印。今夜的小屋很暖。'],
  ['alley-light', 'lamp', '巷口书店 · 点灯人',
    '书店要打烊了，还有人在等两端的来信。请回望整条巷子，再决定出发的方向。',
    '最后一盏灯熄灭前，来信都已送达。我把这束微光留给你。'],
  ['far-wind', 'wind', '纸桥彼岸 · 旅人',
    '南北的风吹过纸桥。桥只借你一次脚步，请替远行的人留下回家的路。',
    '桥那边的信到了。你借来的那阵风，正替我吹向更远的地方。'],
  ['forest-echo', 'echo', '余光邮舍 · 听风人',
    '今夜的灯火不多，远处还有回声。请把走过的路记在心里，把来信送完。',
    '余光还亮着，信也到了。林间记住了你没有浪费的一步。'],
  ['moon-route', 'moon', '雾巷窗口 · 望月人',
    '雾把熟悉的路藏了起来。我在窗前留了一轮纸月，等你循着回声抵达。',
    '你穿过了雾，也把问候带到了窗前。这轮月从此记得你的邮路。'],
  ['starlight', 'star', '逆风驿站 · 观星人',
    '星图上的线总被风吹乱。请再走一遍这条邮路，替我留下一条清楚的轨迹。',
    '你的路线比星图更清楚。我将它盖成邮戳，留在这片夜色里。'],
  ['long-corridor', 'home', '灯塔尽头 · 守夜人',
    '漫长的回廊仍有人守夜。若你再次路过，请把信带来，让灯塔知道远方平安。',
    '远方平安，回信已寄出。你走过的长廊，今晚每一扇窗都亮着。'],
  ['sky-letters', 'letter', '千折邮局 · 理信员',
    '桌上的风笺折了千次，还缺一条妥帖的邮路。请让最后的回声也准时到达。',
    '千折风笺已一一归位。满天来信里，我认得你留下的这枚金色邮戳。'],
];

const STAMP_CATALOG = Object.freeze(STAMPS.map(([name, target], index) => {
  const [id, icon, sender, letter, reply] = STORIES[index];
  // The first two milestones get distinct routes; all others follow star capacity.
  const levelId = index === 1 ? 2 : Math.ceil(target / 3);
  const level = CAMPAIGN.find(item => item.id === levelId);
  return Object.freeze({ id, name, target, icon, sender, letter, reply, index,
    mode: 'campaign', levelId: level.id, levelTitle: level.title, missionPar: level.par });
}).concat(Object.freeze({
  id: 'daily-greeting', name: '今日的问候', target: 'daily', icon: 'sun', index: STAMPS.length,
  sender: '每日邮局 · 值班邮差',
  letter: '每天都有一封不同的问候。挑一个有空的日子，把今日风笺走到三星，再来拆我的回信。',
  reply: '那天的问候已经完美送达。日历会翻页，这枚金色邮票会一直为你留下。',
  mode: 'daily', levelId: null, levelTitle: null, missionPar: null,
})));

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function records(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function recordStars(table, id) {
  if (!own(table, id)) return 0;
  const record = table[id];
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      !own(record, 'stars') || !own(record, 'bestTurns')) return 0;
  return Number.isInteger(record.stars) && record.stars >= 1 && record.stars <= 3 &&
    Number.isInteger(record.bestTurns) && record.bestTurns >= 0 && record.bestTurns <= 100000 ? record.stars : 0;
}
function validDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = new Date(key + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

function getAlbum(profile, dateKey) {
  const data = profile || {}, completed = records(data.completed), daily = records(data.daily);
  const stars = CAMPAIGN.reduce((sum, level) => sum + recordStars(completed, String(level.id)), 0);
  const hasDate = validDate(dateKey);
  const dailyScores = Object.keys(daily)
    .filter(key => validDate(key) && (!hasDate || key <= dateKey))
    .map(key => recordStars(daily, key)).filter(Boolean);
  const dailyBest = dailyScores.reduce((best, value) => Math.max(best, value), 0);
  const stamps = STAMP_CATALOG.map(stamp => {
    const isDaily = stamp.mode === 'daily';
    const current = isDaily ? dailyScores.length : stars;
    const owned = current >= (isDaily ? 1 : stamp.target);
    const missionCurrent = isDaily ? dailyBest : recordStars(completed, String(stamp.levelId));
    return { ...stamp, current, owned, mastered: owned && missionCurrent === 3,
      missionCurrent, missionTarget: 3,
      missionLabel: isDaily ? '任意一天的每日风笺' : '第 ' + stamp.levelId + ' 封 · ' + stamp.levelTitle,
      condition: isDaily ? '完成一次每日风笺' : '主线累计 ' + stamp.target + ' 星' };
  });
  return {
    stamps,
    ownedCount: stamps.filter(stamp => stamp.owned).length,
    masteredCount: stamps.filter(stamp => stamp.mastered).length,
    next: stamps.find(stamp => !stamp.owned) || null,
    equipped: stamps.find(stamp => stamp.id === data.equippedStamp && stamp.owned) || null,
  };
}

module.exports = { STAMP_CATALOG, getAlbum };
