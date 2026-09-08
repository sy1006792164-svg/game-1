'use strict';

const { neighbor } = require('./engine');
const { createProjection, insideRect } = require('./board-projection');

function matches(cache, level, rect, view) {
  return cache && cache.level === level &&
    cache.rect.x === rect.x && cache.rect.y === rect.y && cache.rect.w === rect.w && cache.rect.h === rect.h &&
    cache.view.scale === view.scale && cache.view.panX === view.panX && cache.view.panY === view.panY &&
    cache.view.rotation === view.rotation && cache.view.tilt === view.tilt;
}

// Keep only the current board: switching levels or moving the camera releases
// the previous geometry instead of retaining a cache for every visited view.
function getBoardGeometry(renderer, level, state, rect, view) {
  let cache = renderer.boardGeometry;
  if (!matches(cache, level, rect, view)) {
    const bounds = { ...rect }, camera = { ...view };
    const projection = createProjection(level, bounds, camera);
    const points = Array.from({ length: level.width * level.height }, (_, cell) => projection.point(cell));
    projection.point = cell => points[cell];
    const ordered = points.map((_, cell) => cell).filter(projection.visible).sort((a, b) => points[a][1] - points[b][1]);
    const screenProjection = { ...projection,
      halfW: projection.halfW * camera.scale, halfH: projection.halfH * camera.scale,
      point: cell => projection.toScreen(...points[cell]),
      contains: (cell, x, y) => insideRect(bounds, x, y) && projection.contains(cell, ...projection.toWorld(x, y))
    };
    cache = renderer.boardGeometry = {
      level, rect: bounds, view: camera, projection, screenProjection, ordered, walls: new Set(level.walls)
    };
  }
  // Puzzle states are immutable; neighbors only change after an actual turn.
  if (cache.state !== state) {
    cache.state = state;
    cache.adjacent = new Set(['up', 'down', 'left', 'right']
      .map(direction => neighbor(level, state.player, direction, state)).filter(cell => cell !== null));
  }
  return cache;
}

module.exports = { getBoardGeometry };
