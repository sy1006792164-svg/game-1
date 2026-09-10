'use strict';

const { C } = require('./theme');

const STAGES = Object.freeze([
  Object.freeze({ at: 0, icon: 'letter' }),
  Object.freeze({ at: .34, icon: 'route' }),
  Object.freeze({ at: .67, icon: 'echo' }),
  Object.freeze({ at: 1, icon: 'lamp' })
]);

function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

function routePoint(points, progress) {
  const position = clamp(progress) * (points.length - 1), index = Math.min(points.length - 2, Math.floor(position));
  const t = position - index, a = points[index], b = points[index + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// A compact story line mirrors the real loader. Nothing here advances time or
// invents progress; failed preparation simply leaves the courier where it is.
function drawStartupJourney(r, progress, rect, now, options = {}) {
  progress = clamp(progress);
  const c = r.ctx, width = Math.min(316, rect.w - 44), left = rect.x + (rect.w - width) / 2;
  const baseY = rect.y + rect.h - 20;
  const points = [
    [left, baseY + 2],
    [left + width * .34, baseY - 7],
    [left + width * .67, baseY + 5],
    [left + width, baseY - 2]
  ];
  c.save();
  r.line(points, '#adc4b2', 1.1, [3, 7]);
  for (let i = 0; i < points.length - 1; i++) {
    const start = i / (points.length - 1), end = (i + 1) / (points.length - 1);
    if (progress <= start) break;
    const local = Math.min(1, (progress - start) / (end - start));
    const target = [points[i][0] + (points[i + 1][0] - points[i][0]) * local,
      points[i][1] + (points[i + 1][1] - points[i][1]) * local];
    r.line([points[i], target], C.green, 1.8);
  }
  STAGES.forEach((stage, index) => {
    const reached = progress + .001 >= stage.at, [x, y] = points[index];
    c.save(); c.globalAlpha *= reached ? 1 : .38;
    r.circle(x, y, reached ? 8 : 6, reached ? '#f7efd9' : '#e4ebe0', reached ? C.gold : '#aac0ae');
    r.icon(stage.icon, x, y, reached ? 9 : 7, reached ? index === 2 ? C.blue : index === 3 ? C.gold : C.green : C.muted);
    c.restore();
  });
  if (!options.reducedMotion && progress > .08 && progress < 1) {
    const [x, y] = routePoint(points, progress);
    const bob = options.reducedMotion ? 0 : Math.sin(now / 240) * 1.5;
    c.save(); c.globalAlpha *= .96;
    r.circle(x, y + bob, 6.8, '#fff9e6', C.gold);
    r.icon('letter', x, y + bob, 8, C.gold);
    c.restore();
  } else if (progress >= 1) {
    const [x, y] = points[points.length - 1];
    c.save(); c.globalAlpha *= options.reducedMotion ? .14 : .11 + (1 + Math.sin(now / 430)) * .045;
    r.circle(x, y, 20, C.yellow); c.restore();
  }
  c.restore();
}

module.exports = { drawStartupJourney };
