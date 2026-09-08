'use strict';

const { actorFrame, drawEffects } = require('./motion');
const { insideRect } = require('./board-projection');
const { getBoardGeometry } = require('./board-geometry');
const { treeTop, officeTop, courierTop } = require('./overhead-props');
const { drawIslandSurface } = require('./island-surface');

const COLOR = {
  night: '#102d32', forest: '#173e40', fog: '#285557', teal: '#77cdd0',
  stone: '#f0e4c3', stoneLight: '#fff0cc', moss: '#658d75', gold: '#efb45d',
  rock: '#38605b', rockDark: '#254a48', ink: '#24483e', cream: '#fff1ce'
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

function tree(r, x, y, size, now, distant) {
  const c = r.ctx, sway = Math.sin(now / 2100 + x) * size * .022;
  ellipse(r, x + size * .1, y + 1, size * .36, size * .11, '#102c302b');
  polygon(r, [[x - size * .055, y], [x - size * .025, y - size * .7], [x + size * .05, y - size * .7], [x + size * .08, y]], distant ? '#183b3d' : '#576b52');
  const tones = distant ? ['#214849', '#275052', '#2a5353'] : ['#3b6c59', '#51836a', '#75a47a'];
  for (let i = 0; i < 3; i++) {
    const width = size * (.43 - i * .07), bottom = y - size * (.22 + i * .21);
    polygon(r, [[x - width + sway, bottom], [x + sway, bottom - size * .48], [x + width + sway, bottom], [x + sway, bottom + size * .09]], tones[i]);
    if (!distant) r.line([[x + sway, bottom - size * .38], [x + width * .65 + sway, bottom - size * .02]], '#a6c09155', .75);
  }
}

function grass(r, x, y, size, now, color) {
  const sway = Math.sin(now / 1300 + x) * 1.5;
  r.line([[x - size * .6, y - size * .45], [x, y + 1], [x - size * .12 + sway, y - size]], color || '#91b68a', 1.4);
  r.line([[x, y + 1], [x + size * .6 + sway, y - size * .6]], color || '#91b68a', 1.2);
}

function postOffice(r, x, y, size, now, ready) {
  const c = r.ctx; c.save(); c.translate(x, y); c.scale(size / 44, size / 44);
  ellipse(r, 2, 2, 23, 7, '#143d3445');
  if (ready) glow(r, 0, -11, 20, COLOR.gold, .065 + Math.sin(now / 550) * .012);
  polygon(r, [[-18, -26], [8, -22], [8, 2], [-18, -4]], '#dfcda6');
  polygon(r, [[8, -22], [22, -30], [22, -6], [8, 2]], '#adba94');
  polygon(r, [[-23, -27], [-4, -43], [27, -36], [8, -19]], '#466f61');
  polygon(r, [[-23, -27], [8, -19], [8, -15], [-23, -23]], '#2b574e');
  polygon(r, [[8, -19], [27, -36], [27, -32], [8, -15]], '#264e49');
  r.line([[-4, -42], [24, -35]], '#85a48b', 1.4);
  r.round(-12, -18, 10, 16, 3, '#426b5a');
  r.round(-10, -16, 6, 8, 2, ready ? '#ffe7a4' : '#a9c8b1');
  r.circle(-4, -7, 1, '#e6bd77');
  polygon(r, [[12, -18], [18, -21], [18, -13], [12, -10]], ready ? '#ffe0a0' : '#cbd2ae');
  r.line([[15, -19], [15, -12]], '#779779', .75);
  r.round(-14, -30, 20, 8, 2, COLOR.cream);
  r.icon('letter', -4, -26, 8, '#bf7f47');
  polygon(r, [[8, 2], [-18, -4], [-21, -1], [6, 6], [13, 2]], '#bfbe99');
  r.line([[22, -6], [22, -45], [34, -44]], '#385e51', 1.7);
  const flap = Math.sin(now / 370) * 2;
  polygon(r, [[23, -44], [34, -44 + flap], [32, -37 + flap], [23, -38]], COLOR.gold);
  r.icon('letter', 28, -41 + flap / 2, 5, '#fff3c9');
  c.restore();
}

function lantern(r, x, y, size, now) {
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
}

function diamond(r, x, y, hw, hh, fill, stroke, height, projection) {
  const z = height || 0;
  if (projection) {
    const corners = [[0, -hh], [hw, 0], [0, hh], [-hw, 0]].map(offset => {
      const [dx, dy] = projection.floor(...offset); return [x + dx, y + dy];
    });
    if (z) corners.forEach((a, i) => {
      const b = corners[(i + 1) % 4];
      if (b[0] < a[0]) polygon(r, [a, b, [b[0], b[1] - z], [a[0], a[1] - z]], '#3e654e');
    });
    polygon(r, corners.map(([cx, cy]) => [cx, cy - z]), fill, stroke);
    return;
  }
  if (z) {
    polygon(r, [[x - hw, y], [x, y + hh], [x, y + hh - z], [x - hw, y - z]], '#537b59');
    polygon(r, [[x, y + hh], [x + hw, y], [x + hw, y - z], [x, y + hh - z]], '#3e654e');
  }
  polygon(r, [[x, y - hh - z], [x + hw, y - z], [x, y + hh - z], [x - hw, y - z]], fill, stroke);
}

function island(r, corners, depth, now) {
  const [top, right, front, left] = corners;
  const bottom = [front[0], front[1] + depth];
  ellipse(r, front[0], front[1] + depth + 11, (right[0] - left[0]) * .34, 11, '#061f2824');
  polygon(r, [left, front, bottom, [left[0] + 5, left[1] + depth * .6]], '#3e6258');
  polygon(r, [front, right, [right[0] - 6, right[1] + depth * .6], bottom], '#2a504c');
  polygon(r, [left, [front[0] - 28, front[1] + 5], [front[0] - 62, front[1] + depth * .7], [left[0] + 5, left[1] + depth * .6]], '#496d5c');
  polygon(r, [[front[0] - 28, front[1] + 5], front, bottom, [front[0] - 62, front[1] + depth * .7]], '#31554e');
  polygon(r, [[front[0] + 62, front[1] - 24], [front[0] + 33, front[1] + depth * .54], bottom, front], '#365d54');
  r.line([[left[0] + 4, left[1] + 7], [front[0], front[1] + 7], [right[0] - 4, right[1] + 7]], '#88a07760', 1.3);
  polygon(r, corners, '#597c63');
  for (let i = 1; i < 7; i++) {
    const t = i / 7, edge = i % 2 ? left : right;
    const x = edge[0] + (front[0] - edge[0]) * t, y = edge[1] + (front[1] - edge[1]) * t;
    const drop = 8 + i % 3 * 4;
    r.line([[x, y + 3], [x + Math.sin(now / 2200 + i) * 2, y + drop], [x + 2, y + drop + 4]], '#759d78', 1.6);
    r.icon('leaf', x + 2, y + drop - 2, 7, '#8ba779');
  }
  polygon(r, [[bottom[0] - 7, bottom[1] - 1], [bottom[0] + 1, bottom[1] + 10], [bottom[0] + 6, bottom[1] - 3]], '#648f82');
}

function groundDetail(r, game, now, cell, p) {
  const l = game.level, s = game.state, [x, y] = p.point(cell), hw = p.halfW, hh = p.halfH;
  const bridge = (l.bridges || []).includes(cell), intact = (s.bridges || []).includes(cell);
  if (bridge) {
    if (intact) {
      diamond(r, x, y - .7, hw - 2, hh - 1.5, '#eac798', '#f4dbaf', 0, p);
      for (let i = -1; i <= 1; i++) floorLine(r, p, x, y, [[i * hw * .38 - hw * .31, i * hh * .38], [i * hw * .38 + hw * .31, i * hh * .38 - hh * .65]], '#b99769', 1.2);
    } else {
      diamond(r, x, y, hw - 1.5, hh - 1, '#244947', '#537869', 0, p);
      floorLine(r, p, x, y, [[-hw * .7, -1], [-hw * .36, 3], [-hw * .2, -3]], '#b6a27b', 2);
      floorLine(r, p, x, y, [[hw * .7, -1], [hw * .4, -4], [hw * .2, 1]], '#b6a27b', 2);
    }
  }
  if (l.winds && l.winds[cell]) {
    diamond(r, x, y, hw - 2, hh - 1.5, '#c6dab6', '#e0e8c4', 0, p);
    const [vx, vy] = p.vector(l.winds[cell]);
    const ax = vx * .4, ay = vy * .4;
    r.line([[x - ax, y - ay], [x + ax, y + ay]], '#668973', 2);
    r.line([[x + ax - vx * .33 + vy * .22, y + ay - vy * .33 - vx * .22], [x + ax, y + ay], [x + ax - vx * .33 - vy * .22, y + ay - vy * .33 + vx * .22]], '#668973', 1.5);
  }
}

function floorLine(r, p, x, y, offsets, color, width) {
  r.line(offsets.map(offset => { const [dx, dy] = p.floor(...offset); return [x + dx, y + dy]; }), color, width);
}

function viewProp(r, blend, side, top) {
  const c = r.ctx;
  if (blend < 1) { c.save(); c.globalAlpha *= 1 - blend; side(); c.restore(); }
  if (blend > 0) { c.save(); c.globalAlpha *= blend; top(); c.restore(); }
}

function floatingMail(r, x, y, size, now, cell, seal) {
  const c = r.ctx, bob = Math.sin(now / 670 + cell * .7) * 2.2;
  ellipse(r, x, y + 1, size * .38, size * .12, seal ? '#659d9a38' : '#ae824530');
  glow(r, x, y - 10, size * .52, seal ? COLOR.teal : COLOR.gold, .055);
  c.save(); c.translate(x, y - size * .5 + bob); c.rotate(Math.sin(now / 1500 + cell) * .09);
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
}

function drawBoard(r, game, now, rect) {
  const l = game.level, s = game.state, view = game.camera.frame(now);
  const overheadBlend = Math.max(0, Math.min(1, (view.tilt - .82) / .18)), overhead = overheadBlend > .5;
  const elevation = Math.sqrt(1 - view.tilt * view.tilt) / Math.sqrt(1 - .62 * .62);
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
  glow(r, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * .32, '#6aaba0', .018);
  drawIslandSurface(r, corners, 26 * elevation, now);
  const { walls, adjacent, ordered } = geometry;
  const reach = Math.max(Math.abs(Math.cos(view.rotation)), Math.abs(Math.sin(view.rotation)));
  const reachX = hw * reach, reachY = hh * reach;
  const actors = [];
  for (const cell of ordered) {
    const [x, y] = point(cell), wall = walls.has(cell);
    diamond(r, x, y, hw - .8, hh - .7, wall ? (cell % 3 ? '#315e50' : '#3b6956') : cell % 3 ? COLOR.stone : COLOR.stoneLight, wall ? '#507d60' : '#fff4d8', wall ? 4 * elevation : 0, p);
    if (wall) {
      if (cell % 3 === 0) actors.push({ y: y + 2, draw: () => {
        polygon(r, [[x - 8, y - 3], [x - 5, y - 10], [x + 2, y - 12], [x + 8, y - 5], [x + 4, y]], '#83a082');
        r.line([[x - 5, y - 10], [x + 2, y - 12], [x + 6, y - 7]], '#b1c296', 1);
        grass(r, x - 8, y - 1, 5, now);
      } });
      // Keep trees on their original cells as the camera moves around them.
      const onRim = Math.floor(cell / l.width) === p.bounds.minRow || cell % l.width === p.bounds.minCol;
      if (onRim && cell % 2 === 0) actors.push({ y, draw: () => {
        c.save(); if (!p.rear(cell)) c.globalAlpha *= .45;
        viewProp(r, overheadBlend, () => tree(r, x, y - 3, hw * (1.05 + cell % 3 * .11), now, false), () => treeTop(r, x, y, hw * 1.15, now));
        c.restore();
      } });
      else if (cell % 2) actors.push({ y, draw: () => grass(r, x + 5, y - 4, 6, now, '#b1c293') });
    } else {
      groundDetail(r, game, now, cell, p);
      if (cell === l.exit) {
        diamond(r, x, y, hw - 2, hh - 1.5, '#adc6a0', '#d1dfb2', 0, p);
        const ready = !s.letters.length && !s.seals.length;
        actors.push({ y: y + 2, draw: () => viewProp(r, overheadBlend,
          () => postOffice(r, x, y - 2, hw * 1.2, now, ready), () => officeTop(r, x, y, hw * 1.2, now, ready, view.rotation)) });
      }
      if (!game.reviewing && s.status === 'playing' && adjacent.has(cell)) {
        diamond(r, x, y, hw - 3, hh - 2, '#f8d68877', null, 0, p);
        floorLine(r, p, x, y, [[0, -hh + 2], [hw - 3, 0], [0, hh - 2], [-hw + 3, 0], [0, -hh + 2]], '#edb457', 1.7);
        ellipse(r, x, y + hh * .43, hw * .15, hh * .17, '#e5ae52');
      }
      if (s.lights.includes(cell)) actors.push({ y, draw: () => lantern(r, x, y - 1, hw * .7, now) });
      if (s.letters.includes(cell)) actors.push({ y: y + 1, draw: () => floatingMail(r, x, y, hw * .76, now, cell, false) });
      if (s.seals.includes(cell)) actors.push({ y: y + 1, draw: () => floatingMail(r, x, y, hw * .7, now, cell, true) });
    }
    r.hit(x - reachX, y - reachY, reachX * 2, reachY * 2, () => {
      const player = game.state.player, dx = cell % l.width - player % l.width, dy = Math.floor(cell / l.width) - Math.floor(player / l.width);
      if (!dx && !dy) game.act('wait');
      else if (Math.abs(dx) + Math.abs(dy) === 1) game.act(dx ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
      else if ((l.bridges || []).includes(cell) && !game.state.bridges.includes(cell)) game.toast('纸桥已碎，这里过不去了');
      else game.toast('点相邻格移动，点送信员原地等一拍');
    }, (hx, hy) => p.contains(cell, hx, hy));
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
  [true, false].forEach(ghost => {
    const frame = actorFrame(game, now, point, ghost), shared = ghost && s.echo === s.player;
    if (!frame.alpha) return;
    if (shared) frame.x += hw * .28;
    actors.push({ y: frame.y + (ghost ? 2.5 : 3), draw: () => {
      if (!ghost) { ellipse(r, frame.x, frame.y + 2, hw * .46, hh * .28, '#344b3b40'); ellipse(r, frame.x, frame.y + 2, hw * .59, hh * .4, '#f5d89420'); }
      const actorY = overhead ? frame.y : frame.y - frame.lift - hw * .38, size = hw * (shared ? .85 : 1.16);
      viewProp(r, overheadBlend, () => r.courier(frame.x, frame.y - frame.lift - hw * .38, size, ghost, frame),
        () => courierTop(r, frame.x, frame.y, size, ghost, frame));
      if (!ghost && !game.reviewing && s.status === 'playing') {
        const rx = size * .34, ry = size * (overhead ? .34 : .575), centerY = overhead ? actorY : actorY - size * .175;
        r.hit(frame.x - rx, centerY - ry, rx * 2, ry * 2, () => game.act('wait'), (hx, hy) =>
          Math.pow((hx - frame.x) / rx, 2) + Math.pow((hy - centerY) / ry, 2) <= 1);
      }
    } });
  });
  actors.sort((a, b) => a.y - b.y).forEach(actor => actor.draw());
  drawEffects(target, game, now, point, hw * 1.7);
  c.restore();
}

function drawBackdrop(r, now, chapter) {
  const H = r.H, c = r.ctx;
  c.fillStyle = COLOR.night; c.fillRect(0, 0, 390, H);
  glow(r, 296, H * .3, 152, chapter > 2 ? '#336a70' : '#366d64', .09);
  glow(r, 67, H * .66, 120, '#456855', .055);
  const drift = Math.sin(now / 10000) * 3;
  polygon(r, [[0, H * .45], [0, H * .26], [46 + drift, H * .19], [95, H * .31], [160, H * .2], [216, H * .3], [289, H * .15], [390, H * .31], [390, H * .51]], '#1a4042');
  polygon(r, [[0, H * .56], [0, H * .37], [54, H * .3], [104, H * .41], [199, H * .29], [262, H * .4], [339, H * .27], [390, H * .33], [390, H * .61]], '#1e4747');
  ellipse(r, 195 + drift, H * .48, 227, 39, '#84b3a208');
  [-12, 15, 378, 410].forEach((x, i) => tree(r, x, H * (.64 + i % 2 * .11), 132 + i % 3 * 24, now, true));
  for (let i = 0; i < 22; i++) {
    const x = (i * 83 + 17 + Math.sin(now / 6200 + i) * 9) % 390;
    const y = (i * 127 + 53 - now / (110 + i * 3)) % H;
    c.save(); c.globalAlpha = .12 + (Math.sin(now / 1600 + i * 1.7) + 1) * .17;
    r.circle(x, (y + H) % H, i % 5 ? .9 : 1.5, i % 3 ? '#b6d2b8' : '#edc77d'); c.restore();
  }
  r.line([[0, H * .78], [70, H * .76], [174, H * .79], [265, H * .75], [390, H * .77]], '#7daf9c09', 16);
}

function drawVignette(r, now, rect) {
  const c = r.ctx, scale = Math.min(rect.w / 350, rect.h / 250), x = rect.x + rect.w / 2, y = rect.y + rect.h * .38;
  c.save(); c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip(); c.translate(x, y); c.scale(scale, scale);
  glow(r, 25, -18, 82, COLOR.gold, .035);
  island(r, [[0, -43], [151, 30], [3, 101], [-150, 27]], 31, now);
  polygon(r, [[0, -43], [151, 30], [3, 101], [-150, 27]], '#6e9476');
  polygon(r, [[-104, 13], [-18, -29], [113, 34], [25, 76]], '#bad0a1');
  [[-79, 19], [-44, 36], [-9, 52], [26, 35], [61, 17]].forEach(([sx, sy], i) => diamond(r, sx, sy, 24, 12, i % 2 ? '#e8dcc0' : '#f0e5c9', '#fff0d0', 3));
  r.line([[-79, 13], [-44, 30], [-9, 46], [26, 29], [61, 11]], '#699996', 1.6, [3, 5]);
  tree(r, -105, -3, 55, now, false); tree(r, -61, -17, 45, now + 600, false);
  tree(r, 113, 31, 57, now + 300, false); tree(r, 133, 38, 38, now + 800, false);
  postOffice(r, 48, 8, 77, now, true);
  lantern(r, 82, 32, 32, now);
  const bob = Math.sin(now / 950) * 1.5;
  r.courier(-49, 19 + bob, 31, true, { alpha: .72, stride: 0, facing: 1 });
  r.courier(0, 30 + Math.sin(now / 1200) * .6, 43, false, { alpha: 1, stride: Math.sin(now / 1100) * .08, facing: 1 });
  [[-112, 39, 10], [-87, 59, 8], [46, 72, 9], [74, 57, 8], [-18, 77, 7]].forEach(([sx, sy, size]) => grass(r, sx, sy, size, now));
  floatingMail(r, -88, -53, 28, now, 5, false); floatingMail(r, -24, -71, 17, now, 2, true);
  for (let i = 0; i < 8; i++) {
    const phase = now / 2600 + i * .8, sx = Math.sin(phase) * 142, sy = Math.cos(phase * .7 + i) * 48 + 12;
    glow(r, sx, sy, 2, i % 2 ? COLOR.gold : COLOR.teal, .08);
    r.circle(sx, sy, .9, '#e5ddb0');
  }
  c.restore();
}

module.exports = { drawBoard, drawBackdrop, drawVignette };
