'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { campaignRecord } = require('./campaign-progress');
const { CHAPTER_HEIGHT } = require('./level-navigation');

const NODE_TOP = 116, NODE_ROW = 120;

function chapterMapNodes(chapter, section) {
  const positions = chapter.levels.length <= 3 ? [[96, 0], [280, .5], [174, 1]] :
    [[96, 0], [280, 0], [280, .5], [96, .5], [96, 1], [280, 1]];
  return chapter.levels.map((level, index) => {
    const [x, fraction] = positions[index], y = section.y + NODE_TOP + NODE_ROW * 2 * fraction;
    return { level, x, y, rect: { x: x - 72, y: y - 45, w: 144, h: 96 } };
  });
}

function drawMailRoute(r, game, nodes) {
  for (let index = 1; index < nodes.length; index++) {
    const from = nodes[index - 1], to = nodes[index];
    r.line([[from.x, from.y], [to.x, to.y]], game.unlocked(to.level.id - 1) ? C.green : C.line, 1.5, [3, 6]);
  }
}

function drawMapNode(r, game, node, profile, current, saved, viewport) {
  const { level, x, y, rect } = node;
  const record = campaignRecord(profile, String(level.id)), unlocked = game.unlocked(level.id - 1);
  const inProgress = !!saved && saved.levelId === level.id, next = level.id === current.id;
  const active = unlocked && (inProgress || next && !record);
  const held = game.pointer && !game.pointer.dragging && insideRect(rect, game.pointer.x, game.pointer.y);
  const left = rect.x + 14, right = rect.x + rect.w - 14;
  r.round(rect.x, rect.y, rect.w, rect.h, 16,
    held && unlocked ? C.soft : active ? C.peach : unlocked ? C.panel : C.paper, active ? C.orange : C.line);
  r.text(String(level.id).padStart(3, '0'), left, y - 23, 13, active ? C.goldText : C.muted, 'left', '600');
  r.actionIcon(unlocked ? record ? 'check' : 'letter' : 'lock', right - 6, y - 23,
    active ? C.orange : unlocked ? C.green : C.muted);
  r.label(level.title, left, y + 5, 118, 15, unlocked ? C.ink : C.muted, 'left', '600');
  const status = inProgress ? '进行中 · 继续投递' : record ? record.bestTurns + ' 拍 · ' + record.stars + ' 星' :
    next && unlocked ? '从这里出发' : unlocked ? '三星目标 ' + level.par + ' 拍' : '先送达上一封';
  r.label(status, left, y + 31, 118, 11, active ? C.goldText : C.muted);
  const action = () => unlocked ? game.selectLevel(level.id) : game.toast('送达上一封信后开启');
  action.focusId = 'level:' + level.id;
  r.hit(rect.x, rect.y, rect.w, rect.h, action, (px, py) => insideRect(viewport, px, py),
    '第 ' + level.id + ' 封 ' + level.title + ' ' + status);
}

function drawChapterSection(r, game, chapter, index, profile, current, saved, section, viewport, lastChapter) {
  const nodes = chapterMapNodes(chapter, section);
  r.text('第 ' + (index + 1) + ' 章', 25, section.y + 17, 12, C.muted);
  r.label(chapter.name, 25, section.y + 42, 232, 22, C.ink, 'left', '600');
  r.text(chapter.stars + ' / ' + chapter.maxStars + ' 星光', 365, section.y + 17, 12, C.goldText, 'right');
  r.text('送达 ' + chapter.completedCount + ' / ' + chapter.count, 365, section.y + 40, 12, C.muted, 'right');
  drawMailRoute(r, game, nodes);
  nodes.forEach(node => drawMapNode(r, game, node, profile, current, saved, viewport));
  if (!lastChapter) {
    const dividerY = section.y + CHAPTER_HEIGHT - 7;
    r.line([[42, dividerY], [348, dividerY]], C.line, 1);
  }
}

function drawChapterMap(r, game, progress, profile, current, saved, viewport) {
  const offset = game.levelScroll.offset;
  const tabHitHeight = Math.max(CONTROL.compactHeight, 44 / (r.scale || 1));
  const interactiveTop = Math.max(viewport.y,
    151 + CONTROL.compactHeight / 2 + tabHitHeight / 2);
  const interactiveViewport = { ...viewport, y: interactiveTop,
    h: Math.max(0, viewport.y + viewport.h - interactiveTop) };
  const first = Math.max(0, Math.floor(Math.max(0, offset) / CHAPTER_HEIGHT));
  const last = Math.min(progress.chapters.length - 1,
    Math.floor(Math.max(0, offset + viewport.h) / CHAPTER_HEIGHT));
  for (let index = first; index <= last; index++) {
    const section = { x: viewport.x, y: viewport.y + index * CHAPTER_HEIGHT - offset,
      w: viewport.w, h: CHAPTER_HEIGHT };
    drawChapterSection(r, game, progress.chapters[index], index, profile, current, saved,
      section, interactiveViewport, index === progress.chapters.length - 1);
  }
}

module.exports = { chapterMapNodes, drawChapterMap };
