'use strict';

const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('./levels');
const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');

const CARD_HEIGHT = 126, ROW_HEIGHT = 140, CHAPTER_HEADER = 44;
const CHAPTER_HEIGHT = CHAPTER_HEADER + Math.ceil(PER_CHAPTER / 2) * ROW_HEIGHT + 20;
const clamp = value => Math.max(0, Math.min(1, value));

function levelListLayout(height, count = CAMPAIGN.length) {
  const chapters = Math.ceil(count / PER_CHAPTER);
  const lastRows = Math.ceil((count - (chapters - 1) * PER_CHAPTER) / 2);
  const viewport = { x: 18, y: 148, w: 354, h: Math.max(200, height - 176) };
  const contentHeight = (chapters - 1) * CHAPTER_HEIGHT + CHAPTER_HEADER + lastRows * ROW_HEIGHT + 44;
  return { viewport, contentHeight, maxScroll: Math.max(0, contentHeight - viewport.h), chapterHeight: CHAPTER_HEIGHT };
}

function levelProgressOffset(level, height) {
  return Math.min(level.chapter * CHAPTER_HEIGHT, levelListLayout(height).maxScroll);
}

function drawLetterCard(r, x, y, w, h, unlocked, next, held) {
  r.panel(x, y, w, h, { fill: held && unlocked ? '#30544d' : next ? '#284742' : unlocked ? C.panel : C.dark,
    stroke: next ? '#a18c5e' : C.line, accent: next ? C.gold : null, radius: 11 });
  if (!unlocked) return;
  r.round(x + 6, y + 6, w - 12, h - 12, 7, null, next ? '#8b805855' : '#65877733');
  r.line([[x + 17, y + h - 42], [x + w - 17, y + h - 42]], next ? '#aa96666b' : '#76908255', .8, [3, 4]);
  r.circle(x + 136, y + 25, 13, next ? '#655a3544' : '#36584a55', next ? '#a9915d' : '#587768');
}

function drawLevelCard(r, game, level, record, index, rect, viewport, current, saved) {
  const scroll = game.levelScroll, now = r.now, c = r.ctx;
  if (!scroll.revealed.has(index)) {
    if (scroll.revealed.size >= 64) scroll.revealed.delete(scroll.revealed.keys().next().value);
    const entering = now - scroll.enteredAt < 200 && !scroll.touching && !scroll.dragged && scroll.wheelTarget === null;
    scroll.revealed.set(index, entering ? now + index % PER_CHAPTER * 26 : now - 320);
  }
  if (scroll.touching || scroll.dragged || scroll.wheelTarget !== null) scroll.revealed.set(index, Math.min(scroll.revealed.get(index), now - 320));
  const progress = clamp((now - scroll.revealed.get(index)) / 320), ease = 1 - Math.pow(1 - progress, 3);
  const { x, w, h } = rect, y = rect.y + (1 - ease) * 10;
  const unlocked = game.unlocked(index), next = level.id === current.id;
  const inProgress = saved && saved.levelId === level.id;
  const held = game.pointer && !game.pointer.dragging && insideRect(viewport, game.pointer.x, game.pointer.y) && insideRect(rect, game.pointer.x, game.pointer.y);
  c.save(); c.globalAlpha *= ease;
  const scale = held ? .975 : 1;
  c.translate(x + w / 2, y + h / 2); c.scale(scale, scale); c.translate(-x - w / 2, -y - h / 2);
  drawLetterCard(r, x, y, w, h, unlocked, next, held);
  r.text(String(level.id).padStart(3, '0'), x + 17, y + 26, 22, unlocked ? C.green : '#6c8780', 'left', '600');
  if (inProgress) r.text('进行中', x + 77, y + 26, 10, C.gold);
  r.actionIcon(unlocked ? record ? 'check' : 'letter' : 'lock', x + 136, y + 25, unlocked ? C.gold : '#6c8780');
  r.label(level.title, x + 17, y + 60, 132, 14, unlocked ? C.ink : C.muted, 'left', '500');
  if (record) {
    for (let star = 0; star < 3; star++) r.icon('star', x + 23 + star * 21, y + h - 24, 14, star < record.stars ? C.gold : C.line);
    r.text(record.bestTurns + ' 拍', x + 125, y + h - 24, 10, C.muted, 'right');
  } else r.text(inProgress ? '继续投递' : game.development ? '开发试玩' : unlocked ? '开始投递' : '先送达上一封', x + 17, y + h - 23, 11, next ? C.gold : unlocked ? C.green : C.muted);
  if (unlocked) r.actionIcon('arrow-right', x + 145, y + h - 24, next ? C.gold : C.green);
  c.restore();
  r.hit(x, y, w, h, () => unlocked ? game.selectLevel(level.id) : game.toast('送达上一封信后开启'),
    (px, py) => insideRect(viewport, px, py));
}

function drawLevels(r, game) {
  const profile = game.profile(), current = game.nextLevel(), saved = game.savedRun(), scroll = game.levelScroll;
  const { viewport, contentHeight, maxScroll } = levelListLayout(r.H);
  r.levelRect = viewport;
  scroll.setBounds(maxScroll); scroll.update(r.now);
  r.header('选一封来信', game.development ? '开发环境 · 全关卡自由试玩' : '上下滑动，沿着回声继续出发', () => game.home());
  r.text('主线旅程', 25, 106, 14, C.ink, 'left', '600');
  r.text('已送达 ' + game.completion() + ' / ' + CAMPAIGN.length, 25, 128, 10, C.muted);
  r.button('回到进度', 250, 91, 116, CONTROL.compactHeight, () => game.scrollToProgress(), { style: 'quiet', icon: 'route' });
  if (game.development) r.button('输入关卡号', 130, 91, 114, CONTROL.compactHeight, () => game.openDevelopmentPicker(), { style: 'secondary', icon: 'grid' });

  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(viewport.x, viewport.y, viewport.w, viewport.h); c.clip();
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
      if (rect.y + rect.h > viewport.y && rect.y < viewport.y + viewport.h) drawLevelCard(r, game, level, profile.completed[String(level.id)], index, rect, viewport, current, saved);
    }
  }
  const endY = viewport.y + contentHeight - 18 - scroll.offset;
  if (endY > viewport.y && endY < viewport.y + viewport.h) r.text('九百九十九封信，寄往远方。', 195, endY, 11, C.muted, 'center');
  c.restore();
  const alpha = scroll.touching || Math.abs(scroll.velocity) > 4 ? .65 : clamp(1 - (r.now - scroll.activeAt - 600) / 450) * .65;
  if (maxScroll > 0 && alpha > 0) {
    const thumb = Math.max(34, viewport.h * viewport.h / contentHeight);
    c.save(); c.globalAlpha *= alpha;
    r.round(377, viewport.y + (viewport.h - thumb) * clamp(scroll.offset / maxScroll), 2, thumb, 1, '#a7b997');
    c.restore();
  }
}

module.exports = { drawLevels, levelListLayout, levelProgressOffset };
