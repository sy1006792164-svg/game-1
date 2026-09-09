'use strict';

const { C } = require('./theme');
const { MOVE_MS } = require('./motion');
const { INTRO_MS } = require('./camera');

const COLORS = { move: C.gold, letter: C.gold, echo: C.blue, home: C.green };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const fits = (box, rect) => box.x >= rect.x + 4 && box.y >= rect.y + 4 && box.x + box.w <= rect.x + rect.w - 4 && box.y + box.h <= rect.y + rect.h - 4;

function playerBounds(visual, p) {
  if (!p.visible(visual.player)) return null;
  const [x, y] = p.point(visual.player);
  return { x: x - p.halfW * .8, y: y - p.halfW * 1.4, w: p.halfW * 1.6, h: p.halfW * 1.6 };
}

function guideOpacity(r, game, guide, now) {
  if (!guide || game.modal || game.busy || game.hidden || (game.pointer && game.pointer.scene && game.pointer.dragging)) return 0;
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
  c.fillStyle = '#fff6df'; c.fill(); c.strokeStyle = '#6b7965'; c.lineWidth = 3; c.stroke();
  r.line([[2, 28], [16, 31]], '#dab478', 2);
  c.restore();
}

function drawFocus(r, visual, p, rect, now, onTap) {
  const focus = visual.focus;
  if (!focus || !p.visible(focus.cell)) return null;
  const [x, y] = p.point(focus.cell), c = r.ctx, color = COLORS[focus.kind];
  const onScreen = x >= rect.x + 16 && x <= rect.x + rect.w - 16 && y >= rect.y + 16 && y <= rect.y + rect.h - 16;
  if (!onScreen) {
    const edgeX = clamp(x, rect.x + 22, rect.x + rect.w - 22);
    const edgeY = clamp(y, rect.y + 22, rect.y + rect.h - 22);
    r.circle(edgeX, edgeY, 17, C.white, color);
    c.save(); c.translate(edgeX, edgeY); c.rotate(Math.atan2(y - edgeY, x - edgeX));
    r.icon('arrow-right', 0, 0, 22, color); c.restore();
    return null;
  }
  const radius = clamp(p.halfW * 1.35, 38, 68), pulse = r.reducedMotion ? .5 : (Math.sin(now / 320) + 1) / 2;
  // A local glow keeps the target clear without masking the surrounding world.
  c.save(); c.globalAlpha *= .16;
  r.circle(x, y, radius + 7, C.white);
  r.circle(x, y, radius - 5, '#fff1c8');
  c.restore();
  r.circle(x, y, radius - 3 + pulse * 3, null, color);
  const arrowBaseY = y - radius - 13, arrowTravel = 7;
  const arrowY = clamp(arrowBaseY - pulse * arrowTravel, rect.y + 17, rect.y + rect.h - 17);
  r.circle(x, arrowY, 15, C.white, color);
  r.icon('arrow-down', x, arrowY, 22, color);
  const canTap = visual.tapCell === focus.cell;
  if (canTap) tapGesture(r, x, y, now, color);
  // Reserve the arrow's full travel so the echo badge never flips sides with its bounce.
  const boundsTop = clamp(arrowBaseY - arrowTravel, rect.y + 17, rect.y + rect.h - 17) - 17;
  const bounds = { x: x - radius, y: boundsTop, w: radius * 2, h: y + radius - boundsTop };
  if (canTap) {
    const label = visual.label || '点这里';
    r.font(11, '600');
    const w = clamp(c.measureText(label).width + 20, 58, 104), h = 24;
    const left = clamp(x - w / 2, rect.x + 4, rect.x + rect.w - w - 4);
    const actor = playerBounds(visual, p);
    const badge = [y + radius + 7, boundsTop - h - 5]
      .map(top => ({ x: left, y: top, w, h })).find(box => fits(box, rect) && !overlaps(box, actor));
    if (badge) {
      r.panel(badge.x, badge.y, w, h, { fill: '#fffaf0', stroke: color, radius: 8 });
      r.label(label, badge.x + w / 2, badge.y + h / 2, w - 16, 11, C.ink, 'center', '600');
      r.hit(badge.x, badge.y, w, h, onTap);
      const right = Math.max(bounds.x + bounds.w, badge.x + w), bottom = Math.max(bounds.y + bounds.h, badge.y + h);
      bounds.x = Math.min(bounds.x, badge.x); bounds.w = right - bounds.x;
      bounds.y = Math.min(bounds.y, badge.y); bounds.h = bottom - bounds.y;
    }
  }
  return bounds;
}

function drawPlayerLabel(r, visual, p, rect, focusBounds) {
  const actor = playerBounds(visual, p);
  if (!actor) return null;
  const badge = [actor.x - 32, actor.x + actor.w + 6]
    .map(x => ({ x, y: actor.y + actor.h * .4, w: 26, h: 20 }))
    .find(box => fits(box, rect) && !overlaps(box, focusBounds));
  if (!badge) return null;
  r.round(badge.x, badge.y, badge.w, badge.h, 7, '#fff3da', C.gold);
  r.text('你', badge.x + badge.w / 2, badge.y + badge.h / 2, 11, C.ink, 'center', '600');
  return badge;
}

function drawEchoCountdown(r, echo, p, rect, occupied) {
  if (!echo || !p.visible(echo.cell)) return;
  const [x, y] = p.point(echo.cell);
  if (x < rect.x || x > rect.x + rect.w || y < rect.y || y > rect.y + rect.h) return;
  const w = 70, h = 36, left = clamp(x - w / 2, rect.x + 4, rect.x + rect.w - w - 4);
  const badge = [
    { x: left, y: y - Math.max(40, p.halfW * .9) - h, w, h },
    { x: left, y: y + 28, w, h },
    { x: x - p.halfW - w, y: y - h / 2, w, h },
    { x: x + p.halfW, y: y - h / 2, w, h }
  ].find(box => fits(box, rect) && !occupied.some(bounds => overlaps(box, bounds)));
  // The card always shows the countdown; omit the floating copy if space is tight.
  if (!badge) return;
  r.line([[x, y], [badge.x + w / 2, badge.y + h / 2]], C.blue, 1.6, [3, 3]);
  r.panel(badge.x, badge.y, w, h, { fill: '#edf8f0', stroke: '#80b2ad', radius: 10 });
  r.icon('echo', badge.x + 16, badge.y + 15, 18, C.blue);
  r.text(echo.turns + ' 次', badge.x + 44, badge.y + 14, 13, C.ink, 'center', '600');
  for (let index = 0; index < 3; index++) {
    r.circle(badge.x + 25 + index * 11, badge.y + 28, 2.7, index < 3 - echo.turns ? C.blue : '#dbe9e0', C.blue);
  }
}

// Draw in screen coordinates so cues remain legible while the island is rotated or zoomed.
function drawGuideOverlay(r, game, guide, now) {
  const opacity = guideOpacity(r, game, guide, now), p = r.boardProjection, rect = r.boardRect;
  if (!opacity || !p || !rect || !guide.visual) return;
  const c = r.ctx;
  c.save(); c.globalAlpha *= opacity;
  c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  const focusBounds = guide.control === 'wait' ? null : drawFocus(r, guide.visual, p, rect, now, () => game.act(guide.action));
  const playerLabel = drawPlayerLabel(r, guide.visual, p, rect, focusBounds);
  drawEchoCountdown(r, guide.visual.echo, p, rect, [focusBounds, playerBounds(guide.visual, p), playerLabel]);
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
