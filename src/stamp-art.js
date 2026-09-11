'use strict';

const { C } = require('./theme');
const { materialGradient } = require('./ui-surface');

const INKS = ['#376f5d', '#a87440', '#3b7b88', '#65754a'];

// Transparent notches shape the paper.
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

// Shared album/detail painter.
function drawStampArt(r, stamp, rect, { next = false, held = false } = {}) {
  const c = r.ctx, w = 106, h = 144, middle = w / 2, owned = stamp.owned;
  const ink = owned ? INKS[stamp.index % INKS.length] : next ? C.gold : '#7e9681';
  const paper = owned ? '#fffbed' : next ? '#fff0d5' : '#e2eade';
  const border = held ? owned ? '#86a489' : C.gold : owned ? '#b9c7a9' : next ? '#cba477' : '#b5c9b6';
  c.save(); c.translate(rect.x, rect.y); c.scale(rect.w / w, rect.h / h);
  stampOutline(c, 1, held ? 2 : 4, w - 1, h); c.fillStyle = held ? '#294d4924' : '#294d4933'; c.fill();
  stampOutline(c, 0, 1.8, w, h); c.fillStyle = owned || next ? '#baa981' : '#9faf9b'; c.fill();
  if (held && !r.reducedMotion) c.translate(0, 1);
  stampOutline(c, 0, 0, w, h); c.fillStyle = paper; c.fill(); c.strokeStyle = border; c.lineWidth = held ? 1.8 : next ? 1.3 : .8; c.stroke();
  if (!r.reducedMotion && r.effectsQuality !== 'low') {
    c.save(); c.clip();
    c.fillStyle = materialGradient(r, 0, 0, w, h, [[0, '#ffffff70'], [.4, '#ffffff00'], [1, '#88704418']]);
    c.fillRect(0, 0, w, h); c.restore();
  }
  r.round(6, 6, w - 12, h - 12, 2, null, owned ? '#d9dfc6' : next ? '#e2c796' : '#c9d7c6');
  r.text(String(stamp.index + 1).padStart(2, '0'), 13, 17, 9, C.muted);
  if (next) {
    const label = '下一枚', padding = 5;
    r.font(9);
    const badgeWidth = c.measureText(label).width + padding * 2, badgeX = w - 11 - badgeWidth;
    r.round(badgeX, 9, badgeWidth, 17, 5, '#f5dfb5');
    r.text(label, badgeX + badgeWidth / 2, 17.5, 9, C.goldText, 'center');
  } else r.text(owned ? '已收藏' : '待收藏', w - 14, 17, 9, C.muted, 'right');
  r.circle(middle, 65, 28, owned ? '#839373' : next ? '#c3a16a' : '#b0bfa8');
  r.circle(middle, 62, 28, owned ? '#eff1df' : next ? '#f9e6bd' : '#d9e5d5', owned ? '#c3d0b1' : next ? '#d7b777' : '#b6cbb6');
  c.beginPath(); c.arc(middle, 62, 27, Math.PI * .88, Math.PI * 1.78);
  c.strokeStyle = '#fffdf1e0'; c.lineWidth = .95; c.stroke();
  c.beginPath(); c.arc(middle, 62, 27, -Math.PI * .08, Math.PI * .7);
  c.strokeStyle = owned ? '#9bad898c' : next ? '#b38d488c' : '#8da88b8c'; c.lineWidth = .8; c.stroke();
  r.circle(middle, 62, 23, null, owned ? '#fffdf4' : next ? '#fff2d8' : '#ecf1e7');
  if (owned || next) r.icon(stamp.icon, middle + .5, 64.2, 39, owned ? '#a8b68d' : '#cfb174');
  r.icon(stamp.icon, middle, 63, 39, ink);
  if (next && !r.reducedMotion && r.effectsQuality !== 'low') {
    const time = Number.isFinite(r.ambientNow) ? r.ambientNow : r.now;
    const pulse = .45 + Math.sin(time / 850) * .2, angle = time / 2300;
    c.save(); c.globalAlpha *= pulse;
    r.circle(middle + Math.cos(angle) * 28, 63 + Math.sin(angle) * 28, 2, C.gold);
    r.circle(middle - Math.cos(angle) * 28, 63 - Math.sin(angle) * 28, 1.2, '#c79c53');
    c.restore();
  }
  r.line([[18, 94], [w - 18, 94]], owned ? '#c9d2b6' : next ? '#d5b98b' : '#bbceb9', .8);
  r.label(stamp.name, middle, 110, w - 18, 12, owned ? C.ink : next ? '#92643c' : C.muted, 'center', '600');
  r.label(owned ? '累计 ' + stamp.target + ' 星' : '还差 ' + (stamp.goal - stamp.current) + ' 星', middle, 130, w - 18, 9.5, next ? C.goldText : C.muted, 'center');
  c.restore();
}

module.exports = { drawStampArt };
