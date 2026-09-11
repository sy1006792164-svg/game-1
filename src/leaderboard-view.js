'use strict';

const { C } = require('./theme');

function drawIntro(r, game) {
  r.header('好友排行', '总星数优先 · 同星比较通关与步数', () => game.home());
  r.text('把沿途的星光，收进这封来信', 24, 102, 12, C.muted);
  if (game.development) {
    r.round(286, 91, 80, 22, 11, C.soft);
    r.text('开发测试榜', 326, 102, 10, C.green, 'center');
  }
}

function drawStatusCard(r, box) {
  // The list uses the full page; a consent or error card keeps its readable size.
  r.panel(box.x, box.y, box.w, Math.min(470, box.h), { fill: C.panel, stroke: C.line, radius: 22 });
  const top = box.y;
  r.circle(195, top + 65, 36, C.soft);
  r.circle(195, top + 65, 27, C.raised);
  r.actionIcon('community', 195, top + 65, C.green);
  r.icon('star', 147, top + 48, 12, C.gold);
  r.icon('star', 240, top + 84, 9, C.gold);
  return top;
}

function drawMessage(r, message, y, warning) {
  r.wrapLines(message, 294, 12).slice(0, 4).forEach((line, index) =>
    r.text(line, 195, y + index * 20, 12, warning ? C.goldText : C.muted, 'center'));
}

function drawFooter(r, note, warning) {
  r.label(note, 195, r.H - 18, 342, 10, warning ? C.goldText : C.muted, 'center');
}

function drawRankPlaceholder(r, game, box) {
  r.round(box.x, box.y, box.w, 126, 19, C.green);
  r.circle(55, box.y + 37, 19, '#dce9d8');
  r.text('我的邮路', 88, box.y + 31, 15, C.white, 'left', '600');
  ['总星数', '已通关', '最佳总步数'].forEach((label, i) => {
    const x = box.x + (i + .5) * box.w / 3;
    r.text('—', x, box.y + 84, 21, C.white, 'center');
    r.text(label, x, box.y + 109, 10, '#dce9d8', 'center');
  });
  r.text('好友成绩', 22, box.y + 154, 14, C.ink, 'left', '600');
  for (let i = 0; i < 3; i++) {
    const y = box.y + 176 + i * 76;
    r.panel(box.x, y, box.w, 64, { fill: C.panel, stroke: C.line, radius: 13 });
    r.circle(49, y + 32, 17, C.soft);
    r.round(80, y + 20, 116, 7, 3, C.soft); r.round(80, y + 38, 73, 6, 3, '#e3ebdf');
  }
  drawFooter(r, '仅向微信好友展示已上传的成绩');
}

function drawFriends(r, game, box) {
  const friend = game.friendLeaderboard, state = friend.getState();
  if (state.status === 'ready' || state.status === 'preview') {
    friend.resize({ width: box.w, height: box.h, pixelRatio: Math.min(2, (game.metrics.pixelRatio || 1) * r.scale) });
    friend.draw(r.ctx, box.x, box.y, box.w, box.h);
    // The host forwards complete gestures; scrolling and tap recognition both
    // stay in the child, so a drag can never trigger a second canvas tap.
  } else if (['authorizing', 'waiting', 'loading'].includes(state.status)) {
    return drawRankPlaceholder(r, game, box);
  } else {
    const unavailable = state.status === 'unavailable';
    const warning = ['denied', 'error'].includes(state.status);
    const top = drawStatusCard(r, box);
    const title = unavailable ? '在微信里，与好友相逢' : state.status === 'error' ? '来信暂时没有送达' : '和好友一起收集星光';
    r.text(title, 195, top + 121, 20, C.ink, 'center', '600');
    r.text(unavailable ? '好友成绩由微信提供' : '看看彼此走过的邮路与收集的星星', 195, top + 156, 12, C.muted, 'center');
    drawMessage(r, state.message || (unavailable ? '请在微信小游戏中打开好友排行' : '允许好友互动后，即可查看好友成绩'), top + 202, warning);
    if (!unavailable) {
      r.button(state.status === 'denied' ? '去授权' : state.status === 'error' ? '重新打开好友榜' : '查看好友榜',
        92, top + 302, 206, 48, () => game.openFriendLeaderboard(), { style: 'primary' });
    }
    r.text(unavailable ? '这段邮路，可以先由你独自探索' : '随时可以返回，继续自己的旅程', 195, top + 412, 11, C.muted, 'center');
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
  const top = drawStatusCard(r, box);
  const title = unavailable ? '好友排行，在微信里相见' : '开启好友排行';
  r.text(title, 195, top + 121, 20, C.ink, 'center', '600');
  r.text(unavailable ? '浏览器中可以完整体验解谜旅程' : '好友头像与昵称由微信好友榜提供', 195, top + 156, 12, C.muted, 'center');
  if (!unavailable) r.text('确认隐私授权后，再申请好友互动权限', 195, top + 179, 11, C.muted, 'center');
  drawMessage(r, state.message || '首次使用时，请完成微信隐私授权', top + 216, warning);

  const buttonY = top + 302;
  auth.updateButton(null);
  if (!unavailable && ['idle', 'denied', 'error'].includes(state.status)) {
    r.button(state.status === 'error' ? '重试' : '确认并查看好友榜', 55, buttonY, 280, 48, () => auth.open(), { style: 'primary' });
  }
  if (!unavailable) {
    r.button('隐私保护指引', 45, top + 375, 144, 38, () => auth.openContract(), { style: 'quiet' });
    r.button('暂不授权', 201, top + 375, 144, 38, () => game.home(), { style: 'quiet' });
  } else r.text('星光与本地进度，会留在你的旅途中', 195, top + 375, 11, C.muted, 'center');
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

function leaderboardRect(height) { return { x: 18, y: 120, w: 354, h: Math.max(280, height - 158) }; }

module.exports = { drawLeaderboard, leaderboardRect };
