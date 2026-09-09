'use strict';

const { C } = require('./theme');
const { em, centerY, paths } = require('./title-glyphs');

// Decode once. Basic Canvas paths work without device fonts, font downloads or Path2D.
const outlines = paths.map(path => path.match(/[MLCZ][^MLCZ]*/g).map(command => ({
  type: command[0],
  points: command.length > 1 ? command.slice(1).split(',').map(Number) : []
})));

function drawTitle(r, x, y, size, spacing, color = C.ink) {
  const c = r.ctx, factor = size / em, baseline = y + centerY * factor;
  c.save(); c.fillStyle = color;
  outlines.forEach((outline, index) => {
    // Project to final layout coordinates in JS. Native Canvas never needs the
    // tiny, negative per-glyph transform used by the previous outline renderer.
    const left = x + (index - 1.5) * spacing - size / 2;
    c.beginPath();
    for (const command of outline) {
      const p = command.points;
      if (command.type === 'M') c.moveTo(left + p[0] * factor, baseline - p[1] * factor);
      else if (command.type === 'L') c.lineTo(left + p[0] * factor, baseline - p[1] * factor);
      else if (command.type === 'C') c.bezierCurveTo(left + p[0] * factor, baseline - p[1] * factor,
        left + p[2] * factor, baseline - p[3] * factor, left + p[4] * factor, baseline - p[5] * factor);
      else c.closePath();
    }
    c.fill();
  });
  c.restore();
}

module.exports = { drawTitle };
