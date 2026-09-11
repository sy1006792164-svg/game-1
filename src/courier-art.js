'use strict';

function oval(r, x, y, rx, ry, color) {
  const c = r.ctx; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}

function drawEcho(r, grounded, low, shadeSide) {
  const c = r.ctx;
  if (!grounded) oval(r, 0, 12, 13, 4, '#45949b20');
  if (!low) oval(r, 0, -5, 19, 24, '#81c4c816');
  c.beginPath(); c.moveTo(-11, 10); c.lineTo(-11, -11);
  c.bezierCurveTo(-11, -27, 12, -27, 12, -11); c.lineTo(12, 10);
  c.quadraticCurveTo(8, 5, 5, 11); c.quadraticCurveTo(1, 5, -2, 11);
  c.quadraticCurveTo(-6, 6, -11, 10); c.closePath();
  c.fillStyle = '#79bec4dc'; c.fill(); c.strokeStyle = '#d6f9eb'; c.lineWidth = 1.1; c.stroke();
  c.save(); c.clip();
  oval(r, shadeSide * 10, -5, 6, 20, '#397f9860');
  oval(r, -shadeSide * 4, -12, 6, 10, '#d8ffec55');
  c.restore();
  r.circle(-3, -8, 1.3, '#245e6c'); r.circle(4, -8, 1.3, '#245e6c');
  oval(r, 0, -19, 14, 3, '#39778e');
  r.round(-8, -27, 17, 8, 4, '#7eb8c2');
  oval(r, .5, -27, 8.5, 2.4, '#b2e2d9');
  if (!low) r.line([[-5, -25], [5, -25]], '#e9fff4', 1);
}

function drawCape(r, shadeSide, low) {
  const c = r.ctx;
  c.beginPath(); c.moveTo(-7, -5); c.quadraticCurveTo(-13, -1, -15, 10);
  c.quadraticCurveTo(-1, 19, 14, 10); c.quadraticCurveTo(12, 0, 7, -5); c.closePath();
  c.fillStyle = '#dca567'; c.fill();
  c.save(); c.clip();
  // Mirror only the shading with the pose so the light stays at screen-left.
  c.save(); c.scale(shadeSide, 1);
  c.beginPath(); c.moveTo(1, -6); c.quadraticCurveTo(7, 3, 6, 17);
  c.lineTo(17, 17); c.lineTo(17, -6); c.closePath(); c.fillStyle = '#996347'; c.fill();
  if (!low) {
    c.beginPath(); c.moveTo(-8, -3); c.quadraticCurveTo(-12, 3, -11, 9);
    c.quadraticCurveTo(-6, 12, -3, 12); c.quadraticCurveTo(-6, 3, -4, -4); c.closePath();
    c.fillStyle = '#f5cc88'; c.fill();
  }
  c.restore(); c.restore();
  r.line([[-11, 10], [-2, 13], [6, 12]], '#f5d194', 1);
  r.round(-5, -3, 12, 4, 2, '#677a53');
}

function drawHead(r, shadeSide, low) {
  r.round(-8, -22, 18, 21, 9, '#c58e63');
  r.round(-8 + (shadeSide === 1 ? 0 : 3), -22, 15, 18, 7.5, '#ffdda7');
  oval(r, -5, -11, 2.5, 1.1, '#eaae84');
  r.circle(-2, -12, 1.1, '#344b42'); r.circle(5, -12, 1.1, '#344b42');
  r.line([[0, -6], [3, -6]], '#a87552', .7);
  // A dark underside, curved front and exposed top make the cap a small solid.
  oval(r, 0, -20.7, 16, 4.4, '#244d43');
  oval(r, 0, -22.5, 16, 4.4, '#6e9371');
  r.round(-10, -32, 21, 10, 5, '#3b6c59');
  r.round(shadeSide === 1 ? -10 : -2, -32, 13, 9, 4.5, '#7b9c77');
  oval(r, .5, -32, 10.5, 3.5, '#a4b790');
  r.line([[-8, -24.5], [0, -23.5], [9, -24.5]], '#d1bb7e', 1.7);
  r.circle(6, -27.5, 2, '#e8be78');
  if (!low) {
    oval(r, -shadeSide * 4, -33, 4, 1, '#e3e6b85c');
    r.circle(5.5, -28, .8, '#fff0bd');
    r.line([[-13, -23], [-6, -24]], '#c8d3a7', .8);
  }
}

function drawSatchel(r, stride, low) {
  r.line([[-8, -2], [-16, -4 + stride * 2], [-23, -1 + stride * 3]], '#b36d53', 4);
  r.line([[-6, -1], [8, 10]], '#795837', 2.4);
  r.round(5, 4.5, 13, 11, 3, '#5b5940');
  r.round(5, 3, 10.5, 11, 2.5, '#a6784d');
  r.round(5, 3, 12, 4, 2, '#d0a46b');
  r.circle(10.5, 8, 1.2, '#f1d49a');
  if (!low) r.line([[6.5, 9], [6.5, 12], [13.5, 12]], '#d6ae7666', .7);
  r.line([[10, 0], [15, -3 - stride * 2]], '#e3ad78', 4);
  const mailY = -9.5 - stride * 2;
  r.round(13, mailY + 1.3, 10, 7, 1.2, '#9c7950');
  r.round(12.5, mailY, 10, 7, 1.2, '#fff0cb');
  r.line([[13.4, mailY + 1], [17.5, mailY + 3.7], [21.6, mailY + 1]], '#bfa775', .8);
}

// Grounded actors use scene.js's floor shadow, which never rises with their pose.
function drawCourier(r, x, y, size, ghost, pose = {}) {
  const c = r.ctx, stride = r.reducedMotion ? 0 : pose.stride || 0;
  const facing = pose.facing === -1 ? -1 : 1, low = r.effectsQuality === 'low';
  c.save(); c.translate(x, y); c.scale(size / 40 * facing, size / 40);
  c.globalAlpha *= pose.alpha == null ? 1 : pose.alpha;
  if (ghost) drawEcho(r, pose.grounded === true, low, facing);
  else {
    if (pose.grounded !== true) {
      oval(r, facing * 4, 18, 14, 4, '#34564b30');
      if (!low) oval(r, 2, 18, 9, 2.3, '#2d514536');
    }
    r.line([[-5, 9], [-6 - stride * 3, 16 - stride * 2]], '#426454', 4.5);
    r.line([[5, 9], [6 + stride * 3, 16 + stride * 2]], '#294f44', 4.5);
    r.round(-9 - stride * 3, 15 - stride * 2, 8, 4, 2, '#71523b');
    r.round(3 + stride * 3, 15 + stride * 2, 9, 4, 2, '#5b4935');
    drawCape(r, facing, low);
    drawHead(r, facing, low);
    drawSatchel(r, stride, low);
  }
  c.restore();
}

module.exports = { drawCourier };
