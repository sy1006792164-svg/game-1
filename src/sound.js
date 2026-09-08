'use strict';
function createSound(platform) {
  const voices = {};
  const types = ['move', 'collect', 'start', 'win'];

  function stopVoice(audio) {
    try { if (audio.stop) audio.stop(); else audio.pause(); } catch (_) {}
  }
  function releaseVoice(audio) {
    stopVoice(audio);
    try { if (audio.destroy) audio.destroy(); } catch (_) {}
  }
  function voice(type) {
    const key = types.indexOf(type) >= 0 ? type : 'move';
    if (voices[key]) return voices[key];
    let audio;
    try {
      if (platform.kind === 'wechat' && platform.wx.createInnerAudioContext) {
        audio = platform.wx.createInnerAudioContext();
        audio.onError(() => {});
        audio.src = 'assets/' + key + '.wav'; audio.volume = key === 'move' ? .16 : .32;
      } else if (typeof Audio !== 'undefined') {
        audio = new Audio('/assets/' + key + '.wav'); audio.volume = key === 'move' ? .16 : .32;
      }
      if (audio) voices[key] = audio;
      return audio;
    } catch (_) {
      // A partially initialized native context still owns resources.
      if (audio) releaseVoice(audio);
      return null;
    }
  }
  return {
    play(type) {
      const audio = voice(type);
      if (!audio) return;
      try {
        if (audio.stop) { audio.stop(); audio.seek(0); } else audio.currentTime = 0;
        const promise = audio.play(); if (promise && promise.catch) promise.catch(() => {});
      } catch (_) { /* The host may require an initial user gesture. */ }
    },
    stop() { Object.values(voices).forEach(stopVoice); },
    release() {
      Object.keys(voices).forEach(type => { releaseVoice(voices[type]); delete voices[type]; });
    }
  };
}
module.exports = { createSound };
