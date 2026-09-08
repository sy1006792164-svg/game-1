'use strict';

const { C } = require('./theme');
const { MOVE_MS } = require('./motion');
const { INTRO_MS } = require('./camera');

const COLORS = { move: C.gold, letter: C.gold, echo: C.blue, home: C.green };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function guideOpacity(r, game, guide, now) {
  if (!guide || game.modal || game.busy || game.hidden || (game.pointer && game.pointer.scene)) return 0;
  if (r.reducedMotion) return 1;
  return Math.min(clamp((now - game.camera.enteredAt - INTRO_MS) / 200, 0, 1),
    clamp((now - game.transitionAt - MOVE_MS) / 180, 0, 1),
    clamp((now - game.cameraMovedAt - 120) / 180, 0, 1));
}

function tapGesture(r, x, y, now, color) {
  const c = r.ctx, phase = r.reducedMotion ? .45 : (now % 1600) / 1600;
  const lift = r.reducedMotion ? 0 : Math.abs(phase - .45) * 20;
  c.save();
  c.globalAlpha *= 1 - phase;
  r.circle(x, y, 8 + phase * 25, null, color);
  r.circle(x, y, 5 + phase * 14, null, C.white);
  c.restore();
  // A small vector hand keeps the tap cue consistent on WeChat and browsers.
  c.save(); c.translate(x + 2, y + lift); c.scale(.72, .72); c.rotate(-.15);
  c.beginPath(); c.moveTo(-3, 18); c.lineTo(-3, 0);
  c.bezierCurveTo(-3, -6, 5, -6, 5, 0); c.lineTo(5, 11);
  c.bezierCurveTo(5, 7, 12, 7, 12, 11); c.lineTo(12, 14);
  c.bezierCurveTo(12, 10, 19, 10, 19, 15); c.lineTo(19, 18);
  c.bezierCurveTo(19, 14, 26, 14, 26, 19); c.lineTo(26, 30);
  c.bezierCurveTo(26, 38, 20, 43, 12, 43); c.lineTo(9, 43);
  c.bezierCurveTo(2, 43, -1, 38, -5, 33); c.lineTo(-14, 22);
  c.bezierCurveTo(-17, 17, -12, 13, -8, 17); c.closePath();
  c.fillStyle = '#fff3d7'; c.fill(); c.strokeStyle = '#17383a'; c.lineWidth = 3; c.stroke();
  r.line([[2, 28], [16, 31]], '#dab478', 2);
  c.restore();
}

function drawFocus(r, visual, p, rect, now) {
  const focus = visual.focus;
  if (!focus || !p.visible(focus.cell)) return null;
  const [x, y] = p.point(focus.cell), c = r.ctx, color = COLORS[focus.kind];
  const onScreen = x >= rect.x + 16 && x <= rect.x + rect.w - 16 && y >= rect.y + 16 && y <= rect.y + rect.h - 16;
  if (!onScreen) {
    const edgeX = clamp(x, rect.x + 22, rect.x + rect.w - 22);
    const edgeY = clamp(y, rect.y + 22, rect.y + rect.h - 22);
    r.circle(edgeX, edgeY, 17, C.dark, color);
    c.save(); c.translate(edgeX, edgeY); c.rotate(Math.atan2(y - edgeY, x - edgeX));
    r.icon('arrow-right', 0, 0, 22, color); c.restore();
    return null;
  }
  const radius = clamp(p.halfW * 1.35, 38, 68), pulse = r.reducedMotion ? .5 : (Math.sin(now / 320) + 1) / 2;
  // Opposite winding leaves the target lit while the surrounding board dims.
  c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h);
  c.moveTo(x + radius, y); c.arc(x, y, radius, 0, Math.PI * 2, true);
  c.fillStyle = '#071d254d'; c.fill();
  r.circle(x, y, radius - 3 + pulse * 3, null, color);
  const arrowBaseY = y - radius - 13, arrowTravel = 7;
  const arrowY = clamp(arrowBaseY - pulse * arrowTravel, rect.y + 17, rect.y + rect.h - 17);
  r.circle(x, arrowY, 15, C.dark, color);
  r.icon('arrow-down', x, arrowY, 22, color);
  const canTap = visual.tapCell === focus.cell;
  if (canTap) tapGesture(r, x, y, now, color);
  // Reserve the arrow's full travel so the echo badge never flips sides with its bounce.
  const boundsTop = clamp(arrowBaseY - arrowTravel, rect.y + 17, rect.y + rect.h - 17) - 17;
  return { x: x - radius, y: boundsTop, w: radius * 2, h: y + radius - boundsTop };
}

function drawEchoCountdown(r, echo, p, rect, focusBounds) {
  if (!echo || !p.visible(echo.cell)) return;
  const [x, y] = p.point(echo.cell);
  if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) return;
  const w = 70, h = 36, left = clamp(x - w / 2, rect.x + 4, rect.x + rect.w - w - 4);
  let top = clamp(y - Math.max(40, p.halfW * .9) - h, rect.y + 4, rect.y + rect.h - h - 4);
  if (focusBounds && left < focusBounds.x + focusBounds.w && left + w > focusBounds.x &&
      top < focusBounds.y + focusBounds.h && top + h > focusBounds.y) {
    top = clamp(y + 28, rect.y + 4, rect.y + rect.h - h - 4);
  }
  r.line([[x, y], [left + w / 2, top + h / 2]], C.blue, 1.6, [3, 3]);
  r.panel(left, top, w, h, { fill: '#16383f', stroke: C.blue, radius: 10 });
  r.icon('echo', left + 16, top + 15, 18, C.blue);
  r.text(echo.turns + ' 拍', left + 44, top + 14, 13, C.white, 'center', '600');
  for (let index = 0; index < 3; index++) {
    r.circle(left + 25 + index * 11, top + 28, 2.7, index < 3 - echo.turns ? C.blue : C.dark, C.blue);
  }
}

// Draw in screen coordinates so cues remain legible while the island is rotated or zoomed.
function drawGuideOverlay(r, game, guide, now) {
  const opacity = guideOpacity(r, game, guide, now), p = r.boardProjection, rect = r.boardRect;
  if (!opacity || !p || !rect || !guide.visual) return;
  const c = r.ctx;
  c.save(); c.globalAlpha *= opacity;
  c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  const focusBounds = guide.control === 'wait' ? null : drawFocus(r, guide.visual, p, rect, now);
  drawEchoCountdown(r, guide.visual.echo, p, rect, focusBounds);
  c.restore();
}

function drawGuideWait(r, game, guide, button, now) {
  const opacity = guideOpacity(r, game, guide, now);
  if (!opacity || guide.control !== 'wait') return;
  const pulse = r.reducedMotion ? .5 : (Math.sin(now / 320) + 1) / 2;
  r.ctx.save(); r.ctx.globalAlpha *= opacity;
  const spread = 2 + pulse * 3;
  r.round(button.x - spread, button.y - spread, button.w + spread * 2, button.h + spread * 2, 16, null, C.gold);
  tapGesture(r, button.x + button.w - 30, button.y + 8, now, C.gold);
  r.ctx.restore();
}

module.exports = { drawGuideOverlay, drawGuideWait };
