'use strict';

const { drawBoard } = require('./scene');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { guideCardLayout, drawGuideCard } = require('./guide-view');
const { drawGuideOverlay, drawGuideWait } = require('./guide-effects');
const { chapterNames } = require('./levels');
const { gameFeedback, drawContextFeedback } = require('./game-feedback');
const { drawObjectives } = require('./game-objectives');
const { drawCollectionFlights } = require('./collection-flight');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');

function controlLayout(r, game) {
  const ready = !game.state.letters.length && !game.state.seals.length;
  const guide = game.guideStep();
  // Renderer.H already excludes the device safe area. Reclaim the old 40px
  // bottom spacer for readable guidance while retaining an 8px touch inset.
  const hintLines = r.wrapLines(game.playHint(), ready ? 278 : 310, 12), buttonY = r.H - CONTROL.height - 8;
  const hintHeight = guide ? guideCardLayout(r, guide).height : Math.max(44, hintLines.length * 18 + 14);
  return { buttonY, hintY: buttonY - hintHeight - 8, hintHeight, hintLines, ready, guide };
}

function drawControls(r, game, layout, now, feedback) {
  const { buttonY, hintY, hintHeight, hintLines, ready, guide } = layout;
  const waitFeedback = feedback && feedback.items.find(item => item.type === 'wait');
  const undoFeedback = feedback && feedback.items.find(item => item.type === 'undo');
  const warning = game.state.status === 'failed' || game.state.energy <= 3;
  if (guide) drawGuideCard(r, game, guide, hintY);
  else if (!drawContextFeedback(r, feedback, layout, now)) {
    r.round(24, hintY + 2, 342, hintHeight, 13, '#53715b12');
    r.round(24, hintY, 342, hintHeight, 13, warning ? '#fbebdf' : ready ? '#e6f0e2' : '#f8faf1', warning ? '#d6af95' : ready ? '#9cbd9c' : C.line);
    if (ready) r.icon('check', 44, hintY + hintHeight / 2, 16, C.green);
    const textY = hintY + hintHeight / 2 - (hintLines.length - 1) * 9;
    hintLines.forEach((line, index) => r.text(line, ready ? 209 : 195, textY + index * 18, 12, warning ? '#955d42' : ready ? '#316c5f' : C.muted, 'center'));
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
      style: guide && guide.control === 'undo' ? 'primary' : 'secondary', icon: 'undo',
      feedbackAt: undoFeedback && undoFeedback.at, disabled: !canUndo || !!guide && guide.kind === 'mechanic'
    });
  }
  if (guide && guide.kind === 'mechanic') r.button(guide.buttonLabel, 201, buttonY, 165, CONTROL.height, () => game.advanceMechanicGuide(), {
    style: 'primary', icon: 'arrow-right', disabled: !canAct
  });
  else r.button('等一拍', 201, buttonY, 165, CONTROL.height, () => game.act('wait'), {
    style: guide && guide.control === 'wait' ? 'primary' : 'secondary', icon: 'hourglass',
    feedbackAt: waitFeedback && waitFeedback.at, disabled: !canAct || !!guide && guide.action !== 'wait'
  });
  drawGuideWait(r, game, guide, { x: 201, y: buttonY, w: 165, h: CONTROL.height }, now);
}

function gameBoardRect(r) {
  // Keep the original island framing independent of card typography. Increasing
  // a lesson must not move a tile or clip the rear trees and stone base.
  return { x: r.viewport.x, y: 148, w: r.viewport.w,
    h: r.H - 364, paddingY: 62, centerOffsetY: 2 };
}

function drawGame(r, game, now) {
  const layout = controlLayout(r, game), boardRect = gameBoardRect(r);
  const feedback = gameFeedback(r, game, now);
  const atmosphereNow = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  const feedbackNow = game.modal && Number.isFinite(r.ambientFreezeAt) ? r.ambientFreezeAt : now;
  const actionAge = feedbackNow - game.transitionAt;
  const ambientImpulse = !r.reducedMotion && r.effectsQuality !== 'low' && game.previousState && actionAge >= 0 && actionAge < 720
    ? Math.sin(actionAge / 720 * Math.PI) : 0;
  r.ambientImpulse = ambientImpulse;
  const showGuideEntry = !layout.guide && game.canShowGuide() && game.state.status === 'playing' && !game.reviewing;
  r.label(game.level.title, 24, 32, showGuideEntry ? 138 : 254, 24, C.ink, 'left', '600');
  if (game.reviewing) r.text('路线回顾', 24, 60, 11, C.muted);
  else if (game.development) r.text('开发试玩 · 独立存档', 24, 63, 10, '#925e37');
  else r.label(game.mode === 'campaign' ? '第 ' + String(game.level.id).padStart(3, '0') + ' 封 · ' + (chapterNames[game.level.chapter] || '风笺邮路') : '今日来信 · 一次新的远行', 24, 60, 252, 10, C.muted);
  if (showGuideEntry) r.button('操作引导', 174, 18, 104, CONTROL.compactHeight, () => game.showGuide(), {
    style: 'quiet', icon: 'route', disabled: !!game.modal || game.busy
  });
  r.button(game.reviewing ? '结果' : '暂停', 290, 18, 76, CONTROL.compactHeight, () => game.pause(), {
    style: 'quiet', icon: game.reviewing ? 'route' : 'pause', disabled: !!game.modal || game.busy || (!game.reviewing && game.state.status !== 'playing')
  });
  drawObjectives(r, game, now, feedback);
  // Gameplay ambience is clipped to the dynamic board band and painted beneath
  // the island, keeping the HUD and controls still while the scenery breathes.
  drawAmbientOverlay(r, atmosphereNow, 'game', boardRect, {
    reducedMotion: r.reducedMotion, quality: r.effectsQuality, mood: r.atmosphereMood,
    treatment: atmosphereTreatment('game'), impulse: ambientImpulse
  });
  drawBoard(r, game, now, boardRect, game.modal ? null : layout.guide);
  drawCollectionFlights(r, game, now);
  drawGuideOverlay(r, game, layout.guide, now);
  drawControls(r, game, layout, now, feedback);
}

module.exports = { drawGame, gameBoardRect };
