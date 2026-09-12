'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSound, SOUND_TYPES } = require('../src/sound');
const { createEffectSounds } = require('../tools/effect-audio');

function harness(t, options = {}) {
  const contexts = [], callbacks = {};
  function context() {
    const listeners = new Map();
    const audio = {
      playing: false, destroyed: false, volumeWrites: [], _volume: 1,
      get volume() { return this._volume; },
      set volume(value) {
        assert.equal(this.destroyed, false, 'mixing must not touch a destroyed audio context');
        this.volumeWrites.push(value); this._volume = value;
      },
      play() { this.playing = true; if (options.rejectPlay) return Promise.reject(new Error('gesture required')); },
      stop() { this.playing = false; }, pause() { this.playing = false; },
      destroy() { this.destroyed = true; this.playing = false; },
      onEnded(handler) { listeners.set('ended', handler); }, offEnded() { listeners.delete('ended'); },
      onError(handler) { listeners.set('error', handler); }, offError() { listeners.delete('error'); },
      addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type) { listeners.delete(type); },
      removeAttribute() { this.src = ''; }, load() { this.destroyed = true; },
      emit(type) { if (listeners.has(type)) listeners.get(type)(); },
    };
    contexts.push(audio);
    return audio;
  }
  const platform = { kind: options.browser ? 'browser' : 'wechat', wx: { createInnerAudioContext: context },
    onAudioInterruptionBegin: handler => { callbacks.begin = handler; },
    onAudioInterruptionEnd: handler => { callbacks.end = handler; } };
  let create = createSound;
  if (options.browser) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/sound.js'), 'utf8'),
      { module, Audio: function () { return context(); }, Date, setTimeout, clearTimeout });
    create = module.exports.createSound;
  }
  const sound = create(platform);
  t.after(() => sound.release());
  return { sound, contexts, callbacks,
    effects: () => contexts.filter(audio => audio.playing && !audio.loop),
    music: () => contexts.find(audio => audio.playing && audio.loop) };
}

function advance(t, milliseconds) {
  for (let time = 0; time < milliseconds; time += 32) t.mock.timers.tick(32);
}

test('page and dialog cues share the bounded native pool and never evict important feedback', t => {
  const h = harness(t);
  h.sound.ambience(true);
  for (const type of ['move', 'page', 'open']) h.sound.play(type);
  assert.equal(h.effects().length, 3);
  const move = h.effects()[0];
  h.sound.play('reward');
  assert.equal(move.destroyed, true, 'an incoming reward may replace a footstep');
  assert.equal(h.effects().length, 3);
  h.sound.play('win'); h.sound.play('letter');
  const before = h.contexts.length;
  for (const type of ['tap', 'close', 'toggle']) h.sound.play(type);
  assert.equal(h.contexts.length, before, 'UI chatter cannot evict three important cues');
  assert.equal(h.effects().length, 3);
  assert.ok(h.music(), 'effect contention does not restart or remove music');
});

test('turning off effects clears active cues immediately without changing the music switch', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.sound.ambience(true);
  const background = h.music();
  h.sound.play('reward'); h.sound.play('page');
  assert.ok(background.volume < .28);
  h.sound.stopEffects();
  assert.equal(h.effects().length, 0);
  assert.equal(h.music(), background);
  advance(t, 640);
  assert.equal(background.volume, .28);
  h.sound.play('page');
  assert.equal(h.effects().length, 1, 'a later user action can use a freshly enabled effect channel');
});

test('music ducks for important cues and returns smoothly after the final cue ends', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.sound.ambience(true);
  const background = h.music();
  h.sound.play('page');
  assert.equal(background.volume, .28, 'routine UI feedback does not pump the music');
  h.sound.play('win');
  const win = h.effects().find(audio => audio.src.endsWith('/win.wav'));
  assert.ok(background.volume > .126 && background.volume < .28, 'duck attack is softened');
  advance(t, 320);
  assert.equal(background.volume, .28 * .45);
  win.emit('ended');
  assert.ok(background.volume > .126 && background.volume < .28, 'release is softened too');
  advance(t, 640);
  assert.equal(background.volume, .28);
  assert.equal(h.contexts.filter(audio => audio.loop).length, 1);
});

test('stopping music during a duck never revives it from a delayed mix callback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.sound.ambience(true); h.sound.play('reward');
  const background = h.music();
  h.sound.ambience(false);
  const writes = background.volumeWrites.length;
  advance(t, 3000);
  assert.equal(background.volumeWrites.length, writes);
  assert.equal(h.music(), undefined);
  assert.equal(h.effects().length, 0, 'fallback timeout also frees cues when ended never fires');
  h.sound.play('open');
  assert.equal(h.effects().length, 1, 'music and effects remain independent');
  assert.equal(h.music(), undefined);
});

test('background, advertisement and interruption locks also cancel every mix callback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.sound.ambience(true); h.sound.play('win');
  h.sound.suspend('hidden'); h.sound.suspend('ad'); h.callbacks.begin();
  const count = h.contexts.length;
  const writes = h.contexts.map(audio => audio.volumeWrites.length);
  advance(t, 3000);
  h.sound.resume('ad'); h.callbacks.end(); h.sound.unlock(); h.sound.play('reward');
  assert.equal(h.contexts.length, count);
  assert.deepEqual(h.contexts.map(audio => audio.volumeWrites.length), writes);
  assert.equal(h.effects().length, 0);
  assert.equal(h.music(), undefined);
  h.sound.resume('hidden');
  assert.equal(h.contexts.length, count + 1);
  assert.equal(h.music().volume, .28, 'resuming starts with no stale duck or effect');
  assert.equal(h.effects().length, 0);
});

test('browser feedback requires a user unlock and never replays old cues after backgrounding', t => {
  const h = harness(t, { browser: true });
  h.sound.ambience(true); h.sound.play('page');
  assert.equal(h.contexts.length, 0);
  h.sound.unlock(); h.sound.play('page');
  assert.equal(h.effects().length, 1);
  assert.ok(h.music());
  h.sound.suspend('hidden'); h.sound.resume('hidden'); h.sound.play('open');
  assert.equal(h.effects().length, 0);
  assert.equal(h.music(), undefined);
  h.sound.unlock();
  assert.ok(h.music());
  assert.equal(h.effects().length, 0);
});

test('rejected browser playback retires the voice and its pending mixer work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t, { browser: true, rejectPlay: true });
  h.sound.ambience(true); h.sound.unlock(); h.sound.play('reward');
  await Promise.resolve(); await Promise.resolve();
  advance(t, 3000);
  assert.ok(h.contexts.every(audio => audio.destroyed));
  assert.equal(h.effects().length, 0);
  assert.equal(h.music(), undefined);
});

test('rapid repeated feedback is debounced and native ended/error callbacks retire just once', t => {
  const h = harness(t);
  h.sound.play('page'); h.sound.play('page'); h.sound.play('unknown');
  assert.equal(h.contexts.length, 1);
  const page = h.contexts[0];
  page.emit('ended'); page.emit('error');
  assert.equal(page.destroyed, true);
  assert.equal(h.effects().length, 0);
  h.sound.stopEffects(); h.sound.play('page');
  assert.equal(h.effects().length, 1);
});

test('every registered cue has complete PCM audio, headroom, quiet boundaries and current synthesis', () => {
  const effectSounds = createEffectSounds();
  assert.deepEqual(Object.keys(effectSounds).sort(), SOUND_TYPES.filter(name => name !== 'ambience').sort());
  for (const name of SOUND_TYPES) {
    const wav = fs.readFileSync(path.join(__dirname, '../assets', name + '.wav'));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(wav.readUInt32LE(4), wav.length - 8, name);
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE', name);
    assert.equal(wav.readUInt16LE(20), 1, name + ' is uncompressed PCM');
    assert.equal(wav.readUInt16LE(22), 1, name + ' is mono');
    assert.equal(wav.readUInt16LE(34), 16, name + ' uses signed 16-bit samples');
    assert.equal(wav.readUInt32LE(40), wav.length - 44, name + ' has a complete payload');
    const samples = (wav.length - 44) / 2, rate = wav.readUInt32LE(24);
    let peak = 0, squareSum = 0, mean = 0;
    for (let i = 0; i < samples; i++) {
      const value = wav.readInt16LE(44 + i * 2) / 32767;
      peak = Math.max(peak, Math.abs(value)); squareSum += value * value; mean += value;
    }
    assert.ok(peak > .015 && peak < .9, name + ' has usable signal and headroom: ' + peak);
    assert.ok(Math.sqrt(squareSum / samples) > .007, name + ' is not an empty or inaudible file');
    assert.ok(Math.abs(mean / samples) < .004, name + ' has no significant DC offset');
    if (name === 'ambience') {
      const value = index => wav.readInt16LE(44 + index * 2);
      let boundaryStep = 0;
      for (let i = 1; i <= 24; i++) boundaryStep = Math.max(boundaryStep,
        Math.abs(value(i) - value(i - 1)), Math.abs(value(samples - i) - value(samples - i - 1)));
      assert.ok(Math.abs(value(0) - value(samples - 1)) <= boundaryStep * 1.25,
        'music loop boundary is as continuous as its neighboring waveform');
    } else {
      assert.equal(samples, Math.ceil(effectSounds[name].duration * rate), name + ' keeps its intended timing');
      assert.equal(wav.readInt16LE(44), 0, name + ' starts without a click');
      assert.ok(Math.abs(wav.readInt16LE(wav.length - 2)) <= 1, name + ' ends without a click');
      for (let i = 0; i < samples; i += 997) {
        assert.equal(wav.readInt16LE(44 + i * 2), Math.round(effectSounds[name].sample(i / rate) * 32767) || 0,
          name + ' matches the deterministic generator');
      }
    }
  }
});
