'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { drawVignette } = require('./scene');

function layout(height) {
  const top = Math.max(0, (height - 780) / 2);
  // Keep the navigation above the bottom area reserved for transient notices.
  const heroY = 112 + top, heroH = Math.min(400, height - 383 - top);
  const routeY = heroY + heroH + 9, buttonY = routeY + 24;
  return { top, heroY, heroH, routeY, buttonY, progressY: buttonY + 81, linksY: buttonY + 112 };
}

function departure(next, saved, completed) {
  if (!saved) return {
    title: completed ? '继续送信' : '开始送信',
    detail: '第 ' + String(CAMPAIGN.indexOf(next) + 1).padStart(2, '0') + ' 封 · ' + next.title
  };
  if (saved.mode === 'daily') return { title: '继续每日风笺', detail: '每日风笺 · ' + saved.dateKey };
  const level = CAMPAIGN.find(item => item.id === saved.levelId);
  return { title: '继续送信', detail: level ? '第 ' + String(level.id).padStart(2, '0') + ' 封 · ' + level.title : '上次的路线' };
}

function drawLinks(r, game, y) {
  [
    { title: '选关', action: () => game.openPage('levels') },
    { title: '邮票', action: () => game.openPage('collection') },
    { title: '设置', action: () => game.openPage('settings') }
  ].forEach((item, index) => {
    const x = 39 + index * 108;
    r.button(item.title, x, y, 96, 46, item.action, 'quiet');
    if (index < 2) r.line([[x + 102, y + 17], [x + 102, y + 29]], '#45615c', 1);
  });
}

function drawHome(r, game, now) {
  const saved = game.savedRun(), completed = game.completion();
  const route = departure(game.nextLevel(), saved, completed), ui = layout(r.H);
  r.icon('wind', 195, ui.top + 27, 25, C.blue);
  r.text('风笺回廊', 195, ui.top + 64, 35, C.ink, 'center', '600');
  r.text('你收信，三拍后的回声收蓝票。', 195, ui.top + 96, 11, C.muted, 'center');
  drawVignette(r, now, { x: -30, y: ui.heroY, w: 450, h: ui.heroH });
  r.label(route.detail, 195, ui.routeY, 324, 11, C.muted, 'center');
  r.button(route.title, 30, ui.buttonY, 330, 56, () => game.primary(), 'primary');
  r.text('主线已送达 ' + completed + ' / ' + CAMPAIGN.length + ' 封', 195, ui.progressY, 11, C.muted, 'center');
  drawLinks(r, game, ui.linksY);
}

module.exports = { drawHome };
