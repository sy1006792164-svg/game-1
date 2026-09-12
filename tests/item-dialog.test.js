'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Renderer } = require('../src/renderer');
const { drawModal } = require('../src/modal-view');
const { createState } = require('../src/engine');
const { deliveryResultLines } = require('../src/delivery-result');
const { SUPPLY_ENERGY } = require('../src/supply-rules');

// Load the real dialog-producing method without starting the native game loop.
const mainPath = path.join(__dirname, '../src/main.js');
const source = fs.readFileSync(mainPath, 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
const factory = vm.runInThisContext('(function(require, module, exports) {\n' + source + '\n})', { filename: mainPath });
const loaded = { exports: {} };
factory(createRequire(mainPath), loaded, loaded.exports);

function dialogHarness(metrics, kind, configured) {
  const noop = () => {}, stack = [], canvasState = { globalAlpha: 1, font: '13px sans-serif' };
  const methods = {
    save: () => stack.push({ ...canvasState }), restore: () => Object.assign(canvasState, stack.pop()),
    measureText(text) {
      const size = Number(canvasState.font.match(/([\d.]+)px/)[1]);
      return { width: [...String(text)].reduce((sum, char) => sum + size * (char.charCodeAt(0) > 255 ? 1 : .56), 0) };
    },
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop })
  };
  const ctx = new Proxy(canvasState, { get(target, key) { return key in target ? target[key] : methods[key] || noop; } });
  const r = new Renderer({ getContext: () => ctx }), boxes = [];
  let bounds = null, drawingDialog = false;
  const originalText = r.text.bind(r);
  r.text = (value, x, y, size, color, align, weight) => {
    if (drawingDialog) {
      r.font(size, weight);
      const w = ctx.measureText(value).width;
      boxes.push({ value: String(value), x: x - (align === 'center' ? w / 2 : align === 'right' ? w : 0), y: y - size / 2, w, h: size });
    }
    originalText(value, x, y, size, color, align, weight);
  };
  // The normal Renderer.draw method still computes device scaling, safe areas,
  // modal input ownership and all modal painting; the already-tested board is omitted.
  r.game = noop;
  r.modal = (modal, now, resultAge) => {
    drawingDialog = true; bounds = drawModal(r, modal, now, resultAge); drawingDialog = false;
    return bounds;
  };
  const game = Object.create(loaded.exports.Game.prototype);
  Object.assign(game, { page: 'game', session: 1, busy: false, hidden: false, reviewing: false,
    transitionAt: 0, toastUntil: 0, renderer: r,
    platform: { kind, now: () => 1000, effectsQuality: 'low' },
    ads: { isConfigured: () => kind === 'wechat' && configured, isActive: () => false },
    sound: { suspend: noop, resume: noop },
    store: { getStatus: () => ({ persisted: true }) },
    reducedMotion: () => true, guideStep: () => null, syncMusic: noop, itemRewards: { oil: 0, kite: 0, bridge: 0 } });
  return { game, r, boxes,
    draw() { r.draw(game, 1000, metrics); return bounds; } };
}

const screens = [
  { width: 320, height: 568, safeTop: 72, safeBottom: 0, pixelRatio: 2 },
  { width: 390, height: 844, safeTop: 96, safeBottom: 34, pixelRatio: 3 }
];

function failedRoute(game, held = false) {
  game.level = { id: 20, title: '灯火补给', chapter: 3, width: 5, height: 5,
    start: 12, exit: 24, budget: 30, par: 12, walls: [], letters: [13, 14, 18],
    seals: [17, 19], lights: [], bridges: [], winds: {} };
  game.state = { ...createState(game.level), status: 'failed', energy: 0, turn: 123,
    itemsUsed: 12, revived: true, reviveCount: 23, inventory: { oil: held ? 1 : 0, kite: 0, bridge: 0 } };
  game.actions = []; game.reviveHistory = []; game.moveEvents = [];
}

test('failure dialogs keep six-beat relighting and held-oil actions visible with long route history', () => {
  for (const metrics of screens) for (const kind of ['wechat', 'browser']) for (const held of [false, true]) {
    const h = dialogHarness(metrics, kind, true), game = h.game;
    failedRoute(game, held); game.failure();
    const bounds = h.draw();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.h <= h.r.H, 'failure body fits the safe viewport');
    const relight = game.modal.buttons.find(button => /续灯|已领取灯油/.test(button.text));
    if (kind === 'wechat' || held) {
      assert.ok(relight, 'an owned oil or configured video offers relighting');
      assert.match(relight.text, new RegExp('\\+' + SUPPLY_ENERGY + '\\s*拍'));
      if (held) assert.ok(!/广告|视频/.test(relight.text), 'owned oil does not request another video');
    }
    for (const hit of h.r.hits) assert.ok(hit.y >= 0 && hit.y + hit.h <= h.r.H, 'failure actions remain within the safe area');
    for (const box of h.boxes) assert.ok(box.x >= bounds.x + 20 && box.x + box.w <= bounds.x + bounds.w - 20 &&
      box.y >= bounds.y && box.y + box.h <= bounds.y + bounds.h, 'long failure copy stays on the paper: ' + box.value);
  }
});

test('the video-connection explanation and cancelled relight return fit the smallest safe screen', async () => {
  for (const metrics of screens) {
    const h = dialogHarness(metrics, 'wechat', true), game = h.game;
    failedRoute(game);
    game.ads.showRevive = game.ads.showRewarded = () => Promise.resolve({ rewarded: false, reason: 'cancelled' });
    const request = game.requestRevive();
    const waiting = h.draw();
    assert.ok(waiting.y + waiting.h <= h.r.H, 'the six-beat video explanation remains visible');
    assert.ok(game.modal.lines.some(line => line.includes(String(SUPPLY_ENERGY))), 'the pending video states the actual supply amount');
    await request;
    h.boxes.length = 0;
    const returned = h.draw();
    assert.equal(game.state.energy, 0, 'cancelled viewing never grants beats');
    assert.equal(game.state.inventory.oil, 0, 'cancelled viewing never grants oil');
    assert.ok(returned.y + returned.h <= h.r.H, 'cancelled viewing returns to a usable failure panel');
    assert.ok(h.r.hits.every(hit => hit.y + hit.h <= h.r.H));
  }
});

test('assisted deliveries with relights and a stamp reward keep all result actions on small screens', () => {
  for (const metrics of screens) {
    const h = dialogHarness(metrics, 'wechat', true), game = h.game;
    game.level = { id: 20, chapter: 3, par: 30 };
    game.state = { status: 'won', turn: 67, itemsUsed: 12, revived: true, reviveCount: 7 };
    game.modal = { kind: 'win', title: '信已送达', stars: 1,
      lines: [...deliveryResultLines(game.level, game.state, 1, { stars: 3, bestTurns: 30 }, true), '收到新邮票「山间的问候」'],
      buttons: [{ text: '下一封信', primary: true, action() {} }, { text: '再走一次', textOnly: true, action() {} },
        { text: '看看邮票册', textOnly: true, action() {} }] };
    const bounds = h.draw();
    assert.ok(bounds.y + bounds.h <= h.r.H, 'combined tool and relight details fit the safe viewport');
    assert.equal(h.r.hits.length, 3);
    for (const hit of h.r.hits) assert.ok(hit.y + hit.h <= h.r.H, 'every result action stays visible');
  }
});

test('daily journey is a measured result button with a full target and no overlap on compact screens', () => {
  const resultScreens = [...screens,
    { width: 390, height: 700, safeTop: 0, safeBottom: 0, pixelRatio: 1 },
    { width: 390, height: 844, safeTop: 0, safeBottom: 0, pixelRatio: 1 }];
  for (const metrics of resultScreens) for (const saved of [false, true]) for (const tutorial of [false, true]) {
    const h = dialogHarness(metrics, 'wechat', true), game = h.game;
    game.level = { id: tutorial ? 1 : 20, chapter: tutorial ? 0 : 3, par: 30 };
    game.state = { status: 'won', turn: 2048, itemsUsed: tutorial ? 0 : 2048, revived: true, reviveCount: 340 };
    let opened = 0;
    const lines = deliveryResultLines(game.level, game.state, 1, { stars: 3, bestTurns: 30 }, saved);
    if (tutorial) lines.push('你收信；回声晚 3 次行动，替你收蓝票。', '收齐信和票，再走进邮局就能过关。');
    lines.push('收到新邮票「山间的问候」');
    game.modal = { kind: 'win', title: '信已送达', stars: 1,
      progressLine: '今日邮程 6/6 · 本关今日已记', progressAction: () => { opened++; }, lines,
      buttons: [{ text: '下一封信', primary: true, action() {} }, { text: '再走一次', icon: 'restart', textOnly: true, action() {} },
        { text: '看看邮票册', icon: 'stamp', textOnly: true, action() {} }] };
    const bounds = h.draw(), label = `${metrics.width}x${metrics.height}/${saved}/${tutorial}`;
    const progress = h.r.hits.find(hit => hit.action === game.modal.progressAction);
    assert.ok(progress && progress.h >= 44, label + ': daily journey uses a full touch target');
    assert.ok(bounds.progress, label + ': progress takes up real layout space');
    assert.ok(bounds.y >= 24 && bounds.y + bounds.h <= h.r.H - 24, label + ': panel retains safe insets');
    const lastParagraph = bounds.paragraphs.at(-1);
    const lastTextBottom = bounds.y + lastParagraph.y + (lastParagraph.lines.length - 1) * bounds.lineHeight + 13 / 2;
    assert.ok(progress.y >= lastTextBottom + 8, label + ': journey has breathing room below the body');
    assert.equal(h.r.hits.length, 4, label + ': journey and all three result actions remain reachable');
    assert.ok(h.r.hits.every(hit => hit.y >= bounds.y + 20 && hit.y + hit.h <= bounds.y + bounds.h - 20));
    for (let i = 0; i < h.r.hits.length; i++) for (let j = i + 1; j < h.r.hits.length; j++) {
      const a = h.r.hits[i], b = h.r.hits[j];
      assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), label + ': action targets do not overlap');
    }
    for (let i = 0; i < h.boxes.length; i++) for (let j = i + 1; j < h.boxes.length; j++) {
      const a = h.boxes[i], b = h.boxes[j];
      assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), label + ': result text does not overlap');
    }
    assert.ok(h.boxes.every(box => box.x >= bounds.x + 20 && box.x + box.w <= bounds.x + bounds.w - 20));
    progress.action(); assert.equal(opened, 1);
  }
});

test('actual supply dialogs keep every paragraph and action inside both phone safe areas', () => {
  for (const metrics of screens) for (const kind of ['wechat', 'browser']) {
    for (const scenario of ['video', 'held', 'no-target', 'used', 'locked', 'unconfigured']) for (const id of ['oil', 'kite', 'bridge', 'echo']) {
      const h = dialogHarness(metrics, kind, scenario !== 'unconfigured'), game = h.game;
      game.level = { id: scenario === 'locked' ? 3 : id === 'echo' ? 31 : 20, title: '道具小屏', chapter: 0,
        width: 5, height: 5, start: 12, exit: 24, budget: 20, par: 12,
        walls: [], letters: [13], seals: [17], lights: [], bridges: [11], winds: {} };
      game.state = createState(game.level);
      if (id === 'echo') { game.state.turn = 2; game.state.history = [12, 17, 12]; }
      game.state.inventory = { oil: 0, kite: 0, bridge: 0 };
      if (scenario === 'held') game.state.inventory[id] = 1;
      if (scenario === 'used') game.state.itemsUsed = 1;
      if (scenario === 'no-target') { game.state.letters = []; if (id === 'echo') game.state.seals = []; }
      else game.state.bridges = [];
      game.selectItem(id);
      assert.equal(game.modal.kind, 'item');
      assert.equal(game.modal.itemId, id);
      assert.ok(game.modal.lines.every(line => !/免费|配发|补满/.test(line)), 'dialogs never promise free refills');
      if (kind === 'browser' && scenario !== 'held' || scenario === 'locked' || scenario === 'no-target' && id !== 'oil' || scenario === 'unconfigured')
        assert.equal(game.modal.buttons.some(button => button.primary), false, 'unavailable offers never provide a video action');
      const bounds = h.draw(), name = `${metrics.width}x${metrics.height}/${kind}/${scenario}/${id}`;
      const screenX = x => x * h.r.scale + h.r.ox, screenY = y => y * h.r.scale + h.r.oy;
      assert.ok(screenY(bounds.y) >= metrics.safeTop, name + ': panel clears system controls');
      assert.ok(screenY(bounds.y + bounds.h) <= metrics.height - metrics.safeBottom, name + ': panel clears home indicator');
      assert.ok(h.boxes.length >= 5);
      for (const box of h.boxes) {
        assert.ok(screenX(box.x) >= 0 && screenX(box.x + box.w) <= metrics.width, name + ': ' + box.value + ' fits screen width');
        assert.ok(box.x >= bounds.x + 20 && box.x + box.w <= bounds.x + bounds.w - 20, name + ': paragraph retains paper insets');
        assert.ok(screenY(box.y) >= metrics.safeTop && screenY(box.y + box.h) <= metrics.height - metrics.safeBottom, name + ': ' + box.value + ' remains in safe area');
      }
      for (let i = 0; i < h.boxes.length; i++) for (let j = i + 1; j < h.boxes.length; j++) {
        const a = h.boxes[i], b = h.boxes[j];
        assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
          name + ': ' + a.value + ' overlaps ' + b.value);
      }
      assert.equal(h.r.hits.length, game.modal.buttons.length, name + ': modal owns all hit targets');
      for (const hit of h.r.hits) {
        assert.ok(hit.w >= 44 && hit.h >= 44, name + ': full-size button target');
        assert.ok(screenX(hit.x) >= 0 && screenX(hit.x + hit.w) <= metrics.width);
        assert.ok(screenY(hit.y) >= metrics.safeTop && screenY(hit.y + hit.h) <= metrics.height - metrics.safeBottom, name + ': actions remain tappable');
      }
    }
  }
});
