'use strict';

const { step } = require('./engine');
const { guideRoute } = require('./guide-route');

function canGuide(level, mode) {
  return mode === 'campaign' && !!level && level.id === 1;
}

function autoGuide(profile, level, mode) {
  return canGuide(level, mode) && !profile.completed['1'] && !profile.guideDismissed;
}

// Only the last three actual landing cells can still have an echo on the way.
function pendingSeals(state) {
  const first = Math.max(0, state.turn - 2);
  return state.seals.map(cell => {
    const index = state.history.indexOf(cell, first);
    return { cell, turns: index < 0 ? null : index + 3 - state.turn };
  });
}

// Derive the lesson from the route, so undo, retry and resume cannot leave a stale step.
function guideStep(game, now) {
  const l = game.level, s = game.state;
  if (!game.guideEnabled || !canGuide(l, game.mode) || !s || s.status !== 'playing' || game.reviewing) return null;
  const pending = pendingSeals(s);
  const echo = pending.reduce((next, item) => item.turns !== null && (!next || item.turns < next.turns) ? item : next, null);
  const route = guideRoute(l, s), action = route && route[0];
  const next = action ? step(l, s, action) : null;
  const first = !s.history.some(cell => cell !== l.start);
  const collecting = next && next.events.some(event => event.type === 'letter');
  const cell = next ? next.state.player : null;
  const kind = cell === l.exit ? 'home' : collecting ? 'letter' : s.seals.includes(cell) ? 'echo' : 'move';
  const focus = cell === null || action === 'wait' ? null : { cell, kind };
  const lesson = {
    step: first ? 1 : !s.letters.length ? 4 : collecting ? 3 : 2,
    total: 4, action: action || null, control: action === 'wait' ? 'wait' : null,
    visual: { focus, tapCell: focus ? cell : null, echo, player: s.player,
      label: kind === 'home' ? '点邮局' : collecting ? '点信封' : '点这里' },
    tip: '每次行动扣 1 拍，不操作不扣拍。'
  };
  if (!action) {
    lesson.control = game.canUndo() ? 'undo' : 'restart';
    lesson.title = lesson.control === 'undo' ? '拍数不够，先撤回' : '拍数不够，重新开始';
    lesson.text = lesson.control === 'undo' ? '点下方“撤回”，找回上一步的拍数。' : '点下方“重新学一遍”，从起点跟着走。';
    lesson.tip = '重新开始不影响已有通关成绩。';
    return lesson;
  }
  if (first) {
    lesson.title = '点亮格，走出第一步';
    lesson.text = '点手指指向的格子，送信员就会走过去。';
  } else if (action === 'wait') {
    lesson.title = '等一拍，让回声跟上';
    lesson.text = '点下方“等一拍”，等回声收齐蓝票。';
    lesson.tip = '等待也算行动，会让回声继续走。';
  } else if (next.state.status === 'won') {
    lesson.title = '点邮局，完成投递';
    lesson.text = s.seals.length ? '信已收好，走进邮局时回声会收齐蓝票。'
      : '信和蓝票已收齐，走进邮局就能过关。';
  } else if (collecting) {
    lesson.title = '点信封，把信收好';
    lesson.text = '走到橙色信封所在格，就会自动收信。';
  } else if (echo) {
    lesson.title = '继续走，让回声跟上';
    lesson.text = s.seals.includes(s.player) ? '蓝票由回声收取，它会晚你 3 次行动。' : '沿亮格继续前进，蓝票交给回声。';
    lesson.tip = '回声晚 3 次行动，沿你的脚印前进。';
  } else if (s.seals.length) {
    lesson.title = kind === 'echo' ? '点蓝票格，留下脚印' : '沿亮格走，先经过蓝票';
    lesson.text = '先走过蓝票格，回声晚 3 次行动来收票。';
  } else {
    lesson.title = s.letters.length ? '沿亮格走，去收信' : '沿亮格走回邮局';
    lesson.text = s.letters.length ? '蓝票已收好，跟着手指去拿橙色信封。'
      : '信和蓝票已收齐，跟着手指走回邮局。';
  }
  if (game.blockedAt != null && now - game.blockedAt < 1400) lesson.tip = '跟着手指走；点“跳过”可自由操作。';
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
  const unvisited = pending.filter(item => item.turns === null);
  if (s.player === l.exit) {
    if (s.letters.length) return lowLight + '已到邮局，还差 ' + s.letters.length + ' 封信；收齐信和蓝票后回来投递。';
    if (unvisited.length) return lowLight + '已到邮局，还有 ' + unvisited.length + ' 枚蓝票尚未经过；先走上蓝票格，再回来投递。';
    const turns = Math.max(...pending.map(item => item.turns));
    return lowLight + (s.energy >= turns
      ? '已到邮局，再等 ' + turns + ' 拍，回声就会收齐蓝票。'
      : '已到邮局，回声还需 ' + turns + ' 拍；当前拍数不够原地等齐。');
  }
  const nextEcho = s.turn >= 2 ? s.history[s.turn - 2] : null;
  if (nextEcho != null && s.seals.includes(nextEcho)) return lowLight + '下一步回声会收起蓝票，' + (s.letters.length ? '沿路收好剩余信笺。' : '继续前往邮局。');
  if (!s.letters.length && !unvisited.length) {
    return lowLight + '蓝票已在回声路上，不用折返，继续向邮局走。';
  }
  if (lowLight) return lowLight + '移动和等待都会耗灯；留好回邮局的路。';
  if (s.turn === 0) {
    if (l.id <= 3) return '点亮起的相邻地砖移动，先走过蓝票。';
    if (game.mode === 'campaign' && l.id >= 301) return l.lights.length
      ? '没有富余拍数，纸桥离开就碎，先排好路线。'
      : '没有灯火补给，也没有富余拍数。先排好整条邮路。';
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
