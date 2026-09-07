'use strict';
// Original synthesized bell tones. No downloaded or third-party audio.
const fs = require('node:fs');
const path = require('node:path');
const rate = 22050;
for (const [name, notes] of Object.entries({ move: [523.25], collect: [659.25, 987.77], start: [392, 523.25, 659.25], win: [523.25, 659.25, 783.99, 1046.5] })) {
  const duration = name === 'move' ? .12 : notes.length * .12 + .3;
  const samples = Math.ceil(rate * duration); const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate; let v = 0;
    notes.forEach((f, j) => { const dt = t - j * .115; if (dt >= 0) v += Math.sin(dt * f * Math.PI * 2) * Math.exp(-dt * 13) * Math.min(1, dt * 200) * .38; });
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 24000), 44 + i * 2);
  }
  fs.mkdirSync(path.resolve(__dirname, '../assets'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../assets', name + '.wav'), data);
}
console.log('4 original sound effects generated.');
