'use strict';

const { STYLES } = require('./game-feedback');
const { COLLECTION_DELAY_MS, COLLECTION_FLIGHT_MS } = require('./feedback-timing');
const { objectiveAnchor } = require('./game-objectives');
const { insideRect } = require('./board-projection');

function curve(from, to, progress, side) {
  const u = 1 - progress;
  const cx = from[0] + (to.x - from[0]) * .3 + side * 32;
  const cy = to.y + (from[1] - to.y) * .18;
  return [u * u * from[0] + 2 * u * progress * cx + progress * progress * to.x,
    u * u * from[1] + 2 * u * progress * cy + progress * progress * to.y];
}

function drawCollectionFlights(r, game, now) {
  const buffer = r.motionEffects, projection = r.boardProjection;
  if (!buffer || !projection || r.reducedMotion || game.modal || game.reviewing || game.state.status !== 'playing') return;
  if (game.pointer && game.pointer.scene && game.pointer.dragging) return;
  // Share the board's real event batches, including its undo and session cleanup.
  for (const batch of buffer.batches) {
    const progress = (now - batch.at - COLLECTION_DELAY_MS) / COLLECTION_FLIGHT_MS;
    if (progress <= 0 || progress >= 1) continue;
    const eased = progress * progress * (3 - 2 * progress);
    for (const event of batch.events) {
      const style = STYLES[event.type];
      if (!style || !style.collection) continue;
      const origin = projection.point(event.cell);
      if (!insideRect(r.boardRect, origin[0], origin[1])) continue;
      const from = [origin[0], origin[1] - projection.halfW * .36];
      const to = objectiveAnchor(style.objective), side = event.type === 'seal' ? -1 : 1;
      const [x, y] = curve(from, to, eased, side), c = r.ctx;
      const alpha = Math.min(1, progress / .12, (1 - progress) / .18);
      if (r.effectsQuality !== 'low') {
        c.save(); c.globalAlpha *= alpha;
        const trail = Array.from({ length: 10 }, (_, i) => curve(from, to, Math.max(0, eased - (9 - i) * .023), side));
        c.save(); c.globalAlpha *= .15; r.line(trail, style.color, 5); c.restore();
        for (let i = 1; i < trail.length; i++) {
          c.save(); c.globalAlpha *= i / trail.length * .7;
          r.line([trail[i - 1], trail[i]], i % 2 ? style.color : '#fff5cf', 1.6);
          if (i % 3 === 0) {
            const [px, py] = trail[i], drift = Math.sin(progress * 9 + i) * (1 - i / trail.length) * 6;
            r.circle(px + drift, py + 3, 1.1, style.color);
          }
          c.restore();
        }
        c.restore();
      }
      c.save(); c.globalAlpha *= alpha;
      c.translate(x, y); c.rotate(Math.sin(progress * Math.PI) * side * .18);
      const size = 14 + Math.sin(progress * Math.PI) * 6;
      r.icon(style.icon, 0, 0, size + 3, '#fffdf4');
      r.icon(style.icon, 0, 0, size, style.color);
      c.restore();
    }
  }
}

module.exports = { drawCollectionFlights };
