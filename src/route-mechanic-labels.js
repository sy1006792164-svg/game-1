'use strict';

const { gateStatus } = require('./route-mechanics');
const { insideRect } = require('./board-projection');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function overlapArea(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

function occupiedAreas(game, projection, gates, guide) {
  const { level, state, previousState } = game, areas = [];
  const w = projection.halfW, h = projection.halfH;
  const add = (cell, left, top, width, height) => {
    if (!projection.visible(cell)) return;
    const [x, y] = projection.point(cell);
    areas.push({ x: x + left, y: y + top, w: width, h: height });
  };
  // Reserve both ends of a move so badges do not chase a walking character.
  const actors = new Set([state.player, state.echo, previousState && previousState.player,
    previousState && previousState.echo]);
  actors.forEach(cell => add(cell, -w * .65, -w * 1.8, w * 1.3, w * 2));
  [...state.letters, ...state.seals].forEach(cell => add(cell, -w * .48, -w, w * .96, w * 1.3));
  add(level.exit, -w, -w * 2, w * 2, w * 2.2);
  gates.forEach(cell => add(cell, -w * .65, -w * .65, w * 1.3, w * .65 + h * .3));
  Object.values(level.echoGates || {}).forEach(gate => add(gate.plate, -w * .7, -h * .7, w * 1.4, h * 1.4));
  const focus = guide && guide.visual && guide.visual.focus;
  if (focus) add(focus.cell, w * .55 - 12, -12, 24, 24);
  return areas;
}

function placeLabel(x, y, width, height, projection, bounds, occupied, gap) {
  const { halfW, halfH } = projection;
  const positions = [
    [x - width / 2, y + halfH + gap],
    [x - width / 2, y - halfW * .65 - height - gap],
    [x + halfW * .7 + gap, y - height / 2],
    [x - halfW * .7 - width - gap, y - height / 2]
  ];
  // A second row keeps adjacent gates and nearby mail from covering each other.
  for (const direction of [1, -1]) {
    for (const offset of [0, -1, 1]) positions.push([
      x - width / 2 + offset * (width + gap),
      direction > 0 ? y + halfH + height + gap * 2 : y - halfW * .65 - height * 2 - gap * 2
    ]);
  }
  // Crowded or zoomed boards can use the open margin, linked back to the gate.
  for (const top of [bounds.y + bounds.h - height - gap, bounds.y + gap]) {
    for (const left of [x - width / 2, bounds.x + gap, bounds.x + bounds.w - width - gap])
      positions.push([left, top]);
  }
  let best, bestScore = Infinity;
  positions.forEach(([left, top], index) => {
    const box = { x: clamp(left, bounds.x + gap, bounds.x + bounds.w - width - gap),
      y: clamp(top, bounds.y + gap, bounds.y + bounds.h - height - gap), w: width, h: height };
    const padded = { x: box.x - gap, y: box.y - gap, w: width + gap * 2, h: height + gap * 2 };
    const score = occupied.reduce((sum, area) => sum + overlapArea(padded, area), 0) + index * .01;
    if (score < bestScore) { best = box; bestScore = score; }
  });
  return best;
}

function drawRouteMechanicLabels(r, game, guide) {
  const { level, state } = game, projection = r.boardProjection, bounds = r.boardRect;
  if (!projection || !bounds) return;
  const gates = [...Object.keys(level.tideGates || {}), ...Object.keys(level.echoGates || {})].map(Number);
  if (!gates.length) return;
  const occupied = occupiedAreas(game, projection, gates, guide);
  // Use CSS pixel sizes, independent of board zoom, tile count and device scale.
  const unit = 1 / r.scale, fontSize = 13 * unit, height = 24 * unit, gap = 3 * unit;
  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(bounds.x, bounds.y, bounds.w, bounds.h); c.clip();
  gates.forEach(cell => {
    const [x, y] = projection.point(cell);
    if (!insideRect(bounds, x, y)) return;
    const gate = gateStatus(level, state, cell), tide = gate.type === 'tide';
    const text = gate.open ? '可通行' : tide ? '等 ' + gate.waitTurns + ' 拍' : '回声门';
    const color = gate.open ? '#2d654c' : tide ? '#895826' : '#355e78';
    r.font(fontSize, '700');
    const width = c.measureText(text).width + 14 * unit;
    const box = placeLabel(x, y, width, height, projection, bounds, occupied, gap);
    occupied.push(box);
    const endX = clamp(x, box.x, box.x + box.w), endY = clamp(y, box.y, box.y + box.h);
    r.line([[x, y], [endX, endY]], '#fffdf5', 3 * unit);
    r.line([[x, y], [endX, endY]], color, 1.3 * unit);
    r.round(box.x, box.y + 2 * unit, width, height, 6 * unit, '#263e3433');
    r.round(box.x, box.y, width, height, 6 * unit, color, '#fffdf5');
    r.text(text, box.x + width / 2, box.y + height / 2, fontSize, '#ffffff', 'center', '700');
  });
  c.restore();
}

module.exports = { drawRouteMechanicLabels };
