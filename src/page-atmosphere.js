'use strict';

const TAU = Math.PI * 2;

function clamp(value) { return Math.max(0, Math.min(1, value)); }
function fract(value) { return value - Math.floor(value); }
function seed(index, salt) { return fract(Math.sin((index + 1) * 63.17 + salt * 41.83) * 43758.5453); }
function ease(value) { const t = clamp(value); return t * t * (3 - 2 * t); }

function contentRect(rect) {
  const width = Math.min(390, rect.w), x = rect.x + (rect.w - width) / 2;
  return { x, y: rect.y, w: width, h: rect.h };
}

function bezierRoute(r, points, color, alpha, dash) {
  const c = r.ctx;
  c.save(); c.globalAlpha *= alpha; c.beginPath(); c.moveTo(points[0][0], points[0][1]);
  c.bezierCurveTo(...points[1], ...points[2], ...points[3]);
  c.strokeStyle = color; c.lineWidth = 1.15; c.lineCap = 'round'; c.setLineDash(dash || [2, 8]); c.stroke();
  c.setLineDash([]); c.restore();
}

// The level list reads as one long postal route. It drifts only a few pixels
// with the list, so the map gains depth without competing with card motion.
function drawLevelRoute(r, time, rect, mood, amount, options) {
  const c = r.ctx, area = contentRect(rect), scroll = Number(options.scrollOffset) || 0;
  const still = options.reducedMotion || options.quality === 'low';
  const drift = still ? 0 : Math.sin(time / 3200) * 3;
  const period = Math.max(240, area.h * .93);
  const parallax = -((scroll * .035 % period) + period) % period;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  for (let group = -2; group <= 2; group++) {
    for (let lane = -1; lane <= 1; lane++) {
      const y = area.y + area.h * (.24 + lane * .31) + group * period + parallax + drift * (lane || 1);
      if (y < rect.y - 80 || y > rect.y + rect.h + 80) continue;
      const points = [
        [area.x - 26, y],
        [area.x + 82, y - 33 - lane * 7],
        [area.x + area.w - 86, y + 38 + lane * 5],
        [area.x + area.w + 26, y - 5]
      ];
      bezierRoute(r, points, mood.wind, amount * (lane ? .12 : .17), [3, 9]);
      for (let node = 0; node < 3; node++) {
        const x = area.x + 68 + node * 126 + lane * 13;
        const wave = Math.sin((x - area.x) / area.w * Math.PI * 2 + lane) * 12;
        c.save(); c.globalAlpha *= amount * (lane ? .1 : .15);
        r.circle(x, y + wave, 4.8, mood.fogNear, mood.wind);
        r.circle(x, y + wave, 1.45, mood.windWarm);
        c.restore();
      }
    }
  }
  if (!still) {
    const phase = fract(time / 8200), x = area.x - 12 + phase * (area.w + 24);
    const y = area.y + area.h * .53 + Math.sin(phase * TAU) * 23;
    c.save(); c.globalAlpha *= amount * Math.sin(phase * Math.PI) * .34;
    r.icon('letter', x, y, 11, mood.windWarm);
    c.restore();
  }
  c.restore();
}

function drawPostmark(r, x, y, radius, color, accent, alpha) {
  const c = r.ctx;
  c.save(); c.globalAlpha *= alpha;
  r.circle(x, y, radius, null, color); r.circle(x, y, radius - 6, null, color);
  r.line([[x - radius + 5, y + radius * .12], [x + radius - 5, y - radius * .12]], accent, 1, [2, 5]);
  for (let i = 0; i < 4; i++) {
    const angle = -.8 + i * .54;
    r.line([[x + Math.cos(angle) * (radius - 4), y + Math.sin(angle) * (radius - 4)],
      [x + Math.cos(angle) * (radius + 2), y + Math.sin(angle) * (radius + 2)]], color, .8);
  }
  c.restore();
}

function drawCollectionMarks(r, time, rect, mood, amount, options) {
  const area = contentRect(rect), still = options.reducedMotion || options.quality === 'low';
  const sway = still ? 0 : Math.sin(time / 4200) * 4;
  drawPostmark(r, area.x + 29 + sway, area.y + area.h * .23, 25, mood.wind, mood.windWarm, amount * .14);
  drawPostmark(r, area.x + area.w - 25 - sway, area.y + area.h * .58, 31, mood.wind, mood.light, amount * .11);
  if (options.quality !== 'low') drawPostmark(r, area.x + 18, area.y + area.h * .86, 17,
    mood.windWarm, mood.light, amount * .09);
}

function drawLeaderboardLights(r, time, rect, mood, amount, options) {
  const c = r.ctx, area = contentRect(rect), still = options.reducedMotion || options.quality === 'low';
  const count = options.quality === 'low' ? 4 : 8, points = [];
  for (let i = 0; i < count; i++) {
    const x = area.x + 18 + seed(i, 3) * (area.w - 36);
    const y = area.y + 18 + seed(i, 4) * Math.max(90, area.h - 36);
    points.push([x, y]);
  }
  c.save(); c.globalAlpha *= amount * .12;
  for (let i = 1; i < points.length; i++) r.line([points[i - 1], points[i]], mood.wind, .75, [2, 7]);
  c.restore();
  points.forEach(([x, y], i) => {
    const pulse = still ? .72 : .55 + (1 + Math.sin(time / (900 + i * 83) + i)) * .16;
    c.save(); c.globalAlpha *= amount * pulse;
    r.circle(x, y, i % 3 ? 1.5 : 2.2, i % 3 ? mood.mote : mood.light);
    c.globalAlpha *= .16; r.circle(x, y, i % 3 ? 5 : 7, mood.light);
    c.restore();
  });
}

function drawPublicationSeal(r, rect, mood, amount) {
  const area = contentRect(rect), x = area.x + area.w - 20, y = area.y + area.h * .78;
  const c = r.ctx;
  c.save(); c.globalAlpha *= amount * .1;
  r.circle(x, y, 46, null, mood.windWarm); r.circle(x, y, 38, null, mood.windWarm);
  r.icon('letter', x, y, 27, mood.windWarm);
  r.line([[x - 58, y + 31], [x + 31, y + 55]], mood.wind, 1, [3, 6]);
  c.restore();
}

function drawPageAtmosphere(r, time, page, rect, options = {}) {
  const mood = options.mood;
  if (!mood || !rect || rect.w <= 0 || rect.h <= 0) return;
  const amount = options.amount == null ? 1 : options.amount;
  if (page === 'levels') drawLevelRoute(r, time, rect, mood, amount, options);
  else if (page === 'collection') drawCollectionMarks(r, time, rect, mood, amount, options);
  else if (page === 'leaderboard') drawLeaderboardLights(r, time, rect, mood, amount, options);
  else if (page === 'publication') drawPublicationSeal(r, rect, mood, amount);
}

// Once per long loop, a single letter crosses the home vignette and settles by
// the courier. This is a focal story beat, not another continuous particle layer.
function drawHomeDelivery(r, time, mood, amount = 1, reducedMotion = false) {
  if (reducedMotion) return;
  const phase = fract((time + 1700) / 11800);
  if (phase > .38) return;
  const t = ease(phase / .38), fade = Math.sin(t * Math.PI);
  const x = -170 + t * 139, y = -37 + Math.sin(t * Math.PI) * -23 + t * 52;
  const c = r.ctx;
  c.save(); c.globalAlpha *= amount * fade * .78;
  for (let i = 3; i > 0; i--) {
    const trailT = Math.max(0, t - i * .045), tx = -170 + trailT * 139;
    const ty = -37 + Math.sin(trailT * Math.PI) * -23 + trailT * 52;
    c.globalAlpha *= .72; r.circle(tx, ty, 1.2, mood.light);
  }
  c.globalAlpha = Math.max(.15, fade) * amount;
  r.icon('letter', x, y, 14, mood.windWarm);
  if (t > .78) {
    c.globalAlpha *= (t - .78) / .22 * .17;
    r.circle(-31, 18, 27, mood.light); r.circle(-31, 18, 14, mood.celestialGlow);
  }
  c.restore();
}

module.exports = { drawPageAtmosphere, drawHomeDelivery };
