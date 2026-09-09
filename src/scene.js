'use strict';

const { MOVE_MS, actorFrame, drawEffects } = require('./motion');
const { insideRect } = require('./board-projection');
const { getBoardGeometry } = require('./board-geometry');
const { OFFICE, officeFlag, hitPostOffice } = require('./post-office-geometry');
const { drawIslandSurface } = require('./island-surface');
const { drawAtmosphere, drawActorTrails, drawDestination } = require('./scene-effects');
const { drawGuideTargets } = require('./guide-view');
const { drawHomeArchitecture } = require('./world-art');

const COLOR = {
  sky: '#e9efe7', forest: '#b8cebf', fog: '#d6e2d7', teal: '#60b4ba',
  stone: '#eee9d4', stoneLight: '#faf3dd', moss: '#91ae8b', gold: '#c89756',
  rock: '#b0bda3', rockDark: '#8fa590', ink: '#294d49', cream: '#fff8e7'
};

function polygon(r, points, fill, stroke) {
  const c = r.ctx; c.beginPath();
  points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); }
}

function ellipse(r, x, y, rx, ry, color) {
  const c = r.ctx; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}

function glow(r, x, y, radius, color, alpha) {
  const c = r.ctx; c.save();
  for (let i = 3; i > 0; i--) { c.globalAlpha = alpha / i; r.circle(x, y, radius * i / 2, color); }
  c.restore();
}

// Pick the painted rounded shape after its local rotation, leaving empty corners clickable.
function hitProp(r, x, y, width, height, radius, angle, action) {
  if (!action) return;
  const cos = Math.cos(angle), sin = Math.sin(angle), hw = width / 2, hh = height / 2;
  const rx = Math.abs(cos) * hw + Math.abs(sin) * hh, ry = Math.abs(sin) * hw + Math.abs(cos) * hh;
  radius = Math.min(radius, hw, hh);
  r.hit(x - rx, y - ry, rx * 2, ry * 2, action, (hx, hy) => {
    const dx = hx - x, dy = hy - y;
    const px = Math.abs(dx * cos + dy * sin), py = Math.abs(dy * cos - dx * sin);
    return px <= hw && py <= hh &&
      Math.pow(Math.max(0, px - hw + radius), 2) + Math.pow(Math.max(0, py - hh + radius), 2) <= radius * radius;
  });
}

function tree(r, x, y, size, now, distant) {
  const sway = Math.sin(now / 2600 + x) * size * .012;
  polygon(r, [[x - size * .15, y], [x + size * .08, y - 2], [x + size * .74, y + size * .13], [x + size * .39, y + size * .22]], distant ? '#70938209' : '#577c6724');
  r.line([[x, y], [x, y - size * .72]], distant ? '#9ab7a5' : '#7f8163', Math.max(1, size * .045));
  ellipse(r, x + sway, y - size * .62, size * .27, size * .48, distant ? '#b3cdbb' : '#7fa589');
  ellipse(r, x - size * .08 + sway, y - size * .71, size * .19, size * .35, distant ? '#c0d4c3' : '#adc69a');
  ellipse(r, x + size * .1 + sway, y - size * .61, size * .12, size * .32, distant ? '#adc7b5' : '#73997e');
  if (!distant) r.line([[x - size * .09 + sway, y - size * .94], [x - size * .16 + sway, y - size * .83]], '#e0e8ba88', .85);
}

function grass(r, x, y, size, now, color) {
  const sway = Math.sin(now / 1300 + x) * 1.5;
  r.line([[x - size * .6, y - size * .45], [x, y + 1], [x - size * .12 + sway, y - size]], color || '#91b68a', 1.4);
  r.line([[x, y + 1], [x + size * .6 + sway, y - size * .6]], color || '#91b68a', 1.2);
}

function postOffice(r, x, y, size, now, ready) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size / 44, size / 44);
  polygon(r, [[-18, 0], [20, -9], [42, 1], [9, 13]], '#597c6633');
  ellipse(r, 2, 2, 23, 7, '#597c6619');
  if (ready) glow(r, 0, -11, 20, COLOR.gold, .065 + Math.sin(now / 550) * .012);
  polygon(r, OFFICE.front, '#fff5de');
  polygon(r, OFFICE.side, '#c2cbb2');
  polygon(r, OFFICE.roof, '#cf8b74');
  polygon(r, [[-23, -27], [-4, -43], [8, -35], [8, -19]], '#e9a087');
  polygon(r, OFFICE.frontTrim, '#edb296');
  polygon(r, OFFICE.sideTrim, '#ad705c');
  r.line([[-4, -42], [24, -35]], '#f6c4a5', 1.4);
  [[-11, -37, 1, -21], [-17, -32, -9, -24], [5, -41, 17, -28]].forEach(([ax, ay, bx, by]) => r.line([[ax, ay], [bx, by]], '#f8bea063', .65));
  r.line([[-18, -5], [7, 1]], '#e0d9be', 1.1);
  r.round(-12, -18, 10, 16, 4.8, '#678c7c');
  r.round(-10, -16, 6, 8, 2.8, ready ? '#ffe3a7' : '#bad5bb');
  r.circle(-4, -7, 1, '#e6bd77');
  polygon(r, [[12, -18], [18, -21], [18, -13], [12, -10]], ready ? '#f9d497' : '#789b87');
  r.line([[15, -19], [15, -12]], '#779779', .75);
  r.round(-14, -30, 20, 8, 2, COLOR.cream);
  r.icon('letter', -4, -26, 8, '#bf7f47');
  polygon(r, OFFICE.step, '#dce0c5');
  r.line([[8, 2], [-18, -4]], '#fff9e5', 1.3);
  r.line([[22, -6], [22, -45], [34, -44]], '#385e51', 1.7);
  const flap = Math.sin(now / 370) * 2;
  polygon(r, officeFlag(now), COLOR.gold);
  r.icon('letter', 28, -41 + flap / 2, 5, '#fff3c9');
  c.restore();
}

function lantern(r, x, y, size, now, action) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
  const sway = Math.sin(now / 870 + x) * .06;
  ellipse(r, 0, 2, 10, 3, '#2d4b3b29');
  r.line([[-6, 0], [-6, -27], [5, -27]], '#517064', 2);
  c.save(); c.translate(5, -25); c.rotate(sway);
  glow(r, 0, 7, 10, COLOR.gold, .08);
  r.line([[0, -2], [0, 1]], '#b58e54', 1);
  r.round(-4, 1, 8, 12, 2, '#bd934f'); r.round(-2.5, 3, 5, 7, 1, '#ffe6a2');
  r.line([[-5, 1], [5, 1]], '#57705a', 1.7); r.line([[-5, 13], [5, 13]], '#57705a', 1.7);
  c.restore(); c.restore();
  const scale = size / 24, cos = Math.cos(sway), sin = Math.sin(sway);
  const pick = (cx, cy, w, h, radius) => hitProp(r, x + (5 + cx * cos - cy * sin) * scale,
    y + (-25 + cx * sin + cy * cos) * scale, w * scale, h * scale, radius * scale, sway, action);
  hitProp(r, x - 6 * scale, y - 13.5 * scale, 2 * scale, 29 * scale, scale, 0, action);
  hitProp(r, x - .5 * scale, y - 27 * scale, 13 * scale, 2 * scale, scale, 0, action);
  pick(0, -.5, 1, 4, .5); pick(0, 7, 8, 12, 2);
  pick(0, 1, 11.7, 1.7, .85); pick(0, 13, 11.7, 1.7, .85);
}

function diamond(r, x, y, hw, hh, fill, stroke, height) {
  const z = height || 0;
  if (z) {
    polygon(r, [[x - hw, y], [x, y + hh], [x, y + hh - z], [x - hw, y - z]], '#b7c3a2');
    polygon(r, [[x, y + hh], [x + hw, y], [x + hw, y - z], [x, y + hh - z]], '#8da98e');
  }
  polygon(r, [[x, y - hh - z], [x + hw, y - z], [x, y + hh - z], [x - hw, y - z]], fill, stroke);
}

function groundDetail(r, game, now, cell, p) {
  const l = game.level, s = game.state, [x, y] = p.point(cell), hw = p.halfW, hh = p.halfH;
  const bridge = (l.bridges || []).includes(cell), intact = (s.bridges || []).includes(cell);
  if (bridge) {
    if (intact) {
      diamond(r, x, y - .7, hw - 2, hh - 1.5, '#eac798', '#f4dbaf');
      for (let i = -1; i <= 1; i++) floorLine(r, p, x, y, [[i * hw * .38 - hw * .31, i * hh * .38], [i * hw * .38 + hw * .31, i * hh * .38 - hh * .65]], '#b99769', 1.2);
    } else {
      diamond(r, x, y, hw - 1.5, hh - 1, '#244947', '#537869');
      floorLine(r, p, x, y, [[-hw * .7, -1], [-hw * .36, 3], [-hw * .2, -3]], '#b6a27b', 2);
      floorLine(r, p, x, y, [[hw * .7, -1], [hw * .4, -4], [hw * .2, 1]], '#b6a27b', 2);
    }
  }
  if (l.winds && l.winds[cell]) {
    diamond(r, x, y, hw - 2, hh - 1.5, '#c6dab6', '#e0e8c4');
    const [vx, vy] = p.vector(l.winds[cell]);
    const ax = vx * .4, ay = vy * .4;
    r.line([[x - ax, y - ay], [x + ax, y + ay]], '#668973', 2);
    r.line([[x + ax - vx * .33 + vy * .22, y + ay - vy * .33 - vx * .22], [x + ax, y + ay], [x + ax - vx * .33 - vy * .22, y + ay - vy * .33 + vx * .22]], '#668973', 1.5);
  }
}

function floorLine(r, p, x, y, offsets, color, width) {
  r.line(offsets.map(([dx, dy]) => [x + dx, y + dy]), color, width);
}

function floatingMail(r, x, y, size, now, cell, seal, action) {
  const c = r.ctx, bob = Math.sin(now / 670 + cell * .7) * 2.2;
  const floatY = y - size * .5 + bob, angle = Math.sin(now / 1500 + cell) * .09;
  ellipse(r, x, y + 1, size * .38, size * .12, seal ? '#659d9a38' : '#ae824530');
  glow(r, x, y - 10, size * .52, seal ? COLOR.teal : COLOR.gold, .055);
  c.save(); c.translate(x, floatY); c.rotate(angle);
  if (seal) {
    r.round(-size * .36, -size * .43, size * .72, size * .86, 2, '#79c6c9', '#d0f0e5');
    r.round(-size * .23, -size * .29, size * .46, size * .57, 1, '#b3e0d9');
    r.icon('star', 0, 0, size * .44, '#39797c');
    [-1, 0, 1].forEach(i => { r.circle(-size * .37, i * size * .24, 1.1, COLOR.stone); r.circle(size * .37, i * size * .24, 1.1, COLOR.stone); });
  } else {
    r.icon('letter', 0, 0, size, COLOR.gold);
    r.circle(0, 1, size * .095, '#bd7146');
  }
  c.restore();
  const sparkle = (now / 1800 + cell * .31) % 1;
  c.save(); c.globalAlpha = Math.sin(sparkle * Math.PI) * .7;
  r.circle(x + Math.sin(cell) * size * .6, y - 8 - sparkle * size, .9, seal ? '#c1f6ef' : '#fff1c6'); c.restore();
  hitProp(r, x, floatY, size * (seal ? .72 : 20 / 24), size * (seal ? .86 : 14 / 24),
    seal ? 2 : size * 3 / 24, angle, action);
}

function drawBoard(r, game, now, rect, guide) {
  const options = { reducedMotion: false }, time = now;
  const l = game.level, s = game.state, view = game.camera.frame(now);
  const geometry = getBoardGeometry(r, l, s, rect, view);
  const p = geometry.projection, { halfW: hw, halfH: hh, point, corners } = p;
  r.boardRect = rect;
  r.boardProjection = geometry.screenProjection;
  const target = r, c = r.ctx;
  r = Object.create(target);
  r.hit = (x, y, w, h, action, contains) => {
    const [sx, sy] = p.toScreen(x, y);
    target.hit(sx, sy, w * view.scale, h * view.scale, action, (hx, hy) =>
      insideRect(rect, hx, hy) && (!contains || contains(...p.toWorld(hx, hy))));
  };
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
  c.translate(p.centerX + view.panX * rect.w, p.centerY + view.panY * rect.h);
  c.scale(view.scale, view.scale); c.translate(-p.centerX, -p.centerY);
  glow(r, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * .32, '#f9f3d3', .026);
  drawIslandSurface(r, corners, 26, time);
  const { walls, adjacent, ordered } = geometry;
  const selectCell = cell => {
    const player = game.state.player, dx = cell % l.width - player % l.width, dy = Math.floor(cell / l.width) - Math.floor(player / l.width);
    // A second tap on the destination during arrival is still a move intention.
    if (cell === player && game.previousState && game.previousState.player !== player &&
      game.platform.now() - game.transitionAt < MOVE_MS) return;
    if (!dx && !dy) game.act('wait');
    else if (Math.abs(dx) + Math.abs(dy) === 1) game.act(dx ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
    else if (game.guideMisstep()) return;
    else if ((l.bridges || []).includes(cell) && !game.state.bridges.includes(cell)) game.toast('纸桥已碎，这里过不去了');
    else game.toast('点相邻格移动，点脚下格原地等一拍');
  };
  const enterOffice = !game.reviewing && s.status === 'playing' && (adjacent.has(l.exit) || s.player === l.exit)
    ? () => selectCell(l.exit) : null;
  const actors = [];
  for (const cell of ordered) {
    const [x, y] = point(cell), wall = walls.has(cell);
    diamond(r, x, y, hw - .8, hh - .7, wall ? (cell % 3 ? '#9db792' : '#acc09a') : cell % 3 ? COLOR.stone : COLOR.stoneLight, wall ? '#c3d1ac' : '#fff9e8', wall ? 4 : 0);
    if (wall) {
      if (cell % 3 === 0) actors.push({ y: y + 2, draw: () => {
        polygon(r, [[x - 8, y - 3], [x - 5, y - 10], [x + 2, y - 12], [x + 8, y - 5], [x + 4, y]], '#d5d7bb');
        polygon(r, [[x + 2, y - 12], [x + 8, y - 5], [x + 4, y], [x, y - 4]], '#a3b29a');
        r.line([[x - 5, y - 10], [x + 2, y - 12], [x + 6, y - 7]], '#f6efd6', 1);
        grass(r, x - 8, y - 1, 5, time);
      } });
      // Trees only line the rear rim, so they never hide a floor tile.
      const onRim = Math.floor(cell / l.width) === p.bounds.minRow || cell % l.width === p.bounds.minCol;
      if (onRim && cell % 2 === 0) actors.push({ y, draw: () => tree(r, x, y - 3, hw * (1.05 + cell % 3 * .11), time, false) });
      else if (cell % 2) actors.push({ y, draw: () => grass(r, x + 5, y - 4, 6, time, '#b1c293') });
    } else {
      // Shallow bevels keep the original tappable floor plane exact.
      r.line([[x - hw + 2, y + 1], [x, y + hh - 1.4], [x + hw - 2, y + 1]], '#c4ccb178', .8);
      groundDetail(r, game, time, cell, p);
      if (cell === l.exit) {
        diamond(r, x, y, hw - 2, hh - 1.5, '#cbd9b6', '#eff1ce');
        const ready = !s.letters.length && !s.seals.length;
        actors.push({ y: y + 2, draw: () => {
          postOffice(r, x, y + OFFICE.sideOffset, hw * 1.2, time, ready);
          hitPostOffice(r, { x, y, size: hw * 1.2, now: time }, enterOffice);
        } });
      }
      if (!game.reviewing && s.status === 'playing' && adjacent.has(cell) && (!guide || guide.visual.tapCell === cell)) {
        diamond(r, x, y, hw - 3, hh - 2, '#f4d49b66', null);
        floorLine(r, p, x, y, [[0, -hh + 2], [hw - 3, 0], [0, hh - 2], [-hw + 3, 0], [0, -hh + 2]], '#c69755', 1.45);
        ellipse(r, x, y + hh * .43, hw * .12, hh * .14, '#b68b52');
      }
      const selectProp = !game.reviewing && s.status === 'playing' ? () => selectCell(cell) : null;
      if (s.lights.includes(cell)) actors.push({ y, draw: () => lantern(r, x, y - 1, hw * .7, time, selectProp) });
      if (s.letters.includes(cell)) actors.push({ y: y + 1, draw: () => floatingMail(r, x, y, hw * .76, time, cell, false, selectProp) });
      if (s.seals.includes(cell)) actors.push({ y: y + 1, draw: () => floatingMail(r, x, y, hw * .7, time, cell, true, selectProp) });
    }
    // The courier remains visual only; uncovered floor tiles keep their normal actions.
    r.hit(x - hw, y - hh, hw * 2, hh * 2, () => selectCell(cell), (hx, hy) => p.contains(cell, hx, hy));
  }
  if (game.reviewing) r.line((s.history || []).map(point), '#c8874eca', 2, [3, 4]);
  const forecast = (s.history || []).slice(-3); while (forecast.length < 3) forecast.unshift(null);
  const echoRoute = [s.echo, ...forecast].filter(cell => cell != null).map(point);
  if (echoRoute.length > 1 && !game.reviewing) r.line(echoRoute, '#65b9bfaa', 1.4, [3, 5]);
  if (forecast[0] != null && !game.reviewing) {
    const [x, y] = point(forecast[0]), c = r.ctx;
    ellipse(r, x, y, hw * .49, hh * .49, '#83d8de24');
    c.beginPath(); c.ellipse(x, y, hw * .49, hh * .49, 0, 0, Math.PI * 2); c.strokeStyle = '#77d2d9'; c.lineWidth = 1.6; c.stroke();
    r.icon('echo', x - hw * .58, y - hh * .38, Math.max(10, hw * .34), '#69b9c2');
  }
  drawActorTrails(r, game, now, point, hw * 1.7, options);
  [true, false].forEach(ghost => {
    const frame = actorFrame(game, now, point, ghost, options), shared = ghost && s.echo === s.player;
    if (!frame.alpha) return;
    if (shared) frame.x += hw * .28;
    actors.push({ y: frame.y + (ghost ? 2.5 : 3), draw: () => {
      if (!ghost) { ellipse(r, frame.x, frame.y + 2, hw * .46, hh * .28, '#344b3b40'); ellipse(r, frame.x, frame.y + 2, hw * .59, hh * .4, '#f5d89420'); }
      const size = hw * (shared ? .85 : 1.16);
      r.courier(frame.x, frame.y - frame.lift - hw * .38, size, ghost, frame);
    } });
  });
  actors.sort((a, b) => a.y - b.y).forEach(actor => actor.draw());
  drawGuideTargets(r, guide, p, time);
  drawDestination(r, game, time, p, options, enterOffice);
  drawEffects(target, game, now, point, hw * 1.7, options);
  c.restore();
}

function drawBackdrop(r, now, chapter, options = {}) {
  if (options.reducedMotion) now = 0;
  const H = r.H, c = r.ctx;
  const bounds = r.viewport || { x: 0, y: 0, w: 390, h: H };
  const mapX = x => bounds.x + x * bounds.w / 390, spread = bounds.w / 390;
  c.fillStyle = COLOR.sky; c.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  // Canvas gradients extend their end colors beyond these stops, so the safe areas
  // continue the same sky without changing the artwork's position inside the page.
  const sky = c.createLinearGradient(0, 0, 0, H);
  if (sky && typeof sky.addColorStop === 'function') {
    sky.addColorStop(0, '#f6f3e8'); sky.addColorStop(.5, '#e3eee3'); sky.addColorStop(1, '#d8e5d8');
    c.fillStyle = sky; c.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  const drift = Math.sin(now / 15000) * 2;
  glow(r, mapX(310), H * .225, 35, '#fff7d7', .17);
  r.circle(mapX(310), H * .225, 24, '#f6e8bd');
  r.circle(mapX(310) - 7, H * .216, 18, '#f9edcf55');
  // Broad, soft ridge lines recede into the mist; they stay quieter than the board.
  c.beginPath(); c.moveTo(mapX(0), H * .46); c.lineTo(mapX(0), H * .34);
  c.bezierCurveTo(mapX(45 + drift), H * .25, mapX(57), H * .28, mapX(112), H * .37);
  c.bezierCurveTo(mapX(173), H * .4, mapX(207), H * .23, mapX(266), H * .31);
  c.bezierCurveTo(mapX(320), H * .39, mapX(346), H * .27, mapX(390), H * .31);
  c.lineTo(mapX(390), H * .56); c.closePath(); c.fillStyle = '#d0dfd1'; c.fill();
  c.beginPath(); c.moveTo(mapX(0), H * .59); c.lineTo(mapX(0), H * .42);
  c.bezierCurveTo(mapX(59), H * .33, mapX(88), H * .47, mapX(157), H * .45);
  c.bezierCurveTo(mapX(205), H * .42, mapX(260), H * .34, mapX(310), H * .43);
  c.bezierCurveTo(mapX(343), H * .48, mapX(359), H * .4, mapX(390), H * .39);
  c.lineTo(mapX(390), H * .64); c.closePath(); c.fillStyle = '#c1d6c5'; c.fill();
  ellipse(r, mapX(167 + drift), H * .49, 247 * spread, 31, '#e7efe5b8');
  ellipse(r, mapX(272 - drift), H * .58, 216 * spread, 35, '#e0ebdfad');
  [-20, 403].forEach((x, i) => tree(r, mapX(x), H * .69, 96 + i * 19, now, true));
  ellipse(r, mapX(195), H * .77, 235 * spread, 53, '#e2ecdf55');
  drawAtmosphere(r, now, { x: bounds.x, y: 64, w: bounds.w, h: H - 130 }, options);
}

function drawVignette(r, now, rect, options = {}) {
  if (options.reducedMotion) now = 0;
  const c = r.ctx, scale = Math.min(rect.w / 350, rect.h / 285), x = rect.x + rect.w / 2, y = rect.y + rect.h * .53;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip(); c.translate(x, y); c.scale(scale, scale);
  drawHomeArchitecture(r, now);
  r.line([[-28, 36], [-9, 45], [11, 35], [26, 27]], '#5a9f9c99', 1.3, [2, 5]);
  const bob = Math.sin(now / 1350) * .8;
  r.courier(-31, 25 + bob, 25, true, { alpha: .66, stride: 0, facing: 1 });
  r.courier(4, 29 + Math.sin(now / 1600) * .35, 33, false, { alpha: 1, stride: Math.sin(now / 1400) * .05, facing: 1 });
  floatingMail(r, -100, -53, 19, now, 5, false);
  floatingMail(r, -69, -83, 13, now, 2, true);
  // Two distant swifts add life without competing with the architectural silhouette.
  [-1, 1].forEach((side, i) => {
    const sx = side * 120, sy = -105 + i * 16, flap = Math.sin(now / 650 + i) * 1.1;
    r.line([[sx - 5, sy - 2 - flap], [sx, sy], [sx + 5, sy - 3 + flap]], '#7d9f945b', 1.15);
  });
  c.restore();
}

module.exports = { drawBoard, drawBackdrop, drawVignette };
