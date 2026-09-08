'use strict';

function polygon(r, points, fill) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function edgePoint(a, b, fraction, drop = 0) {
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction + drop];
}

function drawIslandSurface(r, corners, depth, now) {
  const c = r.ctx;
  if (depth > 0) {
    const xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs), front = Math.max(...ys);
    c.save(); c.globalAlpha *= Math.min(1, depth / 26);
    c.beginPath(); c.ellipse((left + right) / 2, front + depth + 7, (right - left) * .34, 10, 0, 0, Math.PI * 2);
    c.fillStyle = '#061f2824'; c.fill(); c.restore();
    corners.forEach((a, index) => {
      const b = corners[(index + 1) % corners.length];
      // Clockwise screen-space edges face the viewer when they run right to left.
      if (b[0] >= a[0]) return;
      const baseA = [a[0], a[1] + depth], baseB = [b[0], b[1] + depth];
      polygon(r, [a, b, baseB, baseA], b[1] > a[1] ? '#2a504c' : '#3e6258');
      polygon(r, [a, edgePoint(a, b, .42), edgePoint(a, b, .27, depth * .72), baseA], '#496d5c');
      polygon(r, [edgePoint(a, b, .42), b, baseB, edgePoint(a, b, .64, depth * .55)], '#31554e');
      polygon(r, [edgePoint(a, b, .27, depth * .72), edgePoint(a, b, .42), edgePoint(a, b, .64, depth * .55), baseB], '#365d54');
      r.line([edgePoint(a, b, .02, depth * .17), edgePoint(a, b, .98, depth * .17)], '#88a07760', Math.min(1.1, depth * .06));
      const count = Math.min(4, Math.floor((a[0] - b[0]) / 45));
      for (let vine = 1; vine <= count; vine++) {
        const [x, y] = edgePoint(a, b, vine / (count + 1));
        const drop = depth * (.5 + vine % 3 * .12);
        const sway = Math.sin(now / 2200 + index + vine) * Math.min(2, depth * .07);
        const leaf = Math.min(3, depth * .1), stemX = x + sway;
        r.line([[x, y + depth * .08], [stemX, y + drop], [stemX + leaf * .4, y + drop + leaf]], '#759d78', Math.min(1.4, depth * .09));
        polygon(r, [[stemX, y + drop * .7], [stemX + leaf, y + drop * .7 - leaf], [stemX + leaf * 1.2, y + drop * .7 + leaf]], '#8ba779');
      }
    });
  }
  polygon(r, corners, '#597c63');
}

module.exports = { drawIslandSurface };
