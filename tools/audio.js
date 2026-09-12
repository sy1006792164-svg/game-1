'use strict';
// Original, deterministic synthesis. No recordings, downloads or dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { createAmbience } = require('./ambience');
const { createEffectSounds } = require('./effect-audio');
const RATE = 22050;

const sounds = {
  ...createEffectSounds(),
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
