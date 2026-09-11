'use strict';

const { DIRECTIONS } = require('./engine');
const { MOVE_MS, EVENT_TIMINGS, EFFECT_BATCH_MS } = require('./feedback-timing');

const TAU = Math.PI * 2;
const COLORS = { gold: '#ffdc8c', cyan: '#94ece7', paper: '#f4ddb5' };
const clamp = value => Math.max(0, Math.min(1, value));
const validCell = value => Number.isInteger(value) && value >= 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const smooth = value => value * value * (3 - 2 * value);

function position(point, cell) {
  if (typeof point !== 'function' || !validCell(cell)) return [0, 0];
  const value = point(cell);
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(finite) ? value : [0, 0];
}

// Echoes replay recorded actions, including the corner between a step and a wind push.
function echoPath(game, from, to) {
  const level = game.level, previous = game.previousState, state = game.state;
  const direct = from === to ? [to] : [from, to];
  if (!level || !previous || !Array.isArray(game.actions) || !level.width) return direct;
  const backwards = previous.turn > state.turn;
  const action = game.actions[Math.max(previous.turn, state.turn) - 4];
  const delta = DIRECTIONS[action];
  if (!delta) return direct;
  const start = backwards ? to : from, end = backwards ? from : to;
  const middle = start + delta[0] + delta[1] * level.width;
  const wind = level.winds && DIRECTIONS[level.winds[middle]];
  if (!wind || middle + wind[0] + wind[1] * level.width !== end) return direct;
  return [from, middle, to];
}

function movementPath(game, from, to, ghost) {
  if (!validCell(from)) return [to];
  if (ghost) return echoPath(game, from, to);
  const explicit = game.motionPath;
  if (Array.isArray(explicit) && explicit.length > 1 && explicit.every(validCell) && explicit[0] === from && explicit[explicit.length - 1] === to) return explicit;
  const path = [from];
  for (const event of game.moveEvents || []) {
    if (event && (event.type === 'move' || event.type === 'wind') && validCell(event.cell) && event.cell !== path[path.length - 1]) path.push(event.cell);
  }
  if (path[path.length - 1] !== to) path.push(to);
  return path;
}

function actorFrame(game, now, point, ghost = false, options = {}) {
  const state = game && game.state, previous = game && game.previousState;
  const key = ghost ? 'echo' : 'player';
  const time = finite(now) ? now : 0;
  const age = game && finite(game.transitionAt) ? Math.max(0, time - game.transitionAt) : MOVE_MS;
  const reduced = !!options.reducedMotion;
  const progress = reduced ? 1 : clamp(age / MOVE_MS), eased = smooth(progress);
  const target = state && state[key], from = previous && previous[key];
  const disappearing = ghost && !validCell(target) && validCell(from) && progress < 1;
  if (!validCell(target) && !disappearing) return { x: 0, y: 0, lift: 0, stride: 0, alpha: 0, moving: false, facing: 1 };
  const path = disappearing ? [from] : movementPath(game, from, target, ghost);
  const segment = Math.min(Math.max(0, path.length - 2), Math.floor(eased * (path.length - 1)));
  const fraction = path.length > 1 ? eased * (path.length - 1) - segment : 0;
  const [x0, y0] = position(point, path[segment]);
  const [x1, y1] = position(point, path[Math.min(segment + 1, path.length - 1)]);
  const moving = path.length > 1 && progress < 1;
  const breathing = reduced ? 0 : Math.sin(time / (ghost ? 390 : 610) + (ghost ? 1.7 : 0));
  const stride = moving ? Math.sin(progress * TAU) : 0;
  const lift = ghost ? 4 + breathing * 1.7 + (moving ? Math.sin(progress * Math.PI) * 3 : 0) : .6 + breathing * .6 + (moving ? Math.sin(progress * Math.PI) * 4 : 0);
  const alpha = !ghost ? 1 : disappearing ? 1 - eased : !validCell(from) ? eased : 1;
  return { x: x0 + (x1 - x0) * fraction, y: y0 + (y1 - y0) * fraction, lift, stride, alpha, moving, facing: x1 < x0 ? -1 : 1 };
}

// A stable seed keeps every particle on the same trajectory between animation frames.
function random(seed) {
  let value = Math.imul(seed + 1, 2654435761);
  value = Math.imul(value ^ value >>> 16, 2246822519);
  return (value >>> 0) / 4294967296;
}

function burst(renderer, x, y, unit, progress, color, seed, paper) {
  const c = renderer.ctx, low = renderer.effectsQuality === 'low';
  const count = low ? paper ? 4 : 5 : paper ? 9 : 13;
  for (let index = 0; index < count; index++) {
    const n = seed + index * 31;
    const angle = random(n) * TAU;
    const distance = unit * (.16 + random(n + 1) * .43) * Math.sqrt(progress);
    const px = x + Math.cos(angle) * distance;
    const py = y + Math.sin(angle) * distance * .6 - Math.sin(progress * Math.PI) * unit * .32 + (paper ? progress * progress * unit * .44 : -progress * unit * .12);
    const radius = 1.1 + random(n + 2) * 1.5;
    if (paper) {
      c.save(); c.translate(px, py); c.rotate(angle + progress * (random(n + 3) - .5) * 9);
      renderer.round(-radius * 1.4, -radius * .6, radius * 2.8, radius * 1.2, .5, color); c.restore();
    } else {
      renderer.circle(px, py, radius * (1 - progress * .5), color);
      if (!low && index % 3 === 0) renderer.line([[px - radius * 2, py], [px + radius * 2, py]], color, .8);
    }
  }
}

function drawEffectBatch(renderer, batch, now, point, scale) {
  const c = renderer.ctx, age = now - batch.at, events = batch.events, low = renderer.effectsQuality === 'low';
  events.forEach((event, index) => {
    if (!event || !validCell(event.cell)) return;
    const timing = EVENT_TIMINGS[event.type];
    if (!timing || age < timing.delay || age >= timing.delay + timing.duration) return;
    const progress = (age - timing.delay) / timing.duration;
    const [x, y] = position(point, event.cell);
    const seed = event.cell * 193 + index * 997;
    c.save();
    if (event.type === 'move') {
      c.globalAlpha *= (1 - progress) * .48;
      c.beginPath(); c.ellipse(x, y + 2, scale * (.12 + progress * .23), scale * (.04 + progress * .1), 0, 0, TAU);
      c.strokeStyle = COLORS.gold; c.lineWidth = 1.2; c.stroke();
      if (!low) [-1, 1].forEach(side => renderer.line([[x + side * scale * .055, y], [x + side * scale * .055, y + scale * .05]], COLORS.paper, 2));
    } else if (['letter', 'seal', 'light', 'bridge'].includes(event.type)) {
      const paper = event.type === 'bridge';
      const color = event.type === 'seal' ? COLORS.cyan : paper ? COLORS.paper : COLORS.gold;
      c.globalAlpha *= 1 - progress;
      renderer.circle(x, y - scale * .08, scale * (.15 + progress * .48), null, color);
      burst(renderer, x, y - scale * .18, scale, progress, color, seed, paper);
    } else if (event.type === 'wind') {
      const entry = events.slice(0, index).find(item => item && item.type === 'move');
      const [sx, sy] = position(point, entry ? entry.cell : event.cell);
      c.globalAlpha *= (1 - progress) * .7;
      for (let ribbon = 0; ribbon < (low ? 1 : 3); ribbon++) {
        const offset = low ? 0 : (ribbon - 1) * scale * .1;
        const lead = clamp(progress * 1.7), tail = Math.max(0, lead - .65);
        renderer.line([[sx + (x - sx) * tail, sy + (y - sy) * tail + offset], [sx + (x - sx) * lead, sy + (y - sy) * lead + offset - Math.sin(progress * Math.PI) * 4]], COLORS.cyan, 1.4 - ribbon * .2);
      }
    } else if (event.type === 'wait') {
      c.globalAlpha *= (1 - progress) * .75;
      renderer.circle(x, y, scale * (.13 + progress * .42), null, COLORS.cyan);
      if (!low) renderer.circle(x, y, scale * (.07 + progress * .29), null, COLORS.gold);
    } else if (event.type === 'echo-born') {
      c.globalAlpha *= 1 - progress;
      renderer.circle(x, y - scale * .2, scale * (.1 + progress * .45), null, COLORS.cyan);
      renderer.icon('echo', x, y - scale * (.64 + progress * .15), scale * .25, COLORS.cyan);
    } else if (event.type === 'undo') {
      c.globalAlpha *= 1 - progress;
      for (let ring = 0; ring < (low ? 1 : 2); ring++) {
        const radius = scale * (.22 + (1 - progress) * (.28 + ring * .12));
        c.beginPath(); c.ellipse(x, y, radius, radius * .47, -progress * .35, .2 + ring * Math.PI, Math.PI * 1.6 + ring * Math.PI);
        c.strokeStyle = COLORS.cyan; c.lineWidth = 1.4; c.stroke();
      }
      renderer.icon('undo', x, y - scale * .65, scale * .28, COLORS.cyan);
    } else if (['ready', 'win', 'fail'].includes(event.type)) {
      const won = event.type === 'win', failed = event.type === 'fail';
      const color = failed ? '#f1b189' : COLORS.gold;
      c.globalAlpha *= 1 - progress;
      c.beginPath(); c.ellipse(x, y, scale * (.25 + progress * .75), scale * (.1 + progress * .34), 0, 0, TAU);
      c.strokeStyle = color; c.lineWidth = won ? 2 : 1.3; c.stroke();
      if (!failed) burst(renderer, x, y - scale * .5, scale * (won ? 1.5 : .85), progress, color, seed, true);
    }
    c.restore();
  });
}

function drawBlocked(renderer, game, now, point, scale, reduced) {
  if (!finite(game.blockedAt) || !validCell(game.state && game.state.player)) return;
  const age = now - game.blockedAt, duration = EVENT_TIMINGS.blocked.duration;
  if (age < 0 || age >= duration) return;
  const [x, y] = position(point, game.state.player), c = renderer.ctx;
  const progress = reduced ? 0 : age / duration;
  c.save(); c.globalAlpha *= reduced ? .85 : 1 - progress;
  c.beginPath(); c.ellipse(x, y + 1, scale * (.3 + progress * .09), scale * (.12 + progress * .04), 0, 0, TAU);
  c.strokeStyle = '#f1b189'; c.lineWidth = 1.8; c.stroke();
  c.restore();
}

function drawEffects(renderer, game, now, point, unit, options = {}) {
  if (!renderer || !renderer.ctx || !game || !finite(now) || !finite(game.transitionAt) || typeof point !== 'function') return;
  let buffer = renderer.motionEffects;
  if (!buffer || buffer.game !== game || buffer.session !== game.session || buffer.level !== game.level) {
    // Preserve the last observed source so changing screens cannot replay an old burst.
    buffer = renderer.motionEffects = {
      game, session: game.session, level: game.level, batches: [], turn: null, undosUsed: null,
      at: buffer ? buffer.at : null, events: buffer ? buffer.events : null
    };
  }
  const turn = game.state && game.state.turn;
  const backwards = (finite(turn) && finite(buffer.turn) && turn < buffer.turn) ||
    (finite(game.undosUsed) && finite(buffer.undosUsed) && game.undosUsed !== buffer.undosUsed);
  const reduced = !!options.reducedMotion;
  if (game.reviewing || backwards || reduced) buffer.batches = [];
  const changed = buffer.at !== game.transitionAt || buffer.events !== game.moveEvents;
  if (!game.reviewing && !reduced && changed && Array.isArray(game.moveEvents) && game.moveEvents.length) {
    const events = game.moveEvents.slice(), state = game.state, previous = game.previousState;
    if (state && previous && validCell(state.echo) && !validCell(previous.echo)) events.push({ type: 'echo-born', cell: state.echo });
    if (state && previous && state.status === 'playing' && !state.letters.length && !state.seals.length && (previous.letters.length || previous.seals.length)) events.push({ type: 'ready', cell: game.level.exit });
    buffer.batches.push({ at: game.transitionAt, events });
  }
  buffer.at = game.transitionAt; buffer.events = game.moveEvents; buffer.turn = turn; buffer.undosUsed = game.undosUsed;
  buffer.batches = buffer.batches.filter(batch => now >= batch.at && now - batch.at < EFFECT_BATCH_MS).slice(-8);
  if (game.reviewing) return;
  const scale = finite(unit) && unit > 0 ? unit : 40;
  // Text belongs to the fixed feedback row; the board only carries visual effects.
  if (game.state && game.state.status === 'playing') drawBlocked(renderer, game, now, point, scale, reduced);
  if (reduced) return;
  buffer.batches.forEach(batch => drawEffectBatch(renderer, batch, now, point, scale));
}

module.exports = { MOVE_MS, actorFrame, drawEffects, drawBurst: burst };
