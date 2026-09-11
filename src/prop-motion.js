'use strict';

const TAU = Math.PI * 2;
const quiet = r => r.reducedMotion || r.effectsQuality === 'low';
const phase = (now, period, seed) => {
  const value = now / period + seed * .173;
  return value - Math.floor(value);
};

// Static rune plus forward ink; wrap only while invisible.
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
  }
  c.restore();
}

// Lift loose corners; never move the deck or animate torn paper.
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
  }
  c.restore();
}

// Smooth lamp frequencies avoid flashing.
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
