'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');
const { drawTitle } = require('./brand-title');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { VIGNETTE_SOURCE, featuredVignetteRect } = require('./startup-layout');

function homeLayout(height, scale = 1) {
  const compactHeight = Math.max(CONTROL.compactHeight, 44 / scale);
  const primaryHeight = Math.max(58, compactHeight), linksHeight = Math.max(52, compactHeight);
  const journeyY = height - 24 - compactHeight;
  const linksY = journeyY - 10 - linksHeight, buttonY = linksY - 28 - primaryHeight;
  const routeY = buttonY - 84, top = Math.max(0, (height - 844) * .2), heroY = 150 + top;
  const heroH = Math.max(120, routeY - heroY - 26), hero = featuredVignetteRect(heroY, heroH);
  // Safe areas make the home hero shorter than the startup hero on many phones.
  // Contain the complete island instead of preserving a larger shared scale and
  // clipping its lower edge behind the route copy.
  const artScale = Math.min(hero.w / VIGNETTE_SOURCE.w, hero.h / VIGNETTE_SOURCE.h);
  return { top, heroY, heroH, hero, artScale,
    artAlignY: 'center', routeY, buttonY,
    primaryHeight, compactHeight, linksHeight, linksY, journeyY };
}

function departure(next, saved, completed) {
  const level = saved && CAMPAIGN.find(item => item.id === saved.levelId) || next;
  return {
    title: saved || completed ? '继续送信' : '开始送信',
    detail: '第 ' + String(level.id).padStart(3, '0') + ' 封 · ' + level.title
  };
}

function drawBrand(r, top) {
  r.text('风 起 · 信 至', 195, top + 29, 11, C.green, 'center', '600');
  drawTitle(r, 195, top + 78, 44, 56);
  r.text('和三拍后的自己，走一程山间邮路。', 195, top + 123, 13, C.muted, 'center');
}

function drawLinks(r, game, y, height) {
  const links = [['选关', 'levels'], ['邮票', 'collection'], ['排行', 'leaderboard']];
  const width = 342 / links.length;
  r.line([[24, y - 10], [366, y - 10]], C.line, 1);
  links.forEach(([title, page], index) => {
    const x = 24 + index * width;
    r.button(title, x + 4, y, width - 8, height, () => game.openPage(page),
      { style: 'text', size: 14, color: C.ink });
    if (index < links.length - 1) r.line([[x + width, y + height / 2 - 7],
      [x + width, y + height / 2 + 7]], C.line, 1);
  });
}

function drawHome(r, game, now) {
  const saved = game.savedRun(), completed = game.completion();
  const route = departure(game.nextLevel(), saved, completed), ui = homeLayout(r.H, r.scale || 1);
  const mood = r.atmosphereMood, quietMotion = r.reducedMotion || r.effectsQuality === 'low';
  const sceneNow = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  drawBrand(r, ui.top);
  r.button('', 366 - ui.compactHeight, ui.top + 7, ui.compactHeight, ui.compactHeight,
    () => game.openPage('settings'), { style: 'quiet', icon: 'settings', label: '设置' });
  const hero = ui.hero;
  r.ctx.save();
  r.round(hero.x, hero.y, hero.w, hero.h, 24);
  r.ctx.clip();
  drawAmbientOverlay(r, sceneNow, 'home', hero,
    { reducedMotion: quietMotion, quality: r.effectsQuality, mood, treatment: atmosphereTreatment('home') });
  drawVignette(r, sceneNow, hero, { reducedMotion: quietMotion, mood, artScale: ui.artScale,
    alignY: ui.artAlignY,
    deliveryStory: r.effectsQuality !== 'low' });
  r.ctx.restore();

  r.text(saved ? '接着上次的旅程' : completed ? '下一站' : '你的第一封信', 26, ui.routeY, 11, C.muted);
  r.label(route.detail, 26, ui.routeY + 28, 338, 21, C.ink, 'left', '600');
  const persisted = !game.store || game.store.getStatus().persisted;
  r.text(saved ? persisted ? '路线已保存，随时接着走。' : '本次运行内可以继续这段路线。' :
    '拾起信笺，让回声替你收集蓝票。', 26, ui.routeY + 55, 12, C.muted);
  r.button(route.title, 24, ui.buttonY, 342, ui.primaryHeight, () => game.primary(),
    { style: 'primary', icon: 'letter', trailing: 'arrow-right', size: 17 });
  drawLinks(r, game, ui.linksY, ui.linksHeight);
  if (typeof game.journey === 'function') {
    const journey = game.journey();
    r.button(journey.done ? '今日已盖章 · 累计 ' + journey.earnedDays + ' 枚日邮戳' :
      '今日邮程 ' + Math.min(journey.points, journey.target) + ' / ' + journey.target + ' · 查看目标',
    42, ui.journeyY, 306, ui.compactHeight, () => game.openJourney(), { style: 'text', size: 12, color: C.muted });
  } else r.text(completed ? '已送达 ' + completed + ' 封信 · 每一程都算数' : '不必赶路，想好了再出发',
    195, ui.journeyY + ui.compactHeight / 2, 12, C.muted, 'center');
}

module.exports = { drawHome, homeLayout };
