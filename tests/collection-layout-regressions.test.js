'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { ListScroll } = require('../src/list-scroll');
const { drawCollection } = require('../src/collection-view');
const { getAlbum } = require('../src/stamp-album');
const { CONTROL } = require('../src/controls');
const { drawStampDetail } = require('../src/stamp-detail-view');

test('daily journey has a full touch target separate from filters and the scrollable album', () => {
  for (const H of [700, 844]) for (const scale of [1, 496 / 700]) {
    const noop = () => {}, buttons = [];
    const ctx = new Proxy({ globalAlpha: 1, font: '14px sans-serif' }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return value => ({ width: String(value).length * 7 });
        return noop;
      }
    });
    const r = new Renderer({ getContext: () => ctx });
    Object.assign(r, { H, scale, now: 1000, pageNow: 1000, reducedMotion: true, effectsQuality: 'low' });
    const originalButton = r.button.bind(r);
    r.button = (label, x, y, w, h, action, style) => {
      buttons.push({ label, x, y, w, h, action });
      originalButton(label, x, y, w, h, action, style);
    };
    let opened = 0;
    const game = { album: () => getAlbum({ completed: {} }), collectionScroll: new ListScroll(),
      journey: () => ({ earnedDays: 0 }), openJourney: () => opened++, home: noop };
    drawCollection(r, game);
    const journey = buttons.find(button => button.label.includes('今日邮程'));
    assert.ok(journey.w * scale >= CONTROL.compactHeight && journey.h * scale >= CONTROL.compactHeight);
    assert.ok(journey.y + journey.h <= r.collectionRect.y, 'journey does not intercept stamp scrolling');
    assert.ok(buttons.filter(button => button !== journey).every(button =>
      button.y + button.h <= journey.y || button.y >= journey.y + journey.h), 'journey does not overlap a filter or back control');
    const journeyHit = r.hits.find(hit => hit.action === journey.action);
    const filterHits = r.hits.filter(hit => /^全部|^已收藏|^待收藏/.test(hit.label || ''));
    assert.ok(filterHits.every(hit => hit.y + hit.h <= journeyHit.y), 'expanded screen-pixel filter targets stay above the daily entry');
    assert.ok(journeyHit.y + journeyHit.h <= r.collectionRect.y, 'the real daily hit target stays out of the album scroll region');
    journey.action(); assert.equal(opened, 1);
    assert.ok(r.collectionRect.y + r.collectionRect.h <= H - 24);
  }
});

test('stamp detail reserves separate screen-sized action rows inside the compact paper', () => {
  for (const [H, scale] of [[590, 1], [700, 496 / 700], [700, .6], [844, 1]]) {
    for (const state of ['owned', 'replay', 'new']) {
      const noop = () => {}, opened = [];
      const ctx = new Proxy({ globalAlpha: 1, font: '14px sans-serif' }, {
        get(target, key) {
          if (key in target) return target[key];
          if (key === 'measureText') return value => ({ width: String(value).length * 7 });
          return noop;
        }
      });
      const r = new Renderer({ getContext: () => ctx });
      Object.assign(r, { H, scale, viewport: { x: 0, y: 0, w: 390, h: H },
        now: 1000, modalAt: 0, reducedMotion: true, effectsQuality: 'low' });
      const album = getAlbum({ completed: state === 'new' ? {} : { 1: { stars: 2, bestTurns: 8 } } });
      const stamp = state === 'owned' ? album.stamps[0] : album.next;
      const game = { page: 'collection', renderer: r, modal: { kind: 'stamp-detail', stampId: stamp.id },
        album: () => album, unlocked: index => index <= 1, syncMusic: noop,
        openLevelBrowser: (...args) => opened.push(args) };
      const panel = drawStampDetail(r, game, 1000);
      assert.ok(panel.y >= 8 && panel.y + panel.h <= H - 8, 'paper stays inside the safe area');
      const primary = r.hits.find(hit => /返回邮票册|去选关/.test(hit.label || ''));
      const secondary = r.hits.find(hit => /^重访 /.test(hit.label || ''));
      for (const hit of r.hits.slice(1)) {
        assert.ok(hit.w * scale >= 44 - 1e-8 && hit.h * scale >= 44 - 1e-8);
        assert.ok(hit.x >= panel.x && hit.x + hit.w <= panel.x + panel.w);
        assert.ok(hit.y >= panel.y && hit.y + hit.h <= panel.y + panel.h, 'expanded target remains inside the paper');
      }
      if (state === 'replay') {
        assert.ok(secondary, 'a real completed two-star route keeps its replay action');
        assert.ok(primary.y + primary.h <= secondary.y, 'continue and replay cannot intercept the same tap');
        primary.action(); secondary.action();
        assert.deepEqual(opened, [['all'], ['replay', 1]], 'continue remains primary and replay keeps the completed route');
      } else if (state === 'new') {
        assert.equal(secondary, undefined, 'an album without completed routes has no active replay target');
        primary.action(); assert.deepEqual(opened, [['all']]);
      } else {
        primary.action(); assert.equal(game.modal, null);
        assert.deepEqual(opened, [], 'owned stamps return to the album');
      }
    }
  }
});
