'use strict';

const { C } = require('./theme');
const { decorativeTime, quiet } = require('./page-feedback');
const { drawStampPaper } = require('./stamp-paper');

const INKS = ['#376f5d', '#a87440', '#3b7b88', '#65754a'];

// One paper face for both the album grid and its enlarged detail.
function drawStampArt(r, stamp, rect, { next = false, held = false, scrolling = false } = {}) {
  const c = r.ctx, w = 106, h = 144, middle = w / 2, owned = stamp.owned;
  const ink = owned ? INKS[stamp.index % INKS.length] : next ? C.orange : C.muted;
  c.save(); c.translate(rect.x, rect.y); c.scale(rect.w / w, rect.h / h);
  drawStampPaper(r, rect, owned, next, held);
  r.text(String(stamp.index + 1).padStart(2, '0'), 12, 18, 11, C.muted);
  if (next) {
    const label = '下一枚', padding = 5;
    r.font(11, '600');
    const badgeWidth = c.measureText(label).width + padding * 2, badgeX = w - 11 - badgeWidth;
    r.round(badgeX, 8, badgeWidth, 20, 7, C.peach);
    r.text(label, badgeX + badgeWidth / 2, 18, 11, C.goldText, 'center', '600');
  } else r.text(owned ? '已收藏' : '待收藏', w - 12, 18, 11, owned ? C.green : C.muted, 'right');
  r.circle(middle, 62, 28, owned ? C.soft : next ? C.peach : C.paper);
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
  r.label(stamp.name, middle, 109, w - 18, 14, owned ? C.ink : next ? C.goldText : C.muted, 'center', '600');
  r.label(owned ? '累计 ' + stamp.target + ' 星' : '还差 ' + (stamp.goal - stamp.current) + ' 星', middle, 130, w - 18, 12, next ? C.goldText : C.muted, 'center');
  c.restore();
}

module.exports = { drawStampArt };
