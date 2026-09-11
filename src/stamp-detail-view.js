'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { drawStampArt } = require('./stamp-art');

function openStampDetail(game, id) {
  if (game.page !== 'collection' || game.busy || game.hidden || game.modal && game.modal.kind !== 'stamp-detail') return false;
  if (!game.album().stamps.some(stamp => stamp.id === id)) return false;
  game.collectionScroll.stop();
  game.pointer = null; game.renderer.hits = [];
  // Renderer uses modal identity to start the opening fade; paging keeps it alive.
  if (game.modal) game.modal.stampId = id;
  else game.modal = { kind: 'stamp-detail', stampId: id };
  game.syncMusic();
  return true;
}

function closeStampDetail(game) {
  game.modal = null; game.pointer = null; game.renderer.hits = [];
  game.syncMusic();
}

function turnStamp(game, direction) {
  const stamps = game.album().stamps, index = stamps.findIndex(stamp => stamp.id === game.modal.stampId);
  const stamp = stamps[index + direction];
  if (index >= 0 && stamp) openStampDetail(game, stamp.id);
}

function stampDetailKey(game, key) {
  if (!game.modal || game.modal.kind !== 'stamp-detail') return false;
  if (game.busy || game.hidden) return true;
  if (key === 'Escape') closeStampDetail(game);
  else if (key === 'ArrowLeft' || key === 'ArrowRight') turnStamp(game, key === 'ArrowLeft' ? -1 : 1);
  return true;
}

function drawStampDetail(r, game, now) {
  const album = game.album(), stamp = album.stamps.find(item => item.id === game.modal.stampId);
  if (!stamp) return null;
  const x = 22, w = 346, h = 500, y = Math.max(24, (r.H - h) / 2);
  const left = x + 24, right = x + w - 24, width = w - 48;
  const close = () => closeStampDetail(game), c = r.ctx, age = Math.max(0, now - r.modalAt);
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : Math.min(1, .18 + age / 180);
  r.scrim('#36554979');
  // Both ends of a dismissing tap must stay outside the paper panel.
  const viewport = r.viewport;
  r.hit(viewport.x, viewport.y, viewport.w, viewport.h, close, (px, py) => !insideRect({ x, y, w, h }, px, py));
  r.panel(x, y, w, h, { fill: C.panel, stroke: C.line, accent: stamp.owned ? C.green : C.gold, radius: 22 });
  r.round(x + 8, y + 8, w - 16, h - 16, 17, null, '#e4e8d9');
  r.text('旅程纪念', left, y + 33, 18, C.ink, 'left', '600');
  r.text('沿途邮票册 · ' + String(stamp.index + 1).padStart(2, '0') + ' / ' + album.stamps.length, left, y + 56, 10, C.muted);

  drawStampArt(r, stamp, { x: 195 - 106 * .7, y: y + 80, w: 106 * 1.4, h: 144 * 1.4 }, { next: album.next === stamp });
  r.button('', left, y + 157, 44, CONTROL.compactHeight, () => turnStamp(game, -1),
    { style: 'quiet', icon: 'back', disabled: stamp.index === 0 });
  r.button('', right - 44, y + 157, 44, CONTROL.compactHeight, () => turnStamp(game, 1),
    { style: 'quiet', icon: 'chevron', disabled: stamp.index === album.stamps.length - 1 });

  r.line([[left, y + 297], [right, y + 297]], C.line, 1, [2, 5]);
  r.text('收藏条件', left, y + 317, 12, C.muted);
  r.text(stamp.condition, right, y + 317, 12, C.ink, 'right', '600');
  r.text(stamp.owned ? '已收入邮票册' : '还差 ' + (stamp.goal - stamp.current) + ' 星', left, y + 344, 12, stamp.owned ? C.green : C.goldText);
  r.text(stamp.owned ? '当前 ' + stamp.current + ' 星' : stamp.current + ' / ' + stamp.goal + ' 星', right, y + 344, 11, C.muted, 'right');
  r.meter(left, y + 365, width, stamp.current, stamp.goal, stamp.owned ? C.green : C.gold);
  r.text(stamp.owned ? '这枚邮票记录了你的主线旅程。' : '通关新关卡，或提高已通关关卡的星级。', 195, y + 391, 11, C.muted, 'center');
  r.text('每关只计最高星级，达标后自动收藏。', 195, y + 411, 11, C.muted, 'center');
  r.button(stamp.owned ? '返回邮票册' : '去送信 · 收集星星', left, y + 430, width, CONTROL.height,
    stamp.owned ? close : () => game.openPage('levels'), { style: 'primary', icon: stamp.owned ? 'stamp' : 'arrow-right' });
  c.restore();
  return { x, y, w, h };
}

module.exports = { openStampDetail, drawStampDetail, stampDetailKey };
