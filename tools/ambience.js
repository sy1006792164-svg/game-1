'use strict';

// A quiet, original piano waltz. Sixteen bars at 90 BPM make a 32-second loop.
const RATE = 16000;
const BEAT = 60 / 90;
const BAR = BEAT * 3;
const TAU = Math.PI * 2;

// MIDI pitches: bass, close chord voicing, then [beat, pitch, length] melody notes.
const SCORE = [
  { bass: 48, chord: [60, 64, 67], melody: [[0, 76, 1.5], [1.5, 79, .5], [2, 76, 1]] },
  { bass: 45, chord: [60, 64, 69], melody: [[0, 74, 1], [1, 72, 2]] },
  { bass: 41, chord: [60, 65, 69], melody: [[.5, 72, 1], [1.5, 76, .5], [2, 77, 1]] },
  { bass: 43, chord: [59, 62, 67], melody: [[0, 74, 2]] },
  { bass: 40, chord: [60, 64, 67], melody: [[0, 76, 1], [1, 79, 1], [2, 81, 1]] },
  { bass: 45, chord: [60, 64, 69], melody: [[0, 79, 1.5], [1.5, 76, 1.5]] },
  { bass: 41, chord: [60, 65, 69], melody: [[0, 77, 1], [1, 76, 1], [2, 72, 1]] },
  { bass: 43, chord: [59, 62, 67], melody: [[0, 74, 2]] },
  { bass: 45, chord: [60, 64, 69], melody: [[.5, 76, 1], [1.5, 72, 1.5]] },
  { bass: 40, chord: [59, 64, 67], melody: [[0, 71, 1], [1, 74, 1], [2, 76, 1]] },
  { bass: 41, chord: [60, 65, 69], melody: [[0, 77, 1.5], [1.5, 76, .5], [2, 72, 1]] },
  { bass: 38, chord: [60, 62, 65], melody: [[0, 74, 2]] },
  { bass: 41, chord: [60, 65, 69], melody: [[0, 72, 1], [1, 76, 1], [2, 77, 1]] },
  { bass: 43, chord: [59, 62, 67], melody: [[0, 74, 1], [1, 71, 1], [2, 67, 1]] },
  { bass: 48, chord: [60, 64, 67], melody: [[0, 72, 2]] },
  { bass: 43, chord: [60, 62, 67], melody: [[1, 67, 1], [2, 74, 1]] },
];

function piano(t, frequency) {
  const phase = TAU * frequency * t;
  const body = Math.sin(phase) * Math.exp(-t / 1.5);
  const warmth = .3 * Math.sin(phase * 2) * Math.exp(-t / .7);
  const hammer = .12 * Math.sin(phase * 3) * Math.exp(-t / .24)
    + .045 * Math.sin(phase * 4) * Math.exp(-t / .12);
  return (body + warmth + hammer) * (1 - Math.exp(-t / .009));
}

function pad(t, frequency, duration) {
  const phase = TAU * frequency * t;
  const swell = Math.sin(Math.PI * t / duration) ** 2;
  return (Math.sin(phase) + .18 * Math.sin(phase * 2)) * swell;
}

function createAmbience() {
  const duration = SCORE.length * BAR;
  const samples = new Float64Array(Math.round(duration * RATE));

  function addNote(start, pitch, length, gain, sustained = false) {
    const frequency = 440 * 2 ** ((pitch - 69) / 12);
    const count = Math.ceil(length * RATE);
    const offset = Math.round(start * RATE);
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      const tone = sustained ? pad(t, frequency, length) : piano(t, frequency);
      const release = Math.min(1, (length - t) / .22);
      // Carry every note's release into the start of the loop, including reverb below.
      samples[(offset + i) % samples.length] += tone * release * gain;
    }
  }

  SCORE.forEach(({ bass, chord, melody }, bar) => {
    const start = bar * BAR;
    addNote(start, bass, BAR + .4, .105);
    // A soft broken chord leaves room for the melody and gameplay cues.
    [0, 2, 1].forEach((index, beat) => {
      addNote(start + beat * BEAT + .018, chord[index], 1.6, beat === 0 ? .055 : .043);
    });
    chord.forEach(pitch => addNote(start, pitch - 12, BAR + .5, .014, true));
    melody.forEach(([beat, pitch, length], index) => {
      const gain = (bar >= 8 && bar < 12 ? .135 : .15) * (index === 0 ? 1 : .9);
      addNote(start + beat * BEAT + .012, pitch, length * BEAT + .6, gain);
    });
  });

  // Short, quiet room reflections soften the piano without a noisy ambience layer.
  const dry = samples.slice();
  [[.107, .15], [.223, .095], [.389, .065], [.617, .045]].forEach(([delay, gain]) => {
    const offset = Math.round(delay * RATE);
    for (let i = 0; i < samples.length; i++) {
      samples[(i + offset) % samples.length] += dry[i] * gain;
    }
  });

  // Remove DC and keep the music below gameplay cues at the existing .28 volume.
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] -= mean;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  const gain = .24 / peak;
  return { duration, rate: RATE, sample: t => samples[Math.round(t * RATE)] * gain };
}

module.exports = { createAmbience };
