'use strict';

const { CAMPAIGN } = require('./levels');
const { ACTIONS } = require('./engine');
const goalCache = new WeakMap();

function homeGoal(game) {
  const saved = game.savedRun(), album = game.album(), progress = album.progress;
  const cached = goalCache.get(game);
  if (cached && cached.saved === saved && cached.album === album) return cached.goal;
  const active = saved && CAMPAIGN.find(level => level.id === Number(saved.levelId));
  const level = active || game.nextLevel(), chapter = progress.chapters[level.chapter];
  const finished = progress.completedCount === CAMPAIGN.length;
  const recordedTurns = active && Array.isArray(saved.actions) ? saved.actions.filter(action => ACTIONS.includes(action)).length : 0;
  const goal = { level, chapter, album, active: !!active, recordedTurns, finished,
    title: active ? '继续送信' : finished ? '重温邮路' : progress.completedCount ? '继续送信' : '开始送信',
    detail: '第 ' + String(level.id).padStart(3, '0') + ' 封 · ' + level.title,
    chapterLabel: '第 ' + (chapter.index + 1) + ' 章 · ' + chapter.name,
    chapterDetail: chapter.completedCount === chapter.count ? '本章已送达 · ' + chapter.stars + '/' + chapter.maxStars + ' 星' :
      '已送达 ' + chapter.completedCount + '/' + chapter.count + ' 封 · 再送 ' + (chapter.count - chapter.completedCount) + ' 封完成本章',
    stampDetail: album.next ? '再收 ' + album.next.remaining + ' 星，收藏「' + album.next.name + '」' : '旅程邮票已集齐 · ' + album.stars + ' 星光' };
  goalCache.set(game, { saved, album, goal });
  return goal;
}

function nextDeliveryGoal(level, state, rating, album) {
  if (rating < 3) {
    if (state.revived || state.itemsUsed > 0)
      return '摘三星：不用道具或续灯，' + level.par + ' 拍内送达。';
    return '摘三星：下次少走 ' + Math.max(1, state.turn - level.par) + ' 拍，目标 ' + level.par + ' 拍。';
  }
  return album.next ? '再收 ' + album.next.remaining + ' 星，收藏「' + album.next.name + '」。' : '全部旅程邮票已收藏，继续挑战全关三星。';
}

module.exports = { homeGoal, nextDeliveryGoal };
