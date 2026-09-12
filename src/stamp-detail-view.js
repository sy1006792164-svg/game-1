'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { insideRect } = require('./board-projection');
const { drawStampArt } = require('./stamp-art');
const { FILTERS, collectionFilter, visibleStamps } = require('./stamp-collection');
const { STAMP_NOTES } = require('./stamp-copy');
const { replayLevels: availableReplayLevels } = require('./level-navigation');
const { drawStampFinish } = require('./keepsake-effects');

function openStampDetail(game, id) {
  if (game.page !== 'collection' || game.busy || game.hidden || game.modal && game.modal.kind !== 'stamp-detail') return false;
  if (!visibleStamps(game).some(stamp => stamp.id === id)) return false;
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
  const stamps = visibleStamps(game), index = stamps.findIndex(stamp => stamp.id === game.modal.stampId);
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
  const album = game.album(), stamps = visibleStamps(game, album);
  const index = stamps.findIndex(item => item.id === game.modal.stampId), stamp = stamps[index];
  if (!stamp) return null;
  const compact = r.H < 630, x = 22, w = 346, h = compact ? 540 : 580, y = Math.max(24, (r.H - h) / 2);
  const artWidth = compact ? 112 : 140, artHeight = compact ? 152 : 190;
  const contentY = y + artHeight - 152;
  const left = x + 24, right = x + w - 24, width = w - 48;
  const filter = FILTERS.find(item => item.id === collectionFilter(game));
  const replayLevels = availableReplayLevels(game);
  const replayLevel = replayLevels[0];
  const close = () => closeStampDetail(game), c = r.ctx, age = Math.max(0, now - r.modalAt);
  const previous = r.stampDetailPresentation;
  if (!previous || previous.modal !== game.modal || previous.id !== stamp.id || previous.owned !== stamp.owned) {
    r.stampDetailPresentation = { modal: game.modal, id: stamp.id, owned: stamp.owned, at: now };
  }
  const artAge = Math.max(0, now - r.stampDetailPresentation.at), enter = Math.min(1, age / 220);
  c.save(); c.globalAlpha *= r.reducedMotion ? 1 : .32 + .68 * (1 - (1 - enter) ** 3);
  r.scrim('#36554979');
  // Both ends of a dismissing tap must stay outside the paper panel.
  const viewport = r.viewport;
  r.hit(viewport.x, viewport.y, viewport.w, viewport.h, close, (px, py) => !insideRect({ x, y, w, h }, px, py));
  r.panel(x, y, w, h, { fill: C.panel, stroke: C.line, accent: stamp.owned ? C.green : C.gold, radius: 22 });
  r.round(x + 8, y + 8, w - 16, h - 16, 17, null, '#e4e8d9');
  r.text('旅程纪念', left, y + 33, 18, C.ink, 'left', '600');
  r.text(filter.label + ' · 第 ' + (index + 1) + ' / ' + stamps.length + ' 枚', left, y + 56, 10, C.muted);
  r.button('关闭', right - 54, y + 17, 54, CONTROL.compactHeight, close, { style: 'quiet', size: 12 });

  const art = { x: 195 - artWidth / 2, y: y + 73, w: artWidth, h: artHeight };
  drawStampArt(r, stamp, art, { next: album.next === stamp });
  drawStampFinish(r, stamp, art, artAge, album.next === stamp);
  r.button('', left, y + 73 + (artHeight - CONTROL.compactHeight) / 2, 44, CONTROL.compactHeight, () => turnStamp(game, -1),
    { style: 'quiet', icon: 'back', disabled: index === 0 });
  r.button('', right - 44, y + 73 + (artHeight - CONTROL.compactHeight) / 2, 44, CONTROL.compactHeight, () => turnStamp(game, 1),
    { style: 'quiet', icon: 'chevron', disabled: index === stamps.length - 1 });

  r.text('纪念短笺', left, contentY + 243, 10, C.goldText);
  r.wrapped(STAMP_NOTES[stamp.id], left, contentY + 263, width, 11, C.muted, 17);

  r.line([[left, contentY + 297], [right, contentY + 297]], C.line, 1, [2, 5]);
  r.text('收藏条件', left, contentY + 317, 12, C.muted);
  r.text(stamp.condition, right, contentY + 317, 12, C.ink, 'right', '600');
  r.text(stamp.owned ? '已收入邮票册' : '还差 ' + stamp.remaining + ' 星', left, contentY + 343, 12, stamp.owned ? C.green : C.goldText);
  r.text('当前累计 ' + stamp.current + ' 星', right, contentY + 343, 11, C.muted, 'right');
  r.meter(left, contentY + 360, width, stamp.stageCurrent, stamp.stageGoal, stamp.owned ? C.green : C.gold);
  r.text('本段 ' + stamp.previousGoal + '–' + stamp.goal + ' 星', left, contentY + 380, 10, C.muted);
  r.text(stamp.stageCurrent + ' / ' + stamp.stageGoal + ' 星', right, contentY + 380, 10, C.muted, 'right');
  if (stamp.owned) {
    r.text('每关只计最高星级，达到条件后自动收藏。', 195, contentY + 405, 11, C.muted, 'center');
    r.text('重走熟悉的邮路，也不会减少已收获的星星。', 195, contentY + 425, 11, C.muted, 'center');
    r.button('返回邮票册', left, contentY + 465, width, CONTROL.height, close, { style: 'primary', icon: 'stamp' });
  } else {
    r.text(replayLevel ? '已送达的来信中，还有 ' + replayLevels.length + ' 封可补星。' : '通关新关卡，星星会自动计入收藏。', 195, contentY + 402, 11, C.muted, 'center');
    r.text('三星需达目标拍数，且不使用道具或续灯。', 195, contentY + 418, 10, C.muted, 'center');
    r.button('去选关 · 继续旅程', left, contentY + 436, width, CONTROL.compactHeight,
      () => game.openLevelBrowser('all'), { style: 'primary', icon: 'route', size: 13 });
    r.button(replayLevel ? '重访 ' + String(replayLevel.id).padStart(3, '0') + ' · 补星' : '暂无可补星关卡', left, contentY + 487, width, CONTROL.compactHeight,
      () => replayLevel && game.openLevelBrowser('replay', replayLevel.id), { style: 'quiet', icon: 'restart', disabled: !replayLevel, size: 13 });
  }
  c.restore();
  return { x, y, w, h };
}

module.exports = { openStampDetail, drawStampDetail, stampDetailKey };
