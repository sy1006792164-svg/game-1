'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Renderer } = require('../src/renderer');
const { drawGame } = require('../src/game-view');
const { guideCardLayout, drawGuideCard } = require('../src/guide-view');
const { guideStep } = require('../src/play-guide');
const { mechanicStep, availableMechanics } = require('../src/mechanic-guide');
const { createProjection } = require('../src/board-projection');
const { createState, step } = require('../src/engine');
const { SceneCamera } = require('../src/camera');
const { drawIslandSurface } = require('../src/island-surface');
const { CAMPAIGN } = require('../src/levels');

function renderer(width = 390, height = 700) {
  const ellipses = [], noop = () => {};
  const ctx = new Proxy({ globalAlpha: 1, font: '12px sans-serif',
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      // CJK glyphs occupy a full em in the shipped PingFang/YaHei font stack;
      // Latin characters are narrower. Keep the measurement font-size aware.
      return { width: [...String(text)].reduce((sum, char) => sum + size * (char.charCodeAt(0) > 255 ? 1 : .56), 0) };
    },
    ellipse(...args) { ellipses.push(args); },
    createLinearGradient() { return { addColorStop: noop }; },
    createRadialGradient() { return { addColorStop: noop }; },
  }, { get(target, key) { return key in target ? target[key] : noop; } });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { H: height, viewport: { x: (390 - width) / 2, y: 0, w: width, h: height },
    reducedMotion: true, now: 1000, ambientNow: 1000, effectsQuality: 'low' });
  return { r, ellipses };
}

function gameFor(level, lesson = null, hint = '点亮起的相邻地砖移动，先走过蓝票。') {
  return { level, state: createState(level), mode: 'campaign', camera: new SceneCamera(), transitionAt: 0,
    guideStep: () => lesson, playHint: () => hint, canShowGuide: () => level.id === 1,
    canUndo: () => false, undoLeft: () => 3, platform: { now: () => 1000 } };
}

function allLessonCards() {
  const cards = new Map();
  const keep = guide => {
    if (guide) cards.set(JSON.stringify([guide.title, guide.text, guide.tip, guide.visual.echo]), guide);
  };
  const level = CAMPAIGN[0];
  // Include detours, missed-light recovery and guide re-entry, not just the
  // winning tutorial witness. The original eight-turn budget bounds the walk.
  const visit = state => {
    if (state.status !== 'playing') return;
    const game = { level, state, guideEnabled: true, mode: 'campaign', canUndo: () => true };
    keep(guideStep(game, 1000));
    game.blockedAt = 900; keep(guideStep(game, 1000));
    game.canUndo = () => false; keep(guideStep(game, 1000));
    for (const action of ['left', 'right', 'wait']) {
      const next = step(level, state, action);
      if (next.moved) visit(next.state);
    }
  };
  visit(createState(level));
  for (const level of CAMPAIGN) for (const id of availableMechanics(level)) {
    for (const phase of [0, 1]) for (const used of [false, true]) {
      const state = createState(level);
      if (used) { state.lights = []; state.bridges = []; }
      keep(mechanicStep({ level, state, mechanicGuide: { ids: [id], phase } }));
    }
  }
  return [...cards.values()];
}

test('guide, normal play and multiline feedback retain the original normal-board tile size on every shipped level', () => {
  const lessonGame = gameFor(CAMPAIGN[0]); lessonGame.guideEnabled = true;
  const lesson = guideStep(lessonGame, 1000);
  for (const [width, height] of [[390, 700], [452, 700], [500, 700], [390, 844]]) {
    const { r } = renderer(width, height), game = gameFor(CAMPAIGN[0]);
    drawGame(r, game, 1000);
    const normalRect = { ...r.boardRect }, normalPoint = r.boardProjection.point(game.level.start);
    game.guideStep = () => lesson; drawGame(r, game, 1000);
    assert.deepEqual(r.boardRect, normalRect, 'opening a lesson cannot move or shrink the board band');
    assert.deepEqual(r.boardProjection.point(game.level.start), normalPoint);
    game.guideStep = () => null;
    game.playHint = () => '只剩一拍，请留好回邮局的路。'.repeat(4);
    drawGame(r, game, 1000);
    assert.deepEqual(r.boardRect, normalRect, 'wrapping feedback cannot resize the board');
    for (const level of CAMPAIGN) {
      const view = { scale: 1, panX: 0, panY: 0 };
      const original = createProjection(level, { x: normalRect.x, y: 158, w: width, h: height - 322 }, view);
      const current = createProjection(level, normalRect, view);
      assert.ok(Math.abs(current.halfW - original.halfW) < 1e-9, `${width}x${height}, level ${level.id}`);
      assert.ok(Math.abs(current.halfH - original.halfH) < 1e-9);
    }
  }
});

test('every reachable tutorial and mechanic card fits the compact band without obscuring the board or its controls', () => {
  const cards = allLessonCards();
  assert.ok(cards.length >= 35, 'include recovery and already-used mechanic variants');
  for (const guide of cards) {
    const { r } = renderer(452, 700), game = gameFor(CAMPAIGN[0], guide);
    const buttons = [], originalButton = r.button.bind(r);
    r.button = (label, x, y, w, h, action, style) => {
      buttons.push({ label, x, y, w, h });
      originalButton(label, x, y, w, h, action, style);
    };
    drawGame(r, game, 1000);
    const ui = guideCardLayout(r, guide), buttonY = buttons.find(button => button.w === 165 && button.h === 52).y;
    const y = buttonY - ui.height - 8;
    assert.ok(y >= r.boardRect.y + r.boardRect.h + 4, guide.title + ' must leave the board clear');
    const skip = buttons.find(button => button.label === '跳过');
    assert.ok(skip.y >= y + 12 && skip.x + skip.w <= 366 - 16, 'skip has visible top and right insets');
    assert.ok(skip.w >= 44 && skip.h >= 44, 'skip retains a complete touch target');
    assert.ok(buttonY + 52 <= r.H - 8, 'controls retain an inset above the device safe area');
    const texts = [], originalText = r.text.bind(r);
    r.text = (value, x, ty, size, color, align, weight) => {
      r.font(size, weight);
      const width = r.ctx.measureText(value).width;
      texts.push({ value: String(value), x: x - (align === 'center' ? width / 2 : align === 'right' ? width : 0),
        y: ty - size / 2, w: width, h: size });
      originalText(value, x, ty, size, color, align, weight);
    };
    drawGuideCard(r, game, guide, y);
    for (const box of texts) {
      assert.ok(box.x >= 36 && box.x + box.w <= 354, `${guide.title}: ${box.value} retains horizontal breathing room`);
      assert.ok(box.y >= y + 12 && box.y + box.h <= y + ui.height - 12, `${guide.title}: ${box.value} retains vertical breathing room`);
    }
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
        `${guide.title}: ${a.value} overlaps ${b.value}`);
    }
    const body = texts.filter(box => ui.bodyLines.includes(box.value));
    assert.ok(body.length <= 2 && body.every(box => box.h >= 14), 'each step stays readable in at most two short lines');
    assert.ok(body[0].y >= skip.y + skip.h + 8, 'body clears the entire skip touch target');
    if (!guide.visual.echo) assert.ok(texts.some(box => box.value === guide.tip), 'the rule tip cannot be ellipsized');
  }
});

test('rear tree crowns remain inside the actual clipped board on short and wide logical viewports', () => {
  for (const width of [390, 440, 452, 500]) for (const id of [1, 2, 3, 13, 19, 31, 301, 999]) {
    const { r, ellipses } = renderer(width, 700);
    drawGame(r, gameFor(CAMPAIGN[id - 1]), 1000);
    // Rear tree foliage uses an upright oval. Capture the painter's actual
    // ellipses so this checks its output, not a duplicate layout formula.
    const crowns = ellipses.filter(([, , rx, ry]) => Math.abs(rx / ry - .27 / .48) < 1e-9 && rx > 5);
    for (const [, y, , radiusY] of crowns) {
      assert.ok(y - radiusY >= r.boardRect.y, `level ${id}, width ${width}: tree crown clips the HUD edge`);
    }
  }
});

test('the island shadow fits below the stone base without changing the island under zoom or pan', () => {
  for (const width of [390, 452, 500]) {
    const { r } = renderer(width, 700);
    drawGame(r, gameFor(CAMPAIGN[0]), 1000);
    const rect = r.boardRect;
    for (const scale of [.65, 1, 1.6]) for (const panY of [-.2, 0, .2]) {
      const p = createProjection(CAMPAIGN[0], rect, { scale, panX: 0, panY });
      const before = p.corners.map(point => point.slice()), { r: painter, ellipses } = renderer();
      const limit = p.toWorld(p.centerX, rect.y + rect.h - 1)[1];
      drawIslandSurface(painter, p.corners, 26, 1000, limit);
      assert.deepEqual(p.corners, before, 'fitting a shadow cannot alter the floor or its depth');
      for (const [x, y, , ry] of ellipses) {
        assert.ok(ry > 0);
        assert.ok(p.toScreen(x, y + ry)[1] <= rect.y + rect.h - 1 + 1e-8, `${width}, zoom ${scale}, pan ${panY}`);
      }
    }
  }
  const { r, ellipses } = renderer();
  const corners = [[0, 0], [200, 50], [0, 100], [-200, 50]];
  drawIslandSurface(r, corners, 26, 1000);
  assert.deepEqual(ellipses[0].slice(0, 4), [0, 133, 136, 10], 'unbounded scenes preserve their original soft shadow');
});
