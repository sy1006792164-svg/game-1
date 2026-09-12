'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState } = require('../src/engine');
const { getAlbum } = require('../src/stamp-album');
const { getJourney } = require('../src/journey');
const { openJourney, openRoutePlan } = require('../src/journey-view');
const { Renderer } = require('../src/renderer');
const { drawModal } = require('../src/modal-view');

function harness(height, profile) {
  const noop = () => {}, labels = [];
  const ctx = new Proxy({ globalAlpha: 1, font: '14px sans-serif' }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return value => ({ width: [...String(value)].reduce((sum, char) =>
        sum + (/[^\x00-\xff]/.test(char) ? 1 : .55) * Number(target.font.match(/([\d.]+)px/)[1]), 0) });
      if (key === 'fillText') return (text, x, y) => labels.push({ text, x, y });
      return noop;
    }
  });
  const renderer = new Renderer({ getContext: () => ctx });
  renderer.H = height; renderer.reducedMotion = true; renderer.modalAt = 0;
  const game = { page: 'home', session: 1, renderer, modal: null,
    platform: { kind: 'wechat' }, ads: { isConfigured: () => true },
    busy: false, hidden: false, startupActive: () => false, unlocked: () => true,
    ensureStoredProgressReady: () => true, savedRun: () => null,
    journey: () => getJourney(profile, '2026-09-12'), album: () => getAlbum(profile),
    cancelItem: noop, syncMusic: noop, stopListScrolling: noop,
    openRoutePlan(level) { return openRoutePlan(game, level); }, openPage: noop };
  return { game, renderer, labels };
}

function checkPages(h) {
  const { game, renderer, labels } = h, modal = game.modal;
  const seen = [];
  for (let page = 0; page < 12; page++) {
    labels.length = 0; renderer.hits = [];
    const ui = drawModal(renderer, modal, 1000);
    assert.ok(ui.y >= 24 && ui.y + ui.h <= renderer.H - 24, modal.kind + ': all content fits safe height');
    assert.ok(labels.every(label => label.y >= ui.y && label.y <= ui.y + ui.h), 'no text outside modal');
    for (const button of modal.buttons) assert.ok(renderer.hits.some(hit => hit.action === button.action), 'every action remains visible');
    assert.ok(renderer.hits.every(hit => hit.y >= ui.y && hit.y + hit.h <= ui.y + ui.h), 'all targets stay on screen');
    seen.push(...ui.help.blocks.map(block => block.title));
    if (!ui.navigation || ui.navigation.page + 1 === ui.navigation.count) break;
    ui.navigation.next();
  }
  assert.deepEqual(seen, modal.sections.map(section => section.title), 'pagination preserves every challenge and reward disclosure');
}

test('journey plans and all difficulty tiers fit the minimum safe height with reachable actions', () => {
  const completed = Object.fromEntries(CAMPAIGN.slice(0, 400).map(level => [level.id, { stars: level.id % 2 ? 2 : 3, bestTurns: level.par }]));
  for (const height of [700, 844]) {
    const h = harness(height, { completed });
    openJourney(h.game); checkPages(h);
    for (const id of [1, 4, 7, 16, 31, 121, 301, 361, 999]) {
      h.game.modal = null;
      openRoutePlan(h.game, CAMPAIGN[id - 1]); checkPages(h);
      h.game.page = 'game'; h.game.level = CAMPAIGN[id - 1]; h.game.state = createState(h.game.level);
      h.game.modal = null;
      openRoutePlan(h.game, h.game.level); checkPages(h);
      h.game.page = 'home';
    }
  }
});

test('exhausted daily recommendations keep a visible return and collection route', () => {
  const h = harness(700, { completed: {} });
  h.game.journey = () => ({ points: 6, target: 6, done: true, earnedDays: 1, candidates: [], creditedLevelIds: [] });
  const previous = { kind: 'win' }; h.game.modal = previous;
  openJourney(h.game); checkPages(h);
  assert.equal(h.game.modal.buttons.length, 2);
  h.game.modal.buttons.at(-1).action();
  assert.equal(h.game.modal, previous);
});

test('route preparation only offers video supplies on a configured supported platform', () => {
  for (const [kind, configured, available] of [['browser', true, false], ['wechat', false, false], ['wechat', true, true]]) {
    const h = harness(700, { completed: {} });
    h.game.platform.kind = kind; h.game.ads.isConfigured = () => configured;
    openRoutePlan(h.game, CAMPAIGN[30]); checkPages(h);
    const text = h.game.modal.sections.map(section => section.text).join('\n');
    assert.equal(h.game.modal.buttons.some(button => button.text.includes('视频补给')), available);
    if (available) assert.match(text, /自愿完整看视频获得 1 份/);
    else {
      assert.match(text, /当前环境没有可用的视频补给/);
      assert.doesNotMatch(text, /需要时自愿完整看视频获得/);
    }
    assert.ok(h.game.modal.buttons.some(button => button.primary), 'the ordinary departure action remains available');
  }
});

test('route preparation keeps already earned supplies accessible when video is unavailable', () => {
  const h = harness(700, { completed: {} });
  h.game.platform.kind = 'browser'; h.game.ads.isConfigured = () => false;
  h.game.page = 'game'; h.game.level = CAMPAIGN[3];
  h.game.state = createState(h.game.level, { oil: 1 });
  h.game.guideStep = () => null;
  let selected = null;
  h.game.selectItem = id => { selected = id; };
  openRoutePlan(h.game, h.game.level); checkPages(h);
  const supply = h.game.modal.buttons.find(button => button.text.includes('已有补给'));
  assert.ok(supply);
  assert.match(h.game.modal.sections.map(section => section.text).join('\n'), /本次路线已有 1 份，无需另看视频/);
  supply.action();
  assert.equal(selected, 'oil');
  assert.equal(h.game.state.inventory.oil, 1, 'opening the supply chooser does not spend the item');
});
