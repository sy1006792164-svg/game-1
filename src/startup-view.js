'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawVignette } = require('./scene');
const { HEALTH_ADVICE_TITLE, HEALTH_ADVICE_LINES } = require('./startup');
const { drawTitle } = require('./brand-title');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { drawStartupJourney } = require('./startup-journey');

const PUBLICATION_LINE_HEIGHT = 23;

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
  r.text('一封信，一段与回声同行的邮路。', 195, top + 100, 12, C.muted, 'center');
}

function drawLoading(r, game, y, now) {
  const startup = game.startup || {};
  if (startup.error) {
    r.text('准备遇到问题，请重试', 195, y + 3, 13, C.ink, 'center');
    r.button('重新加载', 117, y + 14, 156, CONTROL.compactHeight, () => game.retryStartup(), { style: 'primary' });
    return;
  }
  const progress = Math.max(0, Math.min(1, Number(startup.progress) || 0));
  r.text(startup.label || '正在准备邮路…', 42, y + 7, 13, C.ink, 'left', '600');
  r.text(Math.floor(progress * 100) + '%', 348, y + 7, 15, C.green, 'right', '600');
  r.round(42, y + 27, 306, 8, 4, C.soft);
  if (progress > 0) r.round(42, y + 27, 306 * progress, 8, 4, C.green);
  if (progress > 0 && !r.reducedMotion && r.effectsQuality !== 'low') {
    const width = 306 * progress, sweep = (now % 1350) / 1350;
    r.ctx.save(); r.round(42, y + 27, width, 8, 4); r.ctx.clip();
    r.round(42 - 36 + (width + 36) * sweep, y + 27, 36, 8, 4, '#e4f5d85c');
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
  r.panel(24, ui.adviceY, 342, ui.adviceH, { fill: C.raised, stroke: C.line, flat: true });
  r.text(HEALTH_ADVICE_TITLE, 195, ui.adviceY + 27, 16, C.ink, 'center', '600');
  HEALTH_ADVICE_LINES.forEach((text, index) => r.text(text, 195, ui.adviceY + 61 + index * 23, 15, C.ink, 'center'));
  drawLoading(r, game, ui.loadingY, now);
}

// Publication values remain complete, including unusually long registered names.
// Paginate only when wrapping would otherwise reach the automatic-entry footer.
function publicationPages(r, entries, capacity) {
  const pages = []; let page = [], used = 0;
  const finish = () => { if (page.length) pages.push(page); page = []; used = 0; };
  for (const entry of entries) {
    if (!entry || !entry.value) continue;
    const lines = r.wrapLines(String(entry.value), 302, 15);
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
  const footerY = top + contentHeight - 52, panelY = top + 116;
  let maxPanelH = footerY - 34 - panelY;
  const capacity = height => Math.max(2, Math.floor((height - 26) / PUBLICATION_LINE_HEIGHT));
  let pages = publicationPages(r, entries, capacity(maxPanelH));
  const paged = pages.length > 1;
  if (paged) {
    maxPanelH -= 42;
    pages = publicationPages(r, entries, capacity(maxPanelH));
  }
  const rows = Math.max(...pages.map(page => page.reduce((total, entry) => total + entry.gap + 1 + entry.lines.length, 0)));
  const panelH = Math.min(maxPanelH, Math.max(112, 26 + rows * PUBLICATION_LINE_HEIGHT));
  return { top, panelY, panelH, footerY, pages, pageY: footerY - 32 };
}

function drawPublication(r, game) {
  const ui = publicationLayout(r, game.startupPublication || []);
  game.startupPublicationPages = ui.pages.length;
  const pageIndex = Math.max(0, Math.min(ui.pages.length - 1, Math.floor(game.startupPublicationPage || 0)));
  r.text('风笺回廊', 195, ui.top + 36, 12, C.muted, 'center');
  r.text('出版与运营信息', 195, ui.top + 74, 26, C.ink, 'center', '600');
  r.panel(24, ui.panelY, 342, ui.panelH, { fill: C.panel, stroke: C.line, flat: true });
  let y = ui.panelY + 25;
  for (const entry of ui.pages[pageIndex]) {
    y += entry.gap * PUBLICATION_LINE_HEIGHT;
    r.text(entry.label, 44, y, 12, C.muted); y += PUBLICATION_LINE_HEIGHT;
    for (const line of entry.lines) { r.text(line, 44, y, 15, C.ink); y += PUBLICATION_LINE_HEIGHT; }
  }
  if (ui.pages.length > 1) {
    r.text((pageIndex + 1) + ' / ' + ui.pages.length, 195, ui.pageY, 12, C.muted, 'center');
  }
  r.text('即将进入回廊…', 195, ui.footerY, 12, C.muted, 'center');
}

module.exports = { drawStartup, drawPublication, startupLayout, publicationLayout };
