'use strict';

const { TILT } = require('./board-projection');
const TAU = Math.PI * 2;

function floorRing(r, x, y, radius, color, width = 1.3) {
  const c = r.ctx;
  c.beginPath(); c.ellipse(x, y, radius, radius * TILT, 0, 0, TAU);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

// Short-lived event light; no idle motion or hit target.
function risingLight(r, x, y, unit, progress, color) {
  if (r.effectsQuality === 'low') return;
  const c = r.ctx, height = unit * (.2 + Math.sin(progress * Math.PI) * .9);
  const radius = unit * (.16 + progress * .09);
  const light = c.createLinearGradient(x, y - height, x, y);
  if (!light || typeof light.addColorStop !== 'function') return;
  light.addColorStop(0, color + '00'); light.addColorStop(.72, color + '24'); light.addColorStop(1, color + '50');
  c.save();
  c.beginPath(); c.moveTo(x - radius, y); c.lineTo(x - radius * .38, y - height);
  c.lineTo(x + radius * .38, y - height); c.lineTo(x + radius, y); c.closePath();
  c.fillStyle = light; c.fill();
  c.restore();
}

function drawWindRibbon(r, from, to, unit, progress, color) {
  const low = r.effectsQuality === 'low';
  for (let ribbon = 0; ribbon < (low ? 1 : 3); ribbon++) {
    const lead = Math.min(1, progress * 1.7), tail = Math.max(0, lead - .65);
    const offset = low ? 0 : (ribbon - 1) * unit * .09;
    const points = Array.from({ length: low ? 3 : 7 }, (_, index) => {
      const t = tail + (lead - tail) * index / (low ? 2 : 6);
      return [from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t + offset - Math.sin(t * Math.PI) * unit * (.14 + ribbon * .04)];
    });
    if (!low) {
      r.ctx.save(); r.ctx.globalAlpha *= .18;
      r.line(points, color, 4 - ribbon * .5); r.ctx.restore();
    }
    r.line(points, color, 1.5 - ribbon * .3);
  }
}

module.exports = { floorRing, risingLight, drawWindRibbon };
