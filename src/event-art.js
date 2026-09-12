'use strict';

// Local paper, ink and light effects. All trajectories are sampled from event
// time: no emitters, timers, textures or frame-rate-dependent particle updates.
const TAU = Math.PI * 2;
const PALETTE = { gold: '#c48a3e', light: '#ffe9aa', cyan: '#399d9f', mist: '#b8f4df', paper: '#fff3d3', edge: '#bb8b60' };
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => 1 - (1 - n) ** 3;

function seeded(seed) {
  let n = Math.imul(seed + 1, 2654435761);
  n = Math.imul(n ^ n >>> 16, 2246822519);
  return (n >>> 0) / 4294967296;
}

function polygon(r, points, fill, stroke) {
  const c = r.ctx;
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.fillStyle = fill; c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); }
}

function ring(r, x, y, radius, ratio, color, width = 1.5, start = 0, end = TAU) {
  const c = r.ctx;
  c.beginPath(); c.ellipse(x, y, radius, radius * ratio, 0, start, end);
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}

function sparkle(r, x, y, size, color) {
  polygon(r, [[x, y - size], [x + size * .25, y - size * .25], [x + size, y],
    [x + size * .25, y + size * .25], [x, y + size], [x - size * .25, y + size * .25],
    [x - size, y], [x - size * .25, y - size * .25]], color);
}

function halo(r, x, y, unit, progress, color) {
  const c = r.ctx, fade = (1 - progress) ** 2;
  c.save(); c.globalAlpha *= fade * .16;
  // Translucent ellipses avoid expensive per-frame blur and large offscreen layers.
  c.beginPath(); c.ellipse(x, y, unit * (.24 + progress * .48), unit * (.1 + progress * .2), 0, 0, TAU);
  c.fillStyle = color; c.fill(); c.restore();
  c.save(); c.globalAlpha *= fade * .8;
  ring(r, x, y, unit * (.18 + ease(progress) * .42), .44, color, 1.8 - progress);
  c.restore();
}

function motes(r, x, y, unit, progress, seed, color, kind, count) {
  const c = r.ctx, low = r.effectsQuality === 'low';
  for (let i = 0; i < (low ? Math.ceil(count / 3) : count); i++) {
    const n = seed + i * 37, angle = seeded(n) * TAU;
    const spread = unit * (.24 + seeded(n + 1) * .48) * ease(progress);
    const px = x + Math.cos(angle) * spread;
    const py = y + Math.sin(angle) * spread * .45 - Math.sin(progress * Math.PI) * unit * (.18 + seeded(n + 2) * .42)
      + (kind === 'paper' ? progress * progress * unit * .34 : -progress * unit * .24);
    const size = (1.5 + seeded(n + 3) * 2.2) * (1 - progress * .35);
    c.save(); c.globalAlpha *= Math.min(1, progress * 14) * (1 - progress) ** .8;
    if (kind === 'paper') {
      c.translate(px, py); c.rotate(angle + progress * (seeded(n + 4) - .5) * 8);
      const width = size * (1.1 + Math.abs(Math.cos(progress * 8 + angle)));
      polygon(r, [[-width, -size * .5], [width, -size * .7], [width * .8, size * .5], [-width, size * .6]],
        i % 3 ? PALETTE.paper : color, color);
      if (!low && i % 2 === 0) r.line([[-width, 0], [width * .7, 0]], '#e2bb7c', .6);
    } else if (i % 3 === 0) sparkle(r, px, py, size, color);
    else { r.circle(px, py, size * .55, color); if (!low) r.circle(px, py, size * .21, PALETTE.paper); }
    c.restore();
  }
}

function drawPickup(r, type, x, y, unit, p, seed) {
  const c = r.ctx, low = r.effectsQuality === 'low', seal = type === 'seal';
  const color = seal ? PALETTE.cyan : PALETTE.gold;
  halo(r, x, y + 1, unit, p, color);
  if (seal) {
    // A perforated ink impression expands where the echo collected the stamp.
    c.save(); c.globalAlpha *= (1 - p) * .78;
    c.translate(x, y - unit * (.22 + p * .18)); c.rotate(-.12 + ease(p) * .2);
    const size = unit * (.24 + ease(p) * .22);
    r.round(-size / 2, -size / 2, size, size, 2, null, color);
    r.round(-size * .36, -size * .36, size * .72, size * .72, 1, null, PALETTE.mist);
    r.icon('star', 0, 0, size * .48, color);
    if (!low) for (let side = -1; side <= 1; side += 2) for (let i = -1; i <= 1; i++)
      r.circle(side * size * .5, i * size * .25, 1.3, PALETTE.mist);
    c.restore();
  } else {
    // Two unfolding envelope creases briefly open before the paper flies to HUD.
    c.save(); c.globalAlpha *= (1 - p) ** 2 * .8;
    const w = unit * (.17 + ease(p) * .17), lift = unit * (.25 + p * .3);
    r.line([[x - w, y - lift], [x, y - lift + w * .46], [x + w, y - lift]], color, 1.5);
    r.line([[x - w, y - lift], [x, y - lift - w * .5], [x + w, y - lift]], PALETTE.light, 1.6);
    c.restore();
  }
  motes(r, x, y - unit * .18, unit, p, seed, color, seal ? 'spark' : 'paper', seal ? 18 : 15);
}

function drawLight(r, x, y, unit, p, seed) {
  const c = r.ctx, low = r.effectsQuality === 'low';
  halo(r, x, y, unit * 1.15, p, PALETTE.gold);
  c.save(); c.globalAlpha *= Math.sin(Math.PI * p) * .5;
  for (let i = 0; i < (low ? 2 : 5); i++) {
    const phase = p * TAU + i * TAU / 5;
    const bx = x + Math.sin(phase) * unit * (.16 + p * .1), by = y - unit * (.1 + p * .9) + Math.cos(phase) * 3;
    r.line([[bx, by + unit * .16], [bx + Math.sin(phase + .5) * 3, by]], PALETTE.gold, 1.8);
    sparkle(r, bx, by, 2.5 * (1 - p) + .8, PALETTE.light);
  }
  c.restore();
  motes(r, x, y - unit * .2, unit, p, seed, PALETTE.gold, 'spark', 16);
}

function drawBridge(r, x, y, unit, p, seed, repair) {
  const c = r.ctx, low = r.effectsQuality === 'low', time = repair ? 1 - ease(p) : ease(p);
  halo(r, x, y, unit, p, repair ? PALETTE.cyan : PALETTE.edge);
  for (let i = 0; i < (low ? 4 : 10); i++) {
    const n = seed + i * 43, side = i % 2 ? 1 : -1, angle = seeded(n) * TAU;
    const px = x + side * unit * (.05 + seeded(n + 1) * .28) + Math.cos(angle) * unit * time * .3;
    const py = y + Math.sin(angle) * unit * .13 + time * time * unit * .6 - Math.sin(time * Math.PI) * unit * .22;
    const size = unit * (.065 + seeded(n + 2) * .06);
    c.save(); c.globalAlpha *= repair ? .8 * (1 - p * p) : (1 - p) ** .7;
    c.translate(px, py); c.rotate(side * time * (1.2 + seeded(n + 3) * 4));
    polygon(r, [[-size, -size * .35], [size * .8, -size * .58], [size, size * .17], [0, size * .55], [-size, size * .32]],
      i % 3 ? '#eac798' : PALETTE.paper, PALETTE.edge);
    if (!low) r.line([[-size * .8, 0], [size * .7, -size * .12]], '#b99769', .8);
    c.restore();
  }
  if (repair) motes(r, x, y - 3, unit * .7, p, seed, PALETTE.cyan, 'spark', 9);
}

function drawWind(r, x, y, unit, p, origin) {
  const c = r.ctx, low = r.effectsQuality === 'low', [sx, sy] = origin;
  const dx = x - sx, dy = y - sy, length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length, ny = dx / length;
  for (let i = 0; i < (low ? 2 : 5); i++) {
    const lane = (i - (low ? .5 : 2)) * unit * .065, lead = clamp(p * 1.6), tail = clamp(lead - .58);
    const points = [];
    for (let s = 0; s <= 8; s++) {
      const t = tail + (lead - tail) * s / 8;
      const arc = Math.sin(t * Math.PI) * unit * .12;
      points.push([sx + dx * t + nx * lane, sy + dy * t + ny * lane - arc]);
    }
    c.save(); c.globalAlpha *= Math.sin(p * Math.PI) * (i % 2 ? .45 : .85);
    r.line(points, i % 2 ? PALETTE.mist : PALETTE.cyan, i % 2 ? 3 : 1.4);
    if (!low && i % 2 === 0) {
      const end = points[points.length - 1];
      c.translate(end[0], end[1]); c.rotate(Math.atan2(dy, dx) + p * 2);
      polygon(r, [[-3, 0], [0, -2], [5, 0], [0, 2]], PALETTE.paper, PALETTE.gold);
    }
    c.restore();
  }
}

function drawResonance(r, type, x, y, unit, p) {
  const c = r.ctx, low = r.effectsQuality === 'low', born = type === 'echo-born', undo = type === 'undo';
  halo(r, x, y, unit, p, PALETTE.cyan);
  c.save(); c.globalAlpha *= (1 - p) * .82;
  const radius = unit * (undo ? .16 + (1 - ease(p)) * .42 : .17 + ease(p) * .38);
  ring(r, x, y, radius, .46, PALETTE.cyan, 1.6, p * 2, p * 2 + TAU * .8);
  if (!low) ring(r, x, y - (born ? unit * p * .52 : 0), radius * .76, .46, PALETTE.mist, 2, -p * 3, TAU - p * 3);
  if (born) {
    for (let i = 0; i < (low ? 3 : 8); i++) {
      const phase = p * 4 + i * TAU / 8, height = unit * (.12 + i / 8 * .65 + p * .2);
      sparkle(r, x + Math.cos(phase) * radius * .6, y - height, 2.3, i % 2 ? PALETTE.mist : PALETTE.cyan);
    }
  } else {
    const count = low ? 4 : 8;
    for (let i = 0; i < count; i++) {
      const a = i * TAU / count + (undo ? -p * 2 : 0);
      r.line([[x + Math.cos(a) * radius * .88, y + Math.sin(a) * radius * .46 * .88],
        [x + Math.cos(a) * radius, y + Math.sin(a) * radius * .46]], PALETTE.cyan, 1.4);
    }
    if (undo) r.icon('undo', x, y - unit * .63, unit * .28, PALETTE.cyan);
  }
  c.restore();
}

function drawFinish(r, type, x, y, unit, p, seed) {
  const failed = type === 'fail', c = r.ctx;
  halo(r, x, y, unit * (failed ? 1 : 1.7), p, failed ? '#b98161' : PALETTE.gold);
  if (failed) {
    c.save(); c.globalAlpha *= (1 - p) * .45;
    r.line([[x - unit * .18, y], [x - unit * .04, y - 3], [x + unit * .05, y + 3], [x + unit * .18, y]], '#b98161', 1.7);
    c.restore();
  } else {
    motes(r, x, y - unit * .35, unit * (type === 'win' ? 1.7 : 1.1), p, seed, PALETTE.gold, 'paper', 24);
    if (r.effectsQuality !== 'low') motes(r, x, y - unit * .45, unit, p, seed + 91, PALETTE.cyan, 'spark', 9);
  }
}

function drawEventArt(r, type, x, y, unit, progress, seed, origin) {
  const p = clamp(progress);
  if (type === 'letter' || type === 'seal') drawPickup(r, type, x, y, unit, p, seed);
  else if (type === 'light') drawLight(r, x, y, unit, p, seed);
  else if (type === 'bridge' || type === 'repair') drawBridge(r, x, y, unit, p, seed, type === 'repair');
  else if (type === 'wind') drawWind(r, x, y, unit, p, origin || [x, y]);
  else if (['wait', 'echo-born', 'undo'].includes(type)) drawResonance(r, type, x, y, unit, p);
  else if (['ready', 'win', 'fail'].includes(type)) drawFinish(r, type, x, y, unit, p, seed);
  else if (type === 'move') {
    halo(r, x, y + 1, unit * .75, p, PALETTE.gold);
    if (r.effectsQuality !== 'low') motes(r, x, y, unit * .5, p, seed, PALETTE.gold, 'spark', 5);
  }
}

module.exports = { drawEventArt };
