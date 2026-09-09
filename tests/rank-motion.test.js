'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRankMotion } = require('../open-data/rank-motion');
const layout = { listTop: 260, listHeight: 340, stride: 76, rowHeight: 68 };
function create(count = 40) { const model = createRankMotion(); model.setLayout(layout, count, 0); model.enter(0); return model; }
function advance(model, from, to) { for (let at = from; at <= to; at += 16) model.frame(at); return model.frame(to); }
function target(index, count = 40) { return Math.max(0, Math.min((count - 1) * 76 + 68 - 340, index * 76 - 136)); }

test('upward and downward ranking changes move toward the actual new row and settle within 1.2 seconds', () => {
  for (const [oldIndex, newIndex, direction] of [[20, 8, 'up'], [8, 20, 'down']]) {
    const model = create();
    assert.equal(model.settle({ fromRank: oldIndex + 1, toRank: newIndex + 1, oldIndex, newIndex, count: 40 }, 0), true);
    const first = model.frame(0), mid = model.frame(500), end = model.frame(1120);
    assert.equal(first.rankMotion.direction, direction);
    assert.ok((mid.scrollOffset - first.scrollOffset) * (direction === 'up' ? -1 : 1) > 0);
    assert.ok(first.rankMotion.rowY >= layout.listTop && first.rankMotion.rowY + layout.rowHeight <= layout.listTop + layout.listHeight);
    assert.equal(end.scrollOffset, target(newIndex));
    assert.equal(end.rankMotion, null); assert.equal(end.active, false);
  }
});

test('ties use actual row index, and a large change limits visual travel without losing final position', () => {
  const model = create(1000);
  model.settle({ fromRank: 1, toRank: 850, oldIndex: 0, newIndex: 902, count: 1000 }, 0);
  const first = model.frame(0), end = model.frame(1200);
  assert.equal(end.scrollOffset, target(902, 1000));
  assert.ok(end.scrollOffset - first.scrollOffset <= layout.listHeight * 2);
  assert.equal(first.rankMotion.toRank, 850);
});

test('first visit and unchanged ranks locate the player without inventing a change', () => {
  for (const fromRank of [undefined, 0, 8]) {
    const model = create(); model.settle({ fromRank, toRank: 8, oldIndex: 4, newIndex: 10 }, 0);
    assert.equal(model.frame(100).rankMotion, null);
    assert.equal(model.frame(400).scrollOffset, target(10));
  }
});

test('each visit settles once and a new visit permits a fresh change', () => {
  const model = create(), change = { fromRank: 10, toRank: 3, oldIndex: 9, newIndex: 2 };
  assert.equal(model.settle(change, 0), true); model.frame(1200);
  assert.equal(model.settle({ ...change, newIndex: 9 }, 1300), false);
  model.enter(1400); assert.equal(model.settle(change, 1400), true);
});

test('a gesture immediately interrupts rank motion and late data cannot steal its position', () => {
  const model = create(); model.settle({ fromRank: 30, toRank: 10, oldIndex: 29, newIndex: 9 }, 0);
  model.pointer('start', 100, 450, 240);
  const start = model.frame(240).scrollOffset;
  model.pointer('move', 100, 390, 280);
  assert.equal(model.frame(280).rankMotion, null);
  assert.equal(model.frame(280).scrollOffset, start + 60);
  assert.equal(model.settle({ fromRank: 10, toRank: 4, newIndex: 3 }, 281), false);
  assert.equal(model.pointer('end', 100, 390, 285), false);
});

test('a gesture before the first network result protects its position until the next visit', () => {
  const model = create(), change = { fromRank: 30, toRank: 10, oldIndex: 29, newIndex: 9 };
  model.pointer('start', 100, 550, 10); model.pointer('move', 100, 450, 50);
  model.pointer('end', 100, 450, 200);
  assert.equal(model.settle(change, 210), false);
  assert.equal(model.frame(230).scrollOffset, 100);
  model.enter(300); assert.equal(model.settle(change, 310), true);
});

test('the floating player card remains inside the viewport even at first and last rank', () => {
  for (const [oldIndex, newIndex] of [[20, 0], [0, 39]]) {
    const model = create(); model.settle({ fromRank: oldIndex + 1, toRank: newIndex + 1, oldIndex, newIndex }, 0);
    for (let at = 0; at < 1120; at += 16) {
      const { rowY } = model.frame(at).rankMotion;
      assert.ok(rowY >= layout.listTop && rowY + layout.rowHeight <= layout.listTop + layout.listHeight);
    }
    const final = model.frame(1120); assert.equal(final.scrollOffset, target(newIndex));
  }
});

test('dragging has inertia, tapping stops it without becoming a row tap', () => {
  const model = create(); model.pointer('start', 100, 550, 0);
  model.pointer('move', 100, 500, 30); model.pointer('move', 100, 440, 60);
  assert.equal(model.pointer('end', 100, 440, 65), false);
  assert.equal(model.frame(65).scrollOffset, 110);
  assert.ok(model.frame(81).scrollOffset > 110);
  model.pointer('start', 100, 440, 90); const stopped = model.frame(90).scrollOffset;
  assert.equal(model.pointer('end', 100, 440, 95), false);
  assert.equal(advance(model, 95, 2200).scrollOffset, stopped);
});

test('both edges resist continued outward pulling smoothly and spring back', () => {
  for (const direction of [-1, 1]) {
    const model = create(); if (direction > 0) { model.locate(39, 0); model.frame(400); }
    model.pointer('start', 100, 440, 500);
    model.pointer('move', 100, 440 - direction * 40, 520); const first = model.frame(520).scrollOffset;
    model.pointer('move', 100, 440 - direction * 50, 540); const next = model.frame(540).scrollOffset;
    assert.ok((next - first) * direction > 0); assert.ok(Math.abs(next - first) < 10);
    model.pointer('end', 100, 440 - direction * 50, 545);
    assert.equal(advance(model, 545, 3200).scrollOffset, direction < 0 ? 0 : target(39));
  }
});

test('tap jitter stays a tap, and holding a drag before release prevents a fling', () => {
  const model = create(); model.pointer('start', 100, 450, 0); model.pointer('move', 102, 448, 20);
  assert.equal(model.pointer('end', 102, 448, 40), true);
  model.pointer('start', 100, 550, 100); model.pointer('move', 100, 450, 150);
  model.pointer('move', 100, 449, 300); model.pointer('end', 100, 449, 305);
  assert.equal(advance(model, 305, 2500).scrollOffset, 101);
});

test('wheel preserves full deltas, reverses promptly, and prevents late automatic movement', () => {
  const model = create(); model.wheel(800, 0); assert.equal(model.frame(0).scrollOffset, 0);
  const before = model.frame(64).scrollOffset; assert.ok(before > 0 && before < 800);
  model.wheel(-100, 64); assert.ok(model.frame(80).scrollOffset < before);
  assert.equal(model.settle({ fromRank: 9, toRank: 2, newIndex: 1 }, 80), false);
  const accumulated = create(); for (let at = 0; at < 100; at += 4) accumulated.wheel(8, at);
  assert.equal(advance(accumulated, 100, 2500).scrollOffset, 200);
});

test('resize and shrinking data clamp the range and stop any prior motion', () => {
  const model = create(); model.settle({ fromRank: 2, toRank: 30, oldIndex: 1, newIndex: 29 }, 0); model.frame(300);
  model.setLayout({ ...layout, listHeight: 380 }, 2, 310);
  const result = model.frame(1200); assert.equal(result.scrollOffset, 0);
  assert.equal(result.rankMotion, null); assert.equal(result.active, false);
});

test('touch cancellation springs back and invalid player indices cannot start animations', () => {
  const model = create(); assert.equal(model.settle({ newIndex: -1 }, 0), false);
  assert.equal(model.locate(40, 0), false);
  model.pointer('start', 100, 450, 10); model.pointer('move', 100, 500, 30);
  assert.equal(model.pointer('cancel', 100, 500, 40), false);
  assert.equal(advance(model, 40, 2500).scrollOffset, 0);
  model.reset(2600); assert.equal(model.frame(2600).active, false);
});
