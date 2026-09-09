'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { leaderboardLayout, paintLeaderboard } = require('../open-data/leaderboard-view');
const { createFriendLeaderboard } = require('../src/friend-leaderboard');
const { createRankMotion } = require('../open-data/rank-motion');

const row = extra => ({ rank: 1, nickname: '茶杯', avatarUrl: '', stars: 3, completed: 1, turns: 4, isMe: false, ...extra });
function draw(overrides = {}) {
  const labels = [], clips = [], transforms = [], stack = [];
  let clip = null, pathRect = null;
  const ctx = new Proxy({ font: '', measureText: value => ({ width: Array.from(String(value)).length * 7 }),
    save: () => stack.push(clip), restore: () => { clip = stack.pop(); },
    beginPath: () => { pathRect = null; }, rect: (x, y, w, h) => { pathRect = { x, y, w, h }; },
    clip: () => { if (pathRect) { clip = pathRect; clips.push(clip); } },
    scale: (x, y) => transforms.push({ x, y }),
    fillText: (value, x, y) => labels.push({ value: String(value), x, y, clip }) }, { get: (o, k) => k in o ? o[k] : () => {} });
  const model = { width: 354, height: 530, rows: [row()], self: row({ isMe: true }), scrollOffset: 0, status: 'ready', ...overrides };
  const hits = paintLeaderboard(ctx, model, () => {});
  return { hits, labels, model, clips, transforms };
}

test('a single friend list keeps my score above rows without refresh or paging controls', () => {
  const h = draw();
  assert.deepEqual(h.hits, []);
  assert.equal(h.labels.some(item => /刷新成绩|定位我|继续送信|上一页|下一页|\d \/ \d/.test(item.value)), false);
  assert.ok(h.labels.find(item => item.value === '总星数').y < h.labels.find(item => item.value === '好友成绩').y);
  assert.ok(h.labels.some(item => item.value === '每一封送达，都让星光更近'));
});

test('short-list hint travels with rows during pulls in either direction and keeps the same gap', () => {
  for (const count of [1, 2]) for (const height of [400, 470, 614]) {
    const ui = leaderboardLayout(354, height), rows = Array.from({ length: count }, (_, i) => row({ rank: i + 1, nickname: '好友' + i, isMe: i === count - 1 }));
    const initial = draw({ height, rows, self: rows.at(-1) }).labels.find(v => v.value === '每一封送达，都让星光更近');
    for (const offset of [-64, -32, 0, 32, 64]) {
      const h = draw({ height, rows, self: rows.at(-1), scrollOffset: offset });
      const hint = h.labels.find(v => v.value === '每一封送达，都让星光更近');
      assert.ok(hint, 'pulling never toggles the hint on or off');
      assert.equal(hint.y, initial.y - offset, 'hint and rows receive the same scroll displacement');
      assert.deepEqual(hint.clip, { x: 0, y: ui.listTop, w: 354, h: ui.listHeight });
      const last = h.labels.find(v => v.value === '我 · 好友' + (count - 1));
      if (last) assert.equal(hint.y - 21 - (last.y + ui.rowHeight / 2 + 11), 14, 'the panel never covers the last row');
      assert.deepEqual(h.hits, [], 'the decorative hint cannot intercept a gesture');
    }
  }
});

test('hint visibility stays stable near the available-height boundary and is absent in long lists', () => {
  for (const [height, count, visible] of [[314, 1, false], [315, 1, true], [378, 2, false], [379, 2, true], [432, 2, false], [433, 2, true], [614, 3, false], [614, 32, false]]) {
    const rows = Array.from({ length: count }, (_, i) => row({ rank: i + 1 }));
    for (const offset of [-64, 0, 64]) {
      const h = draw({ height, rows, scrollOffset: offset });
      assert.equal(h.labels.some(v => v.value === '每一封送达，都让星光更近'), visible, height + '/' + count + '/' + offset);
    }
  }
});

test('hint stays below a floating self card for every landing frame and after gesture interruption', () => {
  for (const [count, fromRank, toRank] of [[1, 2, 1], [2, 3, 2], [2, 1, 2], [2, 2, 1]]) {
    const height = 470, ui = leaderboardLayout(354, height), model = createRankMotion();
    const rows = Array.from({ length: count }, (_, i) => row({ rank: i + 1, nickname: '好友' + i, isMe: i === toRank - 1 }));
    model.setLayout(ui, count, 0); model.enter(0);
    model.settle({ fromRank, toRank, oldIndex: fromRank - 1, newIndex: toRank - 1, count }, 0);
    const check = now => {
      const frame = model.frame(now);
      const h = draw({ height, rows, self: rows[toRank - 1], scrollOffset: frame.scrollOffset,
        rankMotion: frame.rankMotion && { ...frame.rankMotion, active: true } });
      const hint = h.labels.find(v => v.value === '每一封送达，都让星光更近');
      assert.ok(hint);
      for (const card of h.labels.filter(v => /^(我 · )?好友\d$/.test(v.value) && v.clip)) {
        assert.ok(hint.y - 21 >= card.y + ui.rowHeight / 2 + 11 + 14 - 1e-6, 'hint remains below every visible card, including the floating self');
      }
      assert.deepEqual(hint.clip, { x: 0, y: ui.listTop, w: 354, h: ui.listHeight });
    };
    for (let now = 0; now <= 1152; now += 16) check(now);
    model.enter(1200); model.settle({ fromRank, toRank, oldIndex: fromRank - 1, newIndex: toRank - 1 }, 1200);
    model.frame(1300); model.pointer('start', 100, ui.listTop + 20, 1300);
    model.pointer('move', 100, ui.listTop + 120, 1340); check(1340);
    model.pointer('end', 100, ui.listTop + 120, 1340);
    for (let now = 1356; now < 3200; now += 16) check(now);
  }
});

test('continuous rows scroll by pixels and stay clipped clear of the fixed header and footer', () => {
  for (const height of [280, 470, 614]) {
    const layout = leaderboardLayout(354, height), rows = Array.from({ length: 100 }, (_, i) => row({ rank: i + 1, nickname: '好友' + (i + 1) }));
    const first = draw({ height, rows }), offset = layout.stride * 2 + 17;
    const middle = draw({ height, rows, scrollOffset: offset, updatedAt: 1 });
    const last = draw({ height, rows, scrollOffset: rows.length * layout.stride - 8 - layout.listHeight });
    assert.deepEqual(first.hits, []);
    assert.equal(middle.labels.some(item => /刷新成绩|定位我|继续送信|上一页|下一页|\d \/ \d/.test(item.value)), false);
    const visible = middle.labels.filter(item => /^好友\d+$/.test(item.value));
    assert.equal(visible[0].value, '好友3');
    assert.equal(visible[0].y, layout.listTop - 17 + layout.rowHeight / 2 - 11);
    assert.ok(visible.length <= Math.ceil(layout.listHeight / layout.stride) + 1, 'only intersecting rows are drawn');
    for (const item of visible) assert.deepEqual(item.clip, { x: 0, y: layout.listTop, w: 354, h: layout.listHeight });
    assert.equal(last.labels.some(item => item.value === '好友100'), true);
    assert.equal(last.labels.some(item => item.value === '好友1'), false);
    const footer = middle.labels.find(item => item.value.startsWith('更新于'));
    assert.equal(footer.clip, null);
    assert.ok(footer.y > layout.listBottom);
    assert.equal(middle.labels.find(item => item.value === '好友成绩').clip, null);
  }
});

test('edge rebound remains visible without a self-location button when my row is outside the viewport', () => {
  const layout = leaderboardLayout(354, 470), rows = Array.from({ length: 11 }, (_, i) => row({ rank: i + 1, nickname: '好友' + (i + 1), isMe: i === 10 }));
  const top = draw({ height: 470, rows, self: rows[10], scrollOffset: -18 });
  assert.equal(top.labels.find(item => item.value === '好友1').y, layout.listTop + 18 + layout.rowHeight / 2 - 11);
  assert.deepEqual(top.hits, []);
  assert.equal(top.labels.some(item => item.value === '定位我'), false);
  assert.ok(top.labels.some(item => item.value === '上下滑动'));
  const bottom = draw({ height: 470, rows, self: rows[10], scrollOffset: rows.length * layout.stride - 8 - layout.listHeight });
  assert.deepEqual(bottom.hits, []);
});

test('the extended ranking viewport gives the reclaimed footer space to friend rows', () => {
  for (const H of [700, 760, 844]) {
    const previous = leaderboardLayout(354, H - 230), current = leaderboardLayout(354, H - 158);
    assert.equal(current.listHeight - previous.listHeight, 72);
    const rows = Array.from({ length: 50 }, (_, i) => row({ rank: i + 1, nickname: '好友' + (i + 1), isMe: i === 49 }));
    const h = draw({ height: H - 158, rows, self: rows[49] });
    assert.deepEqual(h.hits, []);
    assert.equal(h.labels.some(item => item.value === '定位我'), false);
    assert.deepEqual(h.clips, [{ x: 0, y: current.listTop, w: 354, h: current.listHeight }]);
  }
});

test('automatic updates preserve visible scores and only actual errors offer retry', () => {
  const h = draw({ refreshing: true });
  assert.ok(h.labels.some(item => item.value === '茶杯'));
  assert.deepEqual(h.hits, []);
  assert.ok(h.labels.some(item => item.value === '更新中…'));
  assert.equal(draw({ status: 'denied', rows: [], self: null }).hits.length, 0);
  assert.deepEqual(draw({ status: 'error', rows: [], self: null }).hits.map(hit => hit.action), ['retry']);
  assert.deepEqual(draw({ status: 'error', refreshing: true }).hits, []);
});

test('unknown own scores stay unknown and refresh failures take precedence over old sync messages', () => {
  const h = draw({ self: null, rows: [], status: 'error', notice: '刷新未成功，已保留上次成绩', sync: { status: 'saved', message: '已保存到微信' } });
  assert.equal(h.labels.filter(item => item.value === '—').length, 3);
  assert.ok(h.labels.some(item => item.value === '刷新未成功，已保留上次成绩'));
  assert.equal(h.labels.some(item => item.value === '已保存到微信'), false);
});

test('rank changes animate the genuine self card once while the hero always states the final rank', () => {
  const layout = leaderboardLayout(354, 470);
  for (const direction of ['up', 'down']) {
    const fromRank = direction === 'up' ? 11 : 2, toRank = 8;
    const rows = Array.from({ length: 11 }, (_, i) => row({ rank: i + 1, nickname: '好友' + (i + 1), isMe: i === toRank - 1 }));
    const rankMotion = { fromRank, toRank, direction, progress: .875, active: true, rowY: layout.listTop + 30 };
    const result = draw({ height: 470, rows, self: rows[toRank - 1], rankMotion });
    assert.equal(result.labels.some(item => item.value === '定位我'), false);
    assert.deepEqual(result.hits, [], 'automatic rank landing remains independent of manual controls');
    assert.ok(result.labels.some(item => item.value === '我的名次  8'));
    assert.ok(result.labels.some(item => item.value === (direction === 'up' ? '↑ 上升 3 名' : '↓ 下降 6 名')));
    assert.ok(result.labels.some(item => item.value === fromRank + ' →'));
    assert.ok(result.labels.some(item => item.value === '8' && item.x === 354 - 64 && item.y > 35 && item.y < 51), 'only the genuine destination digit transitions');
    const ownCards = result.labels.filter(item => item.value === '我 · 好友8');
    assert.equal(ownCards.length, 1);
    assert.equal(ownCards[0].y, rankMotion.rowY + layout.rowHeight / 2 - 11);
    assert.deepEqual(ownCards[0].clip, { x: 0, y: layout.listTop, w: 354, h: layout.listHeight });
    assert.ok(result.transforms.some(scale => scale.x !== 1 || scale.y !== 1), 'the self card settles with a restrained landing pulse');
    const settled = draw({ height: 470, rows, self: rows[toRank - 1], rankChange: { fromRank, toRank, direction }, scrollOffset: 5 * layout.stride });
    assert.ok(settled.labels.some(item => item.value === fromRank + ' → 8'));
    assert.equal(settled.labels.some(item => item.value === fromRank + ' →'), false);
    assert.equal(settled.labels.find(item => item.value === '我 · 好友8').y, layout.listTop + 2 * layout.stride + layout.rowHeight / 2 - 11);
  }
});

test('shared-canvas taps only forward finite in-bounds coordinates while the permission gate is open', async () => {
  const messages = []; let allowed = true;
  const board = createFriendLeaderboard({ kind: 'wechat', wx: {
    authorize: options => options.success(), getOpenDataContext: () => ({ canvas: { width: 1, height: 1 }, postMessage: msg => messages.push(msg) })
  } }, {}, { canSync: () => allowed });
  assert.equal(board.tap(20, 20), false);
  await board.open({ width: 354, height: 470, pixelRatio: 2 });
  messages.length = 0;
  for (const point of [[NaN, 0], [1, Infinity], [-1, 50], [355, 50], [50, 471]]) assert.equal(board.tap(...point), false);
  assert.equal(board.tap(290, 146), true);
  assert.equal(messages.length, 1);
  assert.deepEqual(Object.keys(messages[0]).sort(), ['action', 'channel', 'key', 'x', 'y']);
  assert.equal(messages[0].action, 'tap');
  assert.equal(messages[0].x, 290);
  allowed = false; assert.equal(board.tap(290, 146), false);
  allowed = true; board.close(); assert.equal(board.tap(290, 146), false);
});
