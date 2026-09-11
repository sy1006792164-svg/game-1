'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN } = require('../src/levels');
const { neighbor, replay } = require('../src/engine');
const { MOVE_MS } = require('../src/motion');
const { captureBoardTap } = require('../src/board-input');
const { createProjection } = require('../src/board-projection');
const { createPlatform } = require('../src/platform');

const mainPath = path.join(__dirname, '../src/main.js');
const actualRequire = createRequire(mainPath);
const source = fs.readFileSync(mainPath, 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
const factory = vm.runInThisContext('(function(require, module, exports) {\n' + source + '\n})', { filename: mainPath });

function harness(metrics) {
  let now = 1000;
  const noop = () => {}, data = new Map(), callbacks = {};
  const context = new Proxy({ globalAlpha: 1 }, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 7 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
    return noop;
  } });
  const platform = {
    kind: 'wechat', canvas: { getContext: () => context }, wx: {},
    storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop, vibrate: noop,
    onResize: fn => { callbacks.resize = fn; }, onPointer: noop, onKey: noop, onHide: noop, onShow: noop,
    onAudioInterruptionBegin: noop, onAudioInterruptionEnd: noop,
  };
  const module = { exports: {} };
  factory(specifier => {
    if (specifier === './sound') return { createSound: () => ({ play: noop, stop: noop, release: noop, ambience: noop, unlock: noop, suspend: noop, resume: noop }) };
    if (specifier === './play-guide') return { ...actualRequire(specifier), autoGuide: () => false };
    if (specifier === './mechanic-guide') return { ...actualRequire(specifier), createMechanicGuide: () => null };
    return actualRequire(specifier);
  }, module, module.exports);
  const game = new module.exports.Game(platform);
  for (let frame = 0; game.page !== 'home' && frame < 200; frame++) { now += 100; game.loop(); }
  const draw = (ms = 0) => { now += ms; game.renderer.draw(game, now, metrics); };
  const devicePoint = cell => {
    const r = game.renderer, [x, y] = r.boardProjection.point(cell);
    return [x * r.scale + r.ox, y * r.scale + r.oy];
  };
  return { game, draw, devicePoint, callbacks,
    start(level) { game.start(level, 'campaign'); game.camera.enteredAt = -Infinity; draw(1000); },
    advance(ms) { now += ms; game.loop(); },
    destroy() { game.ads.destroy(); game.sound.release(); },
  };
}

const screens = [
  { width: 320, height: 568, pixelRatio: 1, safeTop: 72, safeBottom: 0 },
  { width: 320, height: 568, pixelRatio: 2, safeTop: 72, safeBottom: 0 },
  { width: 360, height: 640, pixelRatio: 3, safeTop: 76, safeBottom: 24 },
  { width: 375, height: 667, pixelRatio: 2, safeTop: 72, safeBottom: 0 },
  { width: 390, height: 844, pixelRatio: 3, safeTop: 96, safeBottom: 34 },
];

test('small-screen finger jitter selects the pressed legal tile across redraws at every density', t => {
  for (const metrics of screens) for (const id of [1, 121, 301, 601, 999]) for (const zoom of [.65, 1, 1.4]) {
    const h = harness(metrics); t.after(() => h.destroy());
    h.start(CAMPAIGN[id - 1]); h.game.camera.zoomAt(zoom); h.draw();
    const action = h.game.level.solution[0];
    const cell = neighbor(h.game.level, h.game.state.player, action, h.game.state);
    assert.notEqual(cell, null);
    const [x, y] = h.devicePoint(cell), beforePan = [h.game.camera.panX, h.game.camera.panY];
    h.game.pointerEvent(x, y, 'start');
    h.game.pointerEvent(x + 7, y + 2, 'move');
    h.draw(60);
    h.game.pointerEvent(x + 7, y + 2, 'end');
    assert.deepEqual(h.game.actions, [action], `${metrics.width}x${metrics.height}@${metrics.pixelRatio} level ${id}, zoom ${zoom}`);
    assert.deepEqual(h.game.state, replay(h.game.level, [action]));
    assert.deepEqual([h.game.camera.panX, h.game.camera.panY], beforePan);
  }
});

test('touch release beyond a small tile edge keeps the original target instead of requiring both exact diamonds', t => {
  const h = harness(screens[0]); t.after(() => h.destroy()); h.start(CAMPAIGN[300]);
  const action = h.game.level.solution[0], cell = neighbor(h.game.level, h.game.state.player, action, h.game.state);
  const [cx, cy] = h.devicePoint(cell), r = h.game.renderer;
  const x = cx + r.boardProjection.halfW * r.scale * .72;
  h.game.pointerEvent(x, cy, 'start');
  h.game.pointerEvent(x + 4, cy + 1, 'end');
  assert.deepEqual(h.game.actions, [action]);
});

test('real scene drags never spend a turn even if the finger returns to its pressed tile', t => {
  for (const metrics of screens) for (const zoom of [1, 1.4]) {
    const h = harness(metrics); t.after(() => h.destroy()); h.start(CAMPAIGN[120]);
    h.game.camera.zoomAt(zoom); h.draw();
    const cell = neighbor(h.game.level, h.game.state.player, h.game.level.solution[0], h.game.state);
    const [x, y] = h.devicePoint(cell);
    h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x + 24, y + 1, 'move');
    assert.equal(h.game.pointer.dragging, true);
    if (zoom > 1) assert.notEqual(h.game.camera.panX, 0);
    h.game.pointerEvent(x, y, 'end');
    assert.deepEqual(h.game.actions, []);
  }
});

test('jitter on a wall or distant tile cannot walk toward it or consume a wait', t => {
  const h = harness(screens[0]); t.after(() => h.destroy()); h.start(CAMPAIGN[120]);
  const geometry = h.game.renderer.boardGeometry, level = h.game.level;
  for (const cell of [level.walls.find(geometry.projection.visible), level.exit]) {
    const [x, y] = h.devicePoint(cell);
    h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x + 3, y + 1, 'end');
    assert.deepEqual(h.game.actions, []);
  }
});

test('repeated jittery destination presses during movement cannot queue an accidental wait', t => {
  const h = harness(screens[0]); t.after(() => h.destroy()); h.start(CAMPAIGN[0]);
  const [x, y] = h.devicePoint(h.game.state.player + 1);
  const tap = () => { h.game.pointerEvent(x, y, 'start'); h.game.pointerEvent(x + 3, y + 1, 'end'); };
  tap(); h.draw(40); tap(); h.advance(MOVE_MS);
  assert.deepEqual(h.game.actions, ['right']);
  assert.equal(h.game.pendingAction, null);
});

test('short presses on moving mail keep its cell when the prop bobs out from under the release', t => {
  const h = harness(screens[0]); t.after(() => h.destroy()); h.start(CAMPAIGN[0]);
  h.game.act('right'); h.advance(MOVE_MS); h.game.act('right'); h.draw(1000);
  const r = h.game.renderer, cell = h.game.level.letters[0];
  const prop = r.hits.filter(hit => hit.action.boardCell === cell).at(-1);
  assert.ok(prop);
  const x = (prop.x + prop.w / 2) * r.scale + r.ox, y = (prop.y + prop.h / 2) * r.scale + r.oy;
  h.game.pointerEvent(x, y, 'start'); h.draw(400); h.game.pointerEvent(x, y - 3, 'end');
  assert.equal(h.game.state.player, cell);
  assert.deepEqual(h.game.actions, ['right', 'right', 'right']);
});

test('a buffered turn that completes while a finger is held cancels the stale target', t => {
  const h = harness(screens[0]); t.after(() => h.destroy()); h.start(CAMPAIGN[0]);
  h.game.act('right'); h.game.act('right'); h.draw(30);
  const [x, y] = h.devicePoint(h.game.state.player + 1);
  h.game.pointerEvent(x, y, 'start'); h.advance(MOVE_MS);
  h.game.pointerEvent(x + 2, y + 1, 'end'); h.advance(MOVE_MS);
  assert.deepEqual(h.game.actions, ['right', 'right'], 'the held move destination must not become a wait after arrival');
});

test('board edge tolerance is measured in screen pixels and never replaces exact walls, props or UI', () => {
  const level = { width: 3, height: 3, walls: [] }, rect = { x: 0, y: 0, w: 300, h: 400 };
  const p = createProjection(level, rect, { scale: 1, panX: 0, panY: 0 });
  for (const scale of [.6, 1, 2]) {
    const [x, y] = p.point(5), action = Object.assign(() => {}, { boardCell: 5 });
    const floor = { x: x - p.halfW, y: y - p.halfH, w: p.halfW * 2, h: p.halfH * 2,
      contains: (hx, hy) => p.contains(5, hx, hy), action };
    const renderer = { hits: [floor], scale, boardRect: rect,
      boardGeometry: { adjacent: new Set([5]), screenProjection: p } };
    const edge = { x: x + p.halfW + 6 / scale, y };
    assert.equal(captureBoardTap(renderer, edge), floor, 'six window pixels outside a legal floor still selects it');
    assert.equal(captureBoardTap(renderer, { x: x + p.halfW + 10 / scale, y }), null);
    for (const cell of [0, 4]) {
      const exact = { x: edge.x - 1, y: edge.y - 1, w: 2, h: 2, action: Object.assign(() => {}, { boardCell: cell }) };
      renderer.hits.push(exact);
      assert.equal(captureBoardTap(renderer, edge), exact, 'exact cells cannot snap to an adjacent move');
      renderer.hits.pop();
    }
    renderer.hits.push({ x: edge.x - 1, y: edge.y - 1, w: 2, h: 2, action: () => {} });
    assert.equal(captureBoardTap(renderer, edge), null, 'guide and UI controls keep their own input');
    renderer.hits.pop(); renderer.boardGeometry.adjacent.clear();
    assert.equal(captureBoardTap(renderer, edge), null, 'only current engine-approved neighbors can attract a near miss');
  }
});

test('native WeChat touch coordinates keep the small-screen target and multi-touch cannot change the camera or tap', t => {
  const h = harness(screens[2]); t.after(() => h.destroy()); h.start(CAMPAIGN[0]);
  const handlers = {}, metrics = screens[2];
  const api = {
    createCanvas: () => h.game.renderer.canvas,
    getWindowInfo: () => ({ windowWidth: metrics.width, windowHeight: metrics.height, pixelRatio: metrics.pixelRatio,
      safeArea: { top: 24, bottom: metrics.height - metrics.safeBottom } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: metrics.safeTop - 8 }),
    getDeviceInfo: () => ({ platform: 'android' }),
  };
  for (const name of ['Start', 'Move', 'End', 'Cancel']) api['onTouch' + name] = fn => { handlers[name] = fn; };
  const native = createPlatform({ wx: api }), resized = native.resize();
  assert.equal(resized.pixelRatio, metrics.pixelRatio, 'native pixel density does not change touch coordinates');
  assert.equal(resized.safeTop, metrics.safeTop);
  native.onPointer((x, y, type) => h.game.pointerEvent(x, y, type), (...args) => h.game.zoomScene(...args));
  const [x, y] = h.devicePoint(h.game.state.player + 1);
  const first = { identifier: 1, clientX: x, clientY: y }, shifted = { ...first, clientX: x + 7, clientY: y + 2 };
  handlers.Start({ touches: [first], changedTouches: [first] });
  handlers.Move({ touches: [shifted], changedTouches: [shifted] });
  handlers.End({ touches: [], changedTouches: [shifted] });
  assert.deepEqual(h.game.actions, ['right']);
  h.advance(MOVE_MS); h.draw();
  const next = h.devicePoint(h.game.state.player + 1), a = { identifier: 1, clientX: next[0], clientY: next[1] };
  const b = { identifier: 2, clientX: next[0] - 40, clientY: next[1] };
  handlers.Start({ touches: [a], changedTouches: [a] });
  handlers.Start({ touches: [a, b], changedTouches: [b] });
  assert.equal(h.game.pointer, null);
  handlers.Move({ touches: [a, { ...b, clientX: b.clientX - 20 }], changedTouches: [b] });
  handlers.End({ touches: [a], changedTouches: [b] });
  handlers.End({ touches: [], changedTouches: [a] });
  assert.deepEqual(h.game.actions, ['right'], 'the remaining finger cannot emit a tile tap');
  assert.equal(h.game.camera.zoom, 1);
  assert.equal(h.game.camera.panX, 0);
  assert.equal(h.game.camera.panY, 0);
  handlers.Start({ touches: [a], changedTouches: [a] });
  handlers.End({ touches: [], changedTouches: [a] });
  assert.deepEqual(h.game.actions, ['right', 'right'], 'single-finger play resumes after all fingers lift');
});
