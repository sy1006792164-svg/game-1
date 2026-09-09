'use strict';
// Original, deterministic synthesis. No recordings, downloads or dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createAmbience } = require('./ambience');
const RATE = 22050;
const TAU = Math.PI * 2;

function envelope(t, duration, attack) {
  if (t < 0 || t >= duration) return 0;
  return Math.min(1, t / (attack || .012)) * Math.pow(1 - t / duration, 2);
}

function note(t, frequency, duration, color) {
  const body = Math.sin(TAU * frequency * t);
  const overtone = Math.sin(TAU * frequency * 2 * t) * (color === 'wood' ? .26 : .12);
  return (body + overtone) * envelope(t, duration, color === 'soft' ? .035 : .008) * .42;
}

function phrase(notes, spacing, sustain, color) {
  return t => notes.reduce((sum, frequency, index) =>
    sum + note(t - index * spacing, frequency, sustain, color), 0);
}

function air(t, duration) {
  // A fixed, dense set of partials makes a breath without random noise or clicks.
  let value = 0;
  for (let i = 0; i < 18; i++) value += Math.sin(TAU * (410 + i * 71.37) * t + i * 1.7) / 18;
  return value * Math.sin(Math.PI * Math.max(0, Math.min(1, t / duration))) ** 2 * .34;
}

const sounds = {
  move: { duration: .16, sample: phrase([523.25], 0, .16, 'soft') },
  start: { duration: .72, sample: phrase([392, 523.25, 659.25], .13, .46, 'soft') },
  win: { duration: 1.12, sample: phrase([523.25, 659.25, 783.99, 1046.5], .17, .6, 'soft') },
  letter: { duration: .66, sample: phrase([783.99, 1046.5, 1318.51], .08, .49, 'soft') },
  seal: { duration: .54, sample: t => note(t, 196, .14, 'wood') + note(t - .075, 783.99, .45) },
  light: { duration: .72, sample: phrase([523.25, 783.99, 1046.5], .1, .5, 'soft') },
  wind: { duration: .58, sample: t => air(t, .58) + note(t, 392, .58, 'soft') * .15 },
  bridge: { duration: .48, sample: phrase([196, 293.66, 392], .09, .3, 'wood') },
  wait: { duration: .28, sample: t => note(t, 329.63, .28, 'soft') * .7 + air(t, .28) * .3 },
  blocked: { duration: .26, sample: phrase([196, 174.61], .095, .16, 'wood') },
  undo: { duration: .4, sample: phrase([523.25, 392, 329.63], .07, .25, 'soft') },
  tap: { duration: .13, sample: phrase([440], 0, .13, 'wood') },
  echo: { duration: .78, sample: t => note(t, 659.25, .35, 'soft') + note(t - .2, 987.77, .35, 'soft') * .5 + note(t - .43, 659.25, .35, 'soft') * .25 },
  fail: { duration: .86, sample: phrase([392, 329.63, 261.63], .18, .5, 'soft') },
  low: { duration: .62, sample: t => note(t, 261.63, .3, 'soft') * .7 + note(t - .31, 220, .3, 'soft') * .6 },
  ambience: createAmbience(),
};

function writeWav(name, duration, sample, rate = RATE) {
  const samples = Math.ceil(rate * duration);
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const value = sample(i / rate);
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error(name + ': invalid or clipped audio sample.');
    data.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.resolve(__dirname, '../assets', name + '.wav'), data);
  return data.length;
}

fs.mkdirSync(path.resolve(__dirname, '../assets'), { recursive: true });
const bytes = Object.entries(sounds).reduce((sum, [name, sound]) => sum + writeWav(name, sound.duration, sound.sample, sound.rate), 0);
console.log(Object.keys(sounds).length + ' original audio tracks generated (' + bytes + ' bytes).');
