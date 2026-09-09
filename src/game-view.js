'use strict';

const { drawBoard } = require('./scene');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { guideCardLayout, drawGuideCard } = require('./guide-view');
const { drawGuideOverlay, drawGuideWait } = require('./guide-effects');
const { canGuide } = require('./play-guide');

function drawObjectives(r, game, now) {
  const l = game.level, s = game.state, low = s.status === 'playing' && s.energy <= 3;
  const previous = game.previousState, age = Math.max(0, now - game.transitionAt);
  const reduced = r.reducedMotion;
  r.panel(24, 81, 342, 62, { fill: '#123237', stroke: '#365854', radius: 14 });
  const objectives = [
    { label: '剩余拍数', value: s.energy + ' 拍', changed: previous && previous.energy !== s.energy, color: low || s.status === 'failed' ? '#ffc18b' : C.white },
    { label: !s.letters.length ? '信笺已齐 ✓' : '信笺', value: (l.letters.length - s.letters.length) + ' / ' + l.letters.length, changed: previous && previous.letters.length !== s.letters.length, complete: !s.letters.length, color: !s.letters.length ? C.green : C.ink },
    { label: !s.seals.length ? '邮票已齐 ✓' : '回声邮票', value: (l.seals.length - s.seals.length) + ' / ' + l.seals.length, changed: previous && previous.seals.length !== s.seals.length, complete: !s.seals.length, color: !s.seals.length ? C.green : C.ink }
  ];
  objectives.forEach((objective, index) => {
    const x = 24 + index * 114, emphasis = !reduced && objective.changed && age < 600 ? Math.sin(age / 600 * Math.PI) : 0;
    if (objective.complete) r.round(x + 5, 86, 104, 52, 11, '#9bcbbc0d');
    if (emphasis) {
      r.ctx.save(); r.ctx.globalAlpha *= emphasis * .6;
      r.round(x + 5, 86, 104, 52, 11, '#9bcbbc15', objective.color);
      r.ctx.restore();
    }
    if (index) r.line([[x, 94], [x, 130]], '#365854', 1);
    r.text(objective.label, x + 57, 97, 11, objective.complete ? C.green : C.muted, 'center');
    r.label(objective.value, x + 57, 120, 92, 19 + emphasis * 1.5, objective.color, 'center', '600');
  });
  if (low && !game.modal && !game.busy) {
    r.ctx.save(); r.ctx.globalAlpha *= reduced ? .5 : .25 + (Math.sin(now / 380) + 1) * .12;
    r.round(29, 86, 104, 52, 11, null, '#ffb879'); r.ctx.restore();
  }
}

function controlLayout(r, game) {
  const ready = !game.state.letters.length && !game.state.seals.length;
  const guide = game.guideStep();
  const hintLines = r.wrapLines(game.playHint(), ready ? 278 : 310, 12), buttonY = r.H - CONTROL.height - 40;
  const hintHeight = guide ? guideCardLayout(r, guide).height : Math.max(44, hintLines.length * 18 + 14);
  return { buttonY, hintY: buttonY - hintHeight - 16, hintHeight, hintLines, ready, guide };
}

function drawControls(r, game, layout, now) {
  const { buttonY, hintY, hintHeight, hintLines, ready, guide } = layout;
  const warning = game.state.status === 'failed' || game.state.energy <= 3;
  if (guide) drawGuideCard(r, game, guide, hintY);
  else {
    r.round(24, hintY, 342, hintHeight, 12, ready ? '#1c413e' : C.dark, warning ? '#72614b' : ready ? C.green : '#365854');
    if (ready) r.icon('check', 44, hintY + hintHeight / 2, 16, C.green);
    const textY = hintY + hintHeight / 2 - (hintLines.length - 1) * 9;
    hintLines.forEach((line, index) => r.text(line, ready ? 209 : 195, textY + index * 18, 12, warning ? C.gold : ready ? C.green : C.muted, 'center'));
  }
  if (game.reviewing) {
    r.button('重新规划', 24, buttonY, 165, CONTROL.height, () => game.start(game.level, game.mode), { style: 'primary', icon: 'restart' });
    r.button('返回结果', 201, buttonY, 165, CONTROL.height, () => game.failure(), { icon: 'route' });
    return;
  }
  const canUndo = game.canUndo(), remaining = game.undoLeft();
  const canAct = game.state.status === 'playing' && !game.modal && !game.busy;
  if (guide && guide.control === 'restart') {
    r.button('重新学一遍', 24, buttonY, 165, CONTROL.height, () => game.restartGuide(), { style: 'primary', icon: 'restart', disabled: !canAct });
  } else {
    r.button('撤回（' + remaining + '）', 24, buttonY, 165, CONTROL.height, () => game.undo(), {
      style: guide && guide.control === 'undo' ? 'primary' : 'secondary', icon: 'undo', disabled: !canUndo
    });
  }
  r.button('等一拍', 201, buttonY, 165, CONTROL.height, () => game.act('wait'), {
    style: guide && guide.control === 'wait' ? 'primary' : 'secondary', icon: 'hourglass', disabled: !canAct || !!guide && guide.action !== 'wait'
  });
  drawGuideWait(r, game, guide, { x: 201, y: buttonY, w: 165, h: CONTROL.height }, now);
}

function drawGame(r, game, now) {
  const layout = controlLayout(r, game);
  const showGuideEntry = !layout.guide && canGuide(game.level, game.mode) && game.state.status === 'playing' && !game.reviewing;
  r.label(game.level.title, 24, game.reviewing ? 32 : 40, showGuideEntry ? 138 : 254, 25, C.ink, 'left', '600');
  if (game.reviewing) r.text('路线回顾 · 可拖动查看', 24, 60, 11, C.muted);
  else if (game.development) r.text('开发试玩 · 独立存档', 24, 63, 10, C.gold);
  if (showGuideEntry) r.button('操作引导', 174, 18, 104, CONTROL.compactHeight, () => game.showGuide(), {
    style: 'quiet', icon: 'route', disabled: !!game.modal || game.busy
  });
  r.button(game.reviewing ? '结果' : '暂停', 290, 18, 76, CONTROL.compactHeight, () => game.pause(), {
    style: 'quiet', icon: game.reviewing ? 'route' : 'pause', disabled: !!game.modal || game.busy || (!game.reviewing && game.state.status !== 'playing')
  });
  drawObjectives(r, game, now);
  drawBoard(r, game, now, { x: 16, y: 158, w: 358, h: layout.hintY - 170 }, game.modal ? null : layout.guide);
  drawGuideOverlay(r, game, layout.guide, now);
  drawControls(r, game, layout, now);
}

module.exports = { drawGame };
