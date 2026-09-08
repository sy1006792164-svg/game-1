'use strict';

const { C } = require('./theme');

const INKS = ['#376f5d', '#a87440', '#3b7b88', '#65754a'];

// Perforations belong to the paper outline, leaving the scenery beneath intact.
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

function drawStampArt(r, stamp, rect, options) {
  const { x, y, w, h } = rect, c = r.ctx, style = options || {};
  const gold = stamp.mastered, owned = stamp.owned, highlighted = gold || style.next;
  const ink = gold ? '#946b2f' : owned ? INKS[stamp.index % INKS.length] : style.next ? C.gold : '#6f9184';
  const paper = gold ? '#f1dfaa' : owned ? '#e7dfc7' : style.next ? '#37493e' : '#1c3638';
  const edge = gold ? '#d2a252' : owned ? '#b9c09d' : style.next ? '#d1a365' : '#45645a';
  const text = owned ? '#345342' : style.next ? '#ffedc5' : '#a2b7aa';
  c.save();
  stampOutline(c, x, y + 3, w, h); c.fillStyle = '#091f264d'; c.fill();
  stampOutline(c, x, y, w, h); c.fillStyle = paper; c.fill();
  c.strokeStyle = edge; c.lineWidth = highlighted ? 1.4 : .8; c.stroke();
  r.round(x + 6, y + 5, w - 12, h - 10, 2, null, edge);
  r.text(String(stamp.index + 1).padStart(2, '0'), x + 13, y + 14, 9, ink);
  if (style.equipped) r.round(x + w - 55, y + 7, 44, 15, 4, '#3b6553');
  r.text(style.equipped ? '佩戴中' : gold ? '金色' : owned ? '已收藏' : '未解锁', x + w - 14, y + 14, 9,
    style.equipped ? C.white : ink, 'right', style.equipped || gold ? '600' : '400');

  const middle = x + w / 2, artY = y + 23 + (h - 71) / 2;
  const size = Math.min(w * .45, h - 72);
  r.circle(middle, artY, size * .58, null, edge);
  r.circle(middle, artY, size * .49, owned ? '#fff8dd55' : '#71846b16');
  r.line([[middle - size * .72, artY + size * .25], [middle + size * .72, artY + size * .25]], edge, .7);
  r.icon(stamp.icon, middle, artY, size * .8, ink);
  if (gold) {
    r.icon('star', middle - size * .72, artY - size * .24, 8, ink);
    r.icon('star', middle + size * .72, artY - size * .24, 8, ink);
  }
  r.line([[x + 17, y + h - 44], [x + w - 17, y + h - 44]], edge, .8);
  r.label(stamp.name, middle, y + h - 30, w - 18, 12, text, 'center', '600');
  const caption = gold ? '三星珍藏' : owned ? '委托 ' + stamp.missionCurrent + '/3 星' :
    stamp.target === 'daily' ? '完成每日风笺' : '还差 ' + (stamp.target - stamp.current) + ' 星';
  r.label(caption, middle, y + h - 14, w - 18, 10, ink, 'center');
  c.restore();
}

module.exports = { drawStampArt };
