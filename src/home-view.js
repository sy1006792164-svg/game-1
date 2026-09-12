'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');
const { drawTitle } = require('./brand-title');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { decorativeTime } = require('./page-feedback');

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
  const width = 104, gap = 8;
  const startX = (390 - (links.length * width + (links.length - 1) * gap)) / 2;
  links.forEach((item, index) => {
    const x = startX + index * (width + gap);
    r.button(item.title, x, y, width, CONTROL.compactHeight, item.action,
      { style: 'quiet', icon: item.icon, size: 13 });
  });
}

function drawSettingsShortcut(r, game) {
  const size = CONTROL.compactHeight;
  r.button('', 390 - 16 - size, 10, size, size, () => game.openPage('settings'),
    { style: 'quiet', icon: 'settings' });
}

function drawDepartureTrail(r, y, quietMotion) {
  // Three small beats connect the solid courier route to its delayed echo.
  // The small itinerary sits above the route name, clear of all text and hits.
  const x = 151, step = 22, time = decorativeTime(r);
  r.line([[x, y], [x + step * 2, y]], '#9fb99e', .9);
  r.line([[x + step * 2, y], [x + step * 4, y]], '#81aba6', .9, [2, 3]);
  for (let i = 0; i < 5; i++) r.round(x + i * step - 1.8, y - 1.8, 3.6, 3.6, 1.8, i < 3 ? '#7da082' : '#80aaa6');
  if (quietMotion) return;
  const phase = (time % 5600) / 5600, travel = Math.min(1, phase / .7);
  const alpha = Math.round(Math.sin(travel * Math.PI) * 200).toString(16).padStart(2, '0');
  r.round(x - 2 + travel * step * 4, y - 2, 4, 4, 1, C.gold + alpha);
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
  drawDepartureTrail(r, ui.routeY - 13, quietMotion);
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
  if (typeof game.journey === 'function') {
    const journey = game.journey();
    r.button(journey.done ? '今日已盖章 · 累计 ' + journey.earnedDays + ' 枚日邮戳' : '今日邮程 ' + journey.points + ' / ' + journey.target + ' · 查看目标',
      42, footerY - 22, 306, CONTROL.compactHeight, () => game.openJourney(), { style: 'quiet', icon: 'stamp', size: 12 });
  } else r.text(completed ? '已送达 ' + completed + ' 封信 · 每一程都算数' : '不必赶路，想好了再出发', 195, footerY, 10, C.muted, 'center');
  drawSettingsShortcut(r, game);
}

module.exports = { drawHome };
