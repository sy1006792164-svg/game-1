'use strict';

// Light stays in board space: camera drawing and the existing inverse picker
// share the same floor, even while a tile is pressed or an actor is airborne.
function polygon(r, points, fill) {
  const c = r.ctx;
  c.beginPath();
  points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function floorPoints(x, y, hw, hh) {
  return [[x, y - hh], [x + hw, y], [x, y + hh], [x - hw, y]];
}

function drawPaving(r, x, y, hw, hh, wall, variant) {
  const height = wall ? 4 : 0, top = y - height;
  if (wall) {
    polygon(r, [[x - hw, top], [x, top + hh], [x, y + hh], [x - hw, y]], '#839777');
    polygon(r, [[x, top + hh], [x + hw, top], [x + hw, y], [x, y + hh]], '#547c6a');
  }
  polygon(r, floorPoints(x, top, hw, hh), wall ? '#6f9172' : '#b3b9a0');
  const inset = Math.min(1.8, hw * .065);
  polygon(r, floorPoints(x, top - .4, hw - inset, hh - inset * .75),
    wall ? variant ? '#a9bf8e' : '#b8c999' : variant ? '#f1e9cf' : '#fff3d9');
  r.line([[x - hw + inset, top - .5], [x, top - hh + inset * .75], [x + hw - inset, top - .5]],
    wall ? '#d6ddb2' : '#fffdf0', 1.2);
  r.line([[x - hw + inset, top + .8], [x, top + hh - inset * .75], [x + hw - inset, top + .8]],
    wall ? '#7f9b73' : '#b5bca09c', .9);
}

function drawFloorLighting(r, corners) {
  if (r.effectsQuality === 'low') return;
  const c = r.ctx, xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
  const light = c.createLinearGradient(left, top, right, bottom);
  if (!light || typeof light.addColorStop !== 'function') return;
  light.addColorStop(0, '#fff4cd38'); light.addColorStop(.42, '#fff4cd00');
  light.addColorStop(1, '#285e5128');
  c.save(); polygon(r, corners, light); c.restore();
}

function drawGroundGlow(r, x, y, hw, hh, color) {
  const c = r.ctx;
  c.save(); c.translate(x, y); c.scale(1, hh / hw);
  c.globalAlpha *= .14;
  r.circle(0, 0, hw * .7, color);
  if (r.effectsQuality !== 'low') {
    c.globalAlpha *= .7; r.circle(0, 0, hw * .95, color);
  }
  c.restore();
}

function drawTileFocus(r, x, y, hw, hh, pressed) {
  const inset = pressed ? 3.8 : 3;
  const points = floorPoints(x, y, hw - inset, hh - 2);
  polygon(r, points, pressed ? '#e9bf7390' : '#f4d49b50');
  r.line([...points, points[0]], pressed ? '#98662e' : '#b38d4d', pressed ? 2 : 1.25);
  if (pressed) {
    r.line([points[3], points[0], points[1]], '#7b633e88', 2.4);
    r.line([points[3], points[2], points[1]], '#fff7d9', 1.6);
  } else {
    r.line([[x - hw * .12, y + hh * .43], [x + hw * .12, y + hh * .43]], '#af8749', 1.8);
  }
}

function drawActorShadow(r, frame, hw, hh, ghost) {
  const c = r.ctx, lift = Math.max(0, frame.lift), spread = 1 + lift * .025;
  c.save(); c.globalAlpha *= frame.alpha * (ghost ? .4 : .85);
  c.beginPath(); c.ellipse(frame.x + 2, frame.y + 2, hw * .47 * spread, hh * .3 * spread, 0, 0, Math.PI * 2);
  c.fillStyle = ghost ? '#358e982e' : '#31544925'; c.fill();
  c.globalAlpha *= Math.max(.25, 1 - lift * .09);
  c.beginPath(); c.ellipse(frame.x, frame.y + 1, hw * .31, hh * .17, 0, 0, Math.PI * 2);
  c.fillStyle = ghost ? '#43969c36' : '#294d4954'; c.fill();
  c.restore();
}

module.exports = { drawPaving, drawFloorLighting, drawGroundGlow, drawTileFocus, drawActorShadow };
