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

function drawStampNote(r, stamp, left, top, width) {
  r.text('纪念短笺', left, top, 12, C.goldText);
  r.wrapped(STAMP_NOTES[stamp.id], left, top + 23, width, 13, C.ink, 19);
}

function drawStampProgress(r, stamp, left, top, width) {
  const right = left + width;
  r.line([[left, top], [right, top]], C.line, 1, [2, 5]);
  r.text('收藏条件', left, top + 23, 12, C.muted);
  r.text(stamp.condition, right, top + 23, 12, C.ink, 'right', '600');
  r.text(stamp.owned ? '已收入邮票册' : '还差 ' + stamp.remaining + ' 星', left, top + 51, 15,
    stamp.owned ? C.green : C.goldText, 'left', '600');
  r.text('当前累计 ' + stamp.current + ' 星', right, top + 51, 11, C.muted, 'right');
  r.meter(left, top + 74, width, stamp.stageCurrent, stamp.stageGoal, stamp.owned ? C.green : C.gold);
  r.text('本段 ' + stamp.previousGoal + '–' + stamp.goal + ' 星', left, top + 97, 11, C.muted);
  r.text(stamp.stageCurrent + ' / ' + stamp.stageGoal + ' 星', right, top + 97, 11, C.muted, 'right');
}

function drawStampActions(r, game, stamp, replayLevels, left, top, width, close) {
  const replayLevel = replayLevels[0];
  if (stamp.owned) {
    r.text('每关只计最高星级，达到条件后自动收藏。', 195, top, 12, C.muted, 'center');
    r.text('重走邮路，不会减少已收获的星星。', 195, top + 20, 12, C.muted, 'center');
    r.button('返回邮票册', left, top + 48, width, CONTROL.height, close, { style: 'primary', icon: 'stamp' });
    return;
  }
  r.text(replayLevel ? '已送达的来信中，还有 ' + replayLevels.length + ' 封可补星。' : '通关新关卡，星星会自动计入收藏。',
    195, top, 12, C.muted, 'center');
  r.text('三星需达目标拍数，且不使用道具或续灯。', 195, top + 19, 11, C.muted, 'center');
  r.button('去选关 · 继续旅程', left, top + 40, width, CONTROL.height,
    () => game.openLevelBrowser('all'), { style: 'primary', icon: 'route', size: 15 });
  r.button(replayLevel ? '重访 ' + String(replayLevel.id).padStart(3, '0') + ' · 补星' : '暂无可补星关卡', left, top + 99, width, CONTROL.compactHeight,
    () => replayLevel && game.openLevelBrowser('replay', replayLevel.id), { style: 'text', icon: 'restart', disabled: !replayLevel, size: 13 });
}

function drawStampDetail(r, game, now) {
  const album = game.album(), stamps = visibleStamps(game, album);
  const index = stamps.findIndex(item => item.id === game.modal.stampId), stamp = stamps[index];
  if (!stamp) return null;
  const artHeight = Math.min(190, Math.max(112, r.H - 466)), artWidth = artHeight * 106 / 144;
  const x = 22, w = 346, h = artHeight + 434, y = Math.max(8, (r.H - h) / 2);
  const contentY = y + artHeight - 152;
  const left = x + 24, right = x + w - 24, width = w - 48;
  const filter = FILTERS.find(item => item.id === collectionFilter(game));
  const replayLevels = availableReplayLevels(game);
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
  r.label(stamp.name, left, y + 33, width - 70, 22, C.ink, 'left', '600');
  r.text('旅程纪念 · ' + filter.label + ' ' + (index + 1) + ' / ' + stamps.length, left, y + 57, 11, C.muted);
  r.button('关闭', right - 54, y + 17, 54, CONTROL.compactHeight, close, { style: 'text', size: 12 });

  const art = { x: 195 - artWidth / 2, y: y + 73, w: artWidth, h: artHeight };
  drawStampArt(r, stamp, art, { next: album.next === stamp });
  drawStampFinish(r, stamp, art, artAge, album.next === stamp);
  r.button('', left, y + 73 + (artHeight - CONTROL.compactHeight) / 2, 44, CONTROL.compactHeight, () => turnStamp(game, -1),
    { style: 'text', icon: 'back', disabled: index === 0 });
  r.button('', right - 44, y + 73 + (artHeight - CONTROL.compactHeight) / 2, 44, CONTROL.compactHeight, () => turnStamp(game, 1),
    { style: 'text', icon: 'chevron', disabled: index === stamps.length - 1 });

  drawStampNote(r, stamp, left, contentY + 243, width);
  drawStampProgress(r, stamp, left, contentY + 306, width);
  drawStampActions(r, game, stamp, replayLevels, left, contentY + 427, width, close);
  c.restore();
  return { x, y, w, h };
}

module.exports = { openStampDetail, drawStampDetail, stampDetailKey };
