'use strict';

const { insideRect } = require('./board-projection');

// These are window/CSS pixels, not scaled design units or backing texture pixels.
const BOARD_DRAG_SLOP = 12;
const BOARD_EDGE_SLOP = 8;

function containsHit(hit, point) {
  return insideRect(hit, point.x, point.y) && (!hit.contains || hit.contains(point.x, point.y));
}

function hitAt(hits, point) {
  for (let i = hits.length - 1; i >= 0; i--) if (containsHit(hits[i], point)) return hits[i];
  return null;
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function floorDistance(projection, cell, point) {
  if (projection.contains(cell, point.x, point.y)) return 0;
  const [x, y] = projection.point(cell), hw = projection.halfW, hh = projection.halfH;
  const corners = [[x, y - hh], [x + hw, y], [x, y + hh], [x - hw, y]];
  return Math.min(...corners.map((a, i) => segmentDistance(point.x, point.y, ...a, ...corners[(i + 1) % 4])));
}

// Capture the semantic cell before animated mail/camera redraws move their hit shapes.
// Exact artwork/UI always wins. Only empty space may snap to a nearby legal move;
// a wall, distant prop, the player's wait tile or a guide control is never remapped.
function captureBoardTap(renderer, point) {
  const exact = hitAt(renderer.hits, point);
  if (exact) return Number.isInteger(exact.action && exact.action.boardCell) ? exact : null;
  const geometry = renderer.boardGeometry, rect = renderer.boardRect;
  if (!geometry || !rect || !insideRect(rect, point.x, point.y)) return null;
  const tolerance = BOARD_EDGE_SLOP / renderer.scale;
  const candidates = [];
  for (const cell of geometry.adjacent) {
    const distance = floorDistance(geometry.screenProjection, cell, point);
    if (distance > tolerance) continue;
    const hit = renderer.hits.find(candidate => candidate.action && candidate.action.boardCell === cell);
    if (hit) candidates.push({ hit, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  // A tie between possible moves is ambiguous; never choose based on paint order.
  if (!candidates.length || candidates[1] && candidates[1].distance - candidates[0].distance < .5 / renderer.scale) return null;
  return candidates[0].hit;
}

module.exports = { BOARD_DRAG_SLOP, containsHit, hitAt, captureBoardTap };
