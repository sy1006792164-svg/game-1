'use strict';

const { drawBoard } = require('./scene');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { GUIDE_HEIGHT, guideCardLayout, drawGuideCard } = require('./guide-view');
const { drawGuideOverlay, drawGuideWait } = require('./guide-effects');
const { STAR_TWO_MARGIN } = require('./engine');
const { gameFeedback, drawContextFeedback } = require('./game-feedback');
const { drawObjectives } = require('./game-objectives');
const { drawCollectionFlights } = require('./collection-flight');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { itemTrayLayout, drawItemTray, itemAimHint, drawItemAimHint } = require('./item-view');
const { difficultyProfile } = require('./difficulty');

// One- and two-line play hints share one slot, avoiding small board jumps as
// the contextual copy changes between turns.
const PLAY_HINT_HEIGHT = 50;

function routeStatus(game) {
  const { level, state } = game, turn = state.turn, two = level.par + STAR_TWO_MARGIN;
  const assisted = state.itemsUsed > 0 || state.revived || state.reviveCount > 0;
  const source = state.itemsUsed > 0 ? '道具' : '续灯';
  if (turn > two) return { text: '已走 ' + turn + ' 拍 · 本次送达得一星', warning: true };
  if (assisted) return { text: '已走 ' + turn + ' 拍 · ' + source + '封顶二星 · ' + two + ' 拍内', warning: true };
  const target = turn > level.par ? '二星目标 ' + two : '三星目标 ' + level.par;
  return { text: '第 ' + String(level.id).padStart(3, '0') + ' 封 · 已走 ' + turn + ' 拍 · ' + target + ' 拍', warning: false };
}

function controlLayout(r, game) {
  const ready = !game.state.letters.length && !game.state.seals.length;
  const guide = game.guideStep();
  // Renderer.H already excludes the device safe area. Reclaim the old 40px
  // bottom spacer for readable guidance while retaining an 8px touch inset.
  const aiming = !!game.selectedItem;
  const hintLines = r.wrapLines(aiming ? itemAimHint(game) : game.playHint(), !aiming && ready ? 278 : 310, 12), buttonY = r.H - CONTROL.height - 8;
  const hintHeight = guide ? guideCardLayout(r, guide).height : Math.max(PLAY_HINT_HEIGHT, hintLines.length * 18 + 14);
  const hintY = buttonY - hintHeight - 8;
  return { buttonY, hintY, hintHeight, hintLines, ready, guide, aiming, tray: itemTrayLayout(game, guide, hintY) };
}

function drawControls(r, game, layout, now, feedback) {
  const { buttonY, hintY, hintHeight, hintLines, ready, guide } = layout;
  const waitFeedback = feedback && feedback.items.find(item => item.type === 'wait');
  const undoFeedback = feedback && feedback.items.find(item => item.type === 'undo');
  const warning = game.state.status === 'failed' || game.state.energy <= 3;
  if (guide) drawGuideCard(r, game, guide, hintY);
  else if (!drawItemAimHint(r, game, layout) && !drawContextFeedback(r, feedback, layout, now)) {
    r.panel(24, hintY, 342, hintHeight, { radius: 13, fill: warning ? '#fbebdf' : ready ? '#e6f0e2' : '#f8faf1',
      stroke: warning ? '#d6af95' : ready ? '#9cbd9c' : C.line });
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
      feedbackAt: undoFeedback && undoFeedback.at, disabled: !canUndo || layout.aiming || !!guide && guide.kind === 'mechanic'
    });
  }
  if (layout.aiming) r.button('取消选取', 201, buttonY, 165, CONTROL.height, () => game.cancelItem(), {
    style: 'primary', icon: 'close', disabled: !canAct
  });
  else if (guide && guide.kind === 'mechanic') r.button(guide.buttonLabel, 201, buttonY, 165, CONTROL.height, () => game.advanceMechanicGuide(), {
    style: 'primary', icon: 'arrow-right', disabled: !canAct
  });
  else r.button('等一拍', 201, buttonY, 165, CONTROL.height, () => game.act('wait'), {
    style: guide && guide.control === 'wait' ? 'primary' : 'secondary', icon: 'hourglass',
    feedbackAt: waitFeedback && waitFeedback.at, disabled: !canAct || !!guide && guide.action !== 'wait'
  });
  drawGuideWait(r, game, guide, { x: 201, y: buttonY, w: 165, h: CONTROL.height }, now);
}

function gameBoardRect(r, layout) {
  const top = 148, gap = 4;
  // The old fixed band always reserved a full lesson card, even when the much
  // shorter play hint was visible. Reclaim that space for centering, while
  // adding the same amount to the projection padding so tile size stays fixed.
  const reclaimed = Math.max(0, GUIDE_HEIGHT - layout.hintHeight);
  const itemSpace = layout.tray ? layout.tray.reserve : 0;
  return { x: r.viewport.x, y: top, w: r.viewport.w,
    h: layout.hintY - top - gap - itemSpace, paddingY: Math.max(62, 62 + reclaimed - itemSpace), centerOffsetY: 2 };
}

function drawGame(r, game, now) {
  const layout = controlLayout(r, game), boardRect = gameBoardRect(r, layout);
  const feedback = gameFeedback(r, game, now);
  const atmosphereNow = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  const showGuideEntry = !layout.guide && game.canShowGuide() && game.state.status === 'playing' && !game.reviewing;
  const showChallenge = !showGuideEntry && !layout.guide && !game.reviewing && game.level.id >= 4 && typeof game.openRoutePlan === 'function';
  r.label(game.level.title, 24, 32, showGuideEntry ? 138 : showChallenge ? 184 : 254, 24, C.ink, 'left', '600');
  if (showChallenge) r.button(difficultyProfile(game.level).name, 216, 18, 66, CONTROL.compactHeight,
    () => game.openRoutePlan(), { style: 'quiet', size: 11, disabled: !!game.modal || game.busy || game.state.status !== 'playing' });
  // The subtitle sits below the complete 44px guide/pause targets. Its former
  // baseline crossed the guide button on the first level.
  if (game.reviewing) r.text('路线回顾', 24, 69, 11, C.muted);
  else if (game.development && !game.state.itemsUsed && !game.state.revived) r.text('开发试玩 · 独立存档', 24, 69, 10, '#925e37');
  else {
    const status = routeStatus(game);
    r.label(status.text, 24, 69, 342, 11, status.warning ? C.goldText : C.muted);
  }
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
    treatment: atmosphereTreatment('game')
  });
  drawBoard(r, game, now, boardRect, game.modal ? null : layout.guide);
  drawCollectionFlights(r, game, now);
  drawGuideOverlay(r, game, layout.guide, now);
  drawItemTray(r, game, layout.tray);
  drawControls(r, game, layout, now, feedback);
}

module.exports = { PLAY_HINT_HEIGHT, drawGame, gameBoardRect, controlLayout, routeStatus };
