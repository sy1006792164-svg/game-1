'use strict';

// Original paper, wood and felt instruments. Rendering happens only at build
// time; the native game plays the resulting short PCM files with no DSP work.
const TAU = Math.PI * 2;

function envelope(t, duration, attack = .008) {
  if (t <= 0 || t >= duration) return 0;
  return Math.min(1, t / attack) * (1 - t / duration) ** 2;
}

function felt(t, frequency, duration, gain = 1) {
  const phase = TAU * frequency * t;
  return (Math.sin(phase) + .17 * Math.sin(phase * 2) * Math.exp(-t * 13)
    + .035 * Math.sin(phase * 3) * Math.exp(-t * 26)) * envelope(t, duration, .014) * .43 * gain;
}

function wood(t, frequency, duration, gain = 1) {
  const phase = TAU * frequency * t;
  return (Math.sin(phase) * Math.exp(-t * 18) + .24 * Math.sin(phase * 2.71) * Math.exp(-t * 38))
    * envelope(t, duration, .004) * .58 * gain;
}

function chime(t, frequency, duration, gain = 1) {
  const phase = TAU * frequency * t;
  const body = Math.sin(phase) + .1 * Math.sin(phase * 2.003) * Math.exp(-t * 5)
    + .035 * Math.sin(phase * 3.01) * Math.exp(-t * 10);
  return body * envelope(t, duration, .009) * .41 * gain;
}

function paper(t, duration, gain = 1) {
  if (t <= 0 || t >= duration) return 0;
  let texture = 0;
  // Inharmonic, quiet partials avoid the piercing high frequencies of white noise.
  for (let i = 0; i < 14; i++) {
    const frequency = 620 + i * 179.47 + Math.sin(i * 2.31) * 116;
    texture += Math.sin(TAU * frequency * t + i * 1.79) / (1 + i * .14);
  }
  return texture / 14 * Math.sin(Math.PI * t / duration) ** 2 * .48 * gain;
}

function breath(t, duration, gain = 1) {
  if (t <= 0 || t >= duration) return 0;
  let value = 0;
  for (let i = 0; i < 12; i++) value += Math.sin(TAU * (185 + i * 49.37) * t + i * 1.7) / 12;
  return value * Math.sin(Math.PI * t / duration) ** 2 * .5 * gain;
}

function phrase(notes, spacing, sustain, instrument = felt) {
  return t => notes.reduce((sum, frequency, index) => sum + instrument(t - index * spacing, frequency, sustain, 1 - index * .07), 0);
}

function room(sample, duration, amount = .13) {
  return t => {
    if (t < 0 || t >= duration) return 0;
    const tail = Math.min(1, (duration - t) / .026);
    return (sample(t) + sample(t - .047) * amount + sample(t - .103) * amount * .45) * tail;
  };
}

function createEffectSounds() {
  const voices = {
    move: { duration: .16, sample: t => wood(t, 220, .11, .58) + paper(t - .018, .13, .3) },
    start: { duration: .72, sample: t => phrase([392, 523.25, 659.25], .13, .42)(t) + paper(t, .22, .24) },
    win: { duration: 1.12, sample: t => phrase([523.25, 659.25, 783.99, 1046.5], .16, .55, chime)(t)
      + felt(t - .34, 261.63, .72, .25) + paper(t - .04, .38, .3) },
    letter: { duration: .66, sample: t => paper(t, .24, .7) + phrase([783.99, 1046.5, 1318.51], .08, .39, chime)(t - .03) * .8 },
    seal: { duration: .54, sample: t => wood(t, 174.61, .13, .95) + paper(t - .03, .13, .32)
      + chime(t - .075, 783.99, .41, .65) + felt(t - .09, 392, .32, .2) },
    light: { duration: .72, sample: t => breath(t, .43, .35) + phrase([523.25, 783.99, 1046.5], .1, .43, chime)(t) * .88 },
    wind: { duration: .58, sample: t => breath(t, .58, 1.3) + paper(t - .1, .4, .26) + felt(t, 392, .55, .16) },
    bridge: { duration: .48, sample: t => paper(t, .24, .88) + wood(t, 174.61, .18, .7)
      + wood(t - .075, 146.83, .17, .5) + wood(t - .17, 130.81, .2, .32) },
    wait: { duration: .28, sample: t => felt(t, 329.63, .24, .45) + paper(t - .02, .2, .28) },
    blocked: { duration: .26, sample: t => wood(t, 196, .16, .68) + wood(t - .085, 174.61, .15, .45) },
    undo: { duration: .4, sample: t => phrase([523.25, 392, 329.63], .07, .23)(t) * .75 + paper(t, .32, .33) },
    tap: { duration: .13, sample: t => wood(t, 392, .13, .57) + paper(t - .018, .07, .2) },
    echo: { duration: .78, sample: t => chime(t, 659.25, .32, .8) + chime(t - .2, 987.77, .32, .4)
      + chime(t - .43, 659.25, .32, .21) + breath(t - .1, .58, .3) },
    fail: { duration: .86, sample: t => phrase([392, 329.63, 261.63], .18, .42)(t) * .83 + breath(t - .1, .65, .25) },
    low: { duration: .62, sample: t => felt(t, 261.63, .27, .65) + felt(t - .31, 220, .27, .55) },
    page: { duration: .32, sample: t => paper(t, .3, .95) + felt(t - .03, 523.25, .24, .2) },
    open: { duration: .3, sample: t => paper(t, .23, .44) + felt(t, 392, .19, .45) + felt(t - .065, 523.25, .21, .48) },
    close: { duration: .25, sample: t => paper(t, .23, .4) + felt(t, 523.25, .16, .38) + felt(t - .06, 392, .16, .4) },
    toggle: { duration: .18, sample: t => wood(t, 523.25, .12, .45) + wood(t - .045, 659.25, .12, .36) },
    reward: { duration: .92, sample: t => paper(t, .25, .48)
      + phrase([659.25, 783.99, 1046.5], .14, .49, chime)(t - .025) * .88
      + felt(t - .2, 329.63, .57, .27) },
  };
  for (const voice of Object.values(voices)) voice.sample = room(voice.sample, voice.duration);
  return voices;
}

module.exports = { createEffectSounds };
