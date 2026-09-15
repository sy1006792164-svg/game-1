'use strict';

const { DIRECTIONS, ACTIONS, neighbor, step } = require('./engine');
const { getEchoForecast } = require('./echo-timeline');

const MOVE_DIRECTIONS = Object.keys(DIRECTIONS);

function getRoutePreview(renderer, game) {
  const { level, state, actions } = game;
  const previous = renderer.routePreview;
  if (previous && previous.level === level && previous.state === state && previous.actions === actions) return previous;

  const winds = [];
  if (state.status === 'playing') {
    for (const direction of MOVE_DIRECTIONS) {
      const entry = neighbor(level, state.player, direction, state);
      if (entry === null || !level.winds || !level.winds[entry]) continue;
      // Ask the rules for the actual landing, including walls and torn bridges.
      const result = step(level, state, direction);
      winds.push({ entry, landing: result.state.player,
        blocked: !result.events.some(event => event.type === 'wind') });
    }
  }

  const history = state.history, first = Math.max(0, history.length - 4);
  const turns = actions && actions.filter(action => ACTIONS.includes(action));
  const echo = [history[first]];
  for (let index = first + 1; index < history.length; index++) {
    const from = history[index - 1], to = history[index];
    const action = turns && turns[index - 1];
    const entry = DIRECTIONS[action] && neighbor(level, from, action);
    // Recorded actions identify the wind corner unambiguously. The echo can
    // cross paper that has since torn, so current bridge state does not apply.
    if (entry != null && entry !== to && level.winds && level.winds[entry] &&
        neighbor(level, entry, level.winds[entry]) === to) echo.push(entry);
    if (echo[echo.length - 1] !== to) echo.push(to);
  }
  // Cache rule results independently of camera geometry, which changes during a shake.
  return renderer.routePreview = { level, state, actions, winds, echo, forecast: getEchoForecast(game),
    echoNext: history.length >= 3 ? history[history.length - 3] : null };
}

function drawWindLandings(renderer, winds, projection) {
  const c = renderer.ctx, { point, halfW, halfH } = projection;
  c.save(); c.strokeStyle = '#ad854fbf'; c.fillStyle = '#c8975620'; c.lineWidth = 1.3;
  c.lineCap = 'round';
  for (const route of winds) {
    const [sx, sy] = point(route.entry), [x, y] = point(route.landing);
    if (route.blocked) {
      // A stopped gust still permits stepping onto its own tile.
      const dx = halfW * .14, dy = halfH * .17;
      renderer.line([[x - dx, y + halfH * .46 - dy], [x + dx, y + halfH * .46 + dy]], '#996d55', 1.5);
      renderer.line([[x - dx, y + halfH * .46 + dy], [x + dx, y + halfH * .46 - dy]], '#996d55', 1.5);
      continue;
    }
    // Start beyond the tile's existing wind arrow and stop at the landing ring.
    c.strokeStyle = '#ad854fbf'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(sx + (x - sx) * .4, sy + (y - sy) * .4);
    c.lineTo(x - (x - sx) * .24, y - (y - sy) * .24); c.stroke();
    c.beginPath(); c.ellipse(x, y, halfW * .24, halfH * .24, 0, 0, Math.PI * 2);
    c.fill(); c.stroke();
    const dx = x - sx, dy = y - sy, length = Math.hypot(dx, dy), tipX = sx + dx * .64, tipY = sy + dy * .64;
    const ux = dx / length, uy = dy / length, size = Math.max(3, halfW * .14);
    renderer.line([[tipX - ux * size - uy * size * .6, tipY - uy * size + ux * size * .6],
      [tipX, tipY], [tipX - ux * size + uy * size * .6, tipY - uy * size - ux * size * .6]], '#9b764a', 1.3);
  }
  c.restore();
}

function drawRoutePreview(renderer, game, projection, guide) {
  if (game.reviewing) return;
  const preview = getRoutePreview(renderer, game);
  const c = renderer.ctx, { point, halfW, halfH } = projection;
  if (game.state.status === 'playing' && !game.selectedItem && !guide && !game.modal && !game.busy && !game.hidden) {
    drawWindLandings(renderer, preview.winds, projection);
  }
  if (preview.echo.length > 1) {
    c.save(); c.beginPath(); c.setLineDash([3, 5]); c.strokeStyle = '#65b9bfaa'; c.lineWidth = 1.4;
    preview.echo.forEach((cell, index) => {
      const [x, y] = point(cell);
      if (index) c.lineTo(x, y); else c.moveTo(x, y);
    });
    c.stroke(); c.restore();
  }
  if (preview.echoNext !== null) {
    const [x, y] = point(preview.echoNext);
    c.save(); c.beginPath(); c.ellipse(x, y, halfW * .49, halfH * .49, 0, 0, Math.PI * 2);
    c.fillStyle = '#83d8de24'; c.fill(); c.strokeStyle = '#77d2d9'; c.lineWidth = 1.6; c.stroke(); c.restore();
    renderer.icon('echo', x - halfW * .58, y - halfH * .38, Math.max(10, halfW * .34), '#69b9c2');
  }
  if (guide || game.state.status !== 'playing') return;
  c.save();
  const marked = new Set(preview.echoNext === null ? [] : [preview.echoNext]);
  for (const entry of preview.forecast) {
    if (entry.cell === null || marked.has(entry.cell)) continue;
    marked.add(entry.cell);
    const [x, y] = point(entry.cell);
    c.beginPath(); c.ellipse(x, y, halfW * .49, halfH * .49, 0, 0, Math.PI * 2);
    c.strokeStyle = entry.seal ? '#438f96' : '#77adaf88'; c.lineWidth = 1;
    c.setLineDash([2, 3]); c.stroke();
  }
  c.restore();
}

module.exports = { getRoutePreview, drawRoutePreview };
