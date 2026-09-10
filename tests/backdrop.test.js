'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { C } = require('../src/theme');
const { atmosphereTreatment, windState, drawDistantAtmosphere, drawAmbientOverlay } = require('../src/ambient-effects');
const { CHAPTER_MOODS, chapterMood } = require('../src/chapter-atmosphere');
const { levelChapterAtOffset } = require('../src/level-view');
const { drawPageAtmosphere } = require('../src/page-atmosphere');

// Record the actual canvas-space bounds after the renderer applies DPR and safe-area transforms.
function canvasRecorder() {
  const rectangles = [], paths = [], events = [], stack = [];
  let transform = { sx: 1, sy: 1, x: 0, y: 0 }, points = [];
  const properties = { globalAlpha: 1, font: '', fillStyle: '', strokeStyle: '' };
  const point = (x, y) => [transform.x + x * transform.sx, transform.y + y * transform.sy];
  const methods = {
    setTransform(sx, b, c, sy, x, y) { transform = { sx, sy, x, y }; },
    translate(x, y) { transform.x += x * transform.sx; transform.y += y * transform.sy; },
    scale(x, y) { transform.sx *= x; transform.sy *= y; },
    save() { stack.push({ properties: { ...properties }, transform: { ...transform } }); },
    restore() { const saved = stack.pop(); Object.assign(properties, saved.properties); transform = saved.transform; },
    fillRect(x, y, w, h) {
      const [left, top] = point(x, y);
      const rectangle = { x: left, y: top, w: w * transform.sx, h: h * transform.sy,
        style: properties.fillStyle, alpha: properties.globalAlpha };
      rectangles.push(rectangle); events.push({ type: 'rectangle', ...rectangle });
    },
    createLinearGradient(x0, y0, x1, y1) {
      return { start: point(x0, y0), end: point(x1, y1), stops: [], addColorStop(at, color) { this.stops.push([at, color]); } };
    },
    measureText(text) { return { width: String(text).length * 8 }; },
    beginPath() { points = []; },
    moveTo(x, y) { points.push(point(x, y)); },
    lineTo(x, y) { points.push(point(x, y)); },
    bezierCurveTo(...args) { for (let i = 0; i < args.length; i += 2) points.push(point(args[i], args[i + 1])); },
    fill() {
      const path = { style: properties.fillStyle, alpha: properties.globalAlpha, points: points.slice() };
      paths.push(path); events.push({ type: 'path', ...path });
    },
    stroke() {
      events.push({ type: 'stroke', style: properties.strokeStyle,
        alpha: properties.globalAlpha, points: points.slice() });
    }
  };
  const ctx = new Proxy(properties, { get(target, key) { return key in target ? target[key] : methods[key] || (() => {}); } });
  return { canvas: { getContext: () => ctx }, rectangles, paths, events };
}

function draw(metrics, page, modal, extra = {}) {
  const record = canvasRecorder(), renderer = new Renderer(record.canvas);
  // Content layouts have their own integration coverage; keep a known hit target to
  // verify that extending the backdrop cannot change page or pointer coordinates.
  const content = () => renderer.hit(24, 12, 44, 44, () => {});
  renderer.home = content; renderer.game = content; renderer.levels = content; renderer.collection = content;
  const game = {
    page, modal, development: true, store: { getStatus: () => ({ persisted: true }) },
    startup: { progress: .5, label: '正在准备邮路' }, startupPublication: [], startupPublicationPage: 0,
    rankingAuthorization: { getState: () => ({ enabled: false, status: 'unavailable' }), updateButton() {} },
    ...extra
  };
  renderer.draw(game, 1000, metrics);
  return { ...record, renderer };
}

function coversCanvas(rect, metrics) {
  const ratio = metrics.pixelRatio;
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} must equal ${expected}`);
  close(rect.x, 0); close(rect.y, 0);
  close(rect.w, metrics.width * ratio); close(rect.h, metrics.height * ratio);
}

const screens = [
  { width: 390, height: 844, pixelRatio: 3, safeTop: 88, safeBottom: 34 },
  { width: 320, height: 568, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
  { width: 768, height: 1024, pixelRatio: 2, safeTop: 70, safeBottom: 20 },
  { width: 390, height: 844, pixelRatio: 1, safeTop: 0, safeBottom: 0 }
];

test('all page skies and paper washes cover the notch, home indicator and side gutters', () => {
  const pages = ['startup', 'publication', 'home', 'game', 'levels', 'collection', 'leaderboard'];
  for (const metrics of screens) for (const page of pages) {
    const { rectangles } = draw(metrics, page);
    const sky = rectangles.find(rect => typeof rect.style === 'object' && rect.style.stops);
    assert.ok(sky, `${page} draws a sky gradient`);
    coversCanvas(sky, metrics);
    const wash = rectangles.find(rect => rect.style === C.paper && rect.alpha < 1);
    assert.ok(wash, `${page} draws its paper wash`);
    coversCanvas(wash, metrics);
    assert.equal(wash.alpha, atmosphereTreatment(page).wash);
    // The same gradient spans either side of each safe-area boundary. Its end
    // colors extend into the reserved area instead of exposing a separate fill.
    assert.equal(sky.style.start[1], metrics.safeTop * metrics.pixelRatio);
    assert.ok(Math.abs(sky.style.end[1] - (metrics.height - metrics.safeBottom) * metrics.pixelRatio) < 1e-7);
  }
});

test('every real page keeps atmosphere while dense and gameplay pages remain quieter', () => {
  for (const page of ['startup', 'publication', 'home', 'game', 'levels', 'collection', 'leaderboard']) {
    const treatment = atmosphereTreatment(page);
    assert.ok(treatment.depth > 0 && treatment.near > 0, page + ' keeps both atmosphere layers');
  }
  assert.ok(atmosphereTreatment('home').near > atmosphereTreatment('collection').near);
  assert.ok(atmosphereTreatment('game').near >= .7, 'gameplay atmosphere remains perceptible at normal viewing size');
  assert.ok(atmosphereTreatment('levels').wash < atmosphereTreatment('publication').wash);
  assert.equal(atmosphereTreatment('game').ribbons, 0, 'ambient direction cannot imitate a wind-tile hint');
  assert.equal(atmosphereTreatment('game').pieces, 0, 'gameplay uses undirected light and mist carriers');
  assert.equal(atmosphereTreatment('game').mist, 0, 'gameplay does not use horizontally travelling mist');
  assert.equal(atmosphereTreatment('game').motes, 0, 'gameplay uses its dedicated sparse edge carriers');
  assert.equal(atmosphereTreatment('unknown').near, 0);
});

test('gameplay adds readable cloud light, edge foliage and local wildlife behind the board', () => {
  const record = canvasRecorder(), renderer = new Renderer(record.canvas);
  renderer.H = 844;
  const mood = chapterMood(0);
  drawAmbientOverlay(renderer, 1000, 'game', { x: 0, y: 158, w: 390, h: 420 }, {
    treatment: atmosphereTreatment('game'), mood
  });
  const { events } = record;
  const cloudCore = events.filter(event => event.type === 'path' && event.style === mood.cloudCore);
  const warmLight = events.filter(event => event.type === 'path' && event.style === mood.light);
  const foliage = events.filter(event => event.type === 'path' &&
    mood.leaves.includes(event.style));
  const particles = events.filter(event => event.type === 'path' &&
    mood.particles.includes(event.style));
  assert.equal(cloudCore.length, 2, 'two rounded cloud-shadow groups remain on screen');
  assert.equal(warmLight.length, 2, 'opposed warm pools keep the scene breathing');
  assert.equal(foliage.length, 18, 'six three-leaf edge clusters establish foreground depth');
  assert.equal(particles.length, 6, 'four fluffs and two petals follow local closed paths');
  assert.equal(renderer.hits.length, 0, 'gameplay ambience remains decorative');

  const low = canvasRecorder(), lowRenderer = new Renderer(low.canvas);
  lowRenderer.H = 844;
  drawAmbientOverlay(lowRenderer, 1000, 'game', { x: 0, y: 158, w: 390, h: 420 }, {
    treatment: atmosphereTreatment('game'), mood, quality: 'low'
  });
  assert.equal(low.events.filter(event => event.type === 'path' && event.style === mood.cloudCore).length, 2,
    'low quality keeps the broad atmosphere');
  assert.equal(low.events.filter(event => event.type === 'path' && mood.leaves.includes(event.style)).length, 0,
    'low quality removes foreground foliage');
  assert.equal(low.events.filter(event => event.type === 'path' && mood.particles.includes(event.style)).length, 0,
    'low quality removes small particles');
});

test('the shared wind field has a readable gust followed by a quiet interval', () => {
  assert.ok(windState(1000).gust > windState(0).gust);
  assert.equal(windState(4000).gust, 0);
  assert.deepEqual(windState(1000, true), { strength: .16, gust: 0 });
});

test('low quality preserves broad depth while reducing distant mist geometry', () => {
  const mood = chapterMood(0), rect = { x: 0, y: 64, w: 390, h: 650 };
  const countMist = quality => {
    const record = canvasRecorder(), renderer = new Renderer(record.canvas);
    drawDistantAtmosphere(renderer, 1000, rect, {
      page: 'home', mood, quality, treatment: atmosphereTreatment('home')
    });
    return record.events.filter(event => event.type === 'path' &&
      (event.style === mood.fogFar || event.style === mood.fogNear)).length;
  };
  assert.equal(countMist('high'), 9);
  assert.equal(countMist('low'), 1);
});

test('near atmosphere is composited after the paper wash and before page content', () => {
  const { events, renderer } = draw(screens[0], 'levels');
  const wash = events.findIndex(event => event.type === 'rectangle' && event.style === C.paper && event.alpha === .66);
  const nearLight = events.findIndex(event => event.type === 'path' && event.style === chapterMood(0).light);
  assert.ok(wash >= 0 && nearLight > wash);
  assert.equal(renderer.hits.length, 1, 'decorative layers do not create hit targets');
});

test('the landscape reaches wide-screen edges without a seam at the content column', () => {
  const metrics = screens[2], { paths } = draw(metrics, 'home');
  for (const color of [chapterMood(0).ridgeFar, chapterMood(0).ridgeNear]) {
    const ridge = paths.find(path => path.style === color);
    assert.ok(ridge);
    assert.equal(Math.min(...ridge.points.map(point => point[0])), 0);
    assert.ok(Math.abs(Math.max(...ridge.points.map(point => point[0])) - metrics.width * metrics.pixelRatio) < 1e-7);
  }
});

test('chapter progress selects six stable palettes and changes only atmosphere colors', () => {
  assert.equal(CHAPTER_MOODS.length, 6);
  assert.equal(chapterMood(-1), CHAPTER_MOODS[0]);
  assert.equal(chapterMood(Number.NaN), CHAPTER_MOODS[0]);
  assert.equal(chapterMood(0), CHAPTER_MOODS[0]);
  assert.equal(chapterMood(166), CHAPTER_MOODS[5]);
  assert.equal(new Set(CHAPTER_MOODS.map(mood => mood.skyTop)).size, CHAPTER_MOODS.length);
  assert.ok(CHAPTER_MOODS.every(mood => Object.isFrozen(mood) && Object.isFrozen(mood.leaves) && Object.isFrozen(mood.particles)));
  const early = draw(screens[0], 'game', null, { level: { chapter: 0 } });
  const late = draw(screens[0], 'game', null, { level: { chapter: 166 } });
  const earlySky = early.rectangles.find(rect => typeof rect.style === 'object' && rect.style.stops);
  const lateSky = late.rectangles.find(rect => typeof rect.style === 'object' && rect.style.stops);
  assert.deepEqual(earlySky.style.stops.map(stop => stop[1]), [CHAPTER_MOODS[0].skyTop, CHAPTER_MOODS[0].skyMid, CHAPTER_MOODS[0].skyBottom]);
  assert.deepEqual(lateSky.style.stops.map(stop => stop[1]), [CHAPTER_MOODS[5].skyTop, CHAPTER_MOODS[5].skyMid, CHAPTER_MOODS[5].skyBottom]);
});

test('the level list atmosphere follows its visible chapter', () => {
  assert.equal(levelChapterAtOffset(0, 844), 0);
  assert.equal(levelChapterAtOffset(1e9, 844), 166);
  const late = draw(screens[0], 'levels', null, { levelScroll: { offset: 1e9 } });
  const sky = late.rectangles.find(rect => typeof rect.style === 'object' && rect.style.stops);
  assert.deepEqual(sky.style.stops.map(stop => stop[1]),
    [CHAPTER_MOODS[5].skyTop, CHAPTER_MOODS[5].skyMid, CHAPTER_MOODS[5].skyBottom]);
});

test('the level route tiles continuously across its parallax wrap', () => {
  const mood = chapterMood(0), rect = { x: 0, y: 148, w: 390, h: 650 };
  const period = Math.max(240, rect.h * .93), boundary = period / .035;
  const routeY = scrollOffset => {
    const record = canvasRecorder(), renderer = new Renderer(record.canvas);
    drawPageAtmosphere(renderer, 2400, 'levels', rect, {
      mood, amount: .88, scrollOffset, reducedMotion: true
    });
    return record.events.filter(event => event.type === 'stroke' && event.style === mood.wind && event.points.length === 4)
      .map(event => event.points[0][1]).sort((a, b) => a - b);
  };
  const before = routeY(boundary - .01), after = routeY(boundary + .01);
  assert.equal(before.length, after.length);
  before.forEach((y, index) => assert.ok(Math.abs(y - after[index]) < .01));
});

test('a modal freezes decorative time without delaying gameplay feedback', () => {
  const record = canvasRecorder(), renderer = new Renderer(record.canvas), seen = [];
  renderer.game = (_game, now) => seen.push({ pageNow: now, ambientNow: renderer.ambientNow });
  renderer.modal = () => null;
  const pause = { kind: 'pause', title: '歇一会', lines: [], buttons: [] };
  const help = { kind: 'help', title: '投递指引', lines: [], buttons: [] };
  const game = { page: 'game', modal: pause, development: true, store: { getStatus: () => ({ persisted: true }) } };
  renderer.draw(game, 1000, screens[3]);
  game.modal = help; renderer.draw(game, 1500, screens[3]);
  game.modal = pause; renderer.draw(game, 2000, screens[3]);
  assert.deepEqual(seen, [
    { pageNow: 1000, ambientNow: 1000 },
    { pageNow: 1500, ambientNow: 1000 },
    { pageNow: 2000, ambientNow: 1000 }
  ]);
});

test('modal dimming also covers the entire canvas on compact and wide screens', () => {
  const modals = [
    { kind: 'help', title: '投递指引', lines: ['慢慢走，信会送到。'], buttons: [] },
    { kind: 'developer-level', digits: '' }
  ];
  for (const metrics of screens) for (const modal of modals) {
    const { rectangles } = draw(metrics, 'home', modal);
    const scrim = rectangles.find(rect => rect.style === (modal.kind === 'help' ? '#36554979' : '#294d498f'));
    assert.ok(scrim);
    coversCanvas(scrim, metrics);
  }
});

test('full canvas painting preserves content height, safe-area placement and touch conversion', () => {
  for (const metrics of screens) {
    const { renderer } = draw(metrics, 'home');
    const available = metrics.height - metrics.safeTop - metrics.safeBottom;
    const scale = Math.min(metrics.width / 390, available / 700);
    assert.equal(renderer.H, available / scale);
    assert.equal(renderer.oy, metrics.safeTop);
    assert.equal(renderer.ox, (metrics.width - 390 * scale) / 2);
    const hit = renderer.hits[0];
    const pointer = renderer.toLogical(renderer.ox + (hit.x + hit.w / 2) * scale,
      renderer.oy + (hit.y + hit.h / 2) * scale);
    assert.ok(Math.abs(pointer.x - (hit.x + hit.w / 2)) < 1e-7);
    assert.ok(Math.abs(pointer.y - (hit.y + hit.h / 2)) < 1e-7);
  }
});
