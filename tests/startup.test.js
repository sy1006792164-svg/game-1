'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { StartupLoader } = require('../src/startup');

const tick = () => new Promise(resolve => setImmediate(resolve));
function settle(loader) {
  for (let frame = 0; !loader.ready && frame < 100; frame++) loader.update(100);
  assert.equal(loader.ready, true);
}

test('loading starts one real task per frame, displays monotonic progress and holds 100 percent before entry', () => {
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
  loader.update(100); assert.equal(loader.ready, false);
  loader.update(80); assert.equal(loader.ready, true);
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
