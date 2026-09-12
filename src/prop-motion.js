'use strict';

const TAU = Math.PI * 2;
const quiet = r => r.reducedMotion || r.effectsQuality === 'low';
const phase = (now, period, seed) => {
  const value = now / period + seed * .173;
  return value - Math.floor(value);
};

// A permanent rune preserves the instruction while a second ink pass travels
// forward, fades out, then rests. The invisible wrap never reads as a reversal.
function drawWindRune(r, x, y, vector, now, cell) {
  const c = r.ctx, [vx, vy] = vector;
  const point = (along, across = 0) => [x + vx * (along - across), y + vy * (along + across)];
  const arrow = (offset, color, width) => {
    r.line([point(offset - .32), point(offset + .32)], color, width);
    r.line([point(offset + .08, .18), point(offset + .32), point(offset + .08, -.18)], color, width);
  };
  c.save(); arrow(0, '#668973', 1.65);
  const progress = phase(now, 2800, cell) / .68;
  if (!quiet(r) && progress < 1) {
    const ease = progress * progress * (3 - 2 * progress);
    c.globalAlpha *= Math.sin(progress * Math.PI) ** 2 * .9;
    arrow(-.13 + ease * .26, '#306f5b', 2.1);
    // Side streamlets travel farther than the permanent rune. Their small heads
    // keep the wind direction readable even where the courier covers the center.
    c.save(); c.globalAlpha *= .82;
    for (const side of [-1, 1]) {
      const offset = -.35 + ease * .58, across = side * .25;
      r.line([point(offset - .12, across), point(offset + .14, across)], '#f3f8d9', 1.4);
      r.line([point(offset + .065, across + .055), point(offset + .14, across), point(offset + .065, across - .055)], '#f3f8d9', 1.05);
    }
    c.restore();
  }
  c.restore();
}

// Only the two loose paper corners lift. The bridge deck, its seams and its
// walkable footprint remain fixed; a torn bridge never calls this painter.
function drawBridgeFlutter(r, x, y, hw, hh, now, cell) {
  if (quiet(r)) return;
  const c = r.ctx, amount = Math.min(2.6, hh * .16);
  c.save();
  for (const side of [-1, 1]) {
    const lift = (.5 - Math.cos(now / 830 + cell * .71 + side * 1.2) * .5) * amount;
    const hingeX = x + side * hw * .68, tipX = x + side * (hw - 2.2);
    const top = [hingeX, y - hh * .24], bottom = [hingeX, y + hh * .24];
    c.beginPath(); c.moveTo(...top); c.lineTo(tipX, y - lift); c.lineTo(...bottom); c.closePath();
    c.fillStyle = side < 0 ? '#fae3b6' : '#d9b180'; c.fill();
    r.line([top, [tipX, y - lift], bottom], side < 0 ? '#fff0ce' : '#b18c61', .85);
    r.line([top, bottom], '#b9976980', .65);
    // A paper crease catches the light as its corner rises; the deck stays fixed.
    c.save(); c.globalAlpha *= .22 + lift / amount * .32;
    r.line([[hingeX, y], [tipX - side * 1.3, y - lift * .78]], '#fff8dd', .8);
    c.restore();
  }
  c.restore();
}

// Smooth overlapping frequencies suggest lamplight without on/off flashing.
function lampFrame(r, now, seed) {
  const still = quiet(r), wave = still ? 0 : Math.sin(now / 690 + seed) * .65 + Math.sin(now / 1190 + seed * 1.7) * .35;
  return { warmth: still ? .5 : .5 + Math.sin(now / 1450 + seed * .7) * .5,
    lean: wave * .55, height: 4.6 + wave * .55 };
}

function drawLampFlame(r, frame) {
  const c = r.ctx;
  c.save(); c.beginPath(); c.moveTo(-1.1, 9.3);
  c.quadraticCurveTo(-1.7, 7.2, frame.lean, 9.3 - frame.height);
  c.quadraticCurveTo(1.8, 7.6, 1.1, 9.3); c.closePath();
  c.fillStyle = '#fff9d4'; c.fill();
  r.line([[0, 8.8], [frame.lean * .35, 7.3]], '#fffefa', .8);
  c.restore();
}

module.exports = { drawWindRune, drawBridgeFlutter, lampFrame, drawLampFlame };
