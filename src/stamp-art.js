'use strict';

const { C } = require('./theme');
const { decorativeTime, quiet } = require('./page-feedback');
const { drawStampPaper } = require('./stamp-paper');

const INKS = ['#376f5d', '#a87440', '#3b7b88', '#65754a'];

// One paper face for both the album grid and its enlarged detail.
function drawStampArt(r, stamp, rect, { next = false, held = false, scrolling = false } = {}) {
  const c = r.ctx, w = 106, h = 144, middle = w / 2, owned = stamp.owned;
  const ink = owned ? INKS[stamp.index % INKS.length] : next ? C.gold : '#7e9681';
  c.save(); c.translate(rect.x, rect.y); c.scale(rect.w / w, rect.h / h);
  drawStampPaper(r, rect, owned, next, held);
  r.round(6, 6, w - 12, h - 12, 2, null, owned ? '#d9dfc6' : next ? '#e2c796' : '#c9d7c6');
  r.text(String(stamp.index + 1).padStart(2, '0'), 13, 17, 9, C.muted);
  if (next) {
    const label = '下一枚', padding = 5;
    r.font(9);
    const badgeWidth = c.measureText(label).width + padding * 2, badgeX = w - 11 - badgeWidth;
    r.round(badgeX, 9, badgeWidth, 17, 5, '#f5dfb5');
    r.text(label, badgeX + badgeWidth / 2, 17.5, 9, C.goldText, 'center');
  } else r.text(owned ? '已收藏' : '待收藏', w - 14, 17, 9, C.muted, 'right');
  r.circle(middle, 65, 28, owned ? '#7f967521' : next ? '#b8874220' : '#8da18d15');
  r.circle(middle, 62, 28, owned ? '#eff1df' : next ? '#f9e6bd' : '#d9e5d5', owned ? '#c3d0b1' : next ? '#d7b777' : '#b6cbb6');
  c.beginPath(); c.arc(middle, 62, 27, Math.PI * .88, Math.PI * 1.78);
  c.strokeStyle = '#fffdf1e0'; c.lineWidth = .95; c.stroke();
  c.beginPath(); c.arc(middle, 62, 27, -Math.PI * .08, Math.PI * .7);
  c.strokeStyle = owned ? '#9bad898c' : next ? '#b38d488c' : '#8da88b8c'; c.lineWidth = .8; c.stroke();
  r.circle(middle, 62, 23, null, owned ? '#fffdf4' : next ? '#fff2d8' : '#ecf1e7');
  r.icon(stamp.icon, middle, 63, 39, ink);
  if (owned && !quiet(r) && !scrolling) {
    // A foil sweep belongs only to the illustrated medallion. Names, numbers,
    // and collection requirements remain readable on the matte paper below.
    const phase = ((decorativeTime(r) + stamp.index * 1379) % 8300) / 1200;
    if (phase < 1) {
      const lightX = middle - 55 + phase * 110;
      c.save(); c.beginPath(); c.arc(middle, 62, 26, 0, Math.PI * 2); c.clip();
      c.globalAlpha *= Math.sin(phase * Math.PI) * .52;
      r.line([[lightX - 17, 91], [lightX + 17, 33]], '#fffad9', 10);
      r.line([[lightX - 23, 91], [lightX + 11, 33]], '#e7c47a', 1.4);
      c.restore();
    }
  }
  if (next && !quiet(r) && !scrolling) {
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
