'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { STAR_TWO_MARGIN } = require('../src/engine');
const { Renderer } = require('../src/renderer');
const { helpContent } = require('../src/help-view');
const { drawModal } = require('../src/modal-view');
const { handleGameKey } = require('../src/keyboard-input');

function renderer(height) {
  const text = [];
  const ctx = new Proxy({ globalAlpha: 1, font: '400 14px sans-serif' }, {
    get(target, key) {
      if (key in target) return target[key];
      // CJK glyphs occupy a full em; an ASCII-only fixed-width mock misses
      // wrapping failures in the Chinese instructions on real phone fonts.
      if (key === 'measureText') return value => ({ width: [...String(value)].reduce((width, char) =>
        width + (/[^\x00-\xff]/.test(char) ? 1 : .55) * Number(target.font.match(/([\d.]+)px/)[1]), 0) });
      if (key === 'fillText') return (value, x, y) => text.push({ value: String(value), x, y, size: Number(target.font.match(/([\d.]+)px/)[1]) });
      return () => {};
    }
  });
  const r = new Renderer({ getContext: () => ctx });
  r.H = height; r.modalAt = 0; r.reducedMotion = true;
  return { r, text };
}

test('help only offers rewarded relighting when the active platform can show it', () => {
  const level = CAMPAIGN[19];
  for (const kind of ['browser', 'wechat']) {
    assert.equal(helpContent(level, 0, kind).lines.some(line => /广告/.test(line)), false);
    assert.equal(helpContent(level, 0, kind, { canRevive: false }).lines.some(line => /广告/.test(line)), false);
  }
  const available = helpContent(level, 0, 'wechat', { canRevive: true });
  assert.ok(available.lines.some(line => /封顶二星/.test(line)), 'the star consequence is available before a player chooses an ad');
  const late = helpContent(CAMPAIGN[0], 1, 'wechat', { canRevive: true, turn: CAMPAIGN[0].par + STAR_TWO_MARGIN });
  assert.ok(late.sections.some(section => /本次最多一星/.test(section.text)), 'late relights disclose the reachable rating');
  assert.ok(helpContent(level, 0, 'browser').sections.some(section => section.title === '电脑操作' && /WASD/.test(section.text)));
});

test('every campaign help topic and close action stays visible at the minimum safe height', () => {
  for (const height of [700, 844]) {
    const { r, text } = renderer(height);
    for (const level of CAMPAIGN) for (const [kind, reviveCount, canRevive] of [
      ['browser', 0, false], ['wechat', 0, false], ['wechat', 0, true], ['wechat', 3, true]
    ]) {
      let closed = 0;
      const modal = { kind: 'help', title: '和回声一起送信', ...helpContent(level, reviveCount, kind, { canRevive }),
        buttons: [{ text: '明白了', primary: true, action: () => { closed++; } }] };
      const seen = [], positions = [], label = `${height}, level ${level.id}, ${kind}, ${reviveCount}, ${canRevive}`;
      for (let page = 0; page < 10; page++) {
        text.length = 0; r.hits = [];
        const ui = drawModal(r, modal, 300);
        assert.ok(ui.y >= 24 && ui.y + ui.h <= height - 24, label + ': panel stays in the safe area');
        assert.ok(text.every(item => item.y - item.size / 2 >= ui.y && item.y + item.size / 2 <= ui.y + ui.h), label + ': all text stays on the paper');
        assert.ok(r.hits.some(hit => hit.action === modal.buttons[0].action), label + ': close is always available');
        assert.ok(r.hits.every(hit => hit.y >= ui.y && hit.y + hit.h <= ui.y + ui.h), label + ': all touch targets are visible');
        seen.push(...ui.help.blocks.map(block => block.title));
        positions.push({ y: ui.y, h: ui.h, closeY: ui.buttons[0].y });
        if (!ui.navigation || ui.navigation.page === ui.navigation.count - 1) break;
        const next = r.hits.find(hit => hit.action === ui.navigation.next);
        assert.ok(next, label + ': next page is a real touch target');
        next.action();
      }
      assert.deepEqual(seen, modal.sections.map(section => section.title), label + ': every topic is reachable exactly once');
      assert.ok(positions.every(position => JSON.stringify(position) === JSON.stringify(positions[0])), label + ': paging keeps controls in place');
      modal.buttons[0].action(); assert.equal(closed, 1);
    }
  }
});

test('help paging can go back and adapts safely after a taller viewport resize', () => {
  const { r } = renderer(700);
  const modal = { kind: 'help', title: '和回声一起送信', ...helpContent(CAMPAIGN[19], 0, 'browser'),
    buttons: [{ text: '明白了', primary: true, action() {} }] };
  let ui = drawModal(r, modal, 300);
  assert.ok(ui.navigation && ui.navigation.count > 1);
  assert.equal(r.hits.some(hit => hit.action === ui.navigation.previous), false, 'the first page has no active previous target');
  ui.navigation.next(); ui = drawModal(r, modal, 300);
  assert.equal(ui.navigation.page, 1);
  ui.navigation.previous(); ui = drawModal(r, modal, 300);
  assert.equal(ui.navigation.page, 0);
  modal.helpPage = 999; r.H = 1600;
  ui = drawModal(r, modal, 300);
  assert.deepEqual(ui.help.blocks.map(block => block.title), modal.sections.map(section => section.title));
  assert.equal(ui.navigation, null);
});

test('keyboard help paging owns arrows and Page keys while Escape preserves the original close action', () => {
  const { r } = renderer(700);
  const previous = { kind: 'pause' };
  const game = { renderer: r, startupActive: () => false, unlockAudio() {}, syncMusic() {},
    act() { assert.fail('reading help must not walk on the board'); } };
  const modal = { kind: 'help', title: '和回声一起送信', ...helpContent(CAMPAIGN[19], 0, 'browser'),
    buttons: [{ text: '明白了', primary: true, action: () => { game.modal = previous; } }] };
  game.modal = modal;
  drawModal(r, modal, 300);
  for (const [forward, back] of [['ArrowRight', 'ArrowLeft'], ['PageDown', 'PageUp']]) {
    handleGameKey(game, back);
    assert.equal(modal.helpPage || 0, 0, 'the first page cannot go below zero');
    handleGameKey(game, forward); drawModal(r, modal, 300);
    assert.equal(modal.helpPage, 1);
    handleGameKey(game, back); drawModal(r, modal, 300);
    assert.equal(modal.helpPage, 0);
  }
  handleGameKey(game, 'Escape');
  assert.equal(game.modal, previous, 'help returns to the paused route');
  const replacement = { ...modal, helpPage: 0 };
  game.modal = replacement;
  handleGameKey(game, 'ArrowRight');
  assert.equal(replacement.helpPage, 0, 'stale rendered navigation cannot page a different modal');
});
