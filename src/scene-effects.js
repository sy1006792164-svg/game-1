'use strict';

const { actorFrame, movementPath, MOVE_MS } = require('./motion');
const TAU = Math.PI * 2;

function ellipse(c, x, y, width, height, color, lineWidth, start = 0, end = TAU) {
  c.beginPath(); c.ellipse(x, y, width, height, 0, start, end);
  if (lineWidth) { c.strokeStyle = color; c.lineWidth = lineWidth; c.stroke(); }
  else { c.fillStyle = color; c.fill(); }
}

function echoPresence(r, frame, now, unit, still, low) {
  if (!frame.alpha) return;
  const c = r.ctx, phase = still || low ? 0 : now / 1450;
  const breath = still || low ? .5 : .5 + Math.sin(phase) * .5;
  c.save(); c.globalAlpha *= frame.alpha;
  c.save(); c.globalAlpha *= .16 + breath * .05;
  ellipse(c, frame.x, frame.y + 1, unit * .29, unit * .1, '#69c9c0');
  c.restore();
  c.save(); c.globalAlpha *= .58;
  ellipse(c, frame.x, frame.y + 1, unit * .3, unit * .105, '#c5fff0', 1.2);
  if (!low) {
    c.globalAlpha *= .76;
    for (let arc = 0; arc < 2; arc++) {
      const angle = phase * .6 + arc * Math.PI;
      ellipse(c, frame.x, frame.y + 1, unit * .39, unit * .135, '#59afa6', 1, angle, angle + .86);
    }
  }
  c.restore(); c.restore();
}

function drawActorTrails(r, game, now, point, unit, options = {}) {
  if (game.reviewing) return;
  const c = r.ctx, reduced = !!(options.reducedMotion || r.reducedMotion), low = r.effectsQuality === 'low';
  const ambient = Number.isFinite(r.ambientNow) ? r.ambientNow : now;
  const echo = actorFrame(game, now, point, true, { reducedMotion: reduced });
  const sharedOffset = game.state.echo === game.state.player ? unit * .28 / 1.7 : 0;
  echo.x += sharedOffset;
  echoPresence(r, echo, ambient, unit, reduced, low);
  const age = now - game.transitionAt, linger = low ? 100 : 210;
  if (reduced || !Number.isFinite(age) || age < 0 || age > MOVE_MS + linger) return;
  [false, true].forEach(ghost => {
    const frame = actorFrame(game, now, point, ghost), fade = Math.max(0, 1 - Math.max(0, age - MOVE_MS) / linger);
    if (!frame.alpha) return;
    // The tail catches up to the feet after landing, so it cannot mark a later turn.
    const timedSamples = [], count = low ? 4 : 9;
    const start = Math.max(0, age - linger), end = Math.min(age, MOVE_MS);
    if (start >= end) return;
    const smooth = value => value * value * (3 - 2 * value);
    const offset = sample => [sample[0] + (ghost ? sharedOffset : 0), sample[1] - (ghost ? unit * .18 : 0)];
    for (let index = 0; index <= count; index++) {
      const age = start + (end - start) * index / count;
      const sample = actorFrame(game, game.transitionAt + age, point, ghost);
      if (sample.alpha) timedSamples.push({ progress: smooth(age / MOVE_MS), point: offset([sample.x, sample.y]) });
    }
    // Uniform time samples can straddle a wind-push corner. Add the actual cell
    // vertices in the actor's eased path order so every stroke follows a real leg,
    // including reversed undo paths and the shorter low-quality trail window.
    const key = ghost ? 'echo' : 'player';
    const path = movementPath(game, game.previousState && game.previousState[key], game.state[key], ghost);
    const startProgress = smooth(start / MOVE_MS), endProgress = smooth(end / MOVE_MS);
    for (let index = 1; index < path.length - 1; index++) {
      const progress = index / (path.length - 1);
      if (progress >= startProgress && progress <= endProgress) {
        timedSamples.push({ progress, point: offset(point(path[index])) });
      }
    }
    timedSamples.sort((a, b) => a.progress - b.progress);
    const samples = [];
    let previousProgress = -Infinity;
    for (const sample of timedSamples) {
      if (Math.abs(sample.progress - previousProgress) < 1e-9) samples[samples.length - 1] = sample.point;
      else samples.push(sample.point);
      previousProgress = sample.progress;
    }
    if (samples.length < 2 || !samples.some(sample => Math.hypot(sample[0] - samples[0][0], sample[1] - samples[0][1]) > 1)) return;
    c.save(); c.globalAlpha *= frame.alpha * fade;
    if (!low) {
      c.save(); c.globalAlpha *= ghost ? .2 : .14;
      r.line(samples, ghost ? '#51c8bf' : '#e6b766', unit * (ghost ? .16 : .09));
      c.restore();
    }
    for (let index = 1; index < samples.length; index++) {
      c.save(); c.globalAlpha *= (.16 + index / samples.length * .62) * (ghost ? .85 : .66);
      r.line([samples[index - 1], samples[index]], ghost ? '#b5fff2' : '#fff0bd', ghost ? 1.65 : 1.3);
      c.restore();
    }
    if (!low) {
      for (let index = 1; index < samples.length - 1; index += ghost ? 3 : 4) {
        const [x, y] = samples[index];
        c.save(); c.globalAlpha *= .5 * index / samples.length;
        ellipse(c, x, y + unit * (ghost ? .06 : .02), unit * .033, unit * .018, ghost ? '#8ee9de' : '#d7b47c');
        c.restore();
      }
    }
    c.restore();
  });
}

function drawDestination(r, game, now, projection, options = {}, action) {
  const state = game.state;
  if (state.letters.length || state.seals.length) return;
  const [x, y] = projection.point(game.level.exit), unit = projection.halfW;
  const low = r.effectsQuality === 'low', still = !!(options.reducedMotion || r.reducedMotion || low);
  const time = still ? 0 : now, pulse = still ? .5 : (1 + Math.sin(time / 780)) / 2;
  const c = r.ctx;
  c.save();
  c.save(); c.globalAlpha *= .15 + pulse * .07;
  ellipse(c, x, y + 1, unit * .82, projection.halfH * .82, '#ffe2a0');
  c.restore();
  c.save(); c.globalAlpha *= .7 + pulse * .2;
  ellipse(c, x, y + 1, unit * (.81 + pulse * .03), projection.halfH * (.81 + pulse * .03), '#c09957', 1.7);
  c.restore();
  // A narrow, open halo frames the office roof and door without filling its face.
  const gate = () => {
    c.beginPath(); c.moveTo(x - unit * .7, y - unit * .04);
    c.lineTo(x - unit * .7, y - unit * .86);
    c.bezierCurveTo(x - unit * .7, y - unit * 1.59, x + unit * .7, y - unit * 1.59, x + unit * .7, y - unit * .86);
    c.lineTo(x + unit * .7, y - unit * .04);
  };
  if (!low) {
    c.save(); c.globalAlpha *= .13 + pulse * .035;
    gate(); c.strokeStyle = '#f1c879'; c.lineWidth = unit * .15; c.stroke(); c.restore();
  }
  c.save(); c.globalAlpha *= .53 + pulse * .15;
  gate(); c.strokeStyle = '#fff0c0'; c.lineWidth = 1.5; c.stroke(); c.restore();
  if (!low) {
    const count = still ? 3 : 6;
    for (let index = 0; index < count; index++) {
      const progress = still ? .25 + index * .23 : (time / 2400 + index / count) % 1;
      const side = index % 2 ? 1 : -1;
      const px = x + side * unit * (.62 + Math.sin(progress * Math.PI) * .09);
      const py = y - unit * (.12 + progress * 1.23), radius = 1.2 + index % 3 * .3;
      c.save(); c.globalAlpha *= Math.sin(progress * Math.PI) ** 2 * .86;
      r.line([[px - radius, py], [px, py - radius * 1.6], [px + radius, py], [px, py + radius * 1.6], [px - radius, py]], '#fff3c9', .95);
      c.restore();
    }
  }
  const top = y - unit * 1.68;
  r.round(x - 28, top - 8, 56, 16, 8, '#fffae8', '#c8b98c');
  r.text(state.status === 'won' ? '已送达' : '可投递', x, top, 10, '#826139', 'center', '600');
  c.restore();
  if (action) r.hit(x - 28, top - 8, 56, 16, action);
}

function drawCollectibleAura(r, x, y, size, now, cell, seal) {
  const c = r.ctx, low = r.effectsQuality === 'low', still = !!(r.reducedMotion || low);
  const time = still ? 0 : Number.isFinite(now) ? now : 0;
  const seed = Number.isFinite(cell) ? cell * .173 : 0;
  const phase = time / 2700 + seed, color = seal ? '#6cb9b0' : '#d1ac65';
  c.save();
  c.save(); c.globalAlpha *= .1;
  ellipse(c, x, y + 1, size * .58, size * .19, seal ? '#8fe2cf' : '#f4d382');
  c.restore();
  c.save(); c.globalAlpha *= .57;
  if (seal) {
    for (const radius of [.5, .32]) {
      r.line([[x - size * radius, y + 1], [x, y + 1 - size * radius * .34],
        [x + size * radius, y + 1], [x, y + 1 + size * radius * .34], [x - size * radius, y + 1]], color, radius > .4 ? 1.15 : .75);
    }
  } else {
    const angle = still ? .3 : phase * .23;
    for (let arc = 0; arc < 2; arc++) {
      const start = angle + arc * Math.PI;
      ellipse(c, x, y + 1, size * .54, size * .175, color, 1.1, start, start + 2.15);
    }
  }
  c.restore();
  if (!low) {
    for (let index = 0; index < 2; index++) {
      const progress = still ? .3 + index * .4 : ((phase + index * .5) % 1 + 1) % 1;
      const angle = progress * TAU, side = index ? 1 : -1;
      const px = seal ? x + Math.cos(angle) * size * .6
        : x + side * size * (.52 + Math.sin(progress * Math.PI) * .08);
      const py = seal ? y - size * .45 + Math.sin(angle) * size * .23
        : y - size * (.13 + progress * .9);
      const radius = Math.max(.9, Math.min(1.4, size * .055));
      c.save(); c.globalAlpha *= seal ? .62 : Math.sin(progress * Math.PI) ** 2 * .78;
      c.beginPath(); c.moveTo(px, py - radius * 1.7); c.lineTo(px + radius, py);
      c.lineTo(px, py + radius * 1.7); c.lineTo(px - radius, py); c.closePath();
      c.fillStyle = seal ? '#caffef' : '#fff0bc'; c.fill();
      c.restore();
    }
  }
  c.restore();
}

module.exports = { drawActorTrails, drawDestination, drawCollectibleAura };
