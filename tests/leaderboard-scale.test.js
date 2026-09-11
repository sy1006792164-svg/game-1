'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFriendLeaderboard, FRIEND_STORAGE_KEY: KEY } = require('../src/friend-leaderboard');
const { createOpenDataLeaderboard } = require('../open-data/index');

const CHANNEL = 'wind-letter-friends-v1', SCOPE = 'scope.WxFriendInteraction';

// Capture child pixels and then project them through the real main-domain
// drawImage call. Merely checking logical text positions misses a DPR reset.
function recordingCanvas() {
  let width = 1, height = 1, matrix, stack, path, fills, labels;
  const ctx = {
    font: '10px sans-serif', fillStyle: '',
    setTransform(...next) { matrix = next; },
    clearRect() { fills = []; labels = []; },
    save() { stack.push({ matrix: [...matrix], font: this.font, fillStyle: this.fillStyle }); },
    restore() { const saved = stack.pop(); if (saved) { matrix = saved.matrix; this.font = saved.font; this.fillStyle = saved.fillStyle; } },
    translate(x, y) { matrix[4] += matrix[0] * x + matrix[2] * y; matrix[5] += matrix[1] * x + matrix[3] * y; },
    scale(x, y) { matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y; },
    beginPath() { path = []; },
    moveTo(x, y) { path.push(point(x, y)); },
    lineTo(x, y) { path.push(point(x, y)); },
    arcTo(x1, y1, x2, y2) { path.push(point(x1, y1), point(x2, y2)); },
    arc(x, y, radius) { path.push(point(x - radius, y - radius), point(x + radius, y + radius)); },
    rect(x, y, w, h) { path.push(point(x, y), point(x + w, y + h)); },
    fill() { if (path.length) fills.push({ color: this.fillStyle, ...bounds(path) }); },
    fillRect(x, y, w, h) { fills.push({ color: this.fillStyle, ...bounds([point(x, y), point(x + w, y + h)]) }); },
    fillText(value, x, y) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      labels.push({ value: String(value), ...point(x, y), pixelSize: size * Math.hypot(matrix[2], matrix[3]) });
    },
    measureText(value) { return { width: Array.from(String(value)).length * Number(this.font.match(/([\d.]+)px/)[1]) * .55 }; },
    closePath() {}, clip() {}, stroke() {}, drawImage() {},
  };
  function point(x, y) { return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }; }
  function bounds(points) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  function reset() {
    matrix = [1, 0, 0, 1, 0, 0]; stack = []; path = []; fills = []; labels = [];
    ctx.font = '10px sans-serif'; ctx.fillStyle = '';
  }
  reset();
  return {
    get width() { return width; }, set width(value) { width = value; reset(); },
    get height() { return height; }, set height(value) { height = value; reset(); },
    getContext: () => ctx,
    project(x, y, w, h) {
      return {
        fills: fills.map(item => ({ color: item.color, x: x + item.x * w / width, y: y + item.y * h / height,
          w: item.w * w / width, h: item.h * h / height })),
        labels: labels.map(item => ({ value: item.value, x: x + item.x * w / width, y: y + item.y * h / height,
          size: item.pixelSize * h / height })),
      };
    },
  };
}

function harness(t, pixelRatio) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const canvas = recordingCanvas(), queue = [], requests = { mine: [], friends: [], identity: [], writes: [], authorization: [] };
  let receive, allowed = true;
  const api = {
    getSharedCanvas: () => canvas, onMessage: callback => { receive = callback; },
    // Message delivery occurs only after the main-domain operation has returned.
    getOpenDataContext: () => ({ canvas, postMessage: message => queue.push(message) }),
    authorize: options => requests.authorization.push(options),
    getUserCloudStorage: options => requests.mine.push(options),
    getFriendCloudStorage: options => requests.friends.push(options),
    getUserInfo: options => requests.identity.push(options),
    setUserCloudStorage: options => { requests.writes.push(options); options.success(); },
  };
  createOpenDataLeaderboard(api);
  const board = createFriendLeaderboard({ kind: 'wechat', wx: api }, {}, { canSync: () => allowed, canPreview: () => true });
  const dimensions = { width: 354, height: 470, pixelRatio };
  const deliver = () => { while (queue.length) receive(queue.shift()); };
  const send = message => { queue.push({ channel: CHANNEL, ...message }); deliver(); };
  const counts = () => Object.fromEntries(['mine', 'friends', 'identity', 'writes'].map(key => [key, requests[key].length]));
  const advance = ms => { for (let elapsed = 0; elapsed < ms; elapsed += 16) t.mock.timers.tick(Math.min(16, ms - elapsed)); };
  const draw = (w = dimensions.width, h = dimensions.height) => {
    let frame;
    assert.equal(board.draw({ drawImage(source, x, y, width, height) { frame = source.project(x, y, width, height); } }, 18, 120, w, h), true);
    return frame;
  };
  function resolve(index) {
    const record = { v: 2, stars: 12, completed: 4, turns: 34, name: '本人' };
    const KVDataList = [{ key: KEY, value: JSON.stringify(record) }];
    requests.identity[index].success({ data: [{ openId: 'native-me', nickName: '本人' }] });
    requests.mine[index].success({ KVDataList });
    requests.friends[index].success({ data: [{ openid: 'native-me', nickname: '本人', KVDataList }] });
    advance(400);
  }
  async function seed() {
    const opening = board.open(dimensions);
    requests.authorization[0].success(); await opening;
    deliver(); resolve(0);
  }
  t.after(() => { board.close(); deliver(); });
  return { board, canvas, dimensions, requests, deliver, send, counts, advance, draw, resolve, seed,
    allow: value => { allowed = value; } };
}

function assertFullSize(frame, width = 354) {
  const hero = frame.fills.find(item => item.color === '#316c5f' && item.w > 50);
  assert.ok(hero, 'the scorecard must remain painted during cached re-entry');
  assert.deepEqual(hero, { color: '#316c5f', x: 18, y: 120, w: width, h: 126 }, 'the card occupies its full main-domain viewport');
  const name = frame.labels.find(item => item.value === '本人');
  assert.deepEqual(name, { value: '本人', x: 85, y: 147, size: 15 }, 'cached text keeps its rendered position and font size');
}

for (const pixelRatio of [1, 1.5, 2]) {
  test(`cached leaderboard remains full size through asynchronous re-entry at DPR ${pixelRatio}`, async t => {
    const h = harness(t, pixelRatio);
    await h.seed(); assertFullSize(h.draw());
    assert.equal(h.canvas.width, 354 * pixelRatio); assert.equal(h.canvas.height, 470 * pixelRatio);
    h.board.close(); h.deliver();
    h.allow(false);
    const before = h.counts();
    assert.equal(h.board.preview(h.dimensions), true); h.deliver();
    assert.equal(h.board.getState().status, 'preview');
    // Simulate a slow read-only permission check while the player sees frames.
    for (let frame = 0; frame < 24; frame++) { h.advance(100); assertFullSize(h.draw()); }
    assert.equal(h.board.refresh(), false);
    assert.deepEqual(h.counts(), before, 'cached frames do not start cloud reads or writes');
    h.allow(true);
    assert.equal(h.board.revalidate({ [SCOPE]: true }), true); h.deliver();
    assertFullSize(h.draw());
    assert.deepEqual(h.counts(), before, 'validated alone does not fetch the ranking');
    await h.board.open(h.dimensions, { [SCOPE]: true });
    assertFullSize(h.draw(), 354); // The previous child frame still covers the viewport before delivery.
    h.deliver(); assertFullSize(h.draw());
    assert.equal(h.requests.friends.length, before.friends + 1);
    h.resolve(1); assertFullSize(h.draw());
  });

  test(`child preview and partial resize preserve painted scale at DPR ${pixelRatio}`, async t => {
    const h = harness(t, pixelRatio);
    await h.seed(); h.board.close(); h.deliver();
    h.board.preview(h.dimensions); h.deliver();
    const before = h.counts();
    h.send({ action: 'preview' }); assertFullSize(h.draw());
    // A host backing resize clears pixels and resets the native 2D transform.
    // The partial child message must restore its existing DPR for the next paint.
    h.canvas.width = 348 * pixelRatio; h.canvas.height = 480 * pixelRatio;
    h.send({ action: 'resize', width: 348, height: 480 }); assertFullSize(h.draw(348, 480), 348);
    h.send({ action: 'preview', width: 348, height: 480 }); assertFullSize(h.draw(348, 480), 348);
    h.advance(2400); assertFullSize(h.draw(348, 480), 348);
    assert.deepEqual(h.counts(), before, 'partial layout updates keep cached data offline');
  });
}

test('a pending friend permission callback never shrinks repeated cached frames', async t => {
  const h = harness(t, 2);
  await h.seed(); h.board.close(); h.deliver();
  h.board.preview(h.dimensions); h.deliver();
  const before = h.counts(), opening = h.board.open(h.dimensions);
  h.deliver();
  assert.equal(h.board.getState().status, 'preview');
  for (let frame = 0; frame < 12; frame++) { h.advance(200); assertFullSize(h.draw()); }
  assert.deepEqual(h.counts(), before);
  h.requests.authorization[1].success(); await opening; h.deliver();
  assertFullSize(h.draw()); h.resolve(1); assertFullSize(h.draw());
});
