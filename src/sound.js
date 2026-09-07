'use strict';
function createSound(platform) {
  const voices = {};
  const types = ['move', 'collect', 'start', 'win'];
  types.forEach(type => {
    try {
      if (platform.kind === 'wechat' && platform.wx.createInnerAudioContext) {
        const audio = platform.wx.createInnerAudioContext();
        audio.src = 'assets/' + type + '.wav'; audio.volume = type === 'move' ? .16 : .32;
        audio.onError(() => {}); voices[type] = audio;
      } else if (typeof Audio !== 'undefined') {
        const audio = new Audio('/assets/' + type + '.wav'); audio.volume = type === 'move' ? .16 : .32; voices[type] = audio;
      }
    } catch (_) { /* Sound is optional, never block game input. */ }
  });
  return {
    play(type) {
      const audio = voices[type] || voices.move;
      if (!audio) return;
      try {
        if (audio.stop) { audio.stop(); audio.seek(0); } else audio.currentTime = 0;
        const promise = audio.play(); if (promise && promise.catch) promise.catch(() => {});
      } catch (_) { /* The host may require an initial user gesture. */ }
    },
    stop() { Object.values(voices).forEach(audio => { try { if (audio.stop) audio.stop(); else audio.pause(); } catch (_) {} }); }
  };
}
module.exports = { createSound };
