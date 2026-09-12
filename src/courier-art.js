'use strict';

// The same tiny sculpted courier lives in the title scene and every real route.
function drawCourier(r, x, y, size, ghost, pose = {}) {
  const c = r.ctx, stride = pose.stride || 0, cloak = pose.cloak || 0;
  const scale = size / 40, groundOffset = size > 0 ? (pose.lift || 0) / scale : 0;
  const oval = (cx, cy, rx, ry, color) => {
    c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  };
  c.save(); c.translate(x, y); c.scale(scale * (pose.facing === -1 ? -1 : 1), scale);
  c.globalAlpha *= pose.alpha == null ? 1 : pose.alpha;
  // The cast shadow stays on the paper while the figure stretches above it.
  if (ghost) oval(0, 12 + groundOffset, 13, 4, '#45949b18');
  else oval(2, 18 + groundOffset, 14, 4, '#3c615326');
  c.translate(0, 13); c.rotate(pose.lean || 0); c.scale(pose.squash || 1, pose.stretch || 1); c.translate(0, -13);
  if (ghost) {
    oval(0, -5, 19, 24, '#81c4c81c');
    c.beginPath(); c.moveTo(-11, 10); c.lineTo(-11, -11);
    c.bezierCurveTo(-11, -27, 12, -27, 12, -11); c.lineTo(12, 10);
    c.quadraticCurveTo(8, 5 + cloak, 5, 11 - cloak); c.quadraticCurveTo(1, 5 - cloak, -2, 11 + cloak);
    c.quadraticCurveTo(-6, 6 + cloak, -11, 10); c.closePath();
    c.fillStyle = '#8bcacecf'; c.fill(); c.strokeStyle = '#ecfffa'; c.lineWidth = 1.3; c.stroke();
    r.round(-7, -16, 14, 16, 7, '#d7f7eb88');
    r.circle(-3, -8, 1.25, '#2b727c'); r.circle(4, -8, 1.25, '#2b727c');
    oval(0, -19, 14, 3, '#68abb6'); r.round(-8, -27, 17, 8, 4, '#8ecbd0');
    r.line([[-5, -25], [5, -25]], '#e9fff4', 1);
  } else {
    r.line([[-5, 9], [-6 - stride * 3, 16 - stride * 2]], '#42645c', 4.5);
    r.line([[5, 9], [6 + stride * 3, 16 + stride * 2]], '#2e504b', 4.5);
    r.round(-9 - stride * 3, 15 - stride * 2, 8, 4, 2, '#785c46');
    r.round(3 + stride * 3, 15 + stride * 2, 9, 4, 2, '#785c46');
    // A round cape, lit from the upper left; side plane and hem give volume.
    c.beginPath(); c.moveTo(-7, -5); c.quadraticCurveTo(-13 - cloak, -1, -15 - cloak, 10 - cloak);
    c.quadraticCurveTo(-1 - cloak, 19 - cloak * .4, 14, 10); c.quadraticCurveTo(12, 0, 7, -5); c.closePath();
    c.fillStyle = '#dd9c68'; c.fill();
    c.beginPath(); c.moveTo(3, -4); c.quadraticCurveTo(8, 3, 9, 13);
    c.quadraticCurveTo(13, 12, 14, 10); c.quadraticCurveTo(12, 0, 7, -5); c.closePath();
    c.fillStyle = '#ba7958'; c.fill();
    c.beginPath(); c.moveTo(-7, -4); c.quadraticCurveTo(-11, 0, -13, 8);
    c.strokeStyle = '#f9cd98b3'; c.lineWidth = .85; c.stroke();
    c.beginPath(); c.moveTo(4, -2); c.quadraticCurveTo(8, 5, 9, 12);
    c.strokeStyle = '#985f4880'; c.lineWidth = .7; c.stroke();
    c.beginPath(); c.moveTo(-14 - cloak, 10.5 - cloak); c.quadraticCurveTo(-1 - cloak, 18 - cloak * .4, 13, 10.5);
    c.strokeStyle = '#995f4966'; c.lineWidth = .8; c.stroke();
    r.line([[-11 - cloak, 10 - cloak], [-2 - cloak * .5, 13 - cloak * .4], [6, 12]], '#f7ce91', 1);
    r.round(-8, -22, 18, 21, 9, '#d99f75');
    r.round(-8, -22, 16, 18, 8, '#ffdeaf');
    oval(-5, -11, 2.5, 1.1, '#edb997');
    r.circle(-2, -12, 1.1, '#3d5147'); r.circle(5, -12, 1.1, '#3d5147');
    r.line([[0, -6], [3, -6]], '#b5775c', .7);
    // Curved brim, raised crown and a small brass post insignia.
    oval(0, -22, 16, 4.4, '#2b6157');
    r.round(-10, -33, 21, 12, 6, '#548775');
    r.round(-10, -33, 14, 10, 5, '#76a08a');
    c.beginPath(); c.moveTo(-8, -29); c.quadraticCurveTo(-7, -32, -4, -32); c.lineTo(3, -32);
    c.strokeStyle = '#c5d6ae99'; c.lineWidth = .75; c.stroke();
    r.line([[-8, -24], [9, -24]], '#b8c99c', 2);
    oval(1, -22, 14, 2.4, '#478370');
    c.beginPath(); c.ellipse(0, -22, 15, 3.5, 0, .15, Math.PI - .15);
    c.strokeStyle = '#244f467a'; c.lineWidth = .75; c.stroke();
    c.beginPath(); c.moveTo(-12, -22.4); c.quadraticCurveTo(-5, -24.1, 2, -23.6);
    c.strokeStyle = '#a6c5a880'; c.lineWidth = .65; c.stroke();
    r.circle(6, -27, 1.8, '#f6d99c');
    r.line([[-8, -2], [-16, -4 + stride * 2], [-23, -1 + stride * 3]], '#bd715b', 4);
    r.line([[-6, -1], [8, 10]], '#806443', 2.2);
    r.round(5, 3, 12, 11, 3, '#8d694b');
    r.round(5, 3, 12, 5, 2.5, '#bc9064');
    c.beginPath(); c.moveTo(6, 6.5); c.quadraticCurveTo(11, 9, 16, 6.5);
    c.strokeStyle = '#6f503b99'; c.lineWidth = .7; c.stroke();
    r.line([[7, 4.2], [13.5, 4.2]], '#e8be898f', .65);
    r.line([[15.2, 8.5], [15.2, 11.3], [13.7, 12.5], [8, 12.5]], '#60483566', .7);
    r.circle(11, 8, 1.1, '#efd6a3');
    r.line([[10, 0], [15, -3 - stride * 2]], '#e0a777', 4);
    c.save(); c.translate(18, -6 - stride * 2); c.rotate(-cloak * .045);
    r.icon('letter', 0, 0, 12, '#fff6dc'); c.restore();
  }
  c.restore();
}

module.exports = { drawCourier };
