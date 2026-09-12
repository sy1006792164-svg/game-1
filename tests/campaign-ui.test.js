'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { CAMPAIGN, chapterNames, PER_CHAPTER } = require('../src/levels');
const { STAMPS } = require('../src/stamp-album');
const { levelListLayout, levelProgressOffset } = require('../src/level-view');
const { collectionLayout } = require('../src/collection-view');
const { locateNextStamp } = require('../src/collection-view');
const { navigateLevelBrowser, replayLevels, levelBrowserLayout } = require('../src/level-navigation');
const { visibleStamps, setCollectionFilter } = require('../src/stamp-collection');
const { openStampDetail, stampDetailKey } = require('../src/stamp-detail-view');

// Minimal canvas and platform stubs: enough to run the renderer and read back the text it draws.
function harness(options = {}) {
  const calls = [];
  let now = 1000;
  const noop = () => {};
  const ctx = new Proxy({ globalAlpha: 1, font: '12px sans-serif' }, {
    get(target, method) {
      if (method in target) return target[method];
      if (method === 'measureText') return text => ({ width: String(text).length * 7 });
      if (method === 'createLinearGradient' || method === 'createRadialGradient') return () => ({ addColorStop: noop });
      return (...args) => { calls.push({ method, args }); };
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  const canvas = { width: 780, height: 1560, getContext: () => ctx };
  const metrics = { width: 390, height: 780, pixelRatio: 2, safeTop: 0, safeBottom: 0 };
  const data = new Map();
  const callbacks = {};
  const platform = {
    isDevelopment: options.development === true,
    isWeChat: false, canvas, storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop, vibrate: noop,
    onResize: fn => { callbacks.resize = fn; }, onPointer: fn => { callbacks.pointer = fn; }, onKey: fn => { callbacks.key = fn; },
    onHide: noop, onShow: noop, onAudioInterruptionBegin: noop, onAudioInterruptionEnd: noop,
    createInnerAudioContext: () => ({ play: noop, stop: noop, pause: noop, destroy: noop, onEnded: noop, offEnded: noop, onError: noop, offError: noop }),
    createRewardedVideoAd: () => null
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
  const module = { exports: {} };
  vm.runInThisContext('(function (require, module, exports) {' + source + '\n})')(specifier => {
    if (specifier === './sound') return { createSound: () => ({ play: noop, stop: noop, release: noop, ambience: noop, unlock: noop, suspend: noop, resume: noop }) };
    return require(path.join(__dirname, '..', 'src', specifier.replace('./', '')));
  }, module, module.exports);
  const game = new module.exports.Game(platform);
  for (let frame = 0; game.page !== 'home' && frame < 200; frame++) { now += 100; game.loop(); }
  assert.equal(game.page, 'home', 'the real startup loop must automatically finish before campaign UI tests');
  const draw = () => { calls.length = 0; game.renderer.draw(game, now, metrics); return calls.filter(call => call.method === 'fillText').map(call => String(call.args[0])); };
  const tap = predicate => {
    const hit = game.renderer.hits.find(predicate);
    assert.ok(hit, 'expected a hit region');
    hit.action();
  };
  return { game, draw, tap, callbacks, advance(ms) { now += ms; game.loop(); }, pointer(x, y, type) { const r = game.renderer; game.pointerEvent(x * r.scale + r.ox, y * r.scale + r.oy, type); } };
}

test('all 999 levels form one scrollable list with chapter groups and bounded rendering', () => {
  assert.equal(CAMPAIGN.length, 999);
  assert.equal(chapterNames.length, 167);
  const h = harness();
  h.game.openPage('levels');
  let texts = h.draw();
  assert.ok(texts.includes('已送达 0 封') && texts.includes('共 ' + CAMPAIGN.length + ' 封来信'));
  assert.ok(texts.includes('001'), 'route numbers carry three digits');
  assert.ok(texts.includes('第 1 章'));
  assert.equal(texts.includes('回到进度'), false);
  assert.equal(texts.some(text => /上一章|下一章|\d+ \/ \d+ 章/.test(text)), false);
  const layout = levelListLayout(h.game.renderer.H);
  h.game.levelScroll.offset = layout.chapterHeight - 200;
  texts = h.draw();
  assert.ok(texts.includes('006') && texts.includes('007'), 'two chapters meet in the same scroll viewport');
  const seen = new Set();
  for (let chapter = 0; chapter < chapterNames.length; chapter++) {
    h.game.levelScroll.offset = Math.min(chapter * layout.chapterHeight, layout.maxScroll);
    texts = h.draw();
    texts.filter(text => /^\d{3}$/.test(text)).forEach(text => seen.add(Number(text)));
    assert.ok(h.game.renderer.hits.filter(hit => hit.w === 164).length <= 14, 'only visible cards have drawing and hit regions');
    assert.ok(h.game.levelScroll.revealed.size <= 64, 'animation history is bounded');
  }
  assert.equal(seen.size, 999);
  h.callbacks.key('End');
  texts = h.draw();
  assert.ok(texts.includes('第 167 章'));
  assert.ok(texts.includes(String(CAMPAIGN.length).padStart(3, '0')), 'the last chapter lists the final route');
  assert.equal(CAMPAIGN.slice((chapterNames.length - 1) * PER_CHAPTER).length, 3);
  assert.equal(texts.includes('下一章'), false);
  assert.equal(texts.includes('1000'), false);
  h.tap(hit => hit.x === 141 && hit.y === 151); h.draw();
  h.tap(hit => hit.x === 24 && hit.y === 151);
  assert.equal(h.game.levelScroll.offset, 0);
});

test('level selection opens at progress and returning from a filter finds it after a long scroll', () => {
  const h = harness();
  for (const level of CAMPAIGN.slice(0, 14)) h.game.store.recordWin(level.id, 3, level.par, 'campaign');
  h.game.openPage('levels');
  let texts = h.draw();
  const target = levelProgressOffset(CAMPAIGN[14], h.game.renderer.H);
  assert.equal(h.game.levelScroll.offset, target);
  assert.ok(texts.includes('015'));
  h.callbacks.key('End'); h.draw();
  h.tap(hit => hit.x === 141 && hit.y === 151); h.draw();
  h.tap(hit => hit.x === 24 && hit.y === 151);
  assert.equal(h.game.levelScroll.offset, target);
  texts = h.draw();
  assert.ok(texts.includes('015'));
});

test('level dragging never opens a route, clipped cards do not steal header taps, and taps still start unlocked levels', () => {
  const h = harness();
  h.game.openPage('levels'); h.draw(); h.advance(600); h.draw();
  const top = levelListLayout(h.game.renderer.H).viewport.y;
  h.pointer(95, top + 172, 'start'); h.advance(30); h.pointer(95, top + 122, 'move');
  h.advance(30); h.pointer(95, top + 82, 'end'); h.draw();
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.toastUntil, 0);
  const before = h.game.levelScroll.offset;
  h.advance(16);
  assert.ok(h.game.levelScroll.offset > before);
  h.game.levelScroll.stop(); h.game.levelScroll.offset = 80; h.draw();
  h.pointer(95, top - 20, 'start'); h.pointer(95, top - 20, 'end');
  assert.equal(h.game.page, 'levels', 'clipped card behind the fixed header cannot start a route');
  h.callbacks.key('Home'); h.draw();
  h.pointer(95, top + 107, 'start'); h.advance(60); h.pointer(95, top + 107, 'end');
  assert.equal(h.game.page, 'game');
  assert.equal(h.game.level.id, 1);
  assert.equal(h.game.levelScroll.touching, false);
  assert.equal(h.game.levelScroll.velocity, 0);
  h.game.openPage('collection'); h.draw();
  assert.equal(h.game.collectionScroll.offset, 0);
});

test('keyboard scrolling cancels a held list gesture and does not move the board camera', () => {
  const h = harness(); h.game.openPage('levels'); h.draw();
  const camera = JSON.stringify(h.game.camera);
  h.pointer(95, levelListLayout(h.game.renderer.H).viewport.y + 172, 'start'); h.callbacks.key('PageDown');
  assert.equal(h.game.pointer, null);
  assert.equal(h.game.levelScroll.touching, false);
  h.advance(16);
  assert.ok(h.game.levelScroll.offset > 0);
  assert.equal(JSON.stringify(h.game.camera), camera);
});

test('developer selection shows free level 999 and supports keyboard and keypad jumping with validation', () => {
  const h = harness({ development: true }); h.game.openPage('levels');
  let texts = h.draw();
  assert.equal(texts.includes('输入关卡号'), false);
  assert.ok(texts.includes('开发试玩 · 独立存档'));
  h.callbacks.key('End'); texts = h.draw();
  assert.ok(texts.includes('999'));
  assert.equal(texts.includes('先送达上一封'), false);
  h.tap(hit => hit.x === 258 && hit.w === 108); h.draw();
  h.tap(hit => hit.x === 250 && hit.y === 96); h.draw();
  assert.equal(h.game.modal.kind, 'developer-level');
  h.callbacks.key('0'); h.callbacks.key('Enter');
  assert.match(h.game.modal.error, /1–999/);
  h.callbacks.key('Delete');
  for (const key of '1000') h.callbacks.key(key);
  h.callbacks.key('Enter');
  assert.equal(h.game.page, 'levels', '1000 must not be truncated to 100');
  h.callbacks.key('Delete');
  // Touching the 9 key three times works in the native Canvas keypad too.
  h.draw();
  const ninthKeyY = Math.max(24, (h.game.renderer.H - 472) / 2) + 280;
  for (let n = 0; n < 3; n++) h.tap(hit => hit.w === 86 && hit.x === 246 && hit.y === ninthKeyY);
  texts = h.draw();
  assert.ok(texts.includes('999'));
  h.tap(hit => hit.w === 174);
  assert.equal(h.game.level.id, 999);
  assert.equal(h.game.page, 'game');
  assert.ok(h.draw().includes('开发试玩 · 独立存档'));
});

test('formal UI has no developer controls, keeps locks, and developer cancellation does not start a run', () => {
  const formal = harness(); formal.game.openPage('levels');
  const texts = formal.draw();
  assert.equal(texts.some(text => /开发|输入关卡号/.test(text)), false);
  assert.ok(texts.includes('先送达上一封'));
  const dev = harness({ development: true }); dev.game.openPage('levels');
  dev.game.openDevelopmentPicker(); dev.callbacks.key('9'); dev.callbacks.key('Escape');
  assert.equal(dev.game.modal, null);
  assert.equal(dev.game.page, 'levels');
  assert.equal(dev.game.store.loadRun(), null);
});


test('the home page names the next route with three digits', () => {
  const h = harness();
  const texts = h.draw();
  assert.ok(texts.some(text => text.startsWith('第 001 封 · ')));
});

test('the album stays continuous and links daily journey back to the same campaign', () => {
  const h = harness();
  h.game.openPage('collection'); h.draw(); h.advance(700);
  let texts = h.draw();
  assert.equal(STAMPS.length, 29);
  assert.ok(texts.includes('第一缕风'));
  assert.equal(texts.some(text => /[12] \/ 2 页/.test(text)), false);
  assert.ok(texts.some(text => text.includes('今日邮程')));
  assert.ok(h.game.collectionScroll.max > 0);
  h.callbacks.key('End'); texts = h.draw();
  assert.ok(texts.includes('千封星光'));
  assert.equal(texts.includes('01'), false, 'first card is offscreen; the fixed next-stamp summary stays visible');
  h.callbacks.key('Home'); h.draw();
  assert.equal(h.game.collectionScroll.offset, 0);
  h.game.openPage('levels'); texts = h.draw();
  assert.ok(texts.some(text => text.includes('今日邮程')));
  assert.equal(typeof h.game.daily, 'undefined');
  assert.equal(require('../src/levels').getDaily, undefined);
});

test('album touch drags coast without clicking, clipped cards cannot steal header taps, and cancellation stops motion', () => {
  const h = harness();
  h.game.openPage('collection'); h.draw(); h.advance(700); h.draw();
  const beforeToast = h.game.toastUntil;
  const top = collectionLayout(h.game.renderer.H).viewport.y;
  h.pointer(77, top + 149, 'start'); h.advance(30); h.pointer(77, top + 99, 'move');
  h.advance(30); h.pointer(77, top + 49, 'end');
  assert.ok(h.game.collectionScroll.offset >= 100);
  assert.equal(h.game.toastUntil, beforeToast, 'dragging must not tap a stamp');
  const before = h.game.collectionScroll.offset;
  h.advance(16);
  assert.ok(h.game.collectionScroll.offset > before);
  h.pointer(77, top + 49, 'cancel');
  assert.equal(h.game.collectionScroll.velocity, 0);
  h.game.collectionScroll.offset = 100; h.draw();
  h.pointer(77, top - 19, 'start'); h.pointer(77, top - 19, 'end');
  assert.equal(h.game.toastUntil, beforeToast, 'a card clipped behind the section heading is not clickable');
  h.game.collectionScroll.offset = 0; h.draw();
  h.pointer(77, top + 71, 'start'); h.advance(70); h.pointer(77, top + 71, 'end');
  assert.equal(h.game.modal.kind, 'stamp-detail');
  assert.equal(h.game.modal.stampId, h.game.album().stamps[0].id);
  assert.equal(h.game.collectionScroll.tapped.index, 0);
  h.game.home(); h.advance(100);
  assert.equal(h.game.collectionScroll.touching, false);
  assert.equal(h.game.pointer, null);
});

test('chapter navigation covers the final partial chapter and returns to its real route cards', () => {
  const h = harness();
  h.game.openLevelBrowser('chapters', 999);
  assert.equal(h.game.levelBrowser.mode, 'chapters');
  assert.equal(h.game.levelScroll.max, levelBrowserLayout(h.game, h.game.renderer.H).maxScroll);
  const texts = h.draw();
  assert.ok(texts.includes('来信 997–999'));
  assert.ok(texts.includes('送达 0/3'));
  const cards = h.game.renderer.hits.filter(hit => hit.w === 342 && hit.h === 84);
  assert.ok(cards.length <= 8, 'only visible directory rows have hit regions');
  cards[cards.length - 1].action();
  assert.equal(h.game.levelBrowser.mode, 'all');
  assert.equal(h.game.levelScroll.offset, levelProgressOffset(CAMPAIGN[998], h.game.renderer.H));
  assert.equal(h.game.selectLevel(999), false, 'browsing a late chapter does not unlock it');
});

test('replay targets respect locks, refresh after higher stars and cancel old scroll gestures', () => {
  const h = harness();
  h.game.store.recordWin(1, 2, CAMPAIGN[0].par, 'campaign');
  h.game.store.recordWin(2, 3, CAMPAIGN[1].par, 'campaign');
  h.game.store.recordWin(7, 1, CAMPAIGN[6].par, 'campaign');
  h.game.openLevelBrowser('replay');
  assert.deepEqual(replayLevels(h.game).map(level => level.id), [1]);
  h.game.levelScroll.begin(400, 1000);
  h.game.pointer = { x: 95, y: 400 };
  navigateLevelBrowser(h.game, 'chapters');
  assert.equal(h.game.pointer, null);
  assert.equal(h.game.levelScroll.touching, false);
  h.game.store.recordWin(1, 3, CAMPAIGN[0].par, 'campaign');
  assert.equal(replayLevels(h.game).length, 0, 'a cached candidate disappears when its best stars improve');
  h.game.store.recordWin(6, 3, CAMPAIGN[5].par, 'campaign');
  assert.deepEqual(replayLevels(h.game).map(level => level.id), [7]);
});

test('collection targets and return-to-progress preserve and locate a saved replay', () => {
  const h = harness();
  for (const level of CAMPAIGN.slice(0, 14)) h.game.store.recordWin(level.id, level.id === 7 ? 2 : 3, level.par, 'campaign');
  assert.equal(h.game.selectLevel(7), true);
  const run = h.game.store.loadRun();
  h.game.openPage('collection');
  h.game.openLevelBrowser('replay', 7);
  assert.equal(h.game.page, 'levels');
  assert.equal(h.game.modal, null);
  assert.deepEqual(h.game.store.loadRun(), run, 'target browsing must not start or replace a run');
  h.draw(); h.tap(hit => hit.x === 24 && hit.y === 151);
  assert.equal(h.game.levelBrowser.mode, 'all');
  assert.equal(h.game.levelScroll.offset, levelProgressOffset(CAMPAIGN[6], h.game.renderer.H));
  assert.equal(h.game.nextLevel().id, 15, 'the saved replay and next campaign route remain distinct');
  assert.equal(h.game.selectLevel(7), true);
  assert.deepEqual(h.game.store.loadRun(), run, 'selecting the same saved route restores it');
});

test('album filters, detail paging and next-stamp locating share the same real collection', () => {
  const h = harness();
  h.game.store.recordWin(1, 3, CAMPAIGN[0].par, 'campaign');
  h.game.openPage('collection');
  assert.equal(setCollectionFilter(h.game, 'owned'), true);
  assert.deepEqual(visibleStamps(h.game).map(stamp => stamp.id), STAMPS.slice(0, 2).map(stamp => stamp.id));
  assert.equal(openStampDetail(h.game, STAMPS[2].id), false);
  assert.equal(openStampDetail(h.game, STAMPS[0].id), true);
  stampDetailKey(h.game, 'ArrowRight');
  assert.equal(h.game.modal.stampId, STAMPS[1].id);
  stampDetailKey(h.game, 'ArrowRight');
  assert.equal(h.game.modal.stampId, STAMPS[1].id, 'paging stays inside the owned filter');
  stampDetailKey(h.game, 'Escape');
  assert.equal(locateNextStamp(h.game), true);
  assert.equal(h.game.collectionFilter, 'all');
  assert.equal(h.game.page, 'collection');
  assert.equal(h.game.store.loadRun(), null);
  assert.equal(setCollectionFilter(h.game, 'locked'), true);
  assert.equal(visibleStamps(h.game)[0].id, STAMPS[2].id);
  assert.equal(h.game.collectionScroll.offset, 0);
});
