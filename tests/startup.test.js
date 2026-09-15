'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StartupLoader } = require('../src/startup');
const { ART_FILE, ART_SIZE, ART_FRAMES, createArtAssets } = require('../src/art-assets');

const tick = () => new Promise(resolve => setImmediate(resolve));

test('bundled hand-painted atlas has real alpha and bounded source frames', () => {
  const fs = require('node:fs'), path = require('node:path');
  const image = fs.readFileSync(path.resolve(__dirname, '..', ART_FILE));
  assert.equal(image.readUInt32BE(16), ART_SIZE);
  assert.equal(image.readUInt32BE(20), ART_SIZE);
  assert.equal(image[25], 6, 'RGBA PNG retains its original transparent pixels');
  for (const [x, y, w, h] of Object.values(ART_FRAMES)) {
    assert.ok(x >= 0 && y >= 0 && x + w <= ART_SIZE && y + h <= ART_SIZE);
  }
});

test('art loading waits for real decoding, shares concurrent work and caches decoded sprites', async () => {
  let count = 0;
  const image = { width: ART_SIZE, height: ART_SIZE };
  const assets = createArtAssets({ createImage() { count++; return image; } });
  const first = assets.load(), second = assets.load();
  assert.equal(first, second); assert.equal(assets.ready, false); assert.equal(assets.get('courier'), null);
  assert.equal(image.src, ART_FILE);
  image.onload(); await first;
  assert.equal(assets.ready, true); assert.equal(assets.decodedBytes, ART_SIZE * ART_SIZE * 4);
  assert.equal(assets.get('courier').image, image);
  assert.equal(assets.get('courier'), assets.get('courier'), 'rendering does not allocate a sprite descriptor per frame');
  assert.equal(assets.get('toString'), null);
  await assets.load(); assert.equal(count, 1);
});

test('art failures keep startup closed and retry only the failed real resource', async () => {
  for (const failure of ['decode', 'wrong-size', 'factory']) {
    const images = [];
    let attempts = 0;
    const assets = createArtAssets({ createImage() {
      attempts++;
      if (failure === 'factory' && attempts === 1) throw new Error('decoder unavailable');
      const image = { width: failure === 'wrong-size' && attempts === 1 ? 100 : ART_SIZE, height: ART_SIZE };
      images.push(image); return image;
    } });
    const task = assets.load();
    if (failure === 'decode') images[0].onerror();
    else if (failure === 'wrong-size') images[0].onload();
    await assert.rejects(task);
    assert.equal(assets.ready, false); assert.equal(assets.decodedBytes, 0);
    const retry = assets.load(); images[images.length - 1].onload(); await retry;
    assert.equal(attempts, 2); assert.equal(assets.ready, true);
  }
});
function settle(loader) {
  for (let frame = 0; !loader.ready && frame < 100; frame++) loader.update(100);
  assert.equal(loader.ready, true);
}

test('loading starts one real task per frame and enters at 2500 ms after showing full progress', () => {
  const calls = [];
  const loader = new StartupLoader(['profile', 'saved route', 'album', 'home'].map(label => ({ label, run: () => calls.push(label) })));
  let previous = 0;
  for (let frame = 1; loader.progress < 1 && frame < 30; frame++) {
    loader.update(100);
    assert.equal(calls.length, Math.min(frame, 4), 'preparation stages yield between frames');
    assert.equal(loader.completed, calls.length);
    assert.ok(loader.progress >= previous);
    assert.ok(loader.progress <= loader.completed / 4, 'displayed progress never overtakes real completion');
    assert.equal(loader.ready, false, 'reaching 100 percent must leave a frame to paint it');
    previous = loader.progress;
  }
  assert.equal(loader.progress, 1);
  loader.update(99); assert.equal(loader.ready, false, '2499 ms is still the loading page');
  loader.update(1); assert.equal(loader.ready, true, '2500 ms completes the fixed loading duration');
  loader.update(100); assert.equal(calls.length, 4, 'completed preparation never replays');
});

test('an unresolved asynchronous task prevents 100 percent and does not start later tasks', async () => {
  let finish, calls = 0;
  const loader = new StartupLoader([
    { label: 'async resource', run: () => new Promise(resolve => { calls++; finish = resolve; }) },
    { label: 'home', run: () => { calls++; } },
  ]);
  for (let frame = 0; frame < 50; frame++) loader.update(100);
  assert.equal(loader.pending, true); assert.equal(loader.completed, 0);
  assert.equal(loader.progress, 0); assert.equal(loader.ready, false); assert.equal(calls, 1);
  finish(); await tick();
  assert.equal(loader.pending, false); assert.equal(loader.completed, 1);
  assert.equal(calls, 1, 'promise resolution does not start the next task outside the frame loop');
  settle(loader);
  assert.equal(loader.completed, 2); assert.equal(calls, 2); assert.equal(loader.progress, 1);
});

test('a thrown or rejected task can retry without repeating completed preparation or reducing progress', async () => {
  for (const asynchronous of [false, true]) {
    let completedCalls = 0, attempts = 0;
    const failure = new Error('resource temporarily unavailable');
    const loader = new StartupLoader([
      { label: 'saved route', run: () => { completedCalls++; } },
      { label: 'resource', run: () => {
        if (++attempts === 1) {
          if (asynchronous) return Promise.reject(failure);
          throw failure;
        }
      } },
    ]);
    loader.update(100); loader.update(100); await tick();
    assert.equal(loader.error, failure); assert.equal(loader.pending, false);
    assert.equal(loader.completed, 1); assert.equal(loader.ready, false);
    const progress = loader.progress;
    for (let frame = 0; frame < 20; frame++) loader.update(100);
    assert.equal(attempts, 1, 'failed tasks wait for an explicit retry');
    assert.equal(loader.progress, progress);
    loader.retry();
    assert.equal(loader.error, null); assert.equal(loader.progress, progress);
    settle(loader);
    assert.equal(attempts, 2); assert.equal(completedCalls, 1);
  }
});
