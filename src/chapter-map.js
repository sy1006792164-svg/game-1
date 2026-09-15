'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { campaignRecord } = require('./campaign-progress');
const { chapterMood } = require('./chapter-atmosphere');
const { levelBrowserChapter, navigateLevelBrowser } = require('./level-navigation');

function chapterMapNodes(chapter, viewport) {
  const first = viewport.y + 100, last = viewport.y + viewport.h - 136;
  const span = Math.max(130, Math.min(330, last - first)), top = first + Math.max(0, last - first - span) / 2;
  const positions = chapter.levels.length <= 3 ? [[96, 0], [280, .5], [174, 1]] :
    [[96, 0], [280, 0], [280, .5], [96, .5], [96, 1], [280, 1]];
  return chapter.levels.map((level, index) => {
    const [x, fraction] = positions[index], y = top + span * fraction;
    return { level, x, y, rect: { x: x - 68, y: y - 45, w: 136, h: 111 } };
  });
}

function polygon(r, points, fill, stroke) {
  const c = r.ctx;
  c.beginPath(); c.moveTo(...points[0]);
  for (const point of points.slice(1)) c.lineTo(...point);
  c.closePath(); c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}

function drawIsland(r, x, y, active, unlocked, finale, mood) {
  const c = r.ctx;
  c.save(); c.globalAlpha *= unlocked ? 1 : .68;
  c.beginPath(); c.ellipse(x, y + 21, 54, 12, 0, 0, Math.PI * 2);
  c.fillStyle = '#203f3b18'; c.fill();
  const w = finale ? 47 : 43, h = finale ? 19 : 17;
  polygon(r, [[x - w, y], [x, y + h], [x, y + 35], [x - w + 12, y + 18]], mood.treeFar, mood.treeNear);
  polygon(r, [[x, y + h], [x + w, y], [x + w - 13, y + 19], [x, y + 35]], mood.treeNear);
  polygon(r, [[x, y - h], [x + w, y], [x, y + h], [x - w, y]],
    active ? '#f9e6ad' : unlocked ? C.soft : mood.ridgeFar, active ? C.gold : mood.treeFar);
  r.line([[x - w + 9, y + 1], [x, y + h - 5], [x + w - 9, y + 1]], '#fffdf46e', 1.5);
  // A tiny pennant and pine establish a place, without competing with the route number.
  r.line([[x - 29, y - 2], [x - 29, y - 21]], active ? C.goldText : mood.treeNear, 2);
  polygon(r, [[x - 29, y - 21], [x - 14, y - 17], [x - 29, y - 13]], active ? C.orange : mood.light);
  if (finale) {
    r.round(x + 17, y - 18, 17, 17, 2, unlocked ? C.panel : mood.ridgeFar, mood.treeNear);
    polygon(r, [[x + 13, y - 17], [x + 26, y - 30], [x + 39, y - 17]], unlocked ? C.orange : mood.treeFar);
    r.round(x + 24, y - 10, 5, 9, 1, C.gold);
  } else {
    r.line([[x + 29, y - 3], [x + 29, y - 25]], mood.treeNear, 2);
    polygon(r, [[x + 29, y - 34], [x + 17, y - 12], [x + 41, y - 12]], mood.treeNear);
  }
  c.restore();
}

function drawMailRoute(r, game, nodes, now) {
  const c = r.ctx;
  for (let index = 1; index < nodes.length; index++) {
    const from = nodes[index - 1], to = nodes[index], open = game.unlocked(to.level.id - 1);
    const middle = (from.y + to.y) / 2, bend = from.x === to.x ? (from.x < 195 ? -38 : 38) : 0;
    c.save(); c.beginPath(); c.moveTo(from.x, from.y + 10);
    c.bezierCurveTo(from.x + bend, middle, to.x + bend, middle, to.x, to.y + 10);
    c.lineWidth = open ? 4 : 2; c.strokeStyle = open ? C.gold : C.line;
    c.setLineDash(open ? [3, 9] : [2, 8]);
    if (open && !r.reducedMotion && r.effectsQuality !== 'low' && !game.levelScroll.touching)
      c.lineDashOffset = -now / 180;
    c.stroke(); c.restore();
  }
}

function drawMapNode(r, game, node, profile, current, saved, viewport, mood, now, finale) {
  const { level, x, y, rect } = node;
  const record = campaignRecord(profile, String(level.id)), unlocked = game.unlocked(level.id - 1);
  const inProgress = !!saved && saved.levelId === level.id, next = level.id === current.id;
  const active = unlocked && (inProgress || next && !record), c = r.ctx;
  const held = game.pointer && !game.pointer.dragging && insideRect(rect, game.pointer.x, game.pointer.y);
  const still = r.reducedMotion || r.effectsQuality === 'low' || game.levelScroll.touching;
  const pulse = still ? .5 : .5 + Math.sin(now / 800) * .5;
  c.save();
  if (active) {
    c.save();
    c.globalAlpha *= .14 + pulse * .1;
    c.beginPath(); c.ellipse(x, y + 4, 62 + pulse * 2, 28 + pulse, 0, 0, Math.PI * 2);
    c.fillStyle = C.gold; c.fill(); c.restore();
  }
  if (held && unlocked) { c.translate(x, y); c.scale(.96, .96); c.translate(-x, -y); }
  drawIsland(r, x, y, active, unlocked, finale, mood);
  r.circle(x, y - 5, 18, unlocked ? C.panel : C.soft, active ? C.gold : C.line);
  if (unlocked) r.text(String(level.id).padStart(3, '0'), x, y - 4, 12, C.ink, 'center', '600');
  else { r.actionIcon('lock', x, y - 5, C.muted); r.text(String(level.id).padStart(3, '0'), x + 46, y - 10, 10, C.muted, 'center'); }
  for (let star = 0; star < 3; star++) r.icon('star', x - 17 + star * 17, y + 28, 11, record && star < record.stars ? C.gold : C.line);
  r.label(level.title, x, y + 47, 132, 12, unlocked ? C.ink : C.muted, 'center', active ? '600' : '400');
  const status = inProgress ? '进行中 · 继续投递' : record ? record.bestTurns + ' 拍 · ' + record.stars + ' 星' :
    next && unlocked ? '从这里出发' : unlocked ? '三星目标 ' + level.par + ' 拍' : '先送达上一封';
  r.label(status, x, y + 64, 132, 10, active ? C.goldText : C.muted, 'center');
  c.restore();
  const action = () => unlocked ? game.selectLevel(level.id) : game.toast('送达上一封信后开启');
  action.focusId = 'level:' + level.id;
  r.hit(rect.x, rect.y, rect.w, rect.h, action, (px, py) => insideRect(viewport, px, py),
    '第 ' + level.id + ' 封 ' + level.title + ' ' + status);
}

function drawChapterMap(r, game, progress, profile, current, saved, viewport) {
  const index = levelBrowserChapter(game, r.H), chapter = progress.chapters[index];
  const mood = chapterMood(index, progress.chapters.length), nodes = chapterMapNodes(chapter, viewport);
  const now = Number.isFinite(r.ambientNow) ? r.ambientNow : r.now;
  r.text('第 ' + (index + 1) + ' 章', 25, viewport.y + 14, 11, C.muted);
  r.label(chapter.name, 25, viewport.y + 42, 232, 22, C.ink, 'left', '600');
  r.text(chapter.stars + ' / ' + chapter.maxStars + ' 星光', 365, viewport.y + 17, 12, C.goldText, 'right');
  r.text('送达 ' + chapter.completedCount + ' / ' + chapter.count, 365, viewport.y + 40, 11, C.muted, 'right');
  drawMailRoute(r, game, nodes, now);
  for (let slot = 0; slot < nodes.length; slot++) drawMapNode(r, game, nodes[slot], profile, current, saved,
    viewport, mood, now, slot === nodes.length - 1);
  const footerY = viewport.y + viewport.h - CONTROL.height - 6;
  if (index > 0) r.button('上一章', 24, footerY, 104, CONTROL.height,
    () => navigateLevelBrowser(game, 'all', progress.chapters[index - 1].firstId), { style: 'secondary', size: 12 });
  r.button('回到进度', 141, footerY, 108, CONTROL.height,
    () => game.scrollToProgress(), { style: 'primary', icon: 'route', size: 12 });
  if (index + 1 < progress.chapters.length) r.button('下一章', 262, footerY, 104, CONTROL.height,
    () => navigateLevelBrowser(game, 'all', progress.chapters[index + 1].firstId), { style: 'secondary', size: 12 });
}

module.exports = { chapterMapNodes, drawChapterMap };
