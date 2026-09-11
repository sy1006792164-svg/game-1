'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');
const { drawStampArt } = require('./stamp-art');
const { openStampDetail } = require('./stamp-detail-view');

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
  r.text(next ? '下一枚收藏 · 去送信' : '全套珍藏已集齐', contentX, 114, 10, next ? C.goldText : C.green);
  r.label(next ? next.name : '沿途的风，都在这里', contentX, 140, contentWidth - (next ? 32 : 0), 16, C.ink, 'left', '600');
  if (next) {
    r.text('再得 ' + (next.goal - next.current) + ' 星', contentX, 165, 11, C.muted);
    r.text(next.current + ' / ' + next.goal + ' 星', contentRight, 165, 10, C.goldText, 'right');
    r.meter(contentX, 187, contentWidth, next.current, next.goal, C.gold);
    r.actionIcon('arrow-right', contentRight - 10, 140, C.gold);
    r.hit(139, 100, 220, 101, () => game.openPage('levels'));
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
  const bounce = !r.reducedMotion && age >= 0 && age < 1 ? Math.sin(age * Math.PI) * .04 : 0;
  const scale = (.97 + ease * .03) * (held ? .97 : 1 + bounce);
  c.save();
  c.globalAlpha *= ease * Math.min(clamp((y + h - viewport.y) / 22), clamp((viewport.y + viewport.h - y) / 22));
  c.translate(middle, y + h / 2); c.scale(scale, scale); c.translate(-middle, -y - h / 2);
  drawStampArt(r, stamp, { x, y, w, h }, { next, held });
  c.restore();
  r.hit(x, y, w, h, () => {
    scroll.tapped = { index: stamp.index, at: game.platform.now() };
    openStampDetail(game, stamp.id);
  }, (px, py) => insideRect(viewport, px, py));
}

function collectionLayout(height, count) {
  const viewport = { x: 18, y: 251, w: 354, h: Math.max(160, height - 279) };
  const rows = Math.ceil(count / 3), contentHeight = rows * 160 + 44;
  return { viewport, contentHeight, maxScroll: Math.max(0, contentHeight - viewport.h) };
}

function drawCollection(r, game) {
  const album = game.album(), scroll = game.collectionScroll;
  const now = Number.isFinite(r.pageNow) ? r.pageNow : r.now;
  const { viewport, contentHeight, maxScroll } = collectionLayout(r.H, album.stamps.length);
  r.collectionRect = viewport;
  scroll.setBounds(maxScroll);
  if (r.reducedMotion && !scroll.touching) {
    if (scroll.wheelTarget !== null) scroll.offset = scroll.wheelTarget;
    scroll.stop();
  }
  scroll.update(now);
  r.header('沿途邮票册', '把每一次抵达，慢慢收集起来', () => game.home());
  drawSummary(r, game, album);
  r.text('旅程纪念', 24, 232, 14, C.ink, 'left', '600');
  r.text('轻触邮票 · 查看详情', 365, 232, 10, C.muted, 'right');
  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(viewport.x, viewport.y, viewport.w, viewport.h); c.clip();
  album.stamps.forEach((stamp, index) => {
    const row = Math.floor(index / 3), count = Math.min(3, album.stamps.length - row * 3);
    const rect = { x: (390 - (count * 106 + (count - 1) * 12)) / 2 + index % 3 * 118, y: viewport.y + 6 + row * 160 - scroll.offset, w: 106, h: 144 };
    if (rect.y + rect.h > viewport.y && rect.y < viewport.y + viewport.h) drawStamp(r, game, stamp, rect, viewport, now);
  });
  r.text('每一次抵达，都成为珍藏。', 195, viewport.y + contentHeight - 17 - scroll.offset, 11, C.muted, 'center');
  c.restore();
  const alpha = scroll.touching || Math.abs(scroll.velocity) > 4 ? .65 : clamp(1 - (now - scroll.activeAt - 600) / 450) * .65;
  if (maxScroll > 0 && alpha > 0) {
    const thumb = Math.max(34, viewport.h * viewport.h / contentHeight);
    c.save(); c.globalAlpha *= alpha;
    r.round(377, viewport.y + (viewport.h - thumb) * clamp(scroll.offset / maxScroll), 2, thumb, 1, C.green);
    c.restore();
  }
}

module.exports = { drawCollection, collectionLayout };
