'use strict';

// Quiet, short cues can overlap without building an unlimited native audio pool.
const CUES = {
  move: { volume: .17, gap: 90, duration: .16, priority: 0 },
  start: { volume: .25, gap: 400, duration: .72, priority: 2, duck: .7 },
  win: { volume: .3, gap: 700, duration: 1.12, priority: 3, duck: .45 },
  letter: { volume: .29, gap: 150, duration: .66, priority: 2, duck: .7 },
  seal: { volume: .26, gap: 150, duration: .54, priority: 2, duck: .7 },
  light: { volume: .26, gap: 180, duration: .72, priority: 2, duck: .7 },
  wind: { volume: .24, gap: 220, duration: .58, priority: 1 },
  bridge: { volume: .24, gap: 180, duration: .48, priority: 1 },
  wait: { volume: .18, gap: 120, duration: .28, priority: 0 },
  blocked: { volume: .2, gap: 180, duration: .26, priority: 1 },
  undo: { volume: .23, gap: 150, duration: .4, priority: 1 },
  tap: { volume: .17, gap: 90, duration: .13, priority: 0 },
  echo: { volume: .22, gap: 260, duration: .78, priority: 1 },
  fail: { volume: .26, gap: 700, duration: .86, priority: 3, duck: .5 },
  low: { volume: .2, gap: 1800, duration: .62, priority: 2, duck: .7 },
  page: { volume: .18, gap: 150, duration: .32, priority: 1 },
  open: { volume: .2, gap: 150, duration: .3, priority: 1 },
  close: { volume: .17, gap: 150, duration: .25, priority: 1 },
  toggle: { volume: .18, gap: 90, duration: .18, priority: 0 },
  reward: { volume: .27, gap: 450, duration: .92, priority: 2, duck: .6 },
};
const MUSIC_VOLUME = .28;

function createSound(platform) {
  const voices = [];
  const recent = Object.create(null);
  const suspended = new Set();
  let background = null;
  let mixTimer = null;
  let backgroundEnabled = false;
  let unlocked = platform.kind === 'wechat';

  function clearMixTimer() {
    clearTimeout(mixTimer);
    mixTimer = null;
  }

  // Duck only the music during meaningful cues. The user's music and effect
  // switches still operate independently, and idle playback needs no mix timer.
  function mixBackground() {
    clearMixTimer();
    if (!background || background.released || suspended.size) return;
    const voice = background;
    const target = voices.reduce((volume, effect) => Math.min(volume, MUSIC_VOLUME * effect.duck), MUSIC_VOLUME);
    const difference = target - voice.volume;
    voice.volume = Math.abs(difference) <= .002 ? target : voice.volume + difference * (difference < 0 ? .55 : .28);
    try { voice.audio.volume = voice.volume; } catch (_) { /* A closing native context may reject a volume update. */ }
    if (voice.volume !== target) mixTimer = setTimeout(mixBackground, 32);
  }

  function retire(voice) {
    if (!voice || voice.released) return;
    voice.released = true;
    clearTimeout(voice.timer);
    const index = voices.indexOf(voice);
    if (index !== -1) voices.splice(index, 1);
    if (background === voice) { background = null; clearMixTimer(); }
    else mixBackground();
    const audio = voice.audio;
    if (!audio) return;
    try {
      if (audio.offEnded) audio.offEnded(voice.finish);
      if (audio.offError) audio.offError(voice.finish);
      if (audio.removeEventListener) {
        audio.removeEventListener('ended', voice.finish);
        audio.removeEventListener('error', voice.finish);
      }
    } catch (_) { /* Some native SDK versions omit event removal. */ }
    try { if (audio.stop) audio.stop(); else audio.pause(); } catch (_) {}
    try {
      if (audio.destroy) audio.destroy();
      else {
        audio.removeAttribute('src');
        audio.load();
      }
    } catch (_) { /* A detached browser element may already be disposed. */ }
  }

  function createVoice(type, cue, loop) {
    const voice = { audio: null, priority: cue.priority || 0, duck: cue.duck || 1,
      volume: cue.volume, released: false, timer: null };
    voice.finish = function () { retire(voice); };
    try {
      const native = platform.kind === 'wechat' && platform.wx && platform.wx.createInnerAudioContext;
      if (native) voice.audio = platform.wx.createInnerAudioContext();
      else if (typeof Audio !== 'undefined') voice.audio = new Audio();
      if (!voice.audio) return null;
      const audio = voice.audio;
      audio.volume = cue.volume;
      audio.loop = Boolean(loop);
      if (audio.onEnded) audio.onEnded(voice.finish);
      if (audio.onError) audio.onError(voice.finish);
      if (audio.addEventListener) {
        audio.addEventListener('ended', voice.finish);
        audio.addEventListener('error', voice.finish);
      }
      audio.src = (native ? 'assets/' : '/assets/') + type + '.wav';
      if (voice.released) return null;
      if (loop) background = voice;
      else voices.push(voice);
      // onEnded is unreliable on a few native runtimes; bound their lifetime too.
      if (!loop) voice.timer = setTimeout(voice.finish, cue.duration * 1000 + 1000);
      const promise = audio.play();
      if (promise && promise.catch) promise.catch(voice.finish);
      mixBackground();
      return voice.released ? null : voice;
    } catch (_) {
      retire(voice);
      return null;
    }
  }

  function startBackground() {
    if (unlocked && !suspended.size && backgroundEnabled && !background) createVoice('ambience', { volume: MUSIC_VOLUME }, true);
  }

  function stopEffects() {
    voices.slice().forEach(retire);
    Object.keys(recent).forEach(type => { delete recent[type]; });
  }

  function stop() {
    backgroundEnabled = false;
    retire(background);
    stopEffects();
  }

  // Reasons are independent: returning from an ad must not unmute a hidden
  // game or override a phone call that still owns the device's audio.
  function suspend(reason) {
    suspended.add(reason);
    if (reason === 'hidden' && platform.kind !== 'wechat') unlocked = false;
    retire(background);
    stopEffects();
  }

  function resume(reason) {
    if (suspended.delete(reason)) startBackground();
  }

  if (platform.onAudioInterruptionBegin && platform.onAudioInterruptionEnd) {
    platform.onAudioInterruptionBegin(() => suspend('interruption'));
    platform.onAudioInterruptionEnd(() => resume('interruption'));
  }

  return {
    play(type) {
      if (suspended.size || !unlocked || !Object.prototype.hasOwnProperty.call(CUES, type)) return;
      // A new user gesture can recover from the browser's autoplay restriction.
      startBackground();
      const cue = CUES[type];
      const now = Date.now();
      if (recent[type] !== undefined && now - recent[type] < cue.gap) return;
      if (voices.length >= 3) {
        const quietest = voices.reduce((selected, voice) => voice.priority < selected.priority ? voice : selected);
        if (quietest.priority > cue.priority) return;
        retire(quietest);
      }
      recent[type] = now;
      createVoice(type, cue, false);
    },
    ambience(enabled) {
      backgroundEnabled = Boolean(enabled);
      if (backgroundEnabled) startBackground();
      else retire(background);
    },
    unlock() {
      if (suspended.size) return;
      unlocked = true;
      startBackground();
    },
    suspend,
    resume,
    stopEffects,
    stop,
    release() { stop(); unlocked = platform.kind === 'wechat'; },
  };
}

module.exports = { createSound, SOUND_TYPES: Object.freeze(Object.keys(CUES).concat('ambience')) };
