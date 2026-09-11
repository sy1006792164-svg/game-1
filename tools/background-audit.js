'use strict';

// Deterministic Canvas command census, not a timing benchmark or a GPU/FPS claim.
// Run: node tools/background-audit.js --out output/background-audit.json
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Renderer } = require('../src/renderer');
const { drawBackdrop, drawVignette } = require('../src/scene');
const { drawAmbientOverlay, atmosphereTreatment } = require('../src/ambient-effects');
const { CHAPTER_MOODS } = require('../src/chapter-atmosphere');
const { PLAY_HINT_HEIGHT, gameBoardRect } = require('../src/game-view');
const { CONTROL } = require('../src/controls');

const PAGES = ['startup', 'publication', 'home', 'levels', 'game', 'collection', 'leaderboard'];
const SCREENS = [
  { name: 'compact', width: 320, height: 568, safeTop: 70, safeBottom: 20 },
  { name: 'phone', width: 390, height: 844, safeTop: 88, safeBottom: 34 },
  { name: 'tablet', width: 768, height: 1024, safeTop: 70, safeBottom: 20 }
];
const POLICIES = [
  { name: 'normal', quality: 'high', reducedMotion: false },
  { name: 'reduced-motion', quality: 'high', reducedMotion: true },
  { name: 'low', quality: 'low', reducedMotion: false }
];
const PAINT_METHODS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);

function canvasCensus() {
  const counts = {}, commands = [], stack = [];
  const properties = { globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  let writes = 0;
  const record = (method, args) => {
    for (const argument of args) if (typeof argument === 'number' && !Number.isFinite(argument)) {
      throw new Error(`Non-finite ${method} argument: ${argument}`);
    }
    counts[method] = (counts[method] || 0) + 1;
    commands.push([method, ...args]);
  };
  const methods = new Map();
  const ctx = new Proxy(properties, {
    get(target, key) {
      if (key in target) return target[key];
      if (!methods.has(key)) methods.set(key, (...args) => {
        record(key, args);
        if (key === 'save') stack.push({ ...properties });
        else if (key === 'restore') {
          if (!stack.length) throw new Error('Unbalanced canvas restore');
          for (const name of Object.keys(properties)) delete properties[name];
          Object.assign(properties, stack.pop());
        } else if (key === 'measureText') return { width: String(args[0]).length * 8 };
        else if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          return { addColorStop: (...stop) => record('addColorStop', stop) };
        }
      });
      return methods.get(key);
    },
    set(target, key, value) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite ${key}`);
      target[key] = value; writes++; commands.push(['set', key, value]); return true;
    }
  });
  return {
    canvas: { getContext: () => ctx },
    finish() {
      if (stack.length) throw new Error(`Unbalanced canvas save depth: ${stack.length}`);
      return {
        methods: Object.values(counts).reduce((total, count) => total + count, 0),
        paints: Object.entries(counts).reduce((total, [name, count]) => total + (PAINT_METHODS.has(name) ? count : 0), 0),
        propertyWrites: writes,
        trace: crypto.createHash('sha256').update(JSON.stringify(commands)).digest('hex'),
        counts
      };
    }
  };
}

function geometry(screen, page) {
  const available = screen.height - screen.safeTop - screen.safeBottom;
  const scale = Math.min(screen.width / 390, available / 700), height = available / scale;
  const ox = (screen.width - 390 * scale) / 2;
  const viewport = { x: -ox / scale, y: -screen.safeTop / scale, w: screen.width / scale, h: screen.height / scale };
  let rect = { ...viewport }, vignette = null;
  if (page === 'home') {
    const top = Math.max(0, (height - 844) / 2), y = 142 + top;
    const h = Math.min(386, height - 410 - top);
    rect = { x: viewport.x, y, w: viewport.w, h }; vignette = { x: 5, y, w: 380, h };
  } else if (page === 'startup') {
    const contentHeight = Math.min(height, 840), top = (height - contentHeight) / 2;
    const y = top + 116, adviceY = top + contentHeight - 270;
    const h = Math.min(380, adviceY - y - 20);
    rect = { x: viewport.x, y, w: viewport.w, h }; vignette = { x: 13, y, w: 364, h };
  } else if (page === 'game') {
    const hintHeight = PLAY_HINT_HEIGHT;
    rect = gameBoardRect({ H: height, viewport }, {
      hintHeight, hintY: height - CONTROL.height - 8 - hintHeight - 8
    });
  } else {
    const quietTop = { publication: 92, levels: 148, collection: 251, leaderboard: 120 }[page];
    const y = Math.max(viewport.y, quietTop);
    rect = { x: viewport.x, y, w: viewport.w, h: Math.max(0, viewport.y + viewport.h - y) };
  }
  return { height, scale, viewport, rect, vignette };
}

function sample(screen, page, mood, policy, now) {
  const census = canvasCensus(), r = new Renderer(census.canvas), layout = geometry(screen, page);
  Object.assign(r, { H: layout.height, scale: layout.scale, viewport: layout.viewport,
    reducedMotion: policy.reducedMotion, effectsQuality: policy.quality,
    atmosphereMood: mood, ambientNow: now, ambientImpulse: 0 });
  const treatment = atmosphereTreatment(page), options = { ...policy, page, mood, treatment, strength: treatment.depth };
  drawBackdrop(r, now, 0, options);
  drawAmbientOverlay(r, now, page, layout.rect, options);
  if (layout.vignette) drawVignette(r, now, layout.vignette, {
    ...options, deliveryStory: page === 'home' && policy.quality !== 'low'
  });
  return census.finish();
}

function audit() {
  const rows = [];
  for (const screen of SCREENS) for (const page of PAGES) for (const mood of CHAPTER_MOODS) for (const policy of POLICIES) {
    const samples = [1000, 5000, 13000].map(now => sample(screen, page, mood, policy, now));
    rows.push({ screen: screen.name, page, mood: mood.id, policy: policy.name,
      methodCalls: [Math.min(...samples.map(item => item.methods)), Math.max(...samples.map(item => item.methods))],
      paintCalls: [Math.min(...samples.map(item => item.paints)), Math.max(...samples.map(item => item.paints))],
      propertyWrites: [Math.min(...samples.map(item => item.propertyWrites)), Math.max(...samples.map(item => item.propertyWrites))],
      stationary: new Set(samples.map(item => item.trace)).size === 1 });
  }
  return {
    methodology: 'Canvas method and paint call counts through real background draw functions; no rasterization, elapsed time, allocations, overdraw, native FPS, or UI/puzzle rendering is measured. Three logical screen profiles, seven pages, six chapter palettes, three policies, and times 1000/5000/13000 ms. Startup/home include the real decorative vignette; game includes board-space atmosphere only. Layout values mirror current page layouts.',
    combinations: rows.length, drawSamples: rows.length * 3, rows
  };
}

if (require.main === module) {
  const result = audit(), outIndex = process.argv.indexOf('--out');
  if (outIndex !== -1) {
    const filename = process.argv[outIndex + 1];
    if (!filename) throw new Error('--out requires a filename');
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    fs.writeFileSync(filename, JSON.stringify(result, null, 2) + '\n');
  }
  console.table(result.rows.filter(row => row.screen === 'phone' && row.mood === 'dawn').map(row => ({
    page: row.page, policy: row.policy, methods: row.methodCalls.join('–'), paints: row.paintCalls.join('–'), stationary: row.stationary
  })));
  console.log(`${result.combinations} combinations / ${result.drawSamples} draw samples. Canvas calls only; not an FPS benchmark.`);
}

module.exports = { audit, sample, canvasCensus };
