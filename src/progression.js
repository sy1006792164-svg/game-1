'use strict';

const { CAMPAIGN } = require('./levels');

const STAMPS = [
  ['第一缕风', 1], ['三拍之后', 3], ['纸翼初展', 6], ['苔阶来信', 12],
  ['巷口微光', 18], ['随风远行', 24], ['林间回响', 30], ['不迷路的月', 40],
  ['星光邮戳', 50], ['长长的回廊', 65], ['满天风笺', 80],
];
const RANKS = [
  ['见习送信人', 0], ['纸翼新手', 12], ['巷间信使', 30], ['回廊旅人', 60],
  ['追风邮差', 90], ['星夜领航员', 120], ['风笺大师', 180],
];
const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function table(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function validScore(value) {
  return value && Number.isInteger(value.stars) && value.stars >= 1 && value.stars <= 3 &&
    Number.isInteger(value.bestTurns) && value.bestTurns >= 0 && value.bestTurns <= 100000;
}
function hasWin(records, id) { return own(records, id) && validScore(records[id]); }

function calendarDate(dateKey) {
  if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    const date = new Date(dateKey + 'T12:00:00Z');
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey) return date;
  }
  // A fixed fallback keeps this selector pure even for an incomplete caller.
  return new Date('1970-01-01T12:00:00Z');
}

function getProgress(profile, dateKey) {
  const data = profile || {};
  const completed = table(data.completed), expert = table(data.expert), daily = table(data.daily);
  const passed = CAMPAIGN.filter(level => hasWin(completed, String(level.id)));
  const expertPassed = CAMPAIGN.filter(level => hasWin(expert, String(level.id)));
  const stars = passed.reduce((sum, level) => sum + completed[String(level.id)].stars, 0);
  const totalCompleted = passed.length, expertCompleted = expertPassed.length;
  const points = stars + expertCompleted * 3;
  let rankIndex = 0;
  while (rankIndex + 1 < RANKS.length && points >= RANKS[rankIndex + 1][1]) rankIndex += 1;
  const nextRank = RANKS[rankIndex + 1];
  const rank = {
    name: RANKS[rankIndex][0], level: rankIndex + 1,
    current: nextRank ? points - RANKS[rankIndex][1] : 1,
    target: nextRank ? nextRank[1] - RANKS[rankIndex][1] : 1,
    nextName: nextRank ? nextRank[0] : null,
  };
  const stamp = STAMPS.find(item => stars < item[1]);
  const nextStamp = stamp ? { name: stamp[0], current: stars, target: stamp[1] } : null;

  // dateKey is already the player's local calendar day. UTC arithmetic avoids
  // both UTC-to-local date shifts and 23/25-hour days around DST changes.
  const today = calendarDate(dateKey), todayKey = today.toISOString().slice(0, 10);
  const monday = new Date(today.getTime());
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const days = DAY_LABELS.map((label, index) => {
    const date = new Date(monday.getTime());
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { dateKey: key, label, done: key <= todayKey && hasWin(daily, key), today: key === todayKey };
  });
  const weekly = { count: days.filter(day => day.done).length, target: 3, days };

  const nextLevel = CAMPAIGN.find(level => !hasWin(completed, String(level.id)));
  const refineLevel = passed.find(level => completed[String(level.id)].stars < 3);
  const expertLevel = totalCompleted >= 3 ? passed.find(level => !hasWin(expert, String(level.id))) : null;
  const fullStars = passed.filter(level => completed[String(level.id)].stars === 3).length;
  const goals = [];
  if (nextLevel) goals.push({
    title: '寄出下一封信', detail: '第 ' + nextLevel.id + ' 封 · ' + nextLevel.title,
    current: totalCompleted, target: CAMPAIGN.length, complete: false, action: 'campaign',
  });
  goals.push({
    title: hasWin(daily, todayKey) ? '今日风笺已送达' : '完成今日风笺',
    detail: weekly.count >= weekly.target ? '本周已投递 ' + weekly.count + ' 天，目标已达成' : '本周任选 3 天投递，已完成 ' + weekly.count + ' 天',
    current: hasWin(daily, todayKey) ? 1 : 0, target: 1, complete: hasWin(daily, todayKey), action: 'daily',
  });
  const refinement = refineLevel ? {
    title: '把一封信送到三星', detail: '第 ' + refineLevel.id + ' 封 · ' + refineLevel.title,
    current: fullStars, target: totalCompleted, complete: false, action: 'stars',
  } : null;
  const expertise = expertLevel ? {
    title: expertCompleted ? '再征服一封高手来信' : '挑战第一封高手来信',
    detail: '第 ' + expertLevel.id + ' 封 · ' + expertLevel.title,
    current: expertCompleted, target: totalCompleted, complete: false, action: 'expert',
  } : null;
  // Introduce the new challenge at unlock, then alternate toward unclaimed
  // stars. All goals are optional, derived from progress, and never expire.
  const optional = expertise && !expertCompleted ? [expertise, refinement] : [refinement, expertise];
  optional.forEach(goal => { if (goal && goals.length < 3) goals.push(goal); });
  if (!nextLevel && !refinement && !expertise) goals.push({
    title: '风笺全路线精通', detail: '全部主线三星与高手来信已收集',
    current: CAMPAIGN.length, target: CAMPAIGN.length, complete: true, action: 'expert',
  });

  return { stars, totalCompleted, expertCompleted, rank, nextStamp, weekly, goals };
}

module.exports = { getProgress };
