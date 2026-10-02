'use strict';

const { C } = require('./theme');
const { drawBoard } = require('./scene');
const { drawObjectives } = require('./game-objectives');
const { describeMoment, seekReview, reviewLandmark, closeReview } = require('./route-review');

function reviewLayout(height, scale = 1) {
  const touch = Math.max(44, 44 / scale), bottom = height - 12;
  const actionsY = bottom - touch, landmarksY = actionsY - touch - 8;
  const stripY = landmarksY - touch - 14, captionY = stripY - 72;
  return { touch, actionsY, landmarksY, stripY, captionY,
    board: { x: 0, y: 166, w: 390, h: captionY - 174, paddingY: 44, centerOffsetY: 2 } };
}

function reviewWindow(index, length, count) {
  const start = Math.max(0, Math.min(length - count, index - Math.floor(count / 2)));
  return Array.from({ length: Math.min(length, count) }, (_, offset) => start + offset);
}

function drawRouteReview(r, game, now) {
  const review = game.routeReview;
  if (!review) return;
  const { model, index } = review, frame = model.at(index), moment = model.moments[index];
  const layout = reviewLayout(r.H, r.scale);
  r.label('路线复盘', 24, 31, 254, 23, C.ink, 'left', '700');
  r.button('返回', 290, 10, 76, layout.touch, () => closeReview(game), { style: 'text', icon: 'arrow-left' });
  r.label('第 ' + game.level.id + ' 封 · 第 ' + frame.state.turn + ' 拍 · 只回看，不消耗', 24, 67, 342, 12, C.muted);
  // Rendering reads a separate state and camera. The actual run, save and result
  // keep their original identities throughout review, including backgrounding.
  const view = Object.assign(Object.create(game), { state: frame.state, previousState: null,
    transitionAt: -Infinity, moveEvents: [], motionPath: null, reviewing: true, camera: review.camera,
    selectedItem: null, actionPreview: null, guideEnabled: false, mechanicGuide: null });
  drawObjectives(r, view, now, null);
  const controlCount = r.hits.length;
  drawBoard(r, view, now, layout.board, null);
  // Some scenery props expose inspect targets even in a frozen scene.
  // A review never exposes any action belonging to the live board.
  r.hits.length = controlCount;
  r.panel(24, layout.captionY, 342, 66, { fill: C.panel, flat: true, radius: 14 });
  r.label(moment.label, 38, layout.captionY + 17, 314, 14, C.green, 'left', '600');
  const lines = r.wrapLines(describeMoment(moment, frame.state), 314, 12);
  lines.slice(0, 2).forEach((line, row) => r.label(line, 38, layout.captionY + 37 + row * 15, 314, 12, C.muted));
  const count = Math.min(6, Math.floor((342 + 6) / (layout.touch + 6)));
  const visible = reviewWindow(index, model.length, count), gap = 6;
  const width = (342 - (visible.length - 1) * gap) / visible.length;
  visible.forEach((value, offset) => r.button(value === 0 ? '起点' : String(value),
    24 + offset * (width + gap), layout.stripY, width, layout.touch,
    () => seekReview(game, value), { style: value === index ? 'primary' : 'quiet', size: 13,
      label: '查看第 ' + value + ' 次操作：' + model.moments[value].label }));
  r.button('上一关键步', 24, layout.landmarksY, 165, layout.touch, () => reviewLandmark(game, -1), {
    style: 'text', size: 13, disabled: !model.landmarks.some(value => value < index) });
  r.button('下一关键步', 201, layout.landmarksY, 165, layout.touch, () => reviewLandmark(game, 1), {
    style: 'text', size: 13, disabled: !model.landmarks.some(value => value > index) });
  r.button('上一步', 24, layout.actionsY, 105, layout.touch, () => seekReview(game, index - 1), {
    style: 'secondary', icon: 'arrow-left', disabled: index === 0, size: 13 });
  r.button(index === model.length - 1 ? '从头看' : '看最后', 141, layout.actionsY, 108, layout.touch,
    () => seekReview(game, index === model.length - 1 ? 0 : model.length - 1), { style: 'quiet', size: 13 });
  r.button('下一步', 261, layout.actionsY, 105, layout.touch, () => seekReview(game, index + 1), {
    style: 'primary', icon: 'arrow-right', disabled: index === model.length - 1, size: 13 });
}

module.exports = { drawRouteReview, reviewLayout, reviewWindow };
