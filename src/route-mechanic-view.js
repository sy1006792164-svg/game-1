'use strict';

const { gateStatus } = require('./route-mechanics');

function adjacentCell(level, player, cell) {
  return Math.abs(player % level.width - cell % level.width) +
    Math.abs(Math.floor(player / level.width) - Math.floor(cell / level.width)) === 1;
}

function echoArrival(state, plate) {
  for (let index = Math.max(0, state.turn - 2); index < state.history.length; index++) {
    if (state.history[index] === plate) return index + 3 - state.turn;
  }
  return null;
}

function gateMessage(level, state, gate) {
  if (gate.type === 'tide' || gate.gate === 'tide') return gate.open
    ? '潮汐门已开，这一步可以通过；每 3 拍开一次。'
    : '潮汐门未开，先等 ' + gate.waitTurns + ' 拍再进入；等待也耗拍。';
  if (gate.open) return '回声正压住踏板，这一步可以穿过同纹的门。';
  const turns = echoArrival(state, gate.plate);
  return turns === null ? '回声门未开：先踩同纹踏板，3 拍后让回声压住，再进门。'
    : '回声门未开，再行动 ' + turns + ' 拍，回声会压住同纹踏板。';
}

function routeMechanicHint(level, state) {
  const gates = [...Object.keys(level.tideGates || {}), ...Object.keys(level.echoGates || {})].map(Number);
  const nearby = gates.filter(cell => adjacentCell(level, state.player, cell));
  if (nearby.length) return gateMessage(level, state, gateStatus(level, state, nearby[0]));
  if (Object.values(level.echoGates || {}).some(gate => gate.plate === state.player))
    return '已踩过回声踏板：3 拍后回声到这里；趁它压住时穿门。';
  if (state.turn === 0 && gates.length) return Object.keys(level.echoGates || {}).length
    ? '同纹踏板与门相连，让晚 3 拍的回声压住踏板，再穿门收信。'
    : '潮汐门每 3 拍开一次，看门上的开闭提示，安排移动与等待。';
  return '';
}

function diamond(r, x, y, w, h, fill, stroke) {
  const c = r.ctx;
  c.beginPath(); c.moveTo(x, y - h); c.lineTo(x + w, y);
  c.lineTo(x, y + h); c.lineTo(x - w, y); c.closePath();
  c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 1; c.stroke();
}

const PAIRS = [
  { color: '#537f91', fill: '#d5e5e6' },
  { color: '#956a89', fill: '#e8dce4' },
  { color: '#957746', fill: '#ece0be' }
];

function pairMark(r, x, y, size, index, color) {
  if (index % 3 === 0) diamond(r, x, y, size, size * .7, '#faf6e4', color);
  else if (index % 3 === 1) r.circle(x, y, size * .7, '#faf6e4', color);
  else r.line([[x - size, y + size * .55], [x, y - size * .7], [x + size, y + size * .55],
    [x - size, y + size * .55]], color, 1.4);
}

/** Floor symbols follow the board camera; status labels use a separate overlay. */
function drawRouteMechanic(r, level, state, cell, projection) {
  const [x, y] = projection.point(cell), w = projection.halfW, h = projection.halfH;
  const gate = gateStatus(level, state, cell), pairs = Object.entries(level.echoGates || {});
  const pairIndex = pairs.findIndex(([door, value]) => Number(door) === cell || value.plate === cell);
  const plate = pairIndex >= 0 && pairs[pairIndex][1].plate === cell;
  if (!gate && !plate) return;
  const pair = PAIRS[Math.max(0, pairIndex) % PAIRS.length];
  if (plate) {
    const active = state.echo === cell;
    diamond(r, x, y, w * .7, h * .7, active ? '#a4d9d3' : pair.fill, pair.color);
    diamond(r, x, y, w * .54, h * .52, active ? '#d5f2dd' : '#f6f1dd', pair.color);
    pairMark(r, x, y - h * .06, w * .17, pairIndex, pair.color);
    r.line([[x - w * .23, y + h * .4], [x + w * .23, y + h * .4]], pair.color, active ? 2.4 : 1);
  }
  if (!gate) return;
  const tide = gate.type === 'tide', color = tide ? '#447f83' : pair.color;
  diamond(r, x, y, w * .82, h * .82, gate.open ? '#d3e4c8' : tide ? '#d2e2de' : pair.fill, color);
  const postY = y - h * .12, postHeight = w * .38;
  [-1, 1].forEach(side => {
    const px = x + side * w * .49;
    r.round(px - w * .065, postY - postHeight, w * .13, postHeight, w * .035, '#f8f1d9', color);
    r.circle(px, postY - postHeight, w * .095, gate.open ? '#cbdcaa' : '#dfbc87', color);
  });
  if (!gate.open) {
    r.line([[x - w * .45, postY - postHeight * .42], [x + w * .45, postY - postHeight * .42]], color, 2);
    if (!tide) pairMark(r, x, postY - postHeight * .42, w * .14, pairIndex, color);
  } else {
    r.line([[x - w * .14, y - h * .18], [x, y + h * .05], [x + w * .14, y - h * .18]], '#567548', 1.8);
    if (!tide) pairMark(r, x - w * .45, postY - postHeight, w * .08, pairIndex, color);
  }
  if (tide) {
    for (let phase = 0; phase < 3; phase++) {
      const px = x + (phase - 1) * w * .19, py = y - h * .55;
      r.circle(px, py, w * .055, phase === gate.arrivalPhase ? color : '#f8f1d9', phase === gate.phase ? '#b68b50' : color);
    }
  }
}

module.exports = { adjacentCell, echoArrival, gateMessage, routeMechanicHint, drawRouteMechanic };
