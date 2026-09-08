'use strict';

const { C } = require('./theme');
const { drawStampArt } = require('./stamp-art');
const { drawStampDetail } = require('./stamp-detail-view');

const albumPages = new WeakMap();
const PAGE_SIZE = 6;

function drawSummary(r, game, album) {
  const next = album.next;
  r.panel(24, 90, 342, 92, { fill: '#1e3b3d', stroke: '#526b5c', accent: C.gold });
  r.text(album.ownedCount, 41, 119, 30, C.gold, 'left', '600');
  r.text('/ ' + album.stamps.length, 82, 125, 13, C.muted);
  r.text('已收藏', 42, 148, 10, C.muted);
  r.text('金色珍藏 ' + album.masteredCount, 42, 168, 10, C.gold);
  r.line([[132, 106], [132, 168]], '#49645c', 1);
  r.text(next ? '下一枚 · 等你抵达' : '全套来信已收藏', 148, 110, 10, C.gold);
  r.label(next ? next.name : '让每一枚成为金色珍藏', 148, 131, 184, 13, C.ink, 'left', '600');
  if (next) {
    const daily = next.target === 'daily', target = daily ? 1 : next.target;
    r.label(daily ? '完成一次每日风笺' : '再收集 ' + (target - next.current) + ' 星', 148, 151, 128, 10, C.muted);
    r.text(next.current + '/' + target, 345, 151, 10, C.gold, 'right');
    r.meter(148, 167, 197, next.current, target, C.gold);
    r.icon('chevron', 346, 130, 12, C.gold);
    r.hit(141, 96, 217, 79, () => game.openStamp(next.id));
  } else {
    r.text('完成三星委托，收到专属回信', 148, 151, 10, C.muted);
    r.meter(148, 167, 197, album.masteredCount, album.stamps.length, C.gold);
  }
}

function drawEquipped(r, game, album) {
  const stamp = album.equipped;
  r.round(24, 194, 342, 38, 10, '#19373a', '#3b5953');
  r.icon(stamp ? stamp.icon : 'letter', 44, 213, 20, stamp && stamp.mastered ? C.gold : C.green);
  r.label(stamp ? '正在佩戴 · ' + stamp.name : '挑一枚邮票，作为你的送信印记', 62, 213, 260, 11, C.ink);
  if (stamp) {
    r.icon('chevron', 345, 213, 13, C.green);
    r.hit(24, 194, 342, 38, () => game.openStamp(stamp.id));
  }
}

function drawCollection(r, game) {
  const album = game.album();
  const selected = album.stamps.find(stamp => stamp.id === game.selectedStamp);
  if (selected) return drawStampDetail(r, game, selected, album.equipped);

  const pageCount = Math.ceil(album.stamps.length / PAGE_SIZE);
  const page = Math.min(pageCount - 1, albumPages.get(game) || 0);
  r.header('沿途邮票册', '收藏来信 · 完成委托 · 留下你的印记', () => game.home());
  drawSummary(r, game, album);
  drawEquipped(r, game, album);
  r.text(page === 0 ? '初遇的风景' : '远方的来信', 24, 247, 11, C.ink, 'left', '600');
  r.text('点开邮票，读一封信', 366, 247, 10, C.muted, 'right');

  const cardH = Math.min(164, (r.H - 386) / 2);
  album.stamps.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((stamp, index) => {
    const rect = { x: 24 + index % 3 * 118, y: 260 + Math.floor(index / 3) * (cardH + 12), w: 106, h: cardH };
    drawStampArt(r, stamp, rect, {
      equipped: !!album.equipped && album.equipped.id === stamp.id,
      next: !!album.next && album.next.id === stamp.id
    });
    r.hit(rect.x, rect.y, rect.w, rect.h, () => game.openStamp(stamp.id));
  });

  const pagerY = 286 + cardH * 2;
  r.button('上一页', 24, pagerY, 98, 40, () => albumPages.set(game, page - 1), { disabled: page === 0 });
  r.text((page + 1) + ' / ' + pageCount, 195, pagerY + 20, 12, C.ink, 'center');
  r.button('下一页', 268, pagerY, 98, 40, () => albumPages.set(game, page + 1), { disabled: page + 1 === pageCount });
  if (game.toastUntil <= r.now) r.text('一封来信，一次三星委托，一枚金色珍藏。', 195, pagerY + 59, 10, C.muted, 'center');
}

module.exports = { drawCollection };
