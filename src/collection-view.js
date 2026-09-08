'use strict';

const { C } = require('./theme');
const { STAMPS: MAIN_STAMPS } = require('./progression');

// Thresholds come from progression.js so the stamp album and goals never disagree.
const ICONS = ['leaf', 'echo', 'letter', 'tree', 'lamp', 'wind', 'echo', 'moon', 'star', 'home', 'letter'];
const STAMPS = [...MAIN_STAMPS.map(([name, target], index) => [name, target, ICONS[index]]), ['今日的问候', 'daily', 'sun']]
  .map(([name, target, icon], index) => ({ name, target, icon, index }));

const INKS = ['#376f5d', '#a87440', '#3b7b88'];

function collected(stamp, stars, dailyWins) {
  return stamp.target === 'daily' ? dailyWins > 0 : stars >= stamp.target;
}

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

function drawSummary(r, game, progress, owned, next, dailyWins) {
  r.panel(24, 90, 342, 88, { fill: '#1e3b3d', stroke: '#43605b', accent: C.gold });
  r.text(owned, 41, 119, 30, C.gold, 'left', '600');
  r.text('/ ' + STAMPS.length, 87, 125, 14, C.muted);
  r.text('枚已收藏', 42, 151, 10, C.muted);
  r.line([[129, 107], [129, 159]], '#49645c', 1);
  r.text(next ? '下一枚收藏' : '全套珍藏已集齐', 147, 109, 9, next ? C.gold : C.green);
  r.label(next ? next.name : '沿途的风，都在这里', 147, 129, 178, 13, C.ink, 'left', '600');
  if (next) {
    const daily = next.target === 'daily', current = daily ? dailyWins : progress.stars, target = daily ? 1 : next.target;
    r.text(daily ? '完成一次每日风笺' : '再得 ' + (target - current) + ' 星', 147, 151, 10, C.muted);
    r.text(current + ' / ' + target + (daily ? ' 次' : ' 星'), 346, 151, 9, C.gold, 'right');
    r.meter(147, 167, 199, current, target, C.gold);
    r.icon('chevron', 346, 129, 12, C.gold);
    r.hit(137, 95, 220, 78, () => game.goal(daily ? 'daily' : 'stars'));
  } else {
    r.text('主线纪念 ' + MAIN_STAMPS.length + ' 枚 · 每日纪念 1 枚', 147, 151, 9, C.muted);
    r.meter(147, 167, 199, owned, STAMPS.length, C.green);
    r.icon('check', 346, 129, 13, C.green);
  }
}

function drawStamp(r, game, stamp, rect, owned, next, stars) {
  const { x, y, w, h } = rect, c = r.ctx, middle = x + w / 2;
  const ink = owned ? INKS[stamp.index % INKS.length] : next ? C.gold : '#55766f';
  const paper = owned ? '#e7dfc7' : next ? '#37493e' : '#1c3638';
  const edge = owned ? '#b9c09d' : next ? '#d1a365' : '#36534f';
  c.save();
  stampOutline(c, x, y + 3, w, h); c.fillStyle = '#091f264d'; c.fill();
  stampOutline(c, x, y, w, h); c.fillStyle = paper; c.fill(); c.strokeStyle = edge; c.lineWidth = next ? 1.2 : .8; c.stroke();
  r.round(x + 6, y + 5, w - 12, h - 10, 2, null, owned ? '#b3bd9a' : next ? '#9b8754' : '#2e4b47');
  r.text(String(stamp.index + 1).padStart(2, '0'), x + 13, y + 13, 9, owned ? '#52674f' : '#94a99c');
  if (next) r.round(x + w - 55, y + 6, 44, 15, 4, '#755f36');
  r.text(owned ? '已收藏' : next ? '下一枚' : '未解锁', x + w - 14, y + 13, 9, owned ? '#52674f' : next ? '#ffe0a0' : '#94a99c', 'right', next ? '600' : '400');

  const artY = y + 37 + (h - 96) * .35, artSize = 26 + (h - 96) * .2;
  if (owned || next) {
    r.circle(middle, artY, artSize * .51, null, owned ? '#a8b692' : '#b497594d');
    r.line([[middle - 28, artY], [middle - 23, artY]], owned ? '#aab69a' : '#b79760', .8);
    r.line([[middle + 23, artY], [middle + 28, artY]], owned ? '#aab69a' : '#b79760', .8);
  }
  r.icon(stamp.icon, middle, artY, artSize, ink);
  r.line([[x + 18, y + h - 44], [x + w - 18, y + h - 44]], owned ? '#b7bda1' : next ? '#8f8353' : '#33524c', .8);
  r.label(stamp.name, middle, y + h - 31, w - 20, 11, owned ? '#2e5045' : next ? '#ffedc5' : '#a2b7aa', 'center', owned || next ? '600' : '400');
  const condition = stamp.target === 'daily' ? owned ? '每日投递纪念' : '完成每日风笺' : next ? '还差 ' + (stamp.target - stars) + ' 星' : '累计 ' + stamp.target + ' 星';
  r.label(condition, middle, y + h - 14, w - 20, 9, owned ? '#52674f' : next ? '#e4c58b' : '#91a89a', 'center');
  c.restore();
  r.hit(x, y, w, h, () => game.toast(owned ? '「' + stamp.name + '」已经收入你的邮票册' : stamp.target === 'daily' ? '完成一次每日风笺，即可收藏「' + stamp.name + '」' : '主线累计获得 ' + stamp.target + ' 星，即可收藏「' + stamp.name + '」'));
}

function drawCollection(r, game) {
  const progress = game.progress();
  // Store snapshots contain only validated wins; daily tickets do not depend on campaign stars.
  const dailyWins = Object.keys(game.profile().daily).length;
  const owned = STAMPS.filter(stamp => collected(stamp, progress.stars, dailyWins)).length;
  const next = progress.nextStamp ? STAMPS.find(stamp => stamp.target === progress.nextStamp.target) : dailyWins ? null : STAMPS[11];
  r.header('沿途邮票册', '把每一次抵达，慢慢收集起来', () => game.home());
  drawSummary(r, game, progress, owned, next, dailyWins);
  r.text('旅程纪念', 24, 190, 10, C.muted);
  r.text(MAIN_STAMPS.length + ' 枚主线 · 1 枚每日', 366, 190, 9, C.muted, 'right');
  const cardH = Math.min(110, (r.H - 316) / 4);
  STAMPS.forEach(stamp => drawStamp(r, game, stamp, {
    x: 24 + stamp.index % 3 * 118,
    y: 200 + Math.floor(stamp.index / 3) * (cardH + 10), w: 106, h: cardH
  }, collected(stamp, progress.stars, dailyWins), stamp === next, progress.stars));
  if (game.toastUntil > r.now) return;
  const footerY = 200 + cardH * 4 + 30 + 24;
  r.text(owned === STAMPS.length ? '每一次抵达，都成为珍藏。' : '送达更多来信，收藏沿途的风景。', 195, footerY, 10, C.muted, 'center');
}

module.exports = { drawCollection };
