'use strict';

const { C } = require('./theme');

// Static material lighting.
function materialGradient(r, x, y, w, h, stops) {
  const gradient = r.ctx.createLinearGradient(x, y, x + w * .2, y + h);
  if (!gradient || typeof gradient.addColorStop !== 'function') return stops[0][1];
  stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  return gradient;
}

function drawPanel(r, x, y, w, h, options) {
  const style = options || {}, radius = style.radius == null ? 16 : style.radius;
  const depth = Math.min(4, h * .06), quality = r.effectsQuality !== 'low';
  const c = r.ctx;
  c.save();
  if (quality) r.round(x + 3, y + depth + 3, w - 6, h, radius, '#173f3610');
  r.round(x + 1, y + depth + 1, w - 2, h, radius, C.contact);
  r.round(x, y + depth, w, h, radius, C.surfaceSide, '#a6b19b');
  r.round(x, y, w, h, radius, style.fill || C.panel, style.stroke || C.surfaceEdge);
  if (quality) {
    r.round(x + 1, y + 1, w - 2, h - 2, Math.max(1, radius - 1),
      materialGradient(r, x, y, w, h, [[0, '#ffffff66'], [.38, '#ffffff00'], [1, '#8a765313']]));
  }
  const inset = Math.min(radius + 3, w / 3);
  r.line([[x + inset, y + 1.5], [x + w - inset, y + 1.5]], '#fffef6e0', 1);
  r.line([[x + inset, y + h - 1], [x + w - inset, y + h - 1]], '#a6ad902e', 1);
  if (style.accent) {
    r.line([[x + inset + 2, y + 1], [x + Math.min(w - inset - 2, 67), y + 1]], style.accent, 2.5);
  }
  c.restore();
}

function drawMeter(r, x, y, w, value, target, color) {
  const filled = Math.max(0, Math.min(1, value / Math.max(1, target))) * w;
  const c = r.ctx;
  c.save();
  r.round(x, y + 1, w, 5, 2.5, '#fffef6');
  r.round(x, y, w, 5, 2.5, '#aebea9');
  r.round(x + 1, y + 1, Math.max(1, w - 2), 3, 1.5, '#d5decd');
  if (filled > 0) {
    const width = Math.min(w, Math.max(5, filled));
    r.round(x, y, width, 5, 2.5, color || C.green);
    if (width > 4) r.line([[x + 2, y + 1.2], [x + width - 2, y + 1.2]], '#fff6cd7a', .8);
  }
  c.restore();
}

module.exports = { drawPanel, drawMeter, materialGradient };
