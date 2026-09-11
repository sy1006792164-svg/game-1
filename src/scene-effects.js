'use strict';

const { actorFrame, MOVE_MS } = require('./motion');

function drawActorTrails(r, game, now, point, unit, options = {}) {
  if (options.reducedMotion || r.effectsQuality === 'low' || game.reviewing || now < game.transitionAt || now - game.transitionAt > MOVE_MS + 90) return;
  const c = r.ctx;
  [false, true].forEach(ghost => {
    const frame = actorFrame(game, now, point, ghost, options), fade = Math.max(0, 1 - Math.max(0, now - game.transitionAt - MOVE_MS) / 90);
    if (!frame.alpha) return;
    const trail = [];
    for (let i = 3; i > 0; i--) {
      const sample = actorFrame(game, Math.max(game.transitionAt, now - i * 28), point, ghost, options);
      if (!sample.moving || Math.hypot(frame.x - sample.x, frame.y - sample.y) < 1) continue;
      trail.push([sample.x, sample.y - (ghost ? sample.lift + unit * .12 : 0)]);
    }
    if (!trail.length) return;
    trail.push([frame.x, frame.y - (ghost ? frame.lift + unit * .12 : 0)]);
    c.save(); c.globalAlpha *= frame.alpha * fade;
    r.line(trail, ghost ? '#62bdbd38' : '#e9c27b35', ghost ? 6 : 3.5);
    r.line(trail, ghost ? '#b9f6de8c' : '#fff0be99', ghost ? 1.8 : 1);
    c.restore();
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
  c.strokeStyle = '#b88d4e'; c.lineWidth = 1.7; c.stroke(); c.restore();
  const top = y - unit * 1.68;
  r.round(x - 28, top - 8, 56, 16, 8, '#fffae8', '#c8b98c');
  r.text(state.status === 'won' ? '已送达' : '可投递', x, top, 10, '#826139', 'center', '600');
  if (action) r.hit(x - 28, top - 8, 56, 16, action);
}

module.exports = { drawActorTrails, drawDestination };
