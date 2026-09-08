'use strict';

const { C } = require('./theme');

function drawStampSeal(r, stamp, x, y, radius) {
  const color = stamp.mastered ? C.gold : C.green;
  r.circle(x, y, radius, '#35554e', color);
  r.circle(x, y, radius - 4, null, color);
  r.icon(stamp.icon, x, y, radius, color);
  if (stamp.mastered) r.icon('star', x + radius - 3, y - radius + 3, 12, C.gold);
}

function drawHomeStamp(r, game, y) {
  const album = game.album(), stamp = album.equipped;
  if (!stamp) {
    if (album.ownedCount) r.text('邮票册有来信 · 选一枚作为投递邮戳', 195, y + 19, 11, C.muted, 'center');
    return;
  }
  r.round(74, y, 242, 40, 12, '#18383a', stamp.mastered ? '#806e4d' : '#426262');
  drawStampSeal(r, stamp, 100, y + 20, 14);
  r.text(stamp.name, 124, y + 13, 12, C.ink, 'left', '600');
  r.text(stamp.mastered ? '金色珍藏 · 回信已送达' : '我的投递邮戳', 124, y + 28, 9, stamp.mastered ? C.gold : C.muted);
  r.icon('chevron', 297, y + 20, 13, C.muted);
  r.hit(74, y, 242, 40, () => game.openStamp(stamp.id));
}

module.exports = { drawStampSeal, drawHomeStamp };
