'use strict';

const { drawBoard } = require('./scene');
const { C } = require('./theme');

function drawObjectives(r, game, now) {
  const l = game.level, s = game.state, low = s.status === 'playing' && s.energy <= 3;
  r.panel(24, 81, 342, 62, { fill: '#123237', stroke: '#365854', radius: 14 });
  const objectives = [
    { label: '剩余拍数', value: s.energy + ' 拍', color: low || s.status === 'failed' ? '#ffc18b' : C.white },
    { label: '信笺', value: (l.letters.length - s.letters.length) + ' / ' + l.letters.length, color: !s.letters.length ? C.green : C.ink },
    { label: '回声邮票', value: (l.seals.length - s.seals.length) + ' / ' + l.seals.length, color: !s.seals.length ? C.green : C.ink }
  ];
  objectives.forEach((objective, index) => {
    const x = 24 + index * 114;
    if (index) r.line([[x, 94], [x, 130]], '#365854', 1);
    r.text(objective.label, x + 57, 97, 11, C.muted, 'center');
    r.label(objective.value, x + 57, 120, 92, 19, objective.color, 'center', '600');
  });
  if (low && !game.modal && !game.busy) {
    r.ctx.save(); r.ctx.globalAlpha *= .25 + (Math.sin(now / 380) + 1) * .12;
    r.round(29, 86, 104, 52, 11, null, '#ffb879'); r.ctx.restore();
  }
}

function controlLayout(r, game) {
  const hintLines = r.wrapLines(game.playHint(), 310, 12), buttonY = r.H - 92;
  const hintHeight = Math.max(44, hintLines.length * 18 + 14);
  return { buttonY, hintY: buttonY - hintHeight - 16, hintHeight, hintLines };
}

function drawControls(r, game, layout) {
  const { buttonY, hintY, hintHeight, hintLines } = layout;
  const warning = game.state.status === 'failed' || game.state.energy <= 3;
  r.round(24, hintY, 342, hintHeight, 12, C.dark, warning ? '#72614b' : '#365854');
  const textY = hintY + hintHeight / 2 - (hintLines.length - 1) * 9;
  hintLines.forEach((line, index) => r.text(line, 195, textY + index * 18, 12, warning ? C.gold : C.muted, 'center'));
  if (game.reviewing) {
    r.button('重新规划', 24, buttonY, 165, 52, () => game.start(game.level, game.mode), 'primary');
    r.button('返回结果', 201, buttonY, 165, 52, () => game.failure());
    return;
  }
  const canUndo = game.canUndo(), remaining = game.undoLeft();
  const canAct = game.state.status === 'playing' && !game.modal && !game.busy;
  r.button('撤回（' + remaining + '）', 24, buttonY, 165, 52, () => game.undo(), { style: 'secondary', disabled: !canUndo });
  r.button('等一拍', 201, buttonY, 165, 52, () => game.act('wait'), { style: 'secondary', disabled: !canAct });
}

function drawGame(r, game, now) {
  const layout = controlLayout(r, game);
  r.label(game.level.title, 24, game.reviewing ? 32 : 40, 254, 25, C.ink, 'left', '600');
  if (game.reviewing) r.text('路线回顾 · 可拖动查看', 24, 60, 11, C.muted);
  r.button(game.reviewing ? '结果' : '暂停', 294, 18, 72, 44, () => game.pause(), {
    style: 'secondary', disabled: !!game.modal || game.busy || (!game.reviewing && game.state.status !== 'playing')
  });
  drawObjectives(r, game, now);
  drawBoard(r, game, now, { x: 16, y: 158, w: 358, h: layout.hintY - 170 });
  drawControls(r, game, layout);
}

module.exports = { drawGame };
