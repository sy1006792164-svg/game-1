'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');

function renderer() {
  let measures = 0;
  const painted = [];
  const ctx = {
    font: '',
    measureText(value) {
      measures++;
      const size = Number(this.font.split(' ')[1].replace('px', ''));
      return { width: Array.from(value).length * size };
    },
    fillText(value) { painted.push({ value, font: this.font }); }
  };
  return { r: new Renderer({ getContext: () => ctx }), ctx, painted, get measures() { return measures; } };
}

test('scrolling repeated labels reuses measured text with the right width and font', () => {
  const h = renderer(), label = '一封寄往远方的来信';
  h.r.label(label, 0, 0, 50, 10);
  const measured = h.measures;
  for (let frame = 1; frame <= 600; frame++) {
    h.ctx.font = '600 24px other-font';
    h.r.label(label, 25, -frame, 50, 10);
  }
  assert.equal(h.measures, measured, 'scroll position does not require new text measurements');
  assert.ok(h.painted.every(entry => entry.value === '一封寄往…' && entry.font.startsWith('400 10px')));
  h.r.label(label, 0, 0, 80, 10);
  assert.equal(h.painted.at(-1).value, '一封寄往远方的…');
  h.r.label(label, 0, 0, 80, 20, undefined, undefined, '600');
  assert.equal(h.painted.at(-1).value, '一封寄…');
  assert.ok(h.painted.at(-1).font.startsWith('600 20px'));
});

test('empty truncated labels stay cached and clearCaches releases text layouts', () => {
  const h = renderer();
  h.r.label('来信', 0, 0, 1, 10);
  const measured = h.measures;
  h.r.label('来信', 0, 0, 1, 10);
  assert.equal(h.measures, measured);
  assert.equal(h.painted.at(-1).value, '');
  h.r.wrapLines('第一行第二行', 40, 10);
  h.r.clearCaches();
  assert.equal(h.r.labelCache.size, 0);
  assert.equal(h.r.wrapCache.size, 0);
  h.r.label('来信', 0, 0, 1, 10);
  assert.ok(h.measures > measured);
});

test('browsing all 999 routes bounds layout memory without evicting hot list labels', () => {
  const h = renderer();
  let hotMisses = 0;
  for (let chapter = 0; chapter < 999; chapter++) {
    h.r.label('第' + chapter + '封远方来信', 0, 0, 130, 12);
    h.r.wrapLines('这一关的说明' + chapter, 100, 14);
    const before = h.measures;
    h.r.label('选一封来信', 0, 0, 290, 19);
    if (h.measures > before) hotMisses++;
    assert.ok(h.r.labelCache.size <= 512);
    assert.ok(h.r.wrapCache.size <= 256);
  }
  assert.equal(hotMisses, 1, 'a visible header stays warm as old rows are evicted');
});
