'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');

function layout(height) {
  const top = Math.max(0, (height - 780) / 2);
  // Keep the navigation above the bottom area reserved for transient notices.
  const heroY = 112 + top, heroH = Math.min(400, height - 383 - top);
  const routeY = heroY + heroH + 9, buttonY = routeY + 24;
  return { top, heroY, heroH, routeY, buttonY, linksY: buttonY + CONTROL.height + 24 };
}

function departure(next, saved, completed) {
  if (!saved) return {
    title: completed ? '继续送信' : '开始送信',
    detail: '第 ' + String(CAMPAIGN.indexOf(next) + 1).padStart(3, '0') + ' 封 · ' + next.title
  };
  const level = CAMPAIGN.find(item => item.id === saved.levelId);
  return { title: '继续送信', detail: level ? '第 ' + String(level.id).padStart(3, '0') + ' 封 · ' + level.title : '上次的路线' };
}

function drawBrand(r, top) {
  r.text('风笺回廊', 195, top + 52, 35, C.ink, 'center', '600');
  r.text('你收信，三拍后的回声收蓝票。', 195, top + 86, 11, C.muted, 'center');
}

function drawLinks(r, game, y) {
  [
    { title: '选关', icon: 'route', action: () => game.openPage('levels') },
    { title: '邮票', icon: 'stamp', action: () => game.openPage('collection') }
  ].forEach((item, index) => {
    const x = 30 + index * 174;
    r.button(item.title, x, y, 156, CONTROL.compactHeight, item.action, { style: 'quiet', icon: item.icon, trailing: 'chevron' });
  });
}

function drawHome(r, game, now) {
  const saved = game.savedRun(), completed = game.completion();
  const route = departure(game.nextLevel(), saved, completed), ui = layout(r.H);
  drawBrand(r, ui.top);
  drawVignette(r, now, { x: -30, y: ui.heroY, w: 450, h: ui.heroH }, { reducedMotion: r.reducedMotion });
  r.label(route.detail, 195, ui.routeY, 324, 11, C.muted, 'center');
  r.button(route.title, 30, ui.buttonY, 330, CONTROL.height, () => game.primary(), { style: 'primary', icon: 'letter', trailing: 'chevron' });
  drawLinks(r, game, ui.linksY);
}

module.exports = { drawHome };
