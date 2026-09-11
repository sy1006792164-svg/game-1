'use strict';

const { STAR_TWO_MARGIN } = require('./engine');

function deliveryResultLines(level, state, rating, before, saved) {
  const saveLine = saved ? '本次纪录已保存。' : '本次纪录仅在本次运行保留。';
  let delivery = state.turn + ' 拍完成' + (state.revived ? ' · 续灯 ' + state.reviveCount + ' 次' : '');
  if (before && rating > before.stars) delivery += ' · 星光 +' + (rating - before.stars);
  else if (before && rating < before.stars) delivery += ' · 已保留最佳 ' + before.stars + ' 星';
  let best = saveLine;
  if (before) {
    best = state.turn < before.bestTurns ? '刷新纪录，比原纪录少走 ' + (before.bestTurns - state.turn) + ' 拍。'
      : state.turn === before.bestTurns ? '追平个人最佳 · ' + before.bestTurns + ' 拍'
        : '个人最佳 ' + before.bestTurns + ' 拍 · 本次多走 ' + (state.turn - before.bestTurns) + ' 拍';
  }
  const lines = [delivery, best];
  if (state.revived) {
    const two = level.par + STAR_TWO_MARGIN;
    lines.push(rating === 2 ? '总拍数在 ' + two + ' 拍内，续灯后本次获二星。'
      : '总拍数超过 ' + two + ' 拍，本次获一星。');
  }
  if (before && !saved) lines.push(saveLine);
  return lines;
}

module.exports = { deliveryResultLines };
