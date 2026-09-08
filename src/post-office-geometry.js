'use strict';

// Drawing and picking share the same silhouettes, in the office's 44-unit space.
const OFFICE = {
  sideOffset: -2,
  front: [[-18, -26], [8, -22], [8, 2], [-18, -4]],
  side: [[8, -22], [22, -30], [22, -6], [8, 2]],
  roof: [[-23, -27], [-4, -43], [27, -36], [8, -19]],
  frontTrim: [[-23, -27], [8, -19], [8, -15], [-23, -23]],
  sideTrim: [[8, -19], [27, -36], [27, -32], [8, -15]],
  step: [[8, 2], [-18, -4], [-21, -1], [6, 6], [13, 2]],
  top: [[0, -19], [19, 0], [0, 19], [-19, 0]],
};

function officeFlag(now) {
  const flap = Math.sin(now / 370) * 2;
  return [[23, -44], [34, -44 + flap], [32, -37 + flap], [23, -38]];
}

function containsPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    if (Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-8 &&
      x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
  }
  return inside;
}

function hitPostOffice(r, { x, y, size, now, blend, rotation }, action) {
  if (!action) return;
  const scale = size / 44, shapes = [];
  if (blend < 1) {
    [OFFICE.front, OFFICE.side, OFFICE.roof, OFFICE.frontTrim, OFFICE.sideTrim, OFFICE.step, officeFlag(now)]
      .forEach(points => shapes.push(points.map(([dx, dy]) => [x + dx * scale, y + OFFICE.sideOffset + dy * scale])));
  }
  if (blend > 0) {
    const cosine = Math.cos(rotation), sine = Math.sin(rotation);
    shapes.push(OFFICE.top.map(([dx, dy]) => [x + (cosine * dx - sine * dy) * scale, y + (sine * dx + cosine * dy) * scale]));
  }
  const points = shapes.flat(), xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  r.hit(left, top, Math.max(...xs) - left, Math.max(...ys) - top, action,
    (hx, hy) => shapes.some(points => containsPolygon(points, hx, hy)));
}

module.exports = { OFFICE, officeFlag, hitPostOffice };
