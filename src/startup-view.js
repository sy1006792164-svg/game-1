'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');
const { HEALTH_ADVICE_TITLE, HEALTH_ADVICE_LINES } = require('./startup');
const { drawTitle } = require('./brand-title');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { drawStartupJourney } = require('./startup-journey');

function startupLayout(height) {
  const contentHeight = Math.min(height, 840), top = (height - contentHeight) / 2;
  const loadingY = top + contentHeight - 88, adviceH = 164;
  const adviceY = loadingY - 18 - adviceH;
  const heroY = top + 116, heroH = Math.min(380, adviceY - heroY - 20);
  return { top, heroY, heroH, adviceY, adviceH, loadingY };
}

function drawBrand(r, top) {
  r.line([[128, top + 22], [151, top + 22]], '#90ac99', .8);
  r.text('风 起 · 信 至', 195, top + 22, 10, C.green, 'center');
  r.line([[239, top + 22], [262, top + 22]], '#90ac99', .8);
  drawTitle(r, 195, top + 62, 36, 48);
  r.text('一封信，一段与回声同行的邮路。', 195, top + 100, 13, C.ink, 'center');
}

function drawLoading(r, game, y, now) {
  const startup = game.startup || {};
  if (startup.error) {
    r.text('准备遇到问题，请重试', 195, y + 3, 13, C.ink, 'center');
    r.button('重新加载', 117, y + 14, 156, CONTROL.compactHeight, () => game.retryStartup(), { style: 'primary' });
    return;
  }
  const progress = Math.max(0, Math.min(1, Number(startup.progress) || 0));
  r.text(startup.label || '正在准备邮路…', 42, y + 7, 13, C.ink);
  r.text(Math.floor(progress * 100) + '%', 348, y + 7, 13, C.green, 'right', '600');
  r.round(42, y + 25, 306, 12, 6, C.soft, C.line);
  if (progress > 0) r.round(42, y + 25, 306 * progress, 12, 6, C.green);
  if (progress > 0 && !r.reducedMotion && r.effectsQuality !== 'low') {
    const width = 306 * progress, sweep = (now % 1350) / 1350;
    r.ctx.save(); r.round(42, y + 25, width, 12, 6); r.ctx.clip();
    r.round(42 - 36 + (width + 36) * sweep, y + 25, 36, 12, 6, '#e4f5d85c');
    r.ctx.restore();
  }
  r.text('加载完成后自动进入', 195, y + 52, 11, C.muted, 'center');
}

function drawStartup(r, game, now) {
  const ui = startupLayout(r.H), bounds = r.viewport || { x: 0, w: 390 };
  const mood = r.atmosphereMood, quietMotion = r.reducedMotion || r.effectsQuality === 'low';
  const sceneNow = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  drawBrand(r, ui.top);
  drawAmbientOverlay(r, sceneNow, 'startup', { x: bounds.x, y: ui.heroY, w: bounds.w, h: ui.heroH },
    { reducedMotion: quietMotion, quality: r.effectsQuality, mood, treatment: atmosphereTreatment('startup') });
  const hero = { x: 13, y: ui.heroY, w: 364, h: ui.heroH };
  drawVignette(r, sceneNow, hero, { reducedMotion: quietMotion, mood });
  drawStartupJourney(r, game.startup && game.startup.progress, hero, sceneNow, { reducedMotion: quietMotion });
  r.panel(22, ui.adviceY, 346, ui.adviceH, { fill: C.panel, stroke: '#9ab8a5', accent: C.green });
  r.text(HEALTH_ADVICE_TITLE, 195, ui.adviceY + 27, 17, C.ink, 'center', '700');
  HEALTH_ADVICE_LINES.forEach((text, index) => r.text(text, 195, ui.adviceY + 62 + index * 22, 15, C.ink, 'center'));
  drawLoading(r, game, ui.loadingY, now);
}

// Publication values remain complete, including unusually long registered names.
// Paginate only when wrapping would otherwise reach the automatic-entry footer.
function publicationPages(r, entries, capacity) {
  const pages = []; let page = [], used = 0;
  const finish = () => { if (page.length) pages.push(page); page = []; used = 0; };
  for (const entry of entries) {
    if (!entry || !entry.value) continue;
    const lines = r.wrapLines(String(entry.value), 302, 14);
    let offset = 0;
    while (offset < lines.length) {
      const gap = page.length ? 1 : 0;
      if (capacity - used - gap < 2) finish();
      const leading = page.length ? 1 : 0;
      const count = Math.min(lines.length - offset, capacity - used - leading - 1);
      page.push({ label: String(entry.label || '') + (offset ? '（续）' : ''), lines: lines.slice(offset, offset + count), gap: leading });
      used += leading + 1 + count;
      offset += count;
      if (offset < lines.length) finish();
    }
  }
  finish();
  return pages.length ? pages : [[]];
}

function publicationLayout(r, entries) {
  const contentHeight = Math.min(r.H, 840), top = (r.H - contentHeight) / 2;
  const footerY = top + contentHeight - 52, panelY = top + 118;
  const capacity = Math.max(2, Math.floor((footerY - 34 - panelY - 36) / 21));
  let pages = publicationPages(r, entries, capacity);
  const paged = pages.length > 1;
  if (paged) pages = publicationPages(r, entries, Math.max(2, capacity - 2));
  return { top, panelY, panelH: footerY - (paged ? 76 : 34) - panelY, footerY, pages, pageY: footerY - 32 };
}

function drawPublication(r, game) {
  const ui = publicationLayout(r, game.startupPublication || []);
  game.startupPublicationPages = ui.pages.length;
  const pageIndex = Math.max(0, Math.min(ui.pages.length - 1, Math.floor(game.startupPublicationPage || 0)));
  r.text('风笺回廊', 195, ui.top + 36, 15, C.green, 'center', '600');
  r.text('出版与运营信息', 195, ui.top + 74, 25, C.ink, 'center', '600');
  r.panel(22, ui.panelY, 346, ui.panelH, { fill: C.panel, stroke: '#9ab8a5', accent: C.green });
  let y = ui.panelY + 23;
  for (const entry of ui.pages[pageIndex]) {
    y += entry.gap * 21;
    r.text(entry.label, 44, y, 13, C.green, 'left', '600'); y += 21;
    for (const line of entry.lines) { r.text(line, 44, y, 14, C.ink); y += 21; }
  }
  if (ui.pages.length > 1) {
    r.text((pageIndex + 1) + ' / ' + ui.pages.length, 195, ui.pageY, 13, C.ink, 'center');
  }
  r.text('即将进入回廊…', 195, ui.footerY, 13, C.green, 'center');
}

module.exports = { drawStartup, drawPublication, startupLayout, publicationLayout };
