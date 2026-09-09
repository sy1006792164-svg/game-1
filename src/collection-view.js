'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');

const INKS = ['#376f5d', '#a87440', '#3b7b88', '#65754a'];

// The notches are part of the paper silhouette, so no painted holes cover the artwork.
function stampOutline(c, x, y, w, h) {
  const notch = 1.65, inset = 10, spacing = 11;
  c.beginPath(); c.moveTo(x + 3, y);
  for (let px = x + inset; px < x + w - inset; px += spacing) {
    c.lineTo(px - notch, y); c.quadraticCurveTo(px, y + notch * 2, px + notch, y);
  }
  c.lineTo(x + w - 3, y); c.quadraticCurveTo(x + w, y, x + w, y + 3);
  for (let py = y + inset; py < y + h - inset; py += spacing) {
    c.lineTo(x + w, py - notch); c.quadraticCurveTo(x + w - notch * 2, py, x + w, py + notch);
  }
  c.lineTo(x + w, y + h - 3); c.quadraticCurveTo(x + w, y + h, x + w - 3, y + h);
  for (let px = x + w - inset; px > x + inset; px -= spacing) {
    c.lineTo(px + notch, y + h); c.quadraticCurveTo(px, y + h - notch * 2, px - notch, y + h);
  }
  c.lineTo(x + 3, y + h); c.quadraticCurveTo(x, y + h, x, y + h - 3);
  for (let py = y + h - inset; py > y + inset; py -= spacing) {
    c.lineTo(x, py + notch); c.quadraticCurveTo(x + notch * 2, py, x, py - notch);
  }
  c.lineTo(x, y + 3); c.quadraticCurveTo(x, y, x + 3, y); c.closePath();
}

function drawSummary(r, game, album) {
  const next = album.next, contentX = 151, contentWidth = 195, contentRight = contentX + contentWidth;
  r.panel(24, 94, 342, 114, { fill: '#1e3b3d', stroke: '#43605b', accent: C.gold });
  r.text(album.ownedCount, 41, 129, 36, C.gold, 'left', '600');
  r.text('/ ' + album.stamps.length, 91, 136, 14, C.muted);
  r.text('枚已收藏', 42, 165, 10, C.muted);
  r.text(album.stars + ' 星的旅程', 42, 187, 9, '#96aea0');
  r.line([[130, 112], [130, 188]], '#49645c', 1);
  if (next) {
    const held = game.pointer && insideRect({ x: 139, y: 100, w: 220, h: 101 }, game.pointer.x, game.pointer.y);
    r.round(139, 101, 219, 99, 9, held ? '#30544b' : '#24443e', held ? '#a8915f' : '#4f705c');
  }
  r.text(next ? '下一枚收藏 · 去送信' : '全套珍藏已集齐', contentX, 114, 10, next ? C.gold : C.green);
  r.label(next ? next.name : '沿途的风，都在这里', contentX, 140, contentWidth - (next ? 32 : 0), 16, C.ink, 'left', '600');
  if (next) {
    r.text('再得 ' + (next.goal - next.current) + ' 星', contentX, 165, 11, C.muted);
    r.text(next.current + ' / ' + next.goal + ' 星', contentRight, 165, 10, C.gold, 'right');
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
  const progress = clamp((now - scroll.revealed.get(stamp.index)) / 360), ease = 1 - Math.pow(1 - progress, 3);
  const { x, w, h } = rect, y = rect.y + (1 - ease) * 14, c = r.ctx, middle = x + w / 2;
  const held = game.pointer && !game.pointer.dragging && insideRect(viewport, game.pointer.x, game.pointer.y) && insideRect(rect, game.pointer.x, game.pointer.y);
  const age = scroll.tapped && scroll.tapped.index === stamp.index ? (now - scroll.tapped.at) / 330 : 2;
  const bounce = age >= 0 && age < 1 ? Math.sin(age * Math.PI) * .04 : 0;
  const scale = (.97 + ease * .03) * (held ? .97 : 1 + bounce);
  const owned = stamp.owned, ink = owned ? INKS[stamp.index % INKS.length] : next ? C.gold : '#78958a';
  const paper = owned ? '#e7dfc7' : next ? '#37493e' : '#1c3638';
  const border = held ? owned ? '#658b65' : C.gold : owned ? '#b9c09d' : next ? '#d1a365' : '#3b5850';
  c.save();
  c.globalAlpha *= ease * Math.min(clamp((y + h - viewport.y) / 22), clamp((viewport.y + viewport.h - y) / 22));
  c.translate(middle, y + h / 2); c.scale(scale, scale); c.translate(-middle, -y - h / 2);
  stampOutline(c, x, y + 4, w, h); c.fillStyle = '#091f2666'; c.fill();
  stampOutline(c, x, y, w, h); c.fillStyle = paper; c.fill(); c.strokeStyle = border; c.lineWidth = held ? 1.8 : next ? 1.3 : .8; c.stroke();
  r.round(x + 6, y + 6, w - 12, h - 12, 2, null, owned ? '#b3bd9a' : next ? '#9b8754' : '#2e4b47');
  r.text(String(stamp.index + 1).padStart(2, '0'), x + 13, y + 17, 9, owned ? '#52674f' : '#94a99c');
  if (next) r.round(x + w - 56, y + 9, 45, 17, 5, '#755f36');
  r.text(owned ? '已收藏' : next ? '下一枚' : '待收藏', x + w - 14, y + 17, 9, owned ? '#52674f' : next ? '#ffe0a0' : '#94a99c', 'right');
  r.circle(middle, y + 63, 28, owned ? '#fff6d333' : next ? '#c89d4510' : null, owned ? '#b5c19f' : next ? '#a48b57' : '#36534b');
  r.icon(stamp.icon, middle, y + 63, 39, ink);
  if (next) {
    const pulse = .45 + Math.sin(now / 850) * .2, angle = now / 2300;
    c.save(); c.globalAlpha *= pulse;
    r.circle(middle + Math.cos(angle) * 28, y + 63 + Math.sin(angle) * 28, 2, C.gold);
    r.circle(middle - Math.cos(angle) * 28, y + 63 - Math.sin(angle) * 28, 1.2, '#fff0bd');
    c.restore();
  }
  r.line([[x + 18, y + 94], [x + w - 18, y + 94]], owned ? '#b7bda1' : next ? '#8f8353' : '#33524c', .8);
  r.label(stamp.name, middle, y + 110, w - 18, 12, owned ? '#2e5045' : next ? '#ffedc5' : '#a2b7aa', 'center', '600');
  r.label(owned ? '累计 ' + stamp.target + ' 星' : '还差 ' + (stamp.goal - stamp.current) + ' 星', middle, y + 130, w - 18, 9.5, owned ? '#52674f' : next ? '#e4c58b' : '#91a89a', 'center');
  c.restore();
  r.hit(x, y, w, h, () => {
    scroll.tapped = { index: stamp.index, at: game.platform.now() };
    game.toast(owned ? '「' + stamp.name + '」已经收入你的邮票册' : stamp.condition + '，即可收藏「' + stamp.name + '」');
  }, (px, py) => insideRect(viewport, px, py));
}

function collectionLayout(height, count) {
  const viewport = { x: 18, y: 251, w: 354, h: Math.max(160, height - 279) };
  const rows = Math.ceil(count / 3), contentHeight = rows * 160 + 44;
  return { viewport, contentHeight, maxScroll: Math.max(0, contentHeight - viewport.h) };
}

function drawCollection(r, game) {
  const album = game.album(), scroll = game.collectionScroll, now = r.now;
  const { viewport, contentHeight, maxScroll } = collectionLayout(r.H, album.stamps.length);
  r.collectionRect = viewport;
  scroll.setBounds(maxScroll); scroll.update(now);
  r.header('沿途邮票册', '把每一次抵达，慢慢收集起来', () => game.home());
  drawSummary(r, game, album);
  r.text('旅程纪念', 24, 232, 14, C.ink, 'left', '600');
  r.text('轻触邮票查看', 365, 232, 10, C.muted, 'right');
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
    r.round(377, viewport.y + (viewport.h - thumb) * clamp(scroll.offset / maxScroll), 2, thumb, 1, '#a7b997');
    c.restore();
  }
}

module.exports = { drawCollection, collectionLayout };
