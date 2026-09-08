'use strict';

function polygon(r, points, fill) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath(); c.fillStyle = fill; c.fill();
}

function treeTop(r, x, y, size, now) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size, size);
  r.circle(.035, .035, .43, '#102c3033');
  const sway = Math.sin(now / 2100 + x) * .025;
  ['#3b6c59', '#51836a', '#75a47a'].forEach((color, layer) => {
    const radius = .43 - layer * .11;
    const points = Array.from({ length: 16 }, (_, i) => {
      const angle = i * Math.PI / 8 + layer * .2 + sway;
      const length = radius * (i % 2 ? .64 : 1);
      return [Math.cos(angle) * length, Math.sin(angle) * length];
    });
    polygon(r, points, color);
  });
  r.circle(-.035, -.04, .055, '#a6c091');
  c.restore();
}

function officeTop(r, x, y, size, now, ready, rotation) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size / 44, size / 44);
  c.rotate(rotation);
  if (ready) {
    c.save(); c.globalAlpha *= .13 + Math.sin(now / 550) * .025;
    r.circle(0, 0, 22, '#efb45d'); c.restore();
  }
  polygon(r, [[1, -18], [20, 1], [1, 20], [-18, 1]], '#143d3445');
  polygon(r, [[0, -19], [19, 0], [0, 19], [-19, 0]], '#dfcda6');
  polygon(r, [[0, -17], [17, 0], [0, 17], [-17, 0]], '#2b574e');
  polygon(r, [[0, -17], [17, 0], [0, 0], [-17, 0]], '#466f61');
  r.line([[-17, 0], [17, 0]], '#85a48b', 1.4);
  r.line([[-10, -7], [10, -7]], '#85a48b66', .8);
  r.line([[-10, 7], [10, 7]], '#85a48b66', .8);
  r.round(-8, -5, 16, 10, 2, ready ? '#ffe7a4' : '#fff1ce');
  r.icon('letter', 0, 0, 12, '#bf7f47');
  r.round(5, -11, 5, 5, 1, '#adba94');
  r.round(6, -10, 3, 3, .5, '#385e51');
  c.restore();
}

function courierTop(r, x, y, size, ghost, frame) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size / 40, size / 40);
  c.globalAlpha *= frame.alpha * (ghost ? .72 : 1);
  c.rotate(frame.facing === -1 ? -Math.PI / 4 : Math.PI / 4);
  const stride = frame.stride * 1.5;
  r.circle(0, 0, 15, ghost ? '#87dce422' : '#132c302b');
  r.round(-8, 5 + stride, 5, 6, 2, ghost ? '#94dfdf' : '#293b39');
  r.round(3, 5 - stride, 5, 6, 2, ghost ? '#94dfdf' : '#293b39');
  r.round(-11, -3, 22, 13, 6, ghost ? '#94dfdf' : '#efac62');
  r.circle(-12, 1 + stride, 2, ghost ? '#c5ffff' : '#ffe2af');
  r.circle(12, 1 - stride, 2, ghost ? '#c5ffff' : '#ffe2af');
  r.round(-7, 5, 14, 8, 3, ghost ? '#69b9c2' : '#91643b');
  r.round(-6, 5, 12, 3, 1.5, ghost ? '#c5ffff' : '#e0b56b');
  r.circle(0, 9, 1, ghost ? '#dbffff' : '#ffe2ac');
  r.circle(0, -3, 10, ghost ? '#94dfdf' : '#2c6558');
  r.circle(0, -4, 7, ghost ? '#b9efea' : '#427d61');
  r.line([[-4, -8], [3, -9]], ghost ? '#dbffff' : '#77a17a', 1.3);
  r.circle(6, -2, 1.7, ghost ? '#dbffff' : '#efb45d');
  c.restore();
}

module.exports = { treeTop, officeTop, courierTop };
