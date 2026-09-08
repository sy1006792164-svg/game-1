'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ListScroll: CollectionScroll } = require('../src/list-scroll');

function settle(scroll, start = 0) { for (let time = start; time < start + 2500; time += 16) scroll.update(time); }

test('dragging scrolls with the finger, coasts after release and stops when tapped', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(1200);
  scroll.begin(500, 0); scroll.move(450, 30); scroll.move(390, 60);
  assert.equal(scroll.offset, 110);
  assert.equal(scroll.end(65), true);
  scroll.update(81);
  assert.ok(scroll.offset > 110);
  scroll.begin(400, 90);
  assert.equal(scroll.velocity, 0);
  assert.equal(scroll.end(95), true, 'stopping inertia must not open a stamp');
});

test('overscroll resists the finger and springs back at both ends', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(700);
  scroll.begin(300, 0); scroll.move(550, 40); scroll.end(45);
  assert.ok(scroll.offset >= -64 && scroll.offset < 0);
  settle(scroll, 45);
  assert.equal(scroll.offset, 0);
  scroll.offset = scroll.max;
  scroll.begin(500, 3000); scroll.move(250, 3040); scroll.end(3045);
  assert.ok(scroll.offset > 700 && scroll.offset <= 764);
  settle(scroll, 3045);
  assert.equal(scroll.offset, 700);
});

test('continued pulling at either edge moves outward smoothly instead of snapping inward', () => {
  for (const direction of [-1, 1]) {
    const scroll = new CollectionScroll(); scroll.setBounds(700);
    scroll.offset = direction < 0 ? 0 : scroll.max;
    scroll.begin(300, 0); scroll.move(300 - direction * 40, 20);
    const first = scroll.offset;
    scroll.move(300 - direction * 50, 40);
    assert.ok((scroll.offset - first) * direction > 0, 'continuing outward cannot move content inward');
    assert.ok(Math.abs(scroll.offset - first) < 10, 'outward movement still has resistance');
    const held = scroll.offset;
    scroll.move(300 - direction * 50, 60); assert.equal(scroll.offset, held);
    scroll.end(60); settle(scroll, 60);
    assert.equal(scroll.offset, direction < 0 ? 0 : scroll.max);
  }
});

test('tap jitter stays a tap, holding before release does not fling, and resize clamps safely', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(700);
  scroll.begin(500, 0); scroll.move(497, 40);
  assert.equal(scroll.end(80), false);
  assert.equal(scroll.offset, 0);
  scroll.begin(500, 100); scroll.move(250, 140); scroll.end(500);
  assert.equal(scroll.velocity, 0);
  scroll.setBounds(100);
  assert.equal(scroll.offset, 100);
  scroll.setBounds(0); settle(scroll, 600);
  assert.equal(scroll.offset, 0);
});

test('wheel input scrolls smoothly and remains bounded under repeated fast input', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(900);
  scroll.wheel(90, 0);
  const start = scroll.offset;
  scroll.update(16);
  assert.ok(scroll.offset > start);
  for (let n = 0; n < 50; n++) { scroll.wheel(1000, n * 16); scroll.update(n * 16 + 16); }
  settle(scroll, 850);
  assert.equal(scroll.offset, 900);
});

test('a short flick travels several rows and tiny release samples preserve its momentum', () => {
  function flick(tail) {
    const scroll = new CollectionScroll(); scroll.setBounds(3000);
    scroll.begin(500, 0); scroll.move(450, 30); scroll.move(390, 60);
    if (tail !== null) scroll.move(390 + tail, 65);
    scroll.end(65); settle(scroll, 65);
    return scroll.offset;
  }
  const distance = flick(null);
  assert.ok(distance > 650 && distance < 900, 'a 110px flick should carry across several 140px rows');
  for (const tail of [-1, 0, 1]) assert.ok(Math.abs(flick(tail) - distance) < distance * .15, 'release jitter must not kill momentum');
});

test('holding before a slightly jittery release stops a flick and reversing changes direction', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(3000); scroll.offset = 500;
  scroll.begin(500, 0); scroll.move(450, 30); scroll.move(390, 60);
  scroll.move(389, 200); scroll.end(200);
  assert.equal(scroll.velocity, 0, 'a 140ms hold followed by 1px jitter must not fling');
  const held = scroll.offset; settle(scroll, 200); assert.equal(scroll.offset, held);
  scroll.begin(500, 3000); scroll.move(400, 3040); scroll.move(430, 3060); scroll.end(3065);
  assert.ok(scroll.velocity < 0, 'a deliberate reverse flick takes effect immediately');
  const reversed = scroll.offset; scroll.update(3080); assert.ok(scroll.offset < reversed);
});

test('flick distance is consistent across touch sample rates and display refresh rates', () => {
  const distances = [];
  for (const sampleMs of [8, 16, 32]) {
    for (const frameMs of [8, 16, 32]) {
      const scroll = new CollectionScroll(); scroll.setBounds(3000);
      scroll.begin(500, 0);
      for (let t = sampleMs; t <= 96; t += sampleMs) scroll.move(500 - t * 1.5, t);
      assert.equal(scroll.offset, 144);
      scroll.end(96);
      for (let t = 96 + frameMs; t < 2600; t += frameMs) scroll.update(t);
      distances.push(scroll.offset);
    }
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 2);
});

test('wheel animation preserves whole pages and high frequency deltas without instant jumps', () => {
  const page = new CollectionScroll(); page.setBounds(3000);
  page.wheel(800, 0);
  assert.equal(page.offset, 0, 'wheel motion is animated instead of jumping on input');
  page.update(16); assert.ok(page.offset > 0 && page.offset < 800);
  settle(page, 16); assert.equal(page.offset, 800, 'page deltas must not be truncated to 240px');
  const trackpad = new CollectionScroll(); trackpad.setBounds(3000);
  for (let t = 0; t < 100; t += 4) trackpad.wheel(8, t);
  settle(trackpad, 100);
  assert.equal(trackpad.offset, 200, 'all high-frequency trackpad deltas accumulate');
});

test('wheel reversal responds immediately and a touch stops wheel motion without clicking', () => {
  const scroll = new CollectionScroll(); scroll.setBounds(3000);
  scroll.wheel(800, 0); scroll.update(100);
  scroll.wheel(-100, 100); const before = scroll.offset;
  scroll.update(116); assert.ok(scroll.offset < before);
  scroll.begin(400, 120); const stopped = scroll.offset;
  assert.equal(scroll.end(125), true, 'interrupting wheel animation must not activate a card');
  settle(scroll, 125); assert.equal(scroll.offset, stopped);
});
