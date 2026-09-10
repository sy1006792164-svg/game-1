'use strict';

const { chapterMood } = require('./chapter-atmosphere');
const { drawPageAtmosphere } = require('./page-atmosphere');

const TAU = Math.PI * 2;
const TARGET_PAGES = new Set(['startup', 'publication', 'home', 'levels', 'game', 'collection', 'leaderboard']);

// One treatment table keeps scene contrast and motion density intentional per page.
// Near effects are drawn after the paper wash, so they remain legible without
// increasing the opacity of every distant layer.
const TREATMENTS = Object.freeze({
  startup: Object.freeze({ wash: .1, depth: 1, near: .92, mist: 1, ribbons: 1, pieces: 6, motes: 5 }),
  home: Object.freeze({ wash: .02, depth: 1, near: 1, mist: .9, ribbons: 1.08, pieces: 8, motes: 6 }),
  levels: Object.freeze({ wash: .66, depth: .82, near: .88, mist: .72, ribbons: .84, pieces: 7, motes: 4 }),
  game: Object.freeze({ wash: .08, depth: .66, near: .78, mist: 0, ribbons: 0, pieces: 0, motes: 0 }),
  publication: Object.freeze({ wash: .8, depth: .48, near: .22, mist: .4, ribbons: 0, pieces: 0, motes: 2 }),
  collection: Object.freeze({ wash: .72, depth: .64, near: .58, mist: .5, ribbons: 0, pieces: 0, motes: 4 }),
  leaderboard: Object.freeze({ wash: .74, depth: .6, near: .52, mist: .44, ribbons: 0, pieces: 0, motes: 4 }),
  quiet: Object.freeze({ wash: .87, depth: .25, near: 0, mist: .3, ribbons: 0, pieces: 0, motes: 2 })
});

function atmosphereTreatment(page) {
  return TREATMENTS[page] || TREATMENTS.quiet;
}

function fract(value) { return value - Math.floor(value); }
function seed(index, salt) { return fract(Math.sin((index + 1) * 91.73 + salt * 47.11) * 43758.5453); }
function smoothstep(value) { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); }

// Every carrier reads the same quiet-rise-peak-fall envelope. The offset puts a
// complete gust inside the short startup window instead of making it wait for a
// long ambient loop.
function windState(now, reducedMotion = false) {
  if (reducedMotion) return { strength: .16, gust: 0 };
  const phase = fract((now + 560) / 7600);
  const rise = smoothstep(phase / .12);
  const fall = 1 - smoothstep((phase - .28) / .18);
  const gust = Math.max(0, Math.min(rise, fall));
  return { strength: .18 + gust * .82, gust };
}

function drawMist(r, time, rect, amount, mood, low = false) {
  const c = r.ctx, alpha = c.globalAlpha;
  const bands = low ? [1] : [0, 1, 2];
  for (const i of bands) {
    const phase = fract(time / (15000 + i * 2400) + seed(i, 2));
    const direction = i === 1 ? 1 - phase : phase;
    const x = rect.x - rect.w * .38 + direction * rect.w * 1.76;
    const y = rect.y + rect.h * (.28 + i * .23) + Math.sin(time / 3600 + i * 2.1) * 4;
    c.globalAlpha = alpha * amount * (.075 + i * .018);
    c.fillStyle = i === 1 ? mood.fogNear : mood.fogFar;
    for (let layer = low ? 1 : 3; layer > 0; layer--) {
      c.beginPath();
      c.ellipse(x - layer * 9, y + layer * 2, rect.w * (.22 + layer * .065), 8 + layer * 7, -.035, 0, TAU);
      c.fill();
    }
  }
  c.globalAlpha = alpha;
}

function drawMotes(r, time, rect, count, amount, mood) {
  const c = r.ctx;
  for (let i = 0; i < count; i++) {
    const phase = i * 2.4, drift = time / (4200 + i * 270);
    const x = rect.x + seed(i, 4) * rect.w + Math.sin(drift + phase) * (7 + seed(i, 5) * 7);
    const y = rect.y + seed(i, 6) * rect.h + Math.cos(drift * .68 + phase) * 10;
    const brightness = amount * (.2 + (1 + Math.sin(time / 2100 + phase)) * .1);
    const color = i % 3 ? mood.celestial : mood.mote;
    c.save(); c.globalAlpha *= brightness;
    r.circle(x, y, i % 3 ? 1.5 : 2, color);
    c.globalAlpha *= .24; r.circle(x, y, 4.8, color);
    c.restore();
  }
}

// Distant atmosphere stays behind the page wash and establishes depth.
function drawDistantAtmosphere(r, now, rect, options = {}) {
  const treatment = options.treatment || atmosphereTreatment(options.page);
  const mood = options.mood || chapterMood(options.chapter || 0);
  const low = options.quality === 'low';
  const c = r.ctx, time = options.reducedMotion || low ? 2400 : now;
  c.save(); c.globalAlpha *= options.strength == null ? treatment.depth : options.strength;
  if (treatment.mist) drawMist(r, time, rect, treatment.mist * (low ? .65 : 1), mood, low);
  if (treatment.motes) drawMotes(r, time, rect, low ? Math.min(2, treatment.motes) : treatment.motes, .78, mood);
  c.restore();
}

function drawLightShafts(r, time, rect, amount, mood) {
  const c = r.ctx, sway = Math.sin(time / 7800) * rect.w * .025;
  c.save(); c.globalAlpha *= amount * .055;
  c.fillStyle = mood.light;
  c.beginPath();
  c.moveTo(rect.x + rect.w * .68 + sway, rect.y);
  c.lineTo(rect.x + rect.w * .86 + sway, rect.y);
  c.lineTo(rect.x + rect.w * .57 - sway, rect.y + rect.h * .72);
  c.lineTo(rect.x + rect.w * .38 - sway, rect.y + rect.h * .72);
  c.closePath(); c.fill();
  c.globalAlpha *= .55;
  c.beginPath();
  c.moveTo(rect.x + rect.w * .82 - sway, rect.y);
  c.lineTo(rect.x + rect.w * .91 - sway, rect.y);
  c.lineTo(rect.x + rect.w * .78 + sway, rect.y + rect.h * .48);
  c.lineTo(rect.x + rect.w * .66 + sway, rect.y + rect.h * .48);
  c.closePath(); c.fill();
  c.restore();
}

function gameplayScale(r) {
  const scale = Number.isFinite(r.scale) && r.scale > 0 ? 1 / r.scale : 1;
  return Math.max(1, Math.min(1.35, scale));
}

function drawGameplayClouds(r, time, rect, amount, mood) {
  const c = r.ctx, base = c.globalAlpha;
  const clouds = [
    [.18, .34, 2700, 3650, 0],
    [.82, .66, 3300, 3020, Math.PI]
  ];
  c.save();
  clouds.forEach(([anchorX, anchorY, speedX, speedY, offset], i) => {
    const phase = (1 + Math.sin(time / 1750 + offset)) / 2;
    const x = rect.x + rect.w * (anchorX + Math.sin(time / speedX + offset) * .07);
    const y = rect.y + rect.h * (anchorY + Math.cos(time / speedY + offset) * .05);
    c.globalAlpha = base * amount * (.075 + phase * .018);
    c.fillStyle = mood.cloud; c.beginPath();
    c.ellipse(x, y, rect.w * .24, rect.h * .105, i ? .08 : -.08, 0, TAU); c.fill();
    c.globalAlpha = base * amount * (.105 + phase * .018);
    c.fillStyle = mood.cloudCore; c.beginPath();
    c.ellipse(x + (i ? -13 : 13), y + 3, rect.w * .175, rect.h * .072, i ? -.06 : .06, 0, TAU); c.fill();
  });
  c.restore();
}

function drawGameplayLight(r, time, rect, amount, mood) {
  const c = r.ctx, base = c.globalAlpha;
  const lights = [[.72, .16, 0], [.24, .76, Math.PI]];
  c.save();
  lights.forEach(([anchorX, anchorY, offset], i) => {
    const phase = (1 + Math.sin(time / (i ? 1830 : 1350) + offset)) / 2;
    const x = rect.x + rect.w * anchorX + Math.sin(time / (2200 + i * 430) + offset) * 8;
    const y = rect.y + rect.h * anchorY + Math.cos(time / (2500 + i * 390) + offset) * 6;
    c.globalAlpha = base * amount * (.085 + phase * .025);
    r.circle(x, y, 48 + phase * 12, mood.celestialGlow);
    c.globalAlpha = base * amount * (.14 + phase * .045);
    r.circle(x, y, 25 + phase * 8, mood.light);
  });
  c.restore();
}

function drawGameplayMist(r, time, rect, amount, mood) {
  const c = r.ctx, base = c.globalAlpha;
  c.save();
  for (let side = 0; side < 2; side++) {
    const offset = side * Math.PI, phase = time / (3100 + side * 470) + offset;
    const x = rect.x + rect.w * (side ? .93 : .07) + Math.sin(phase) * 9;
    const y = rect.y + rect.h * (side ? .6 : .48) + Math.cos(phase * .71) * 6;
    c.globalAlpha = base * amount * .125;
    c.fillStyle = side ? mood.mistA : mood.mistB; c.beginPath();
    c.ellipse(x, y, rect.w * .19, 31, side ? .08 : -.08, 0, TAU); c.fill();
    c.globalAlpha = base * amount * .105;
    c.beginPath(); c.ellipse(x + (side ? -15 : 15), y + 7, rect.w * .145, 22, 0, 0, TAU); c.fill();
  }
  c.restore();
}

function drawGameplayBirds(r, time, rect, amount, scale, mood) {
  const c = r.ctx;
  c.save(); c.globalAlpha *= amount * .82;
  [[.28, .12, 0], [.73, .21, Math.PI]].forEach(([anchorX, anchorY, offset], i) => {
    const phase = time / (1650 + i * 420) + offset;
    const x = rect.x + rect.w * anchorX + Math.sin(phase) * 15 * scale;
    const y = rect.y + rect.h * anchorY + Math.sin(phase * 2) * 6 * scale;
    const wing = (5.8 + i * 1.2) * scale, flap = Math.sin(time / (125 + i * 28) + offset) * 3 * scale;
    r.line([[x - wing, y - 1 - flap], [x, y + 1], [x + wing, y - 2 + flap]], mood.treeNear, 1.45 * scale);
  });
  c.restore();
}

function drawGameplayFoliage(r, time, rect, amount, scale, mood) {
  const c = r.ctx, wind = windState(time);
  const colors = mood.leaves;
  c.save(); c.globalAlpha *= amount * (.43 + wind.strength * .13);
  for (let i = 0; i < 6; i++) {
    const side = i % 2, row = Math.floor(i / 2), mirror = side ? -1 : 1;
    const phase = time / (930 + row * 150) + seed(i, 41) * TAU;
    const x = rect.x + (side ? rect.w + 3 : -3) + Math.sin(phase) * 5 * scale;
    const y = rect.y + rect.h * (.19 + row * .3) + Math.cos(phase * .73) * 9 * scale;
    const size = (11 + seed(i, 42) * 6) * scale, angle = mirror * (.08 + Math.sin(phase) * .1);
    c.save(); c.translate(x, y); c.rotate(angle); c.scale(mirror, 1);
    r.line([[-2, size * .8], [size * .18, 0], [size * .46, -size * .75]], mood.treeNear, 1.55 * scale);
    drawLeaf(r, size * .18, -size * .1, size * .48, -.48, colors[row]);
    drawLeaf(r, size * .39, -size * .48, size * .4, .28, colors[(row + 1) % colors.length]);
    drawLeaf(r, -size * .02, size * .24, size * .36, -.95, colors[(row + 2) % colors.length]);
    c.restore();
  }
  c.restore();
}

function drawGameplayParticles(r, time, rect, amount, scale, mood) {
  const c = r.ctx, compact = rect.h * (Number.isFinite(r.scale) ? r.scale : 1) < 300;
  const count = compact ? 5 : 6;
  const anchors = [[.11, .09], [.88, .13], [.05, .39], [.95, .49], [.12, .7], [.87, .86]];
  for (let i = 0; i < count; i++) {
    const phase = time / (1350 + i * 170) + seed(i, 51) * TAU;
    const x = rect.x + rect.w * anchors[i][0] + Math.sin(phase) * (8 + seed(i, 52) * 7) * scale;
    const y = rect.y + rect.h * anchors[i][1] + Math.sin(phase * 2) * (5 + seed(i, 53) * 5) * scale;
    const shimmer = .56 + (1 + Math.sin(time / 850 + i * 1.7)) * .09;
    c.save(); c.globalAlpha *= amount * shimmer;
    if (i >= count - 2) {
      drawLeaf(r, x, y, (4.8 + seed(i, 54) * 1.7) * scale, seed(i, 55) * TAU + Math.sin(phase) * .45,
        i % 2 ? mood.particles[2] : mood.particles[3]);
    } else {
      const size = (2.7 + seed(i, 54) * .9) * scale;
      const stemAngle = seed(i, 55) * TAU + Math.sin(phase * .63) * .25;
      r.circle(x, y, size, i % 2 ? mood.particles[0] : mood.particles[1]);
      c.globalAlpha *= .64;
      r.line([[x, y], [x + Math.cos(stemAngle) * size * 3.8, y + Math.sin(stemAngle) * size * 3.8]], mood.windWarm, .85 * scale);
      [-1, 0, 1].forEach(spoke => {
        const angle = stemAngle + Math.PI + spoke * .58 + Math.sin(phase) * .12;
        r.line([[x, y], [x + Math.cos(angle) * size * 3.4, y + Math.sin(angle) * size * 3.4]], mood.celestial, .8 * scale);
      });
      c.globalAlpha *= .2; r.circle(x, y, size * 4.3, mood.celestialGlow);
    }
    c.restore();
  }
}

// Large rounded light and shadow masses establish motion at a glance. Every
// carrier follows a small closed orbit, so the decorative layer cannot be read
// as the directional instruction emitted by a real wind tile.
function drawGameplayAir(r, time, rect, amount, mood, quality) {
  const scale = gameplayScale(r);
  drawGameplayClouds(r, time, rect, amount, mood);
  drawGameplayLight(r, time, rect, amount, mood);
  if (quality === 'low') return;
  drawGameplayMist(r, time, rect, amount, mood);
  drawGameplayFoliage(r, time, rect, amount, scale, mood);
  drawGameplayParticles(r, time, rect, amount, scale, mood);
  drawGameplayBirds(r, time, rect, amount, scale, mood);
}

function ribbonPath(c, x, y, length, bend) {
  c.beginPath(); c.moveTo(x, y);
  c.bezierCurveTo(x + length * .24, y - bend, x + length * .55, y + bend * .82, x + length, y - bend * .12);
  c.moveTo(x + length * .16, y + 8);
  c.bezierCurveTo(x + length * .37, y + 1, x + length * .63, y + 13, x + length * .79, y + 7);
}

function drawWindRibbons(r, time, rect, amount, mood) {
  const c = r.ctx, wind = windState(time);
  for (let i = 0; i < 3; i++) {
    const phase = fract(time / (7200 + i * 920) + i * .31);
    const x = rect.x - 180 + phase * (rect.w + 360);
    const y = rect.y + rect.h * (.22 + i * .265) + Math.sin(time / 2400 + i * 1.8) * 7;
    const fade = Math.pow(Math.sin(phase * Math.PI), .72), length = 132 + i * 16, bend = 10 + i * 2;
    c.save(); c.lineCap = 'round';
    c.globalAlpha *= amount * fade * (.18 + wind.strength * .34);
    ribbonPath(c, x, y, length, bend);
    c.strokeStyle = i === 1 ? mood.windWarm : mood.wind; c.lineWidth = 1.7; c.stroke();
    c.globalAlpha *= .42;
    c.translate(0, -1.4); ribbonPath(c, x, y, length, bend);
    c.strokeStyle = mood.celestial; c.lineWidth = .8; c.stroke();
    c.restore();
  }
}

function drawLeaf(r, x, y, size, angle, color) {
  const c = r.ctx; c.save(); c.translate(x, y); c.rotate(angle);
  c.beginPath(); c.moveTo(-size, size * .18);
  c.quadraticCurveTo(-size * .38, -size * .9, size, -size * .18);
  c.quadraticCurveTo(size * .28, size * .82, -size, size * .18);
  c.closePath(); c.fillStyle = color; c.fill();
  c.beginPath(); c.moveTo(-size * .72, size * .2); c.lineTo(size * .68, -size * .13);
  c.strokeStyle = '#fff8df99'; c.lineWidth = .7; c.stroke(); c.restore();
}

function drawPaper(r, x, y, size, angle, color) {
  const c = r.ctx; c.save(); c.translate(x, y); c.rotate(angle);
  c.beginPath(); c.moveTo(-size, -size * .58); c.lineTo(size, -size * .4);
  c.lineTo(size * .84, size * .58); c.lineTo(-size * .94, size * .42); c.closePath();
  c.fillStyle = color; c.fill(); c.strokeStyle = '#9d765563'; c.lineWidth = .65; c.stroke();
  c.beginPath(); c.moveTo(-size * .84, -size * .43); c.lineTo(0, size * .08); c.lineTo(size * .84, -size * .29);
  c.strokeStyle = '#fffdf0b8'; c.stroke(); c.restore();
}

function drawWindbornePieces(r, time, rect, count, amount, mood) {
  const c = r.ctx, wind = windState(time), colors = mood.leaves;
  for (let i = 0; i < count; i++) {
    const duration = 7600 + seed(i, 9) * 5200;
    const phase = fract(time / duration + seed(i, 10));
    const x = rect.x - 26 + phase * (rect.w + 52);
    const lane = .12 + seed(i, 11) * .76;
    const y = rect.y + rect.h * lane + Math.sin(phase * TAU * (1.2 + seed(i, 12)) + i) *
      (8 + seed(i, 13) * 11 + wind.gust * 9);
    const edge = Math.min(1, phase * 8, (1 - phase) * 8);
    const turn = time / (1250 + seed(i, 14) * 1200) + seed(i, 15) * TAU;
    c.save(); c.globalAlpha *= amount * edge * (.16 + wind.strength * (.28 + seed(i, 16) * .22));
    if (i % 4 === 1) drawPaper(r, x, y, 4.6 + seed(i, 17) * 2.4, Math.sin(turn) * .7, mood.particles[3]);
    else drawLeaf(r, x, y, 4.2 + seed(i, 18) * 3.1, turn, colors[i % colors.length]);
    c.restore();
  }
}

// Near atmosphere is intentionally rendered after the page wash but before UI.
// It never creates hit regions and solid cards naturally occlude it.
function drawAmbientOverlay(r, now, page, rect, options = {}) {
  if (!TARGET_PAGES.has(page)) return;
  const treatment = options.treatment || atmosphereTreatment(page);
  if (!treatment.near) return;
  const mood = options.mood || chapterMood(options.chapter || 0);
  const quality = options.quality || 'high';
  const c = r.ctx, time = options.reducedMotion || quality === 'low' ? 2400 : now;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  if (page === 'game') {
    const impulse = Math.max(0, Math.min(1, Number(options.impulse) || 0));
    drawGameplayAir(r, time, rect, treatment.near * (1 + impulse * .2), mood, quality);
    c.restore();
    return;
  }
  drawPageAtmosphere(r, time, page, rect, { ...options, mood, quality, amount: treatment.near });
  // Reading-heavy pages use their own sparse motif instead of generic motion.
  if (page !== 'publication' && page !== 'collection' && page !== 'leaderboard') {
    drawLightShafts(r, time, rect, treatment.near, mood);
    if (quality !== 'low' && treatment.ribbons) drawWindRibbons(r, time, rect, treatment.near * treatment.ribbons, mood);
    if (quality !== 'low' && treatment.pieces) drawWindbornePieces(r, time, rect, treatment.pieces, treatment.near, mood);
  }
  // Gameplay keeps an undirected atmosphere so decorative wind cannot be read
  // as a hint for the direction of a wind tile.
  c.restore();
}

module.exports = { atmosphereTreatment, windState, drawDistantAtmosphere, drawAmbientOverlay };
