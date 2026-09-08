'use strict';

const { DIRECTIONS, neighbor } = require('./engine');

function canGuide(level, mode) {
  return mode === 'campaign' && !!level && level.id === 1;
}

function autoGuide(profile, level, mode) {
  return canGuide(level, mode) && !profile.totalWins && !profile.guideDismissed;
}

// Only the last three actual landing cells can still have an echo on the way.
function pendingSeals(state) {
  const first = Math.max(0, state.turn - 2);
  return state.seals.map(cell => {
    const index = state.history.indexOf(cell, first);
    return { cell, turns: index < 0 ? null : index + 3 - state.turn };
  });
}

function guideVisual(level, state, lesson, pending) {
  // Only point at a tap that lands on its marked tile; wind can carry a tap past it.
  const direct = Object.keys(DIRECTIONS).map(action => {
    const cell = neighbor(level, state.player, action, state);
    if (cell === null) return null;
    const wind = level.winds && level.winds[cell];
    return wind && neighbor(level, cell, wind, state) !== null ? null : cell;
  }).filter(cell => cell !== null);
  let cells, kind;
  if (lesson.step === 1) {
    cells = direct; kind = 'move';
  } else if (state.letters.length) {
    cells = state.letters; kind = 'letter';
  } else if (pending.every(item => item.turns !== null)) {
    cells = [level.exit]; kind = 'home';
  } else {
    cells = pending.filter(item => item.turns === null).map(item => item.cell); kind = 'echo';
  }
  const nearby = cells.find(cell => direct.includes(cell));
  const cell = nearby == null ? cells[0] : nearby;
  const focus = cell == null ? null : { cell, kind };
  const echo = pending.reduce((next, item) => item.turns !== null && (!next || item.turns < next.turns) ? item : next, null);
  return { focus, tapCell: focus && direct.includes(focus.cell) ? focus.cell : null, echo };
}

// Derive the lesson from the route, so undo, retry and resume cannot leave a stale step.
function guideStep(game, now) {
  const l = game.level, s = game.state;
  if (!game.guideEnabled || !canGuide(l, game.mode) || !s || s.status !== 'playing' || game.reviewing) return null;
  const pending = pendingSeals(s), queued = pending.filter(item => item.turns !== null);
  const countdown = queued.length ? Math.min(...queued.map(item => item.turns)) : null;
  const allQueued = pending.length > 0 && queued.length === pending.length;
  const markers = (cells, kind) => cells.map(cell => ({ cell, kind }));
  let lesson;
  if (!s.history.some(cell => cell !== l.start)) {
    const adjacent = Object.keys(DIRECTIONS).map(action => neighbor(l, s.player, action, s)).filter(cell => cell !== null);
    lesson = { step: 1, title: '先迈出一步',
      text: '你是橙衣送信员，点相邻亮格移动。\n移动或等待耗 1 拍；没有倒计时。',
      targets: markers(adjacent, 'move') };
  } else if (s.letters.length) {
    lesson = { step: 2, title: '你收信，回声收票',
      text: '走到橙色信笺格收信。\n' + (!s.seals.length ? '蓝票已由回声收齐，收好信笺再回邮局。' : countdown !== null
        ? '蓝票由回声收取，再行动 ' + countdown + ' 拍就会收起一枚。'
        : '先停在蓝票格，三拍后的回声会替你收票。'),
      targets: [...markers(s.letters, 'letter'), ...markers(s.seals, 'echo')] };
  } else {
    const ready = !s.seals.length;
    lesson = { step: 3, title: ready ? '把信送到邮局' : '和回声一起完成投递',
      text: ready ? '信笺和邮票已收齐。\n走到亮起的邮局，就能完成投递。' : allQueued
        ? (s.player === l.exit ? '已到邮局，点“等一拍”等回声收齐蓝票。' : '向邮局走，回声会沿着你的脚步收蓝票。') + '\n再行动 ' + countdown + ' 拍会收起一枚；等待也会耗拍。'
        : '橙色信笺已齐，先停在剩余蓝票格。\n回声晚三拍到达，收齐后再回邮局。',
      targets: [...markers(s.seals, 'echo'), ...markers(ready || allQueued ? [l.exit] : [], 'home')],
      control: allQueued && s.player === l.exit ? 'wait' : null };
  }
  lesson.visual = guideVisual(l, s, lesson, pending);
  lesson.tip = game.blockedAt != null && now - game.blockedAt < 1400 ? '这边不通，点相邻的亮格试试。'
    : s.energy <= 3 ? '只剩 ' + s.energy + ' 拍，移动和等待都会消耗灯火。'
    : '拖动调整视角；双指或滚轮缩放。';
  return lesson;
}

// Show only the rule that matters at the current point in the real route.
function playHint(game, now) {
  const l = game.level, s = game.state;
  if (!l || !s) return '';
  if (game.reviewing) return game.failureHint();
  if (s.status === 'won') return '信已送达。';
  if (s.status === 'failed') return '灯火已耗尽。' + game.failureHint();
  if (game.blockedAt != null && now - game.blockedAt < 1400) return '这边不通，点亮起的相邻地砖试试。';
  if (!s.letters.length && !s.seals.length) return '收集完成，' + (s.energy <= 3 ? '只剩 ' + s.energy + ' 拍，' : '') + '前往亮起的邮局。';
  const lowLight = s.energy <= 3 ? '只剩 ' + s.energy + ' 拍。' : '';
  const pending = pendingSeals(s);
  const nextEcho = s.turn >= 2 ? s.history[s.turn - 2] : null;
  if (nextEcho != null && s.seals.includes(nextEcho)) return lowLight + '下一步回声会收起蓝票，移动或等一拍都可以。';
  if (!s.letters.length && pending.every(item => item.turns !== null)) {
    return lowLight + (s.player === l.exit ? '已到邮局，等待回声收齐剩余蓝票。' : '蓝票已在回声路上，向邮局走或等一拍。');
  }
  if (lowLight) return lowLight + '移动和等待都会耗灯；留好回邮局的路。';
  if (s.turn === 0) {
    if (l.id <= 3) return '点亮起的相邻地砖移动，先走过蓝票。';
    if ((l.bridges || []).length) return '纸桥离开后就会碎，先想好哪一段只走一次。';
    if (l.lights.length) return '沿路的风灯可以补 3 拍，收信时顺路点亮。';
    if (Object.keys(l.winds).length) return '箭头会再推你一格，留意实际落点。';
    return '收橙色信笺，让晚三拍的回声收蓝票。';
  }
  const queued = pending.filter(item => item.turns !== null);
  if (queued.length) return '你已经过蓝票，再走 ' + Math.min(...queued.map(item => item.turns)) + ' 拍，回声就会到达。';
  if (!s.seals.length) return '蓝票已齐，收好剩余信笺再回邮局。';
  return nextEcho != null ? '蓝色光环是回声下一步的位置。' : '先走过蓝票，再沿路收橙色信笺。';
}

module.exports = { playHint, canGuide, autoGuide, guideStep };
