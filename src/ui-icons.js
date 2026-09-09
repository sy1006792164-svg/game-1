'use strict';

const UI_ICON = Object.freeze({ size: 20, viewBox: 24, stroke: 2 });

// Action glyphs share one stroke and optical bounds inside a 24-unit grid.
// Keep scenery and collectible illustrations in the world's icon painter.
function drawUiGlyph(c, type) {
  const line = points => points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  const box = (x, y, w, h, radius = 1.5) => {
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
  };
  const circle = (x, y, radius) => { c.moveTo(x + radius, y); c.arc(x, y, radius, 0, Math.PI * 2); };
  c.beginPath();
  if (type === 'letter') {
    box(-10, -8, 20, 16, 2);
    line([[-9, -6], [0, 1], [9, -6]]);
  } else if (type === 'play') {
    line([[-7, -9], [9, 0], [-7, 9]]); c.closePath();
  } else if (type === 'pause') {
    box(-8, -9, 5, 18, 1); box(3, -9, 5, 18, 1);
  } else if (type === 'restart') {
    c.arc(0, 0, 9, -Math.PI * .8, Math.PI * .85);
    line([[-8, -10], [-8, -3], [-1, -3]]);
  } else if (type === 'undo') {
    line([[-4, -9], [-10, -3], [-4, 3]]);
    c.moveTo(-10, -3); c.lineTo(2, -3);
    c.bezierCurveTo(12, -3, 12, 9, 2, 9); c.lineTo(-3, 9);
  } else if (type === 'home' || type === 'office') {
    line([[-10, -1], [0, -10], [10, -1]]);
    line([[-7, -3], [-7, 9], [7, 9], [7, -3]]);
    line([[-2, 9], [-2, 2], [2, 2], [2, 9]]);
  } else if (type === 'route') {
    circle(-7, 7, 2.5); circle(7, -7, 2.5);
    c.moveTo(-7, 4.5); c.lineTo(-7, 1);
    c.quadraticCurveTo(-7, -2, -4, -2); c.lineTo(4, -2);
    c.quadraticCurveTo(7, -2, 7, -4.5);
  } else if (type === 'stamp') {
    box(-7, -9, 14, 18, 1);
    for (const y of [-6, 0, 6]) {
      line([[-10, y], [-7, y]]); line([[7, y], [10, y]]);
    }
    line([[-4, 5], [0, 0], [4, 5]]); circle(2, -4, 1);
  } else if (type === 'ranking') {
    box(-10, 0, 6, 10, 1); box(-3, -8, 6, 18, 1); box(4, 4, 6, 6, 1);
  } else if (type === 'community') {
    line([[-9, -8], [9, -8], [9, 5], [0, 5], [-6, 10], [-6, 5], [-9, 5]]);
    c.closePath(); line([[-5, -2], [5, -2]]);
  } else if (type === 'book') {
    line([[-10, -8], [-5, -9], [0, -6], [5, -9], [10, -8], [10, 8], [5, 7], [0, 10], [-5, 7], [-10, 8]]);
    c.closePath(); line([[0, -6], [0, 10]]);
  } else if (type === 'hourglass') {
    line([[-8, -9], [8, -9]]); line([[-8, 9], [8, 9]]);
    c.moveTo(-7, -9); c.bezierCurveTo(-7, -2, 7, 2, 7, 9);
    c.moveTo(7, -9); c.bezierCurveTo(7, -2, -7, 2, -7, 9);
    line([[-3, 6], [3, 6]]);
  } else if (type === 'grid') {
    for (const y of [-9, 2]) for (const x of [-9, 2]) box(x, y, 7, 7, 1);
  } else if (type === 'close') {
    line([[-8, -8], [8, 8]]); line([[8, -8], [-8, 8]]);
  } else if (type === 'check') {
    line([[-9, 0], [-3, 7], [9, -7]]);
  } else if (type === 'lock') {
    box(-8, -1, 16, 11, 2);
    c.moveTo(-5, -1); c.lineTo(-5, -5); c.arcTo(-5, -10, 0, -10, 5);
    c.arcTo(5, -10, 5, -5, 5); c.lineTo(5, -1);
    line([[0, 3], [0, 6]]);
  } else if (type === 'lamp') {
    c.moveTo(-3, -6); c.lineTo(-3, -7); c.arcTo(-3, -10, 0, -10, 3);
    c.arcTo(3, -10, 3, -7, 3); c.lineTo(3, -6);
    box(-6, -5, 12, 14, 2);
    line([[-8, -5], [8, -5]]); line([[-8, 10], [8, 10]]);
    line([[-2, 5], [0, 0], [2, 5]]);
  } else if (type === 'arrow-right') {
    line([[-9, 0], [9, 0]]); line([[2, -7], [9, 0], [2, 7]]);
  } else if (type === 'chevron' || type === 'back') {
    const direction = type === 'back' ? -1 : 1;
    line([[-4 * direction, -8], [4 * direction, 0], [-4 * direction, 8]]);
  }
  c.stroke();
}

function drawUiIcon(r, type, x, y, color, size = UI_ICON.size) {
  const c = r.ctx;
  c.save(); c.translate(x, y); c.scale(size / UI_ICON.viewBox, size / UI_ICON.viewBox);
  c.strokeStyle = color; c.lineWidth = UI_ICON.stroke; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash([]);
  drawUiGlyph(c, type);
  c.restore();
}

module.exports = { UI_ICON, drawUiIcon };
