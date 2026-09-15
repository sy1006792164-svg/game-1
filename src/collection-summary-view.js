'use strict';

const { C } = require('./theme');
const { insideRect } = require('./board-projection');

function drawCollectionSummary(r, game, album, locate) {
  const next = album.next, left = 151, width = 195;
  r.round(24, 94, 342, 114, 18, C.panel);
  r.text('已收藏', 42, 115, 12, C.muted);
  r.text(album.ownedCount, 40, 148, 34, C.ink, 'left', '600');
  r.text('/ ' + album.stamps.length, 88, 151, 13, C.muted);
  r.text(album.stars + ' 星光', 42, 184, 13, C.green, 'left', '600');
  r.line([[131, 113], [131, 190]], C.line, 1);
  const area = { x: 139, y: 100, w: 220, h: 101 };
  if (next) {
    const held = !game.modal && game.pointer && insideRect(area, game.pointer.x, game.pointer.y);
    if (held) r.round(area.x, area.y, area.w, area.h, 13, C.soft);
  }
  r.text(next ? '下一枚收藏' : '全套珍藏已集齐', left, 117, 11, C.muted);
  r.label(next ? next.name : '沿途的风，都在这里', left, 144, width - (next ? 26 : 0), 18, C.ink, 'left', '600');
  if (next) {
    r.text('还差 ' + next.remaining + ' 星', left, 170, 13, C.goldText, 'left', '600');
    r.text('定位邮票', left + width, 171, 11, C.muted, 'right');
    r.meter(left, 186, width, next.stageCurrent, next.stageGoal, C.orange);
    r.actionIcon('arrow-right', left + width - 9, 144, C.orange);
    r.hit(area.x, area.y, area.w, area.h, locate, undefined, '定位下一枚邮票：' + next.name);
  } else {
    r.text('每一次抵达，都成为珍藏', left, 170, 12, C.muted);
    r.meter(left, 186, width, album.ownedCount, album.stamps.length, C.green);
  }
}

module.exports = { drawCollectionSummary };
