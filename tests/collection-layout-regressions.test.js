'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { ListScroll } = require('../src/list-scroll');
const { drawCollection } = require('../src/collection-view');
const { getAlbum } = require('../src/stamp-album');
const { CONTROL } = require('../src/controls');

test('daily journey has a full touch target separate from filters and the scrollable album', () => {
  for (const H of [700, 844]) {
    const noop = () => {}, buttons = [];
    const ctx = new Proxy({ globalAlpha: 1, font: '14px sans-serif' }, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return value => ({ width: String(value).length * 7 });
        return noop;
      }
    });
    const r = new Renderer({ getContext: () => ctx });
    Object.assign(r, { H, now: 1000, pageNow: 1000, reducedMotion: true, effectsQuality: 'low' });
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
    assert.ok(journey.w >= CONTROL.compactHeight && journey.h >= CONTROL.compactHeight);
    assert.ok(journey.y + journey.h <= r.collectionRect.y, 'journey does not intercept stamp scrolling');
    assert.ok(buttons.filter(button => button !== journey).every(button =>
      button.y + button.h <= journey.y || button.y >= journey.y + journey.h), 'journey does not overlap a filter or back control');
    journey.action(); assert.equal(opened, 1);
    assert.ok(r.collectionRect.y + r.collectionRect.h <= H - 24);
  }
});
