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

test('Chinese wrapping keeps closing punctuation with text and opening brackets off line ends', () => {
  const h = renderer();
  assert.deepEqual(h.r.wrapLines('信已送达。', 40, 10), ['信已送', '达。']);
  assert.deepEqual(h.r.wrapLines('请看（回声）再出发。', 30, 10), ['请看', '（回', '声）再', '出发。']);
  const text = '山间的信，已经送达。请看（回声）、《邮路》与【说明】：“准备好了？”然后出发！';
  for (const width of [50, 70, 90]) {
    const lines = h.r.wrapLines(text, width, 10);
    assert.equal(lines.join(''), text, 'wrapping preserves every character and punctuation mark');
    assert.ok(lines.every(line => !/^[，。！？、；：）】》”]/.test(line)), 'closing punctuation cannot start an automatic row');
    assert.ok(lines.every(line => !/[（【《“]$/.test(line)), 'opening brackets stay with following content');
    assert.ok(lines.every(line => h.ctx.measureText(line).width <= width), 'moving punctuation never overflows the line');
  }
  const mixed = '请查看(回声)、[邮路]，继续前行。';
  const lines = h.r.wrapLines(mixed, 50, 10);
  assert.equal(lines.join(''), mixed);
  assert.ok(lines.every(line => !/^[)\]，。、]/.test(line) && !/[([]$/.test(line)));
});

test('punctuation wrapping preserves explicit paragraphs and degrades safely at narrow widths', () => {
  const h = renderer();
  assert.deepEqual(h.r.wrapLines('\n信已送达。\r\n（向左走）\n\n继续。\n', 40, 10),
    ['', '信已送', '达。', '（向左', '走）', '', '继续。', '']);
  assert.deepEqual(h.r.wrapLines('请看\n（回声）', 100, 10), ['请看', '（回声）']);
  const text = '（风）🙂。';
  for (const width of [0, 1, 10, 20]) {
    const lines = h.r.wrapLines(text, width, 10);
    assert.equal(lines.join(''), text, 'a narrow column cannot discard punctuation or split a Unicode character');
    assert.ok(lines.every(line => line && (h.ctx.measureText(line).width <= width || Array.from(line).length === 1)),
      'only an indivisible glyph may exceed a column narrower than that glyph');
  }
});

test('Chinese punctuation layouts reuse the original font and width cache without exposing cached arrays', () => {
  const h = renderer(), text = '信已送达。\n请看（回声）。';
  const expected = h.r.wrapLines(text, 40, 10, '600'), measured = h.measures;
  for (let frame = 0; frame < 20; frame++) {
    h.ctx.font = '400 24px other-font';
    const lines = h.r.wrapLines(text, 40, 10, '600');
    assert.deepEqual(lines, expected);
    lines[0] = '外部修改';
    assert.ok(h.ctx.font.startsWith('600 10px'));
  }
  assert.equal(h.measures, measured, 'repeated punctuation-aware layouts do not measure again');
  h.r.wrapLines(text, 50, 10, '600');
  assert.ok(h.measures > measured, 'different widths receive their own measured layout');
  const afterWidth = h.measures;
  h.r.wrapLines(text, 40, 12, '600');
  assert.ok(h.measures > afterWidth, 'different fonts receive their own measured layout');
});
