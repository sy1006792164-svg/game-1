'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { decorativeTime, quiet } = require('./page-feedback');

const HEADER_ACTION_X = 322;
const CONTENT_Y = 94;

const DISABLED_REMINDER_STATES = Object.freeze(['checking', 'requesting', 'banned', 'disabled']);

function drawIntro(r, game) {
  const subscription = game.rankMessageSubscription && game.rankMessageSubscription.getState();
  const authorization = game.rankingAuthorization.getState();
  const friend = game.friendLeaderboard && game.friendLeaderboard.getState();
  const showReminder = subscription && !['accepted', 'unavailable'].includes(subscription.status) &&
    friend && (authorization.enabled || authorization.canDisplay) && ['ready', 'preview'].includes(friend.status);
  r.header('好友排行', '总星数优先 · 同星比较通关与步数', () => game.home(), { actionWidth: showReminder ? 52 : 0 });
  if (showReminder) {
    const status = subscription.status;
    const disabled = DISABLED_REMINDER_STATES.includes(status);
    r.button('', HEADER_ACTION_X, 10, CONTROL.compactHeight, CONTROL.compactHeight,
      () => game.subscribeRankReminder(), { style: 'quiet', icon: 'notification', disabled });
  }
}

function drawStatusCard(r, box) {
  const height = Math.min(446, box.h), compact = height < 380;
  r.panel(box.x, box.y, box.w, height, { fill: C.panel, stroke: C.line, radius: 22 });
  if (!compact) {
    r.circle(195, box.y + 49, 29, C.soft);
    r.actionIcon('community', 195, box.y + 49, C.green);
    r.icon('star', 235, box.y + 61, 8, C.gold);
  }
  const buttonY = box.y + Math.min(280, height - 126);
  return { titleY: box.y + (compact ? 28 : 105), subtitleY: box.y + (compact ? 58 : 137),
    detailY: box.y + (compact ? 80 : 159), messageY: box.y + (compact ? 108 : 193),
    buttonY, secondaryY: buttonY + 60, noteY: box.y + height - 30 };
}

function drawMessage(r, message, ui, warning) {
  const lines = r.wrapLines(message, 294, 12);
  const limit = Math.max(1, Math.floor((ui.buttonY - ui.messageY - 16) / 20) + 1);
  lines.slice(0, limit).forEach((line, index) =>
    r.label(line + (index === limit - 1 && lines.length > limit ? '…' : ''), 195,
      ui.messageY + index * 20, 294, 12, warning ? C.goldText : C.muted, 'center'));
}

function drawFooter(r, note, warning) {
  r.label(note, 195, r.H - 18, 342, 10, warning ? C.goldText : C.muted, 'center');
}

function drawSkeletonLine(r, x, y, w, h, offset = 0) {
  r.round(x, y, w, h, h / 2, C.soft);
  if (quiet(r)) return;
  const phase = ((decorativeTime(r) + offset) % 2100) / 2100;
  const length = Math.min(30, w * .35), left = x + phase * (w - length);
  const alpha = Math.round(Math.sin(phase * Math.PI) * 195).toString(16).padStart(2, '0');
  r.round(left, y, length, h, h / 2, '#ffffff' + alpha);
}

function drawRankPlaceholder(r, game, box) {
  const compact = box.h < 420, heroH = compact ? 96 : 126, stride = compact ? 64 : 76;
  r.round(box.x, box.y, box.w, heroH, 19, C.green);
  r.round(box.x + 19, box.y + 1.5, box.w - 38, 1, .5, '#c6dec18a');
  r.circle(55, box.y + 31, compact ? 15 : 19, '#dce9d8');
  r.text('我的邮路', 88, box.y + 29, 15, C.white, 'left', '600');
  ['总星数', '已通关', '最佳总步数'].forEach((label, i) => {
    const x = box.x + [.195, .515, .82][i] * box.w;
    r.text('—', x, box.y + (compact ? 65 : 82), i ? 18 : 28, i ? C.white : '#ffe2a6', 'center', '600');
    r.text(label, x, box.y + (compact ? 85 : 107), 11, '#dce9d8', 'center');
  });
  r.text('好友成绩', 22, box.y + heroH + 28, 16, C.ink, 'left', '600');
  r.label('正在连接微信', box.x + box.w - 7, box.y + heroH + 28, 150, 11, C.muted, 'right');
  const count = Math.min(3, Math.max(0, Math.floor((box.h - heroH - 52 - 20) / stride)));
  for (let i = 0; i < count; i++) {
    const y = box.y + heroH + 52 + i * stride;
    r.panel(box.x, y, box.w, stride - 8, { fill: C.panel, stroke: C.line, radius: 13, flat: true });
    r.circle(49, y + (stride - 8) / 2, 17, C.soft);
    drawSkeletonLine(r, 80, y + 20, 116, 7, i * 170);
    drawSkeletonLine(r, 80, y + 38, 73, 6, i * 170 + 80);
    drawSkeletonLine(r, box.x + box.w - 61, y + 27, 38, 8, i * 170 + 140);
  }
  drawFooter(r, '仅向微信好友展示已上传的成绩');
}

function drawFriends(r, game, box) {
  const friend = game.friendLeaderboard, state = friend.getState();
  if (state.status === 'ready' || state.status === 'preview') {
    friend.resize({ width: box.w, height: box.h, pixelRatio: (game.metrics.pixelRatio || 1) * r.scale });
    friend.draw(r.ctx, box.x, box.y, box.w, box.h);
    // The host forwards complete gestures; scrolling and tap recognition both
    // stay in the child, so a drag can never trigger a second canvas tap.
  } else if (['authorizing', 'waiting', 'loading'].includes(state.status)) {
    return drawRankPlaceholder(r, game, box);
  } else {
    const unavailable = state.status === 'unavailable';
    const warning = ['denied', 'error'].includes(state.status);
    const ui = drawStatusCard(r, box);
    const title = unavailable ? '在微信里，与好友相逢' : state.status === 'error' ? '来信暂时没有送达' : '和好友一起收集星光';
    r.label(title, 195, ui.titleY, 306, 22, C.ink, 'center', '700');
    r.label(unavailable ? '好友成绩由微信提供' : '看看彼此走过的邮路与收集的星星', 195, ui.subtitleY, 306, 12, C.muted, 'center');
    drawMessage(r, state.message || (unavailable ? '请在微信小游戏中打开好友排行' : '允许好友互动后，即可查看好友成绩'), ui, warning);
    if (!unavailable) {
      r.button(state.status === 'denied' ? '去授权' : state.status === 'error' ? '重新打开好友榜' : '查看好友榜',
        92, ui.buttonY, 206, 48, () => game.openFriendLeaderboard(), { style: 'primary' });
    }
    r.label(unavailable ? '这段邮路，可以先由你独自探索' : '随时可以返回，继续自己的旅程', 195, ui.noteY, 306, 11, C.muted, 'center');
  }
  const syncError = state.syncStatus === 'error';
  const auth = game.rankingAuthorization.getState();
  drawFooter(r, auth.canDisplay && auth.status === 'error' ? '本次更新暂未完成，正在展示上次成绩' :
    syncError ? state.syncMessage || '成绩暂未同步，重新进入后会自动更新' : '仅向微信好友展示已上传的成绩', syncError);
}

function drawAuthorization(r, game, box, state) {
  const auth = game.rankingAuthorization;
  const unavailable = state.status === 'unavailable';
  const warning = ['denied', 'error'].includes(state.status);
  const ui = drawStatusCard(r, box);
  const title = unavailable ? '好友排行，在微信里相见' : '开启好友排行';
  r.label(title, 195, ui.titleY, 306, 22, C.ink, 'center', '700');
  r.label(unavailable ? '浏览器中可以完整体验解谜旅程' : '好友头像与昵称由微信好友榜提供', 195, ui.subtitleY, 306, 12, C.muted, 'center');
  if (!unavailable) r.label('确认隐私授权后，再申请好友互动权限', 195, ui.detailY, 306, 11, C.muted, 'center');
  drawMessage(r, state.message || '首次使用时，请完成微信隐私授权', ui, warning);

  auth.updateButton(null);
  if (!unavailable && ['idle', 'denied', 'error'].includes(state.status)) {
    r.button(state.status === 'error' ? '重试' : '确认并查看好友榜', 55, ui.buttonY, 280, 48, () => auth.open(), { style: 'primary' });
  }
  if (!unavailable) {
    r.button('隐私保护指引', 45, ui.secondaryY, 144, 44, () => auth.openContract(), { style: 'text', size: 12 });
    r.button('暂不授权', 201, ui.secondaryY, 144, 44, () => game.home(), { style: 'text', size: 12 });
  } else r.label('星光与本地进度，会留在你的旅途中', 195, ui.noteY, 306, 11, C.muted, 'center');
  drawFooter(r, '拒绝授权不影响单人游玩与本地存档');
}

function drawLeaderboard(r, game) {
  drawIntro(r, game);
  const box = leaderboardRect(r.H);
  const state = game.rankingAuthorization.getState();
  if (!state.enabled && !state.canDisplay) {
    if (['privacy', 'authorizing', 'loading'].includes(state.status)) return drawRankPlaceholder(r, game, box);
    return drawAuthorization(r, game, box, state);
  }
  game.rankingAuthorization.updateButton(null);
  drawFriends(r, game, box);
}

function leaderboardRect(height) { return { x: 18, y: CONTENT_Y, w: 354, h: Math.max(280, height - CONTENT_Y - 38) }; }

module.exports = { drawLeaderboard, leaderboardRect };
