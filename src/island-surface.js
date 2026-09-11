'use strict';

function polygon(r, points, fill) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function edgePoint(a, b, fraction, drop = 0) {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction + drop];
}

function drawStoneFace(r, a, b, depth, now, index, low) {
  const shaded = b[1] > a[1], topBand = depth * .19, foot = depth * .83;
  const baseA = [a[0], a[1] + depth], baseB = [b[0], b[1] + depth];
  // The top stays on the projection's exact plane. Light and carved courses,
  // rather than a raised floor, give the playing surface its thickness.
  polygon(r, [a, b, baseB, baseA], shaded ? '#69877f' : '#b5b79d');
  polygon(r, [a, b, edgePoint(a, b, 1, topBand), edgePoint(a, b, 0, topBand)], shaded ? '#9cae96' : '#e8dfbf');
  polygon(r, [edgePoint(a, b, 0, foot), edgePoint(a, b, 1, foot), baseB, baseA], shaded ? '#45685f' : '#8b9b82');
  r.line([edgePoint(a, b, 0, topBand), edgePoint(a, b, 1, topBand)], shaded ? '#3c605d77' : '#7d846270', 1.25);
  r.line([a, b], shaded ? '#c2d1b6' : '#fff6d8', 1.5);
  if (low) return;

  // A narrow brass seam sits below the limestone cap; the lower courses catch
  // reflected ground light while the joints remain recessed.
  r.line([edgePoint(a, b, .015, topBand - 1), edgePoint(a, b, .985, topBand - 1)], shaded ? '#b39c69' : '#e3c28a', .9);
  [.5, .81].forEach(fraction => {
    r.line([edgePoint(a, b, .005, depth * fraction), edgePoint(a, b, .995, depth * fraction)], shaded ? '#355c544f' : '#7c8d6f70', .9);
    r.line([edgePoint(a, b, .005, depth * fraction + 1), edgePoint(a, b, .995, depth * fraction + 1)], shaded ? '#b7c6a847' : '#f6e9c477', .7);
  });
  const blocks = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 34));
  for (let block = 1; block < blocks; block++) {
    r.line([edgePoint(a, b, block / blocks, topBand + 1), edgePoint(a, b, block / blocks, depth * .49)], shaded ? '#355c5470' : '#7c8d6f77', .8);
    r.line([edgePoint(a, b, (block - .5) / blocks, depth * .52), edgePoint(a, b, (block - .5) / blocks, depth * .79)], shaded ? '#355c5470' : '#7c8d6f77', .8);
  }
  const count = Math.min(3, Math.floor((a[0] - b[0]) / 55));
  for (let vine = 1; vine <= count; vine++) {
    const [x, y] = edgePoint(a, b, vine / (count + 1));
    const drop = depth * (.5 + vine % 3 * .12);
    const sway = Math.sin(now / 2200 + index + vine) * Math.min(2, depth * .07);
    const leaf = Math.min(3, depth * .1), stemX = x + sway;
    r.line([[x, y + depth * .08], [stemX, y + drop], [stemX + leaf * .4, y + drop + leaf]], '#537d64', Math.min(1.4, depth * .09));
    polygon(r, [[stemX, y + drop * .7], [stemX + leaf, y + drop * .7 - leaf], [stemX + leaf * 1.2, y + drop * .7 + leaf]], '#9bb586');
  }
}

function drawIslandSurface(r, corners, depth, now, limitBottom = Infinity) {
  const c = r.ctx, low = r.effectsQuality === 'low';
  if (r.reducedMotion || low) now = 0;
  if (depth > 0) {
    const xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs), front = Math.max(...ys);
    // A short viewport may leave only a few pixels below the stone base. Fit
    // just its soft shadow there instead of cutting a wide ellipse in half.
    const shadowRoom = limitBottom - front - depth;
    const shadowGap = Math.min(7, Math.max(0, shadowRoom / 2));
    const shadowRadius = Math.min(10, Math.max(0, shadowRoom - shadowGap));
    if (shadowRadius > 0) {
      c.save(); c.globalAlpha *= Math.min(1, depth / 26);
      c.beginPath(); c.ellipse((left + right) / 2, front + depth + shadowGap, (right - left) * .34, shadowRadius, 0, 0, Math.PI * 2);
      c.fillStyle = '#375f5527'; c.fill();
      if (!low) {
        c.beginPath(); c.ellipse((left + right) / 2, front + depth + shadowGap, (right - left) * .23, shadowRadius * .48, 0, 0, Math.PI * 2);
        c.fillStyle = '#31594e18'; c.fill();
      }
      c.restore();
    }
    corners.forEach((a, index) => {
      const b = corners[(index + 1) % corners.length];
      // Clockwise screen-space edges face the viewer when they run right to left.
      if (b[0] >= a[0]) return;
      drawStoneFace(r, a, b, depth, now, index, low);
    });
  }
  polygon(r, corners, '#aabd97');
}

module.exports = { drawIslandSurface };
