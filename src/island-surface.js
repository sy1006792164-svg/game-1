'use strict';

function polygon(r, points, fill) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function edgePoint(a, b, fraction, drop = 0) {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction + drop];
}

function drawIslandSurface(r, corners, depth, now, limitBottom = Infinity) {
  const c = r.ctx;
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
      c.fillStyle = '#64816c18'; c.fill(); c.restore();
    }
    corners.forEach((a, index) => {
      const b = corners[(index + 1) % corners.length];
      // Clockwise screen-space edges face the viewer when they run right to left.
      if (b[0] >= a[0]) return;
      const baseA = [a[0], a[1] + depth], baseB = [b[0], b[1] + depth];
      const shaded = b[1] > a[1];
      polygon(r, [a, b, baseB, baseA], shaded ? '#9caf9b' : '#c7cbb1');
      // A carved limestone rim and continuous masonry courses give the floating
      // courtyard weight without changing any of the playable top-surface points.
      polygon(r, [a, b, edgePoint(a, b, 1, depth * .2), edgePoint(a, b, 0, depth * .2)], shaded ? '#bbc8ac' : '#e4e3c7');
      polygon(r, [edgePoint(a, b, 0, depth * .82), edgePoint(a, b, 1, depth * .82), baseB, baseA], shaded ? '#8da28e' : '#b6c0a5');
      [.21, .5, .8].forEach(fraction => r.line([edgePoint(a, b, .005, depth * fraction), edgePoint(a, b, .995, depth * fraction)], shaded ? '#dce4c738' : '#f5f0d666', .85));
      const blocks = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 28));
      for (let block = 1; block < blocks; block++) {
        r.line([edgePoint(a, b, block / blocks, depth * .22), edgePoint(a, b, block / blocks, depth * .49)], '#819b8155', .65);
        r.line([edgePoint(a, b, (block - .5) / blocks, depth * .51), edgePoint(a, b, (block - .5) / blocks, depth * .79)], '#819b8155', .65);
      }
      const count = Math.min(4, Math.floor((a[0] - b[0]) / 45));
      for (let vine = 1; vine <= count; vine++) {
        const [x, y] = edgePoint(a, b, vine / (count + 1));
        const drop = depth * (.5 + vine % 3 * .12);
        const sway = Math.sin(now / 2200 + index + vine) * Math.min(2, depth * .07);
        const leaf = Math.min(3, depth * .1), stemX = x + sway;
        r.line([[x, y + depth * .08], [stemX, y + drop], [stemX + leaf * .4, y + drop + leaf]], '#739875', Math.min(1.4, depth * .09));
        polygon(r, [[stemX, y + drop * .7], [stemX + leaf, y + drop * .7 - leaf], [stemX + leaf * 1.2, y + drop * .7 + leaf]], '#91ae83');
      }
    });
  }
  polygon(r, corners, '#a7be98');
}

module.exports = { drawIslandSurface };
