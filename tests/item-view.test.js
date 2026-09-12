'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawGame, controlLayout } = require('../src/game-view');
const { drawBoard } = require('../src/scene');
const { drawItemTray, itemTrayLayout, drawItemTarget, drawItemEffects } = require('../src/item-view');
const { createState, neighbor } = require('../src/engine');
const { itemOffer } = require('../src/items');
const { CAMPAIGN } = require('../src/levels');
const { SceneCamera } = require('../src/camera');
const { gameFeedback, objectiveFeedback, drawObjectiveFeedback } = require('../src/game-feedback');
const { drawObjectives } = require('../src/game-objectives');
const { turnFeedback } = require('../src/feedback');
const { SUPPLY_ENERGY } = require('../src/supply-rules');

function renderer(width = 390, height = 700) {
  const commands = [], texts = [], ellipses = [], stack = [], noop = () => {};
  const state = { globalAlpha: 1, font: '12px sans-serif' };
  const methods = {
    save: () => stack.push({ ...state }), restore: () => Object.assign(state, stack.pop()),
    measureText(text) {
      const size = Number(state.font.match(/([\d.]+)px/)[1]);
      return { width: [...String(text)].reduce((sum, char) => sum + size * (char.charCodeAt(0) > 255 ? 1 : .56), 0) };
    },
    fillText(value, x, y) { texts.push({ value, x, y, font: state.font, align: state.textAlign,
      width: methods.measureText(value).width }); },
    ellipse(...args) { ellipses.push(args); },
    createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop })
  };
  const ctx = new Proxy(state, { get(target, key) { return key in target ? target[key] : methods[key] ||
    ((...args) => commands.push([key, args, state.globalAlpha, state.strokeStyle, state.fillStyle])); } });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { H: height, viewport: { x: (390 - width) / 2, y: 0, w: width, h: height },
    reducedMotion: true, effectsQuality: 'low', now: 1000, ambientNow: 1000 });
  return { r, texts, commands, ellipses };
}

function gameFor(level = CAMPAIGN[19]) {
  const selected = [], acted = [], targeted = [];
  return { level, state: createState(level), mode: 'campaign', camera: new SceneCamera(),
    transitionAt: -Infinity, platform: { now: () => 1000 }, guideStep: () => null, playHint: () => '先收集信笺，再去邮局。',
    canShowGuide: () => false, canUndo: () => false, undoLeft: () => 3,
    selectItem: id => selected.push(id), itemTarget: cell => targeted.push(cell), cancelItem() { this.selectedItem = null; },
    inspectGuideCell: () => false, guideMisstep: () => false, toast: () => {}, act: action => acted.push(action),
    selected, acted, targeted };
}

test('supplies retain the existing tile size and clear all controls on short and wide screens', () => {
  for (const [width, height] of [[390, 700], [452, 700], [500, 700], [390, 844]]) {
    for (const id of [4, 7, 16, 20, 121, 301, 601, 999]) {
      const game = gameFor(CAMPAIGN[id - 1]), { r, ellipses } = renderer(width, height);
      const selectItem = game.selectItem; game.selectItem = null;
      drawGame(r, game, 1000);
      const previousHalfW = r.boardProjection.halfW;
      game.selectItem = selectItem; r.hits = []; ellipses.length = 0;
      drawGame(r, game, 1000);
      const layout = controlLayout(r, game), cards = r.hits.filter(hit => hit.action.itemId);
      assert.equal(cards.length, id >= 31 ? 4 : 3);
      assert.equal(r.boardProjection.halfW, previousHalfW, `level ${id}: retain tile size at ${width}x${height}`);
      assert.equal(r.boardRect.y + r.boardRect.h + 4, layout.tray.y);
      assert.ok(cards.every(card => card.w >= 44 && card.h >= 44 && card.y + card.h < layout.hintY));
      assert.ok(layout.buttonY + 52 <= height - 8);
      const crowns = ellipses.filter(([, , rx, ry]) => Math.abs(rx / ry - .27 / .48) < 1e-9 && rx > 5);
      for (const [, y, , radius] of crowns) assert.ok(y - radius >= r.boardRect.y, `level ${id}: rear trees clear the HUD`);
    }
  }
});

test('first lessons and mechanic guides leave the satchel hidden', () => {
  for (const id of [1, 2, 3]) assert.equal(itemTrayLayout(gameFor(CAMPAIGN[id - 1]), null, 590).visible, false);
  assert.equal(itemTrayLayout(gameFor(), { title: '纸桥' }, 590).visible, false);
  const review = gameFor(); review.reviewing = true;
  assert.equal(itemTrayLayout(review, null, 590).visible, false);
});

test('supply labels fit their paper cards and unavailable supplies explain themselves when tapped', () => {
  for (const id of [4, 7, 16, 20, 31, 53, 301, 999]) {
    const game = gameFor(CAMPAIGN[id - 1]), { r, texts } = renderer();
    const layout = itemTrayLayout(game, null, 590);
    drawItemTray(r, game, layout);
    for (const text of texts) {
      const left = text.x - (text.align === 'center' ? text.width / 2 : text.align === 'right' ? text.width : 0);
      const card = layout.cards.find(card => text.x >= card.x && text.x <= card.x + card.w);
      assert.ok(card, text.value);
      assert.ok(left >= card.x + 6 && left + text.width <= card.x + card.w - 6, text.value + ' stays in the card');
      assert.ok(text.y >= card.y + 10 && text.y <= card.y + card.h - 10);
    }
    r.hits.forEach(hit => hit.action());
    assert.deepEqual(game.selected, id >= 31 ? ['oil', 'kite', 'bridge', 'echo'] : ['oil', 'kite', 'bridge'], 'locked and targetless supplies retain explanation taps');
    assert.equal(game.state.turn, 0);
    assert.equal(game.state.itemsUsed, 0);
  }
});

test('targeting routes every tile and prop tap to item selection without moving or waiting', () => {
  const level = { id: 20, width: 5, height: 5, start: 12, exit: 24, budget: 20,
    walls: [7], letters: [2, 10, 13], seals: [17], lights: [11], bridges: [6, 8], winds: {} };
  const game = gameFor(level), { r } = renderer();
  game.state.inventory = { oil: 0, kite: 0, bridge: 0 };
  const rect = { x: 0, y: 148, w: 390, h: 380, paddingY: 90 };
  drawBoard(r, game, 1000, rect);
  const movementGeometry = r.boardGeometry;
  const movementNeighbors = new Set(['up', 'down', 'left', 'right'].map(action => neighbor(level, 12, action, game.state)).filter(cell => cell !== null));
  game.selectedItem = 'kite'; r.hits = [];
  drawBoard(r, game, 1000, rect);
  assert.deepEqual(r.boardGeometry.adjacent, new Set(itemOffer(level, game.state, 'kite').targets));
  assert.ok(r.boardGeometry.adjacent.size > 0, 'selecting a video target works before any reward is granted');
  assert.notEqual(r.boardGeometry, movementGeometry);
  assert.deepEqual(movementGeometry.adjacent, movementNeighbors, 'target tolerance cannot mutate cached movement neighbors');
  for (const cell of [2, 7, 10, 11, 12, 13, 17, 24]) {
    const hits = r.hits.filter(hit => hit.action.boardCell === cell);
    assert.ok(hits.length > 0);
    hits.forEach(hit => hit.action());
    assert.ok(game.targeted.includes(cell));
  }
  assert.deepEqual(game.acted, [], 'even foot, wall and invalid prop taps cannot advance the route');
  game.selectedItem = null; r.hits = [];
  drawBoard(r, game, 1000, rect);
  assert.equal(r.boardGeometry, movementGeometry, 'cancel restores the original movement cache');
  assert.deepEqual(r.boardGeometry.adjacent, movementNeighbors);
  r.hits.find(hit => hit.action.boardCell === 13).action();
  assert.deepEqual(game.acted, ['right']);
});

test('aim mode replaces waiting with cancellation and keeps its two-line hint stable', () => {
  const game = gameFor(), { r, texts } = renderer(), buttons = [];
  const button = r.button.bind(r);
  r.button = (label, x, y, w, h, action, style) => { buttons.push({ label, action, style }); button(label, x, y, w, h, action, style); };
  game.selectedItem = 'kite';
  game.state.inventory.kite = 1;
  drawGame(r, game, 1000);
  assert.ok(texts.some(text => text.value.includes('你与回声都留在原地')));
  assert.equal(buttons.some(button => button.label === '等一拍'), false);
  assert.equal(buttons.find(button => button.label.startsWith('撤回')).style.disabled, true);
  buttons.find(button => button.label === '取消选取').action();
  assert.equal(game.selectedItem, null);
  assert.deepEqual(game.acted, []);
});

test('zero stock offers a voluntary video while returned stock and targetless items keep distinct states', () => {
  const level = { id: 20, width: 5, height: 5, start: 12, exit: 24, budget: 20,
    walls: [], letters: [13], seals: [17], lights: [], bridges: [11], winds: {} };
  for (const kind of ['wechat', 'browser']) {
    const game = gameFor(level), { r, texts } = renderer(); game.platform.kind = kind;
    game.state.inventory = { oil: 0, kite: 0, bridge: 0 }; game.state.bridges = [];
    drawItemTray(r, game, itemTrayLayout(game, null, 590));
    const label = kind === 'browser' ? '微信内视频获取' : '看视频获取';
    assert.equal(texts.filter(text => text.value === label).length, 3);
    assert.equal(texts.filter(text => text.value === '×0').length, 3);
    assert.ok(texts.every(text => !text.value.includes('已用完')));
    texts.length = 0; game.state.inventory.kite = 1; game.state.letters = [];
    drawItemTray(r, game, itemTrayLayout(game, null, 590));
    assert.ok(texts.some(text => text.value === '×1'));
    assert.equal(texts.filter(text => text.value === '信笺已全部收齐').length, 1);
    assert.equal(texts.filter(text => text.value === label).length, 2, 'an unavailable target never advertises a reward action');
    texts.length = 0; game.state.letters = [13];
    drawItemTray(r, game, itemTrayLayout(game, null, 590));
    assert.ok(texts.some(text => text.value === '隔空收信'));
    assert.equal(texts.filter(text => text.value === label).length, 2, 'returned inventory is directly reusable');
  }
});

test('target hints stop pulsing in quiet modes and repair feedback expires cleanly', () => {
  const projection = { halfW: 25, halfH: 15, point: () => [100, 200] };
  const frame = (now, options) => {
    const { r, commands } = renderer(); Object.assign(r, options);
    drawItemTarget(r, 'kite', projection, 5, now);
    return commands;
  };
  for (const options of [{ reducedMotion: true, effectsQuality: 'high' }, { reducedMotion: false, effectsQuality: 'low' }])
    assert.deepEqual(frame(1000, options), frame(9000, options));
  assert.notDeepEqual(frame(1000, { reducedMotion: false, effectsQuality: 'high' }), frame(9000, { reducedMotion: false, effectsQuality: 'high' }));
  const game = gameFor(), { r, ellipses } = renderer();
  game.transitionAt = 1000; game.moveEvents = [{ type: 'item', item: 'bridge', cell: 5 }];
  drawItemEffects(r, game, 1200, projection);
  assert.equal(ellipses.length, 1, 'one quiet repair ring still confirms the restored bridge');
  ellipses.length = 0;
  drawItemEffects(r, game, 2000, projection);
  assert.equal(ellipses.length, 0);
});

test('the satchel distinguishes intact bridges, distant broken bridges and distant mail', () => {
  const level = { id: 44, width: 6, height: 6, start: 5, exit: 32, budget: 26,
    walls: [], letters: [13, 29], seals: [0, 11], lights: [], bridges: [16], winds: {} };
  const game = gameFor(level), { r, texts } = renderer();
  game.platform.kind = 'wechat';
  const draw = () => {
    texts.length = 0; r.hits = [];
    drawItemTray(r, game, itemTrayLayout(game, null, 590));
    return texts.map(text => text.value);
  };
  assert.ok(draw().includes('纸桥完好'));
  assert.ok(draw().includes('信笺不在范围'));
  game.state.bridges = [];
  assert.ok(draw().includes('靠近断桥再修'));
  assert.equal(draw().filter(text => text === '看视频获取').length, 1, 'only oil has a valid target here');
  game.state.player = 22;
  assert.equal(draw().filter(text => text === '看视频获取').length, 3, 'nearby torn bridge and mail remain independent offers');
  assert.equal(game.state.itemsUsed, 0);
});

test('energy pickup text sums actual oil gains, map lamps and legacy oil without counting frames twice', () => {
  const game = gameFor(), { r, texts } = renderer();
  let now = 1000;
  const pickup = events => {
    game.transitionAt = now; game.moveEvents = events;
    const notice = gameFeedback(r, game, now), energy = objectiveFeedback(notice, 0);
    drawObjectiveFeedback(r, energy, { x: 30, y: 124, w: 32, h: 16 }, now);
    now += 200;
    return { notice, energy };
  };
  let current = pickup([{ type: 'light', cell: game.state.player, amount: SUPPLY_ENERGY, source: 'oil' }]);
  assert.equal(SUPPLY_ENERGY, 6);
  assert.equal(current.energy.value, '+6 拍');
  assert.ok(texts.some(text => text.value === '+6 拍'));
  current = pickup([{ type: 'light', cell: game.state.player, amount: SUPPLY_ENERGY, source: 'oil' }, { type: 'letter', cell: 1 }]);
  assert.equal(current.energy.value, '+12 拍', 'two oil uses award twelve beats, not six');
  assert.equal(current.energy.count, 2, 'collection count remains distinct from energy');
  assert.equal(objectiveFeedback(current.notice, 1).value, '+1');
  current = pickup([{ type: 'light', cell: 2 }, { type: 'light', cell: 3, amount: 3, source: 'oil' }, { type: 'letter', cell: 4 }]);
  assert.equal(current.energy.value, '+18 拍', 'map lamp and old saved oil still add three each');
  assert.equal(objectiveFeedback(current.notice, 1).value, '+2');
  assert.equal(objectiveFeedback(gameFeedback(r, game, now - 50), 0).value, '+18 拍', 'a redraw cannot grant another gain');
  current = pickup([{ type: 'undo', cell: game.state.player }]);
  assert.equal(current.energy, null, 'undo clears gains even when a tool did not advance the turn');
  current = pickup([{ type: 'light', cell: 5 }]);
  assert.equal(current.energy.value, '+3 拍', 'a fresh map lamp starts a new three-beat gain');
});

test('relighting reuses the six-beat energy display and the existing light sound', () => {
  const game = gameFor(), { r, texts } = renderer();
  game.state = { ...game.state, status: 'failed', energy: 0 };
  game.transitionAt = 1000; game.moveEvents = [{ type: 'fail', cell: game.state.player }];
  assert.equal(gameFeedback(r, game, 1000), null);
  game.previousState = game.state;
  game.state = { ...game.state, status: 'playing', energy: SUPPLY_ENERGY, revived: true, reviveCount: 1 };
  game.transitionAt = 1200; game.moveEvents = [{ type: 'light', cell: game.state.player, amount: SUPPLY_ENERGY, source: 'oil' }];
  const notice = gameFeedback(r, game, 1200);
  assert.equal(objectiveFeedback(notice, 0).value, '+6 拍');
  drawObjectives(r, game, 1200, notice);
  assert.ok(texts.some(text => text.value === '6' && text.x === 66), 'the energy counter draws the actual restored state');
  assert.ok(texts.some(text => text.value === '+6 拍'));
  assert.deepEqual(turnFeedback(game.moveEvents, game.previousState, game.state).sounds, ['light']);
});
