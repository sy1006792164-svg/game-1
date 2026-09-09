'use strict';

const { C } = require('./theme');

function drawFriends(r, game) {
  const friend = game.friendLeaderboard, state = friend.getState();
  const box = { x: 18, y: 120, w: 354, h: Math.max(200, r.H - 242) };
  r.text(game.development ? '开发好友榜 · 测试成绩单独保存' : '和微信好友一起收集星光', 23, 103, 11, C.muted);
  if (state.status === 'ready') {
    friend.resize({ width: box.w, height: box.h, pixelRatio: Math.min(2, (game.metrics.pixelRatio || 1) * r.scale) });
    friend.draw(r.ctx, box.x, box.y, box.w, box.h);
    r.button('上一页', 20, r.H - 105, 105, 42, () => friend.page(-1), { style: 'quiet' });
    r.button('刷新', 143, r.H - 105, 104, 42, () => { game.syncFriendScore(); friend.refresh(); }, { style: 'quiet' });
    r.button('下一页', 265, r.H - 105, 105, 42, () => friend.page(1), { style: 'quiet' });
  } else {
    r.panel(box.x, box.y, box.w, box.h, { fill: C.panel, stroke: C.line, radius: 12 });
    r.text('好友排行榜', 195, box.y + 70, 20, C.ink, 'center', '600');
    const lines = r.wrapLines(state.message || '允许好友互动后，查看彼此的通关成绩', 298, 12);
    lines.forEach((line, index) => r.text(line, 195, box.y + 110 + index * 22, 12, C.muted, 'center'));
    if (!['unavailable', 'authorizing'].includes(state.status)) {
      r.button(state.status === 'denied' ? '去授权' : '查看好友榜', 92, box.y + 190, 206, 48, () => game.openFriendLeaderboard(), { style: 'primary', icon: 'community' });
    }
  }
  r.label(state.syncMessage || '仅展示已上传成绩的好友 · 微信内可用', 195, r.H - 39, 350, 10, state.syncStatus === 'error' ? C.gold : C.muted, 'center');
}

function drawLeaderboard(r, game) {
  r.header('好友排行榜', '总星数 → 通关数 → 更少步数', () => game.home());
  const auth = game.rankingAuthorization, state = auth.getState();
  if (!state.enabled) {
    const top = 140, buttonY = top + 228;
    r.panel(18, top, 354, 355, { fill: C.panel, stroke: C.line, radius: 12 });
    r.text('用微信头像昵称上榜', 195, top + 47, 21, C.ink, 'center', '600');
    r.text('头像昵称仅用于好友榜和本人排名展示', 195, top + 82, 12, C.muted, 'center');
    r.text('好友榜另需微信朋友信息授权', 195, top + 106, 12, C.muted, 'center');
    const lines = r.wrapLines(state.message || '首次使用需同意隐私保护指引', 298, 12);
    lines.slice(0, 4).forEach((line, index) => r.text(line, 195, top + 146 + index * 20, 12, C.gold, 'center'));
    if (state.needsProfile) {
      r.round(55, buttonY, 280, 48, 8, C.green);
      r.text('授权头像昵称并查看', 195, buttonY + 24, 15, C.paper, 'center', '600');
      auth.updateButton({ left: r.ox + 55 * r.scale, top: r.oy + buttonY * r.scale, width: 280 * r.scale, height: 48 * r.scale }, { visible: !game.hidden && !game.modal });
    } else {
      auth.updateButton(null);
      if (state.canOpenSettings) r.button('去设置授权', 55, buttonY, 280, 48, () => auth.openSettings(), { style: 'primary' });
      else if (['idle', 'denied', 'error'].includes(state.status)) r.button('重新申请授权', 55, buttonY, 280, 48, () => auth.open(), { style: 'primary' });
    }
    r.button('隐私保护指引', 83, top + 296, 224, 38, () => auth.openContract(), { style: 'quiet' });
    r.button('暂不授权，返回游戏', 71, top + 379, 248, 44, () => game.home(), { style: 'quiet' });
    r.text('拒绝授权不影响单人游玩与本地存档', 195, r.H - 37, 11, C.muted, 'center');
    return;
  }
  auth.updateButton(null);
  drawFriends(r, game);
}

module.exports = { drawLeaderboard };
