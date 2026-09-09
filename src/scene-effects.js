'use strict';

const { actorFrame, MOVE_MS } = require('./motion');

// Keep atmosphere sparse and deterministic: no frame-dependent particle allocation.
function drawAtmosphere(r, now, rect, options = {}) {
  const c = r.ctx, time = options.reducedMotion ? 0 : now;
  for (let i = 0; i < 12; i++) {
    const phase = i * 2.4, drift = time / (4600 + i * 240);
    const x = rect.x + ((i * .271 + .08) % 1) * rect.w + Math.sin(drift + phase) * 8;
    const y = rect.y + ((i * .383 + .12) % 1) * rect.h + Math.cos(drift * .71 + phase) * 11;
    const brightness = .2 + (1 + Math.sin(time / 1500 + phase)) * .12;
    const color = i % 3 ? '#c1e3c5' : '#f7d696';
    c.save(); c.globalAlpha *= brightness;
    r.circle(x, y, i % 3 ? 2.7 : 3.7, color);
    c.globalAlpha *= .28; r.circle(x, y, 7, color);
    c.globalAlpha /= .28; r.circle(x, y, 1, '#fff3cb'); c.restore();
  }
  if (options.reducedMotion) return;
  // Three slow, faint ribbons sit behind the island and never cover its controls.
  for (let i = 0; i < 3; i++) {
    const phase = (now / 14000 + i / 3) % 1;
    const x = rect.x + phase * (rect.w + 110) - 90, y = rect.y + rect.h * (.26 + i * .24);
    c.save(); c.globalAlpha *= Math.sin(phase * Math.PI) * .1;
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + 24, y - 10, x + 55, y + 7, x + 78, y - 2);
    c.strokeStyle = '#99d8ca'; c.lineWidth = 1; c.stroke(); c.restore();
  }
}

function drawActorTrails(r, game, now, point, unit, options = {}) {
  if (options.reducedMotion || game.reviewing || now < game.transitionAt || now - game.transitionAt > MOVE_MS + 90) return;
  const c = r.ctx;
  [false, true].forEach(ghost => {
    const frame = actorFrame(game, now, point, ghost), fade = Math.max(0, 1 - Math.max(0, now - game.transitionAt - MOVE_MS) / 90);
    if (!frame.alpha) return;
    for (let i = 3; i > 0; i--) {
      const sample = actorFrame(game, Math.max(game.transitionAt, now - i * 28), point, ghost);
      if (!sample.moving || Math.hypot(frame.x - sample.x, frame.y - sample.y) < 1) continue;
      c.save(); c.globalAlpha *= sample.alpha * fade * (ghost ? .2 : .11) * (1 - i / 4);
      c.beginPath(); c.ellipse(sample.x, sample.y - (ghost ? unit * .16 : 0), unit * (ghost ? .17 : .09), unit * .07, 0, 0, Math.PI * 2);
      c.fillStyle = ghost ? '#94ece7' : '#ffdc8c'; c.fill(); c.restore();
    }
  });
}

function drawDestination(r, game, now, projection, options = {}, action) {
  const state = game.state;
  if (state.letters.length || state.seals.length) return;
  const [x, y] = projection.point(game.level.exit), unit = projection.halfW;
  const pulse = options.reducedMotion ? 0 : (1 + Math.sin(now / 600)) / 2;
  const c = r.ctx;
  c.save(); c.globalAlpha *= .65 + pulse * .2;
  c.beginPath(); c.ellipse(x, y + 1, unit * (.81 + pulse * .03), projection.halfH * (.81 + pulse * .03), 0, 0, Math.PI * 2);
  c.strokeStyle = '#ffdc8c'; c.lineWidth = 1.7; c.stroke(); c.restore();
  const top = y - unit * 1.68;
  r.round(x - 28, top - 8, 56, 16, 8, '#244c42', '#d6c68c');
  r.text(state.status === 'won' ? '已送达' : '可投递', x, top, 10, '#ffe7a4', 'center', '600');
  if (action) r.hit(x - 28, top - 8, 56, 16, action);
}

module.exports = { drawAtmosphere, drawActorTrails, drawDestination };
