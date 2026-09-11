'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawSettings, ROWS } = require('../src/settings-view');
const { CONTROL } = require('../src/controls');
const { GAME_NAME, VERSION } = require('../src/config');

function harness(options = {}) {
  const calls = [], hits = [], buttons = [], events = [];
  const settings = { sound: true, music: false, haptics: true, reducedMotion: false, ...options.settings };
  const ctx = { globalAlpha: 1, save() {}, restore() {} };
  const r = {
    H: options.H || 700, now: 1000, ctx,
    header(title, subtitle, action) { calls.push({ method: 'header', args: [title, subtitle, action] }); },
    panel(...args) { calls.push({ method: 'panel', args }); },
    text(...args) { calls.push({ method: 'text', args }); },
    round(...args) { calls.push({ method: 'round', args }); },
    circle(...args) { calls.push({ method: 'circle', args }); },
    hit(x, y, w, h, action) { hits.push({ x, y, w, h, action }); },
    button(label, x, y, w, h, action, style) {
      buttons.push({ label, x, y, w, h, action, style });
      hits.push({ x, y, w, h, action });
    },
    wrapLines(value, width, size) {
      const length = Math.max(1, Math.floor(width / size));
      return String(value).match(new RegExp('.{1,' + length + '}', 'gu')) || [''];
    },
  };
  const game = {
    platform: { kind: options.kind || 'wechat', reducedMotion: options.systemReduced === true },
    store: { getStatus: () => ({ persisted: options.persisted !== false }) },
    profile: () => ({ settings }), toastUntil: 0,
    home: () => events.push('home'), toggle: key => events.push(key), resetPrompt: () => events.push('reset'),
  };
  drawSettings(r, game);
  return { r, calls, hits, buttons, events, game, labels: calls.filter(call => call.method === 'text').map(call => call.args[0]) };
}

test('settings view exposes four persisted choices with full-row touch targets', () => {
  for (const H of [700, 844]) {
    const h = harness({ H });
    assert.deepEqual(ROWS.map(row => row.key), ['sound', 'music', 'haptics', 'reducedMotion']);
    for (const title of ['操作音效', '背景音乐', '硬件振动', '减少动态效果']) assert.ok(h.labels.includes(title));
    const toggleHits = h.hits.slice(0, 4);
    assert.equal(toggleHits.length, 4);
    assert.ok(toggleHits.every(hit => hit.x >= 0 && hit.x + hit.w <= 390 && hit.w >= 44 && hit.h >= 44));
    toggleHits.forEach(hit => hit.action());
    assert.deepEqual(h.events, ['sound', 'music', 'haptics', 'reducedMotion']);
    const clear = h.buttons.find(button => button.label === '清除这台设备的数据');
    assert.ok(clear);
    assert.equal(clear.h, CONTROL.compactHeight);
    assert.ok(clear.y >= 0 && clear.y + clear.h < H - 18);
    clear.action(); assert.equal(h.events.at(-1), 'reset');
    h.calls.find(call => call.method === 'header').args[2](); assert.equal(h.events.at(-1), 'home');
    assert.equal(h.labels.some(label => String(label).includes(GAME_NAME) || String(label).includes(VERSION)), false,
      'settings does not render product or version metadata');
  }
});

test('settings view explains platform limits, system motion preference and failed persistence truthfully', () => {
  const h = harness({ kind: 'browser', systemReduced: true, persisted: false });
  assert.ok(h.labels.includes('当前平台不支持硬件振动'));
  assert.ok(h.labels.includes('手动关闭 · 系统仍保持开启'));
  assert.match(h.labels.join(''), /原存档会尽量保留.*新变化可能仅在本次运行有效/);
  assert.equal(h.hits.length, 4, 'three supported toggles and the clear button remain actionable');
  assert.equal(h.events.includes('haptics'), false);
});
