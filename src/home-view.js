'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');
const { drawTitle } = require('./brand-title');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');

function layout(height) {
  const top = Math.max(0, (height - 844) / 2);
  const heroY = 142 + top, heroH = Math.min(386, height - 410 - top);
  const routeY = heroY + heroH + 32, buttonY = routeY + 48;
  return { top, heroY, heroH, routeY, buttonY, linksY: buttonY + CONTROL.height + 28 };
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
  r.line([[137, top + 29], [157, top + 29]], '#90ac99', .8);
  r.text('风 起 · 信 至', 195, top + 29, 9, C.green, 'center');
  r.line([[233, top + 29], [253, top + 29]], '#90ac99', .8);
  drawTitle(r, 195, top + 76, 39, 50);
  r.text('和三拍后的自己，走一程山间邮路。', 195, top + 121, 11, C.muted, 'center');
}

function drawLinks(r, game, y) {
  const links = [
    { title: '选关', icon: 'route', action: () => game.openPage('levels') },
    { title: '邮票', icon: 'stamp', action: () => game.openPage('collection') },
    { title: '排行', icon: 'ranking', action: () => game.openPage('leaderboard') }
  ];
  if (game.gameCircle.available) links.push({ title: '圈子', icon: 'community', action: () => game.openGameCircle() });
  const startX = (390 - (links.length * 88 - 6)) / 2;
  links.forEach((item, index) => {
    const x = startX + index * 88;
    r.button(item.title, x, y, 82, CONTROL.compactHeight, item.action, { style: 'quiet', icon: item.icon });
  });
}

function drawHome(r, game, now) {
  const saved = game.savedRun(), completed = game.completion();
  const route = departure(game.nextLevel(), saved, completed), ui = layout(r.H), bounds = r.viewport || { x: 0, w: 390 };
  const mood = r.atmosphereMood, quietMotion = r.reducedMotion || r.effectsQuality === 'low';
  const sceneNow = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  drawBrand(r, ui.top);
  drawAmbientOverlay(r, sceneNow, 'home', { x: bounds.x, y: ui.heroY, w: bounds.w, h: ui.heroH },
    { reducedMotion: quietMotion, quality: r.effectsQuality, mood, treatment: atmosphereTreatment('home') });
  drawVignette(r, sceneNow, { x: 5, y: ui.heroY, w: 380, h: ui.heroH },
    { reducedMotion: quietMotion, mood, deliveryStory: r.effectsQuality !== 'low' });
  r.line([[171, ui.routeY - 13], [219, ui.routeY - 13]], '#a6bfa6', .8);
  r.label(route.detail, 195, ui.routeY + 6, 324, 12, C.ink, 'center', '600');
  r.text(saved ? '路线已留好，随时接着走' : '你拾起信笺 · 回声收集邮票', 195, ui.routeY + 28, 10, C.muted, 'center');
  if (!quietMotion) {
    const breath = (1 + Math.sin(sceneNow / 1200)) / 2;
    const alpha = Math.round(12 + breath * 16).toString(16).padStart(2, '0');
    r.round(38 - breath * 2, ui.buttonY - 4 - breath * 2, 314 + breath * 4,
      CONTROL.height + 8 + breath * 4, 17, C.green + alpha);
  }
  r.button(route.title, 42, ui.buttonY, 306, CONTROL.height, () => game.primary(), { style: 'primary' });
  drawLinks(r, game, ui.linksY);
  const footerY = ui.linksY + CONTROL.compactHeight + 32;
  r.text(completed ? '已送达 ' + completed + ' 封信 · 每一程都算数' : '不必赶路，想好了再出发', 195, footerY, 10, C.muted, 'center');
}

module.exports = { drawHome };
