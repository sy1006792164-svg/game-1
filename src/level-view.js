'use strict';

const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { campaignRecord } = require('./campaign-progress');
const { drawChapterDirectory } = require('./chapter-view');
const { drawLevelHeader } = require('./level-header-view');
const { drawScrollEdges } = require('./page-feedback');
const { CARD_HEIGHT, ROW_HEIGHT, CHAPTER_HEADER, CHAPTER_HEIGHT, levelBrowserMode, replayLevels,
  levelBrowserLayout, levelListLayout, levelProgressOffset, levelChapterAtOffset, levelBrowserChapter,
  navigateLevelBrowser } = require('./level-navigation');

const clamp = value => Math.max(0, Math.min(1, value));

function drawLetterCard(r, x, y, w, h, unlocked, next, held) {
  r.panel(x, y, w, h, { fill: held && unlocked ? '#e5ecde' : next ? '#fff7e5' : unlocked ? C.panel : '#dce5dc',
    stroke: next ? '#cba477' : C.line, accent: next ? C.gold : unlocked ? C.green : null, radius: 13 });
  r.round(x + 6, y + 6, w - 12, h - 12, 8, null, next ? '#e7d4af' : unlocked ? '#e1e7d9' : '#d0dbd0');
  r.line([[x + 17, y + h - 42], [x + w - 17, y + h - 42]], next ? '#d5b98b' : '#b6cab9', .8, [3, 4]);
  r.circle(x + 136, y + 26, 14, next ? '#dfbf8e55' : '#78977d1c');
  r.circle(x + 136, y + 24, 13, next ? '#f6e6c6' : unlocked ? '#e6eee0' : '#d3dfd2', next ? '#c8a476' : '#abc1ae');
  if (unlocked) r.line([[x + w - 29, y + 15], [x + w - 20, y + 15]], '#fffdf4', 1.4);
}

function drawLevelCard(r, game, level, record, index, rect, viewport, current, saved) {
  const scroll = game.levelScroll, now = Number.isFinite(r.pageNow) ? r.pageNow : r.now, c = r.ctx;
  if (!scroll.revealed.has(index)) {
    if (scroll.revealed.size >= 64) scroll.revealed.delete(scroll.revealed.keys().next().value);
    const entering = now - scroll.enteredAt < 200 && !scroll.touching && !scroll.dragged && scroll.wheelTarget === null;
    scroll.revealed.set(index, entering ? now + index % PER_CHAPTER * 26 : now - 320);
  }
  if (scroll.touching || scroll.dragged || scroll.wheelTarget !== null) scroll.revealed.set(index, Math.min(scroll.revealed.get(index), now - 320));
  const progress = clamp((now - scroll.revealed.get(index)) / 320);
  const ease = r.reducedMotion || r.effectsQuality === 'low' ? 1 : 1 - Math.pow(1 - progress, 3);
  const { x, w, h } = rect, y = rect.y + (1 - ease) * 10;
  const unlocked = game.unlocked(index), next = level.id === current.id;
  const inProgress = saved && saved.levelId === level.id, highlighted = next || inProgress;
  const held = game.pointer && !game.pointer.dragging && insideRect(viewport, game.pointer.x, game.pointer.y) && insideRect(rect, game.pointer.x, game.pointer.y);
  c.save(); c.globalAlpha *= ease;
  const scale = held ? .975 : 1;
  c.translate(x + w / 2, y + h / 2); c.scale(scale, scale); c.translate(-x - w / 2, -y - h / 2);
  drawLetterCard(r, x, y, w, h, unlocked, highlighted, held);
  r.text(String(level.id).padStart(3, '0'), x + 17, y + 26, 22, unlocked ? C.green : '#74897a', 'left', '600');
  if (inProgress) r.text('进行中', x + 77, y + 26, 10, C.goldText);
  else if (next && !record) r.text('待送达', x + 77, y + 26, 10, C.goldText);
  const idle = unlocked && !record && highlighted && !held && !scroll.touching &&
    Math.abs(scroll.velocity) < 4 && scroll.wheelTarget === null && progress === 1 &&
    now - scroll.enteredAt > 800 && now - scroll.activeAt > 800 && !r.reducedMotion && r.effectsQuality !== 'low';
  const time = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  const phase = (time + index * 719) % 6200 / 820;
  const lift = idle && phase < 1 ? Math.sin(phase * Math.PI) ** 2 : 0;
  if (highlighted && unlocked && !record) {
    // A traveling dash on the envelope fold leads toward its opening action.
    // Keep every highlight inside the card, so adjacent locked routes stay clear.
    const routePhase = idle ? (time % 4200) / 4200 : .5;
    const length = 12, start = x + 18 + routePhase * (w - 48);
    const alpha = Math.round((idle ? Math.sin(routePhase * Math.PI) : .8) * 220).toString(16).padStart(2, '0');
    r.line([[start, y + h - 42], [Math.min(x + w - 17, start + length), y + h - 42]], C.gold + alpha, 1.6);
  }
  c.save(); c.translate(x + 136, y + 25 - lift * 2);
  c.rotate(lift * Math.sin(phase * Math.PI * 2) * .12);
  r.actionIcon(unlocked ? record ? 'check' : 'letter' : 'lock', 0, 0, unlocked ? C.gold : '#74897a');
  c.restore();
  r.label(level.title, x + 17, y + 53, 132, 14, unlocked ? C.ink : C.muted, 'left', '500');
  r.label('三星 ' + level.par + '拍内·无道具/续灯', x + 17, y + 72, 132, 10, C.muted);
  if (record) {
    for (let star = 0; star < 3; star++) r.icon('star', x + 23 + star * 21, y + h - 24, 14, star < record.stars ? C.gold : C.line);
    r.text(record.bestTurns + ' 拍', x + 125, y + h - 24, 10, C.muted, 'right');
  } else r.text(inProgress ? '继续投递' : unlocked ? '开始投递' : '先送达上一封', x + 17, y + h - 23, 11, highlighted ? C.goldText : unlocked ? C.green : C.muted);
  if (unlocked) r.actionIcon('arrow-right', x + 145, y + h - 24, highlighted ? C.gold : C.green);
  c.restore();
  r.hit(x, y, w, h, () => unlocked ? game.selectLevel(level.id) : game.toast('送达上一封信后开启'),
    (px, py) => insideRect(viewport, px, py));
}

function drawAllLevels(r, game, profile, current, saved, viewport, contentHeight) {
  const scroll = game.levelScroll;
  // Render only chapters intersecting the viewport, not all 999 cards.
  const first = Math.max(0, Math.floor(scroll.offset / CHAPTER_HEIGHT));
  const last = Math.min(chapterNames.length - 1, Math.floor((scroll.offset + viewport.h) / CHAPTER_HEIGHT));
  for (let chapter = first; chapter <= last; chapter++) {
    const baseY = viewport.y + chapter * CHAPTER_HEIGHT - scroll.offset;
    if (baseY + 34 > viewport.y && baseY < viewport.y + viewport.h) {
      r.label(chapterNames[chapter], 25, baseY + 18, 248, 20, C.ink, 'left', '600');
      r.text('第 ' + (chapter + 1) + ' 章', 365, baseY + 19, 10, C.muted, 'right');
    }
    const end = Math.min(CAMPAIGN.length, (chapter + 1) * PER_CHAPTER);
    for (let index = chapter * PER_CHAPTER; index < end; index++) {
      const slot = index % PER_CHAPTER, level = CAMPAIGN[index];
      const rect = { x: 24 + slot % 2 * 178, y: baseY + CHAPTER_HEADER + Math.floor(slot / 2) * ROW_HEIGHT, w: 164, h: CARD_HEIGHT };
      if (rect.y + rect.h > viewport.y && rect.y < viewport.y + viewport.h) drawLevelCard(r, game, level, campaignRecord(profile, String(level.id)), index, rect, viewport, current, saved);
    }
  }
  const endY = viewport.y + contentHeight - 18 - scroll.offset;
  if (endY > viewport.y && endY < viewport.y + viewport.h) r.text('九百九十九封信，寄往远方。', 195, endY, 11, C.muted, 'center');
}

function drawReplayLevels(r, game, profile, progress, current, saved, viewport) {
  const levels = replayLevels(game), offset = game.levelScroll.offset;
  if (!levels.length) {
    const y = viewport.y + Math.min(92, viewport.h * .22);
    const untouched = progress.completedCount === 0, inaccessible = progress.replayLevels.length > 0;
    r.actionIcon(untouched ? 'letter' : inaccessible ? 'route' : 'check', 195, y, C.green);
    r.text(untouched ? '先送达一封来信' : inaccessible ? '暂无可重投的来信' : '已送达的来信都已三星', 195, y + 37, 17, C.ink, 'center', '600');
    const description = untouched ? '已送达但不足三星的来信会收在这里。' : inaccessible ? '先送达前一封，即可重访对应来信。' :
      progress.perfectCount === CAMPAIGN.length ? '所有来信已三星送达，随时可以重温旅程。' : '下一段旅程，还有新的星光等你。';
    r.text(description, 195, y + 68, 11, C.muted, 'center');
    r.button('回到主线进度', 98, y + 96, 194, CONTROL.height, () => game.scrollToProgress(), { style: 'primary', icon: 'route' });
    return;
  }
  r.text(levels.length + ' 封待摘星 · 目标拍内送达，不用道具或续灯', 25, viewport.y + 18 - offset, 11, C.muted);
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
  [['all', '全部来信'], ['replay', '待摘星'], ['chapters', '章节目录']].forEach(([key, title], index) => {
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
  else drawAllLevels(r, game, profile, current, saved, viewport, contentHeight);
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
