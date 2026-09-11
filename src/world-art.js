'use strict';

const { windState } = require('./ambient-effects');

// The miniature uses the same two-to-one perspective as the playable courtyard.
// These buildings are home-screen scenery, never part of a puzzle's hit geometry.
const PALETTE = {
  ivory: '#eee5cb', top: '#fff7df', shade: '#8fa69a', edge: '#d4cdb0',
  arch: '#54766d', archDark: '#2b514d', coral: '#c28a54', coralDark: '#775b44',
  coralLight: '#f1c78a', sage: '#90ae8d', moss: '#507769', water: '#8fc5bd'
};

function polygon(r, points, fill) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function ellipse(r, x, y, rx, ry, fill) {
  const c = r.ctx; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}

function point(u, v, z = 0) { return [u - v, (u + v) / 2 + 8 - z]; }

function slab(r, u, v, width, length, z, height, colors = {}) {
  const top = [point(u, v, z + height), point(u + width, v, z + height), point(u + width, v + length, z + height), point(u, v + length, z + height)];
  polygon(r, [top[3], top[2], point(u + width, v + length, z), point(u, v + length, z)], colors.front || PALETTE.ivory);
  polygon(r, [top[2], top[1], point(u + width, v, z), point(u + width, v + length, z)], colors.side || PALETTE.shade);
  polygon(r, top, colors.top || PALETTE.top);
  if (r.effectsQuality === 'low') return;
  const bevel = Math.min(1.15, height * .22, width * .15, length * .15);
  if (height > 3) {
    polygon(r, [top[3], top[2], point(u + width, v + length, z + height - bevel), point(u, v + length, z + height - bevel)], '#fff5d380');
    polygon(r, [top[2], top[1], point(u + width, v, z + height - bevel), point(u + width, v + length, z + height - bevel)], '#d0d5b75c');
    r.line([point(u, v + length, z + .5), point(u + width, v + length, z + .5), point(u + width, v, z + .5)], '#3c655333', .8);
  }
  r.line([top[3], top[2]], '#fffbe8b3', .85);
  r.line([top[2], top[1]], '#dce4c880', .75);
}

function arch(r, u, v, z, width, height, face = 'front', lit = false) {
  const c = r.ctx, map = (along, up) => face === 'front' ? point(u + along, v, z + up) : point(u, v - along, z + up);
  const [x, y] = map(0, 0), radius = width / 2;
  c.save(); c.translate(x, y);
  // Affine projection keeps the opening upright, with the lintel on its wall plane.
  c.transform(1, face === 'front' ? .5 : -.5, 0, -1, 0, 0);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(width, 0); c.lineTo(width, height - radius);
  c.arc(radius, height - radius, radius, 0, Math.PI); c.closePath();
  c.fillStyle = lit ? '#e4b976' : PALETTE.arch; c.fill();
  c.strokeStyle = face === 'front' ? '#d9cfaf' : '#779288'; c.lineWidth = 2.2; c.stroke();
  c.save(); c.clip();
  c.fillStyle = lit ? '#977446' : PALETTE.archDark; c.fillRect(0, 0, 3.4, height);
  c.fillStyle = lit ? '#ffe7ae' : '#a5b5a0'; c.fillRect(3.4, 0, width, 2);
  if (r.effectsQuality !== 'low') {
    c.fillStyle = lit ? '#ffedb6' : '#c0c9ac'; c.fillRect(width - 1, 2, 1, height);
    c.fillStyle = '#284d4325'; c.fillRect(3.4, height - radius * .7, width, radius);
  }
  if (lit) { c.fillStyle = '#fff3c455'; c.fillRect(width / 2 - .8, 0, 1.6, height); }
  c.restore(); c.restore();
}

function roof(r, u, v, width, length, z, height, detail = true) {
  const a = point(u - 3, v - 3, z), b = point(u + width + 3, v - 3, z);
  const d = point(u - 3, v + length + 3, z), e = point(u + width + 3, v + length + 3, z);
  const ridgeA = point(u - 3, v + length / 2, z + height), ridgeB = point(u + width + 3, v + length / 2, z + height);
  polygon(r, [d, e, [e[0], e[1] + 3], [d[0], d[1] + 3]], '#715e47');
  polygon(r, [e, b, [b[0], b[1] + 3], [e[0], e[1] + 3]], '#4f6254');
  polygon(r, [a, b, ridgeB, ridgeA], PALETTE.coralDark);
  polygon(r, [ridgeA, ridgeB, e, d], PALETTE.coral);
  polygon(r, [b, e, ridgeB], '#967653');
  if (detail) polygon(r, [ridgeA, ridgeB, [ridgeB[0] + (e[0] - ridgeB[0]) * .32, ridgeB[1] + (e[1] - ridgeB[1]) * .32],
    [ridgeA[0] + (d[0] - ridgeA[0]) * .32, ridgeA[1] + (d[1] - ridgeA[1]) * .32]], '#d9aa6d');
  r.line([ridgeA, ridgeB], PALETTE.coralLight, 2);
  r.line([d, e], '#edc08a', 1.3);
  for (let i = 1; detail && i < 6; i++) {
    const t = i / 6;
    r.line([[ridgeA[0] + (ridgeB[0] - ridgeA[0]) * t, ridgeA[1] + (ridgeB[1] - ridgeA[1]) * t],
      [d[0] + (e[0] - d[0]) * t, d[1] + (e[1] - d[1]) * t]], '#7b61455c', .8);
  }
}

function gardenTree(r, u, v, size, now, color = '#789e7c', sharedWind) {
  const quiet = r.reducedMotion || r.effectsQuality === 'low';
  if (quiet) now = 0;
  const wind = sharedWind || windState(now, quiet), [x, y] = point(u, v);
  const sway = Math.sin(now / 2800 + u) * .28 + Math.sin(now / 620 + u * .17) * (.22 + wind.gust * 1.05);
  polygon(r, [[x - 3, y], [x + 3, y - 1], [x + size * .82, y + size * .2], [x + size * .38, y + size * .28]], '#325d4938');
  ellipse(r, x + 1, y, size * .13, size * .045, '#2e58484d');
  r.line([[x, y], [x, y - size * .59]], '#887e60', 2.3);
  r.line([[x, y - size * .29], [x - size * .15, y - size * .51]], '#8c8566', 1.2);
  ellipse(r, x + sway, y - size * .66, size * .31, size * .4, color);
  ellipse(r, x - size * .1 + sway, y - size * .73, size * .22, size * .31, '#b7c993');
  ellipse(r, x + size * .13 + sway, y - size * .6, size * .12, size * .27, '#4e7864');
  if (r.effectsQuality !== 'low') {
    ellipse(r, x - size * .12 + sway, y - size * .84, size * .12, size * .15, '#d5dbaa70');
    r.line([[x - size * .12 + sway, y - size * .94], [x - size * .19 + sway, y - size * .82]], '#eff0c280', 1.2);
  }
}

function planter(r, u, v, width, length) {
  slab(r, u, v, width, length, 0, 4, { front: '#e2d7bb', side: '#b1bda5', top: '#a7bc90' });
  [0, 1, 2].forEach(i => {
    const [x, y] = point(u + 3 + i * (width - 6) / 2, v + length / 2, 5);
    ellipse(r, x, y, 4, 2.5, i % 2 ? '#89ac86' : '#719979');
    r.circle(x - 1, y - 2, 1.6, '#eac19a');
  });
}

function drawHomeArchitecture(r, now, options = {}) {
  const low = options.quality === 'low' || r.effectsQuality === 'low';
  if (low && r.effectsQuality !== 'low') { r = Object.create(r); r.effectsQuality = 'low'; }
  const quiet = options.reducedMotion || r.reducedMotion || low;
  if (quiet) now = 0;
  const wind = windState(now, quiet);
  // A stone garden plinth, with continuous masonry courses and a thin grass cap.
  ellipse(r, 20, 119, 123, 13, '#365e5229');
  if (!low) ellipse(r, 19, 118, 94, 8, '#3357461b');
  slab(r, -72, -72, 144, 144, -29, 5, { front: '#8d9a7b', side: '#45695d', top: '#adb697' });
  slab(r, -72, -72, 144, 144, -24, 20, { front: '#b9b798', side: '#6a897c', top: '#dde0c6' });
  slab(r, -75, -75, 150, 150, -4, 4, { front: '#f1e3bd', side: '#9eae8e', top: '#afc19a' });
  [-20, -12].forEach(z => r.line([point(-72, 72, z), point(72, 72, z), point(72, -72, z)], '#385e4c40', 1));
  if (!low) r.line([point(-74, 74, -3), point(74, 74, -3), point(74, -74, -3)], '#dec18e', .8);
  [-40, 0, 40].forEach(u => r.line([point(u, 72, -11), point(u, 72, -19)], '#a7b29c77', .8));
  [-40, 0, 40].forEach(v => r.line([point(72, v, -19), point(72, v, -27)], '#899f8e66', .8));
  slab(r, -59, -54, 114, 110, 0, 2, { front: '#d3d1b2', side: '#91a58b', top: '#c9ceb0' });

  // Inlaid courtyard paving follows the isometric axes all the way to the arcade.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const u = -24 + col * 17, v = -6 + row * 17;
    const top = (row + col) % 2 ? '#f4efd9' : '#edead3';
    // Keep every paving color and top outline; subpixel bevels can disappear on
    // small screens and cost two extra faces plus a stroke per tile.
    if (low) polygon(r, [point(u, v, 3), point(u + 16.3, v, 3), point(u + 16.3, v + 16.3, 3), point(u, v + 16.3, 3)], top);
    else slab(r, u, v, 16.3, 16.3, 2, 1, { front: '#dfdfc6', side: '#c9d0b7', top });
  }
  // A shallow reflecting pool provides one quiet, cool counterpoint to the roofs.
  slab(r, -52, 11, 23, 42, 2, 3, { front: '#f2ebd2', side: '#c2ccb3', top: '#fbf4db' });
  polygon(r, [point(-49, 14, 5), point(-32, 14, 5), point(-32, 50, 5), point(-49, 50, 5)], '#4d958b');
  polygon(r, [point(-48, 15, 5), point(-35, 15, 5), point(-35, 45, 5), point(-48, 39, 5)], '#aad3c6');
  for (let i = 0; i < 3; i++) {
    const drift = Math.sin(now / 1700 + i), [x, y] = point(-42 + drift * 2, 21 + i * 10, 5);
    r.line([[x - 3 - drift, y], [x + 3 + drift, y + 2]], '#eff4dc99', .9);
  }
  r.line([point(-49, 50, 5), point(-49, 14, 5), point(-32, 14, 5)], '#345f5966', 1.8);

  // The light comes from the upper left; every built volume casts the same direction.
  polygon(r, [point(-53, -18), point(9, -18), point(31, -5), point(-31, -5)], '#315d4e34');
  polygon(r, [point(8, -46), point(38, -46), point(72, -27), point(72, 3), point(42, 3), point(8, -16)], '#315a4e30');
  polygon(r, [point(-53, -18), point(11, -18), point(14, -14), point(-51, -14)], '#2c52484d');
  gardenTree(r, -63, -41, 41, now, undefined, wind);
  gardenTree(r, -58, -63, 29, now, undefined, wind);

  // Raised gallery with three genuine inset arches and a roof terrace.
  slab(r, -53, -48, 64, 30, 2, 6);
  slab(r, -51, -46, 60, 26, 8, 34);
  [-47, -28, -9].forEach(u => arch(r, u, -20, 8, 12, 25));
  slab(r, -51, -46, 60, 26, 39, 3, { front: '#b1aa8b', side: '#597c6f', top: '#d7ceb0' });
  slab(r, -54, -49, 66, 32, 42, 4, { front: '#eee1be', side: '#8ba18c', top: '#fff8e5' });
  slab(r, -51, -46, 60, 3, 46, 8);
  slab(r, -51, -20, 60, 3, 46, 8);
  slab(r, -51, -43, 3, 23, 46, 8);
  [-48, -29, -10, 6].forEach(u => slab(r, u, -21, 4, 4, 46, 11));
  planter(r, -60, -11, 11, 16);

  // A slender postal tower is the focal point, with a copper hipped roof and bell.
  slab(r, 5, -49, 36, 36, 2, 7);
  slab(r, 8, -46, 30, 30, 9, 38);
  slab(r, 6, -48, 34, 34, 47, 3, { front: '#eee1bf', side: '#8ca28d', top: '#fff4df' });
  slab(r, 8, -46, 30, 30, 50, 46);
  if (!low) {
    r.line([point(8, -16, 46), point(38, -16, 46), point(38, -46, 46)], '#355e4c55', 1.2);
    r.line([point(9, -16, 52), point(9, -16, 93)], '#fff6daa6', 1.6);
    r.line([point(38, -17, 52), point(38, -17, 93)], '#c3ceb3', .8);
  }
  arch(r, 15, -16, 10, 15, 27, 'front', true);
  arch(r, 17, -16, 62, 12, 22);
  arch(r, 38, -24, 60, 12, 22, 'side');
  const [bellX, bellY] = point(23, -16, 68);
  r.line([[bellX, bellY - 8], [bellX, bellY - 2]], '#b5a373', 1.1);
  polygon(r, [[bellX - 3.5, bellY + 2], [bellX - 2.5, bellY - 3], [bellX + 1, bellY - 4], [bellX + 3.5, bellY + 5]], '#d9b374');
  slab(r, 8, -46, 30, 30, 93, 3, { front: '#b9b092', side: '#587b6d', top: '#d5d1b3' });
  slab(r, 5, -49, 36, 36, 96, 4);
  roof(r, 5, -49, 36, 36, 100, 17, !low);
  const [flagX, flagY] = point(23, -31, 121);
  r.line([[flagX, flagY + 8], [flagX, flagY - 14]], '#657e6b', 1.1);
  const flap = Math.sin(now / 850) * (1.8 + wind.strength * 3.5);
  polygon(r, [[flagX + .5, flagY - 13], [flagX + 15 + Math.sin(now / 1100), flagY - 10 + flap], [flagX + 12, flagY - 3 + flap * .65], [flagX + .5, flagY - 6]], '#d79177');
  const [signX, signY] = point(23, -16, 45);
  r.circle(signX, signY, 5, '#e1ba83'); r.icon('letter', signX, signY, 6, '#fff9df');

  // Six individual steps connect the porch to the courtyard.
  for (let i = 5; i >= 0; i--) slab(r, 11, -13 + i * 3, 23, 3.2, 2, 1 + (6 - i) * 1.05, { front: '#e9e4ce', side: '#bfcab0', top: '#fff5df' });
  planter(r, 46, -22, 11, 23);
  gardenTree(r, 58, -39, 36, now, undefined, wind);
  gardenTree(r, 61, -17, 27, now, undefined, wind);

  // Warm brass lamp and a low bench make the courtyard feel inhabited.
  const [lampX, lampY] = point(48, 23, 3);
  ellipse(r, lampX + 3, lampY + 1, 4.5, 1.7, '#5c7c682d');
  r.line([[lampX, lampY], [lampX, lampY - 26], [lampX - 5, lampY - 26]], '#667f67', 1.6);
  r.round(lampX - 8, lampY - 26, 6, 9, 2, '#c5a574');
  r.round(lampX - 6.5, lampY - 24.5, 3, 5, 1, '#fff1b8');
  slab(r, 43, 42, 17, 7, 4, 3, { front: '#b5906c', side: '#8e8162', top: '#d8b58a' });
  [[44, 43], [56, 46]].forEach(([u, v]) => { const a = point(u, v, 0), b = point(u, v, 5); r.line([a, b], '#7b8466', 1.5); });
  planter(r, -18, 62, 23, 8);
  planter(r, 49, 61, 13, 8);
  // Tiny grasses and vines break the stone silhouette without obscuring architecture.
  [-46, 4, 45].forEach((u, i) => {
    const [x, y] = point(u, 75, -2), drop = 12 + i * 2;
    r.line([[x, y], [x - 2, y + drop], [x + 1, y + drop + 5]], '#82a281', 1.5);
    ellipse(r, x + 1, y + drop - 2, 3, 1.5, '#91ae84');
  });
}

module.exports = { drawHomeArchitecture, gardenTree };
