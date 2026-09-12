'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { CAMPAIGN } = require('../src/levels');
const { drawModal } = require('../src/modal-view');
const { helpContent } = require('../src/help-view');
const { handleGameKey } = require('../src/keyboard-input');
const { drawLevels } = require('../src/level-view');
const { drawStampDetail } = require('../src/stamp-detail-view');
const { getAlbum } = require('../src/stamp-album');
const { ListScroll } = require('../src/list-scroll');
const { stars } = require('../src/engine');

function renderer() {
  const texts = [], noop = () => {};
  const ctx = new Proxy({ globalAlpha: 1, font: '12px sans-serif' }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return value => ({ width: [...String(value)].reduce((sum, char) =>
        sum + (/[^\x00-\xff]/.test(char) ? 1 : .55) * Number(target.font.match(/([\d.]+)px/)[1]), 0) });
      if (key === 'fillText') return value => texts.push(String(value));
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return noop;
    }
  });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { H: 700, viewport: { x: 0, y: 0, w: 390, h: 700 },
    now: 1000, modalAt: 0, reducedMotion: true, effectsQuality: 'low' });
  return { r, texts };
}

function helpGame() {
  const { r } = renderer();
  const game = { renderer: r, startupActive: () => false, unlockAudio() {}, syncMusic() {} };
  game.modal = { kind: 'help', title: '和回声一起送信', ...helpContent(CAMPAIGN[19], 0, 'browser'),
    buttons: [{ text: '明白了', primary: true, action: () => { game.modal = null; } }] };
  drawModal(r, game.modal, 1000);
  assert.ok(r.helpNavigation.count >= 3);
  return game;
}

test('rapid help navigation keeps every key press and reversal before the next frame', () => {
  const game = helpGame(), count = game.renderer.helpNavigation.count;
  handleGameKey(game, 'ArrowRight');
  handleGameKey(game, 'PageDown');
  assert.equal(game.modal.helpPage, 2, 'separate key presses must not reuse the previously painted page');
  handleGameKey(game, 'ArrowLeft');
  assert.equal(game.modal.helpPage, 1, 'reversal must use the current requested page');
  for (let index = 0; index < count + 2; index++) handleGameKey(game, 'PageDown');
  assert.equal(game.modal.helpPage, count - 1);
  for (let index = 0; index < count + 2; index++) handleGameKey(game, 'PageUp');
  assert.equal(game.modal.helpPage, 0);
});

test('keyboard help paging cancels a held touch before new page controls appear', () => {
  const game = helpGame();
  game.pointer = game.renderer.pointer = { x: 300, y: 500, modal: game.modal };
  handleGameKey(game, 'ArrowRight');
  assert.equal(game.pointer, null, 'the old finger release must not activate a button on the new help page');
  assert.equal(game.renderer.pointer, null);
  assert.deepEqual(game.renderer.hits, []);
});

test('level and collection star guidance discloses tools as well as relighting', () => {
  const { r, texts } = renderer(), profile = { completed: { 20: { stars: 2, bestTurns: CAMPAIGN[19].par + 1 } } };
  const album = getAlbum(profile), game = { renderer: r, levelScroll: new ListScroll(),
    platform: { now: () => 1000 }, profile: () => profile, album: () => album,
    nextLevel: () => CAMPAIGN[19], savedRun: () => null, unlocked: () => true,
    home() {}, selectLevel() {}, toast() {}, scrollToProgress() {} };
  assert.equal(stars(CAMPAIGN[19], { turn: CAMPAIGN[19].par, itemsUsed: 1 }), 2);
  assert.equal(stars(CAMPAIGN[19], { turn: CAMPAIGN[19].par, revived: true }), 2);
  drawLevels(r, game);
  const cardLabels = texts.filter(text => text.startsWith('三星 '));
  assert.ok(cardLabels.length > 0);
  assert.ok(cardLabels.every(text => /道具/.test(text) && /续灯/.test(text) && !text.includes('…')));
  texts.length = 0; game.levelBrowser = { mode: 'replay' };
  drawLevels(r, game);
  assert.ok(texts.some(text => /待摘星/.test(text) && /道具/.test(text) && /续灯/.test(text)));
  texts.length = 0; game.page = 'collection'; game.modal = { kind: 'stamp-detail', stampId: album.next.id };
  drawStampDetail(r, game, 1000);
  assert.ok(texts.some(text => /三星/.test(text) && /道具/.test(text) && /续灯/.test(text)));
});
