'use strict';

const { CAMPAIGN } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawLevelCard } = require('./level-card-view');
const { campaignRecord } = require('./campaign-progress');
const { drawChapterDirectory } = require('./chapter-view');
const { drawChapterMap } = require('./chapter-map');
const { drawLevelHeader } = require('./level-header-view');
const { difficultyProfile } = require('./difficulty');
const { drawScrollEdges } = require('./page-feedback');
const { CARD_HEIGHT, ROW_HEIGHT, CHAPTER_HEADER, levelBrowserMode, replayLevels,
  levelBrowserLayout, levelListLayout, levelProgressOffset, levelChapterAtOffset, levelBrowserChapter,
  navigateLevelBrowser } = require('./level-navigation');

const clamp = value => Math.max(0, Math.min(1, value));

function drawReplayLevels(r, game, profile, progress, current, saved, viewport) {
  const levels = replayLevels(game), offset = game.levelScroll.offset;
  if (!levels.length) {
    const y = viewport.y + Math.min(92, viewport.h * .22);
    const untouched = progress.completedCount === 0, inaccessible = progress.replayLevels.length > 0;
    r.actionIcon(untouched ? 'letter' : inaccessible ? 'route' : 'check', 195, y, C.green);
    r.text(untouched ? '先送达一封来信' : inaccessible ? '暂无可重投的来信' : '已送达的来信都已三星', 195, y + 37, 17, C.ink, 'center', '600');
    const description = untouched ? '已送达但不足三星的来信会收在这里。' : inaccessible ? '先送达前一封，即可重访对应来信。' :
      progress.perfectCount === CAMPAIGN.length ? '所有来信已三星送达，随时可以重温旅程。' : '下一段旅程，还有新的星光等你。';
    r.text(description, 195, y + 68, 12, C.muted, 'center');
    r.button('回到主线进度', 98, y + 96, 194, CONTROL.height, () => game.scrollToProgress(), { style: 'primary', icon: 'route' });
    return;
  }
  r.text(levels.length + ' 封来信，等待补齐星光', 25, viewport.y + 18 - offset, 13, C.ink, 'left', '600');
  const firstRow = Math.max(0, Math.floor((offset - CHAPTER_HEADER) / ROW_HEIGHT));
  const lastRow = Math.min(Math.ceil(levels.length / 2) - 1, Math.floor((offset + viewport.h - CHAPTER_HEADER) / ROW_HEIGHT));
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = 0; column < 2; column++) {
      const level = levels[row * 2 + column];
      if (!level) continue;
      const rect = { x: 24 + column * 178, y: viewport.y + CHAPTER_HEADER + row * ROW_HEIGHT - offset, w: 164, h: CARD_HEIGHT };
      if (rect.y + rect.h > viewport.y && rect.y < viewport.y + viewport.h) drawLevelCard(r, game, level, campaignRecord(profile, String(level.id)), level.id - 1, rect, viewport, current, saved);
    }
  }
}

function drawLevels(r, game) {
  const profile = game.profile(), progress = game.album().progress;
  const current = game.nextLevel(), run = game.savedRun(), scroll = game.levelScroll;
  const saved = run && run.mode === 'campaign' && CAMPAIGN[run.levelId - 1] && game.unlocked(run.levelId - 1) ? run : null;
  const mode = levelBrowserMode(game), now = Number.isFinite(r.pageNow) ? r.pageNow : r.now;
  const { viewport, contentHeight, maxScroll } = levelBrowserLayout(game, r.H);
  r.levelRect = viewport;
  scroll.setBounds(maxScroll);
  if (r.reducedMotion && !scroll.touching) {
    if (scroll.wheelTarget !== null) scroll.offset = scroll.wheelTarget;
    scroll.stop();
  }
  scroll.update(now);
  drawLevelHeader(r, game, progress, mode);
  r.round(24, 151, 342, CONTROL.compactHeight, 14, C.soft);
  [['all', '邮路地图'], ['replay', '待摘星'], ['chapters', '章节目录']].forEach(([key, title], index) => {
    r.button(title, 24 + index * 117, 151, 108, CONTROL.compactHeight, () => {
      if (key === mode) return;
      if (key === 'all') game.scrollToProgress();
      else navigateLevelBrowser(game, key, key === 'chapters' ? (saved ? saved.levelId : current.id) : undefined);
    }, { style: 'tab', selected: key === mode, size: 13 });
  });

  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(viewport.x, viewport.y, viewport.w, viewport.h); c.clip();
  if (mode === 'chapters') drawChapterDirectory(r, game, progress.chapters, viewport, current, saved);
  else if (mode === 'replay') drawReplayLevels(r, game, profile, progress, current, saved, viewport);
  else drawChapterMap(r, game, progress, profile, current, saved, viewport);
  c.restore();
  drawScrollEdges(r, viewport, scroll);
  const alpha = scroll.touching || Math.abs(scroll.velocity) > 4 ? .65 : clamp(1 - (now - scroll.activeAt - 600) / 450) * .65;
  if (maxScroll > 0 && alpha > 0) {
    const thumb = Math.max(34, viewport.h * viewport.h / contentHeight);
    c.save(); c.globalAlpha *= alpha;
    r.round(377, viewport.y + (viewport.h - thumb) * clamp(scroll.offset / maxScroll), 2, thumb, 1, C.green);
    c.restore();
  }
}

module.exports = { drawLevels, levelListLayout, levelProgressOffset, levelChapterAtOffset,
  levelBrowserLayout, levelBrowserChapter, navigateLevelBrowser };
