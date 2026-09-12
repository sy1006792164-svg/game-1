'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { drawStampArt } = require('./stamp-art');
const { openStampDetail } = require('./stamp-detail-view');
const { STAMPS } = require('./stamp-album');
const { FILTERS, collectionFilter, visibleStamps, setCollectionFilter } = require('./stamp-collection');
const { quiet, drawScrollEdges, drawProgressGlint, drawLocatedCorners } = require('./page-feedback');

const locatedStamps = new WeakMap();

function locateNextStamp(game) {
  const album = game.album();
  if (!album.next || !setCollectionFilter(game, collectionFilter(game) === 'owned' ? 'all' : collectionFilter(game))) return false;
  const stamps = visibleStamps(game, album), index = stamps.findIndex(stamp => stamp.id === album.next.id);
  const scroll = game.collectionScroll;
  scroll.setBounds(collectionLayout(game.renderer.H, stamps.length).maxScroll);
  scroll.offset = Math.min(scroll.max, Math.floor(index / 3) * 160);
  scroll.activeAt = game.platform.now();
  // Locating is an immediate jump to one collectible, so don't replay the
  // entire grid entrance and briefly hide the item the player just requested.
  scroll.enteredAt = scroll.activeAt - 600;
  locatedStamps.set(scroll, { index: album.next.index, enteredAt: scroll.enteredAt,
    at: Number.isFinite(game.renderer.pageNow) ? game.renderer.pageNow : scroll.activeAt });
  return true;
}

function drawSummary(r, game, album) {
  const next = album.next, contentX = 151, contentWidth = 195, contentRight = contentX + contentWidth;
  r.panel(24, 94, 342, 114, { fill: C.panel, stroke: C.line, accent: C.gold, radius: 18 });
  r.text(album.ownedCount, 41, 129, 36, C.gold, 'left', '600');
  r.text('/ ' + album.stamps.length, 91, 136, 14, C.muted);
  r.text('枚已收藏', 42, 165, 10, C.muted);
  r.text(album.stars + ' 星的旅程', 42, 187, 9, C.muted);
  r.line([[130, 112], [130, 188]], '#cbd6c4', 1, [2, 4]);
  if (next) {
    const held = !game.modal && game.pointer && insideRect({ x: 139, y: 100, w: 220, h: 101 }, game.pointer.x, game.pointer.y);
    r.round(139, 101, 219, 99, 12, held ? '#efe0bd' : '#f5ecd7', held ? '#c59c65' : '#dfcba8');
  }
  r.text(next ? '下一枚收藏 · 定位邮票' : '全套珍藏已集齐', contentX, 114, 10, next ? C.goldText : C.green);
  r.label(next ? next.name : '沿途的风，都在这里', contentX, 140, contentWidth - (next ? 32 : 0), 16, C.ink, 'left', '600');
  if (next) {
    r.text('还差 ' + next.remaining + ' 星', contentX, 163, 11, C.muted);
    r.text('本段 ' + next.stageCurrent + ' / ' + next.stageGoal, contentRight, 163, 10, C.goldText, 'right');
    r.meter(contentX, 179, contentWidth, next.stageCurrent, next.stageGoal, C.gold);
    drawProgressGlint(r, contentX, 179, contentWidth, next.stageCurrent, next.stageGoal);
    r.text('累计 ' + next.current + ' / ' + next.goal + ' 星', contentX, 194, 9, C.muted);
    r.actionIcon('arrow-right', contentRight - 10, 140, C.gold);
    r.hit(139, 100, 220, 101, () => locateNextStamp(game));
  } else {
    r.text('每一次抵达，都成为珍藏', contentX, 165, 10, C.muted);
    r.meter(contentX, 187, contentWidth, album.ownedCount, album.stamps.length, C.green);
  }
}

const clamp = value => Math.max(0, Math.min(1, value));

function drawStamp(r, game, stamp, rect, viewport, now) {
  const scroll = game.collectionScroll, next = game.album().next === stamp;
  if (!scroll.revealed.has(stamp.index)) {
    const entering = now - scroll.enteredAt < 200 && !scroll.touching && !scroll.dragged && scroll.wheelTarget === null;
    const delay = Math.min(180, Math.floor(stamp.index / 3) * 45 + stamp.index % 3 * 30);
    scroll.revealed.set(stamp.index, entering ? now + delay : now - 360);
  }
  if (scroll.touching || scroll.dragged || scroll.wheelTarget !== null) scroll.revealed.set(stamp.index, Math.min(scroll.revealed.get(stamp.index), now - 360));
  const progress = clamp((now - scroll.revealed.get(stamp.index)) / 360);
  const ease = r.reducedMotion || r.effectsQuality === 'low' ? 1 : 1 - Math.pow(1 - progress, 3);
  const { x, w, h } = rect, y = rect.y + (1 - ease) * 14, c = r.ctx, middle = x + w / 2;
  const held = !game.modal && game.pointer && !game.pointer.dragging && insideRect(viewport, game.pointer.x, game.pointer.y) && insideRect(rect, game.pointer.x, game.pointer.y);
  const age = scroll.tapped && scroll.tapped.index === stamp.index ? (now - scroll.tapped.at) / 330 : 2;
  const bounce = !quiet(r) && age >= 0 && age < 1 ? Math.sin(age * Math.PI) * .04 : 0;
  const scale = (.97 + ease * .03) * (held ? .97 : 1 + bounce);
  c.save();
  c.globalAlpha *= ease * Math.min(clamp((y + h - viewport.y) / 22), clamp((viewport.y + viewport.h - y) / 22));
  c.translate(middle, y + h / 2); c.scale(scale, scale); c.translate(-middle, -y - h / 2);
  drawStampArt(r, stamp, { x, y, w, h }, { next, held, scrolling: scroll.touching || Math.abs(scroll.velocity) > 4 || scroll.wheelTarget !== null });
  const located = locatedStamps.get(scroll);
  if (located && located.index === stamp.index && located.enteredAt === scroll.enteredAt && !scroll.touching && !scroll.dragged && scroll.wheelTarget === null) {
    const age = now - located.at;
    if (age >= 0 && age < 1800) drawLocatedCorners(r, { x, y, w, h }, quiet(r) ? .85 : clamp((1800 - age) / 550));
  }
  c.restore();
  r.hit(x, y, w, h, () => {
    scroll.tapped = { index: stamp.index, at: game.platform.now() };
    openStampDetail(game, stamp.id);
  }, (px, py) => insideRect(viewport, px, py));
}

function collectionLayout(height, count = STAMPS.length) {
  if (!Number.isInteger(count) || count < 0) count = STAMPS.length;
  const viewport = { x: 18, y: 302, w: 354, h: Math.max(160, height - 330) };
  const rows = Math.ceil(count / 3), contentHeight = rows * 160 + 44;
  return { viewport, contentHeight, maxScroll: Math.max(0, contentHeight - viewport.h) };
}

function drawFilters(r, game, album) {
  const current = collectionFilter(game);
  FILTERS.forEach((filter, index) => {
    const count = filter.id === 'all' ? album.stamps.length : filter.id === 'owned' ? album.ownedCount : album.stamps.length - album.ownedCount;
    r.button(filter.label + ' ' + count, 24 + index * 116, 217, 110, CONTROL.compactHeight,
      () => setCollectionFilter(game, filter.id), { style: 'tab', selected: current === filter.id, size: 12 });
  });
}

function drawEmpty(r, game, viewport) {
  const owned = collectionFilter(game) === 'owned', y = viewport.y;
  r.icon(owned ? 'stamp' : 'star', 195, y + 28, 30, C.gold);
  r.text(owned ? '第一枚邮票，正在路上' : '沿途邮票已全部收藏', 195, y + 67, 17, C.ink, 'center', '600');
  r.text(owned ? '主线累计获得 1 星，就会自动收入邮票册。' : '翻开已收藏，读读每一枚邮票的短笺。', 195, y + 94, 11, C.muted, 'center');
  r.button(owned ? '去选一封信' : '查看已收藏', 85, y + 116, 220, CONTROL.height,
    owned ? () => game.openLevelBrowser('all') : () => setCollectionFilter(game, 'owned'), { style: 'primary', icon: owned ? 'route' : 'stamp' });
}

function drawCollection(r, game) {
  const album = game.album(), scroll = game.collectionScroll, stamps = visibleStamps(game, album);
  const now = Number.isFinite(r.pageNow) ? r.pageNow : r.now;
  const { viewport, contentHeight, maxScroll } = collectionLayout(r.H, stamps.length);
  r.collectionRect = viewport;
  scroll.setBounds(maxScroll);
  if (r.reducedMotion && !scroll.touching) {
    if (scroll.wheelTarget !== null) scroll.offset = scroll.wheelTarget;
    scroll.stop();
  }
  scroll.update(now);
  r.header('沿途邮票册', '把每一次抵达，慢慢收集起来', () => game.home());
  drawSummary(r, game, album);
  drawFilters(r, game, album);
  r.text('旅程纪念', 24, 282, 14, C.ink, 'left', '600');
  r.text('轻触邮票 · 读纪念短笺', 365, 282, 10, C.muted, 'right');
  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(viewport.x, viewport.y, viewport.w, viewport.h); c.clip();
  stamps.forEach((stamp, index) => {
    const row = Math.floor(index / 3), count = Math.min(3, stamps.length - row * 3);
    const rect = { x: (390 - (count * 106 + (count - 1) * 12)) / 2 + index % 3 * 118, y: viewport.y + 6 + row * 160 - scroll.offset, w: 106, h: 144 };
    if (rect.y + rect.h > viewport.y && rect.y < viewport.y + viewport.h) drawStamp(r, game, stamp, rect, viewport, now);
  });
  if (stamps.length) r.text('每一次抵达，都成为珍藏。', 195, viewport.y + contentHeight - 17 - scroll.offset, 11, C.muted, 'center');
  else drawEmpty(r, game, viewport);
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

module.exports = { drawCollection, collectionLayout, locateNextStamp };
