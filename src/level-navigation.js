'use strict';

const { CAMPAIGN, PER_CHAPTER } = require('./levels');

const CARD_HEIGHT = 126, ROW_HEIGHT = 140, CHAPTER_HEADER = 44, DIRECTORY_ROW = 96;
const CHAPTER_HEIGHT = CHAPTER_HEADER + Math.ceil(PER_CHAPTER / 2) * ROW_HEIGHT + 20;
const MODES = ['all', 'replay', 'chapters'];
const replayCache = new WeakMap();

function levelBrowserMode(game) {
  return game.levelBrowser && MODES.includes(game.levelBrowser.mode) ? game.levelBrowser.mode : 'all';
}

function replayLevels(game) {
  const progress = game.album().progress, previous = replayCache.get(game);
  if (previous && previous.progress === progress && previous.development === game.development) return previous.levels;
  const levels = progress.replayLevels.filter(level => game.unlocked(level.id - 1));
  replayCache.set(game, { progress, development: game.development, levels });
  return levels;
}

function listLayout(height, contentHeight) {
  const viewport = { x: 18, y: 205, w: 354, h: Math.max(200, height - 233) };
  return { viewport, contentHeight, maxScroll: Math.max(0, contentHeight - viewport.h), chapterHeight: CHAPTER_HEIGHT };
}

function levelListLayout(height, count = CAMPAIGN.length) {
  if (!count) return listLayout(height, 0);
  const chapters = Math.ceil(count / PER_CHAPTER);
  const lastRows = Math.ceil((count - (chapters - 1) * PER_CHAPTER) / 2);
  return listLayout(height, (chapters - 1) * CHAPTER_HEIGHT + CHAPTER_HEADER + lastRows * ROW_HEIGHT + 44);
}

function levelBrowserLayout(game, height) {
  const mode = levelBrowserMode(game);
  if (mode === 'chapters') return listLayout(height, game.album().progress.chapters.length * DIRECTORY_ROW + 8);
  if (mode === 'replay') {
    const count = replayLevels(game).length;
    return listLayout(height, count ? CHAPTER_HEADER + Math.ceil(count / 2) * ROW_HEIGHT + 24 : 0);
  }
  return levelListLayout(height);
}

function levelProgressOffset(level, height) {
  return Math.min(level.chapter * CHAPTER_HEIGHT, levelListLayout(height).maxScroll);
}

// Count remains the campaign level count in both all and directory modes.
function levelChapterAtOffset(offset, height, count = CAMPAIGN.length, mode = 'all') {
  const chapters = Math.max(1, Math.ceil(count / PER_CHAPTER));
  const { viewport } = levelListLayout(height, count);
  const focus = Math.max(0, Number(offset) || 0) + viewport.h * .3;
  return Math.min(chapters - 1, Math.max(0, Math.floor(focus / (mode === 'chapters' ? DIRECTORY_ROW : CHAPTER_HEIGHT))));
}

function levelBrowserChapter(game, height) {
  const mode = levelBrowserMode(game), offset = game.levelScroll.offset;
  if (mode !== 'replay') return levelChapterAtOffset(offset, height, CAMPAIGN.length, mode);
  const levels = replayLevels(game);
  if (!levels.length) return game.nextLevel().chapter;
  const { viewport } = levelBrowserLayout(game, height);
  const row = Math.max(0, Math.floor((offset + viewport.h * .3 - CHAPTER_HEADER) / ROW_HEIGHT));
  return levels[Math.min(levels.length - 1, row * 2)].chapter;
}

function navigateLevelBrowser(game, mode = 'all', levelId) {
  if (!MODES.includes(mode)) mode = 'all';
  const now = game.platform.now(), scroll = game.levelScroll, renderer = game.renderer;
  game.levelBrowser = { mode };
  game.pointer = null; renderer.pointer = null; renderer.hits = []; renderer.levelRect = null;
  scroll.reset(now);
  const layout = levelBrowserLayout(game, renderer.H);
  scroll.setBounds(layout.maxScroll);
  const level = CAMPAIGN.find(entry => entry.id === levelId);
  if (level) {
    if (mode === 'all') scroll.offset = levelProgressOffset(level, renderer.H);
    else if (mode === 'chapters') scroll.offset = Math.min(layout.maxScroll, level.chapter * DIRECTORY_ROW);
    else {
      const index = replayLevels(game).indexOf(level);
      if (index >= 0) scroll.offset = Math.min(layout.maxScroll, Math.floor(index / 2) * ROW_HEIGHT);
    }
  }
  scroll.activeAt = now;
}

module.exports = { CARD_HEIGHT, ROW_HEIGHT, CHAPTER_HEADER, CHAPTER_HEIGHT, DIRECTORY_ROW,
  levelBrowserMode, replayLevels, levelBrowserLayout, levelListLayout, levelProgressOffset,
  levelChapterAtOffset, levelBrowserChapter, navigateLevelBrowser };
