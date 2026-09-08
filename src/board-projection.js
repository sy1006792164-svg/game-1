'use strict';

const { DIRECTIONS } = require('./engine');

function boardBounds(level) {
  const walls = new Set(level.walls);
  const playable = Array.from({ length: level.width * level.height }, (_, cell) => cell).filter(cell => !walls.has(cell));
  const cols = playable.map(cell => cell % level.width), rows = playable.map(cell => Math.floor(cell / level.width));
  return {
    minCol: Math.max(0, Math.min(...cols) - 1), maxCol: Math.min(level.width - 1, Math.max(...cols) + 1),
    minRow: Math.max(0, Math.min(...rows) - 1), maxRow: Math.min(level.height - 1, Math.max(...rows) + 1)
  };
}

function insideRect(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// Keep floor geometry separate from the camera's uniform scale: props and
// effects use the same canvas transform, while hit testing uses its inverse.
function createProjection(level, rect, view) {
  const { width, height } = level, bounds = boardBounds(level);
  const { minCol, maxCol, minRow, maxRow } = bounds;
  const rotation = Number.isFinite(view.rotation) ? view.rotation : 0;
  const tilt = Math.max(.38, Math.min(1, Number.isFinite(view.tilt) ? view.tilt : .62));
  const cosine = Math.cos(rotation), sine = Math.sin(rotation);
  // The greatest extent across every angle keeps the scale steady while orbiting.
  const span = Math.hypot(maxCol - minCol + 1, maxRow - minRow + 1) * Math.SQRT2;
  const centerCol = (minCol + maxCol + 1) / 2, centerRow = (minRow + maxRow + 1) / 2;
  const halfW = Math.min((rect.w - 22) / span, (rect.h - 104) / (span * tilt));
  const halfH = halfW * tilt;
  const centerX = rect.x + rect.w / 2, centerY = rect.y + rect.h / 2 + 4;
  const floor = (dx, dy) => [
    cosine * dx - sine * dy * halfW / halfH,
    sine * dx * halfH / halfW + cosine * dy,
  ];
  const gridDelta = (dx, dy) => {
    const u = cosine * dx / halfW + sine * dy / halfH;
    const v = -sine * dx / halfW + cosine * dy / halfH;
    return [(u + v) / 2, (v - u) / 2];
  };
  const corner = (col, row) => {
    const dc = col - centerCol, dr = row - centerRow;
    const [x, y] = floor((dc - dr) * halfW, (dc + dr) * halfH);
    return [centerX + x, centerY + y];
  };
  const point = cell => corner(cell % width + .5, Math.floor(cell / width) + .5);
  const toScreen = (x, y) => [centerX + (x - centerX) * view.scale + view.panX * rect.w, centerY + (y - centerY) * view.scale + view.panY * rect.h];
  const toWorld = (x, y) => [centerX + (x - centerX - view.panX * rect.w) / view.scale, centerY + (y - centerY - view.panY * rect.h) / view.scale];
  const visible = cell => Number.isInteger(cell) && cell >= 0 && cell < width * height &&
    cell % width >= minCol && cell % width <= maxCol && Math.floor(cell / width) >= minRow && Math.floor(cell / width) <= maxRow;
  const contains = (cell, x, y) => {
    const p = point(cell);
    const [col, row] = gridDelta(x - p[0], y - p[1]);
    return visible(cell) && Math.abs(col) <= .5 + 1e-8 && Math.abs(row) <= .5 + 1e-8;
  };
  const cellAt = (x, y) => {
    if (!insideRect(rect, x, y)) return null;
    const [wx, wy] = toWorld(x, y), [dc, dr] = gridDelta(wx - centerX, wy - centerY);
    const col = Math.floor(dc + centerCol), row = Math.floor(dr + centerRow), cell = row * width + col;
    return col >= 0 && col < width && row >= 0 && row < height && contains(cell, wx, wy) ? cell : null;
  };
  const vector = name => {
    const [col, row] = DIRECTIONS[name];
    return floor((col - row) * halfW, (col + row) * halfH);
  };
  const direction = (dx, dy) => {
    const [col, row] = gridDelta(dx, dy);
    const difference = Math.abs(col) - Math.abs(row);
    // At diagonal ties, keep horizontal and vertical keys on distinct axes.
    const alongCol = Math.abs(difference) < 1e-8 ? Math.abs(dx) >= Math.abs(dy) : difference > 0;
    return alongCol ? col > 0 ? 'right' : 'left' : row > 0 ? 'down' : 'up';
  };
  const corners = [corner(minCol, minRow), corner(maxCol + 1, minRow), corner(maxCol + 1, maxRow + 1), corner(minCol, maxRow + 1)];
  const rear = cell => {
    const col = cell % width, row = Math.floor(cell / width);
    const colDepth = sine + cosine, rowDepth = cosine - sine;
    return (colDepth > 1e-8 && col === minCol) || (colDepth < -1e-8 && col === maxCol) ||
      (rowDepth > 1e-8 && row === minRow) || (rowDepth < -1e-8 && row === maxRow);
  };
  return { halfW, halfH, bounds, centerX, centerY, floor, corner, point, visible, contains, cellAt, direction, vector, rear, corners, toScreen, toWorld };
}

module.exports = { createProjection, insideRect };
