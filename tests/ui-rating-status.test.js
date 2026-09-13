'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, revive, stars, STAR_TWO_MARGIN } = require('../src/engine');
const { itemAction } = require('../src/items');
const { routeStatus, drawGame } = require('../src/game-view');
const { helpContent } = require('../src/help-view');
const { Renderer } = require('../src/renderer');
const { SceneCamera } = require('../src/camera');

function gameFor(level, overrides = {}) {
  return { level, state: { ...createState(level), ...overrides }, mode: 'campaign',
    camera: new SceneCamera(), transitionAt: 0, guideStep: () => null,
    playHint: () => '想好了再行动，每次移动或等待扣一拍。',
    canShowGuide: () => level.id === 1, canUndo: () => false, undoLeft: () => 3,
    selectItem() {}, platform: { kind: 'browser', now: () => 1000 } };
}

function renderer(height) {
  const texts = [], noop = () => {};
  const ctx = new Proxy({ globalAlpha: 1, font: '12px sans-serif',
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: [...String(text)].reduce((sum, character) =>
        sum + size * (character.charCodeAt(0) > 255 ? 1 : .56), 0) };
    },
    fillText(value, x, y) {
      const w = this.measureText(value).width, h = Number(this.font.match(/([\d.]+)px/)[1]);
      texts.push({ value: String(value), x: x - (this.textAlign === 'center' ? w / 2 : this.textAlign === 'right' ? w : 0),
        y: y - h / 2, w, h });
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  }, { get(target, key) { return key in target ? target[key] : noop; } });
  const r = new Renderer({ getContext: () => ctx });
  Object.assign(r, { H: height, viewport: { x: 0, y: 0, w: 390, h: height },
    reducedMotion: true, now: 1000, ambientNow: 1000, effectsQuality: 'low' });
  return { r, texts };
}

test('the visible route target follows turn thresholds and both forms of assisted runs', () => {
  for (const level of CAMPAIGN) {
    const two = level.par + STAR_TWO_MARGIN;
    assert.match(routeStatus(gameFor(level)).text, new RegExp('已走 0 拍.*三星目标 ' + level.par + ' 拍'));
    assert.match(routeStatus(gameFor(level, { turn: level.par + 1 })).text, new RegExp('二星目标 ' + two + ' 拍'));
    assert.match(routeStatus(gameFor(level, { turn: two + 1 })).text, /本次送达得一星/);
    for (const overrides of [{ itemsUsed: 1 }, { revived: true, reviveCount: 0 }, { reviveCount: 1 }]) {
      const status = routeStatus(gameFor(level, overrides));
      assert.match(status.text, /封顶二星/);
      assert.doesNotMatch(status.text, /三星/);
      assert.equal(status.warning, true);
      assert.match(routeStatus(gameFor(level, { ...overrides, turn: two + 1 })).text, /本次送达得一星/);
    }
  }
});

test('the actual rating subtitle clears guide and pause targets and stays above the objectives', () => {
  for (const height of [700, 844]) for (const id of [1, 4, 7, 19, 301, 999]) {
    const level = CAMPAIGN[id - 1];
    for (const overrides of [{}, { turn: level.par + 1 }, { turn: 4096 }, { itemsUsed: 1 }, { revived: true }]) {
      const { r, texts } = renderer(height), game = gameFor(level, overrides);
      drawGame(r, game, 1000);
      const subtitle = texts.find(text => text.value === routeStatus(game).text);
      assert.ok(subtitle, 'the complete status is drawn without truncating the target');
      assert.ok(subtitle.x >= 24 && subtitle.x + subtitle.w <= 366, `${id}: status fits the header`);
      assert.ok(subtitle.y + subtitle.h < 81, `${id}: status clears the objective panel`);
      for (const hit of r.hits.filter(hit => hit.y < 81)) {
        const overlaps = subtitle.x < hit.x + hit.w && subtitle.x + subtitle.w > hit.x &&
          subtitle.y < hit.y + hit.h && subtitle.y + subtitle.h > hit.y;
        assert.equal(overlaps, false, `${id}: status cannot cross a header control`);
      }
    }
  }
});

test('help explains the real item-assisted rating instead of offering a new three-star result', () => {
  const level = CAMPAIGN[6], two = level.par + STAR_TWO_MARGIN;
  const score = turn => helpContent(level, 0, 'browser', { turn, itemsUsed: 1 }).sections
    .find(section => section.title === '本关评星').text;
  assert.match(score(0), /已使用道具，本次最高二星/);
  assert.doesNotMatch(score(0), /三星：/);
  assert.match(score(two), /本次最高二星/);
  assert.match(score(two + 1), /本次最多一星/);
  assert.doesNotMatch(score(two + 1), /本次最高二星/);
  assert.match(score(0), /已获得的三星与更短纪录会保留/);
  const items = helpContent(level, 0, 'browser').sections.find(section => section.title === '随身道具').text;
  assert.match(items, /直着数最多2格/);
  assert.match(items, /拐弯数各1格/);
});

test('relighting at the exact two-star boundary still permits a zero-turn kite delivery', () => {
  const level = { id: 7, width: 3, height: 1, start: 0, exit: 1, letters: [2], seals: [],
    walls: [], winds: {}, lights: [], bridges: [], par: 3, budget: 5 };
  let state = createState(level, { kite: 1 });
  for (const action of ['right', 'wait', 'wait', 'wait', 'wait']) {
    const result = step(level, state, action);
    assert.equal(result.moved, true);
    state = result.state;
  }
  assert.equal(state.status, 'failed');
  assert.equal(state.player, level.exit);
  assert.equal(state.turn, level.par + STAR_TWO_MARGIN);
  assert.deepEqual(state.letters, [2]);
  const relit = revive(level, state);
  assert.equal(relit.status, 'playing');
  assert.equal(relit.reviveCount, 1);
  assert.equal(relit.inventory.kite, 1);
  const scoreText = current => helpContent(level, current.reviveCount, 'wechat', {
    turn: current.turn, itemsUsed: current.itemsUsed
  }).sections.find(section => section.title === '本关评星').text;
  assert.match(scoreText(relit), /续灯封顶二星/);
  assert.match(scoreText(relit), /总计 5 拍内通关得二星/);
  assert.doesNotMatch(scoreText(relit), /本次最多一星/);
  assert.match(routeStatus({ level, state: relit }).text, /封顶二星/);
  const delivery = step(level, relit, itemAction('kite', 2));
  assert.equal(delivery.moved, true);
  assert.equal(delivery.state.status, 'won');
  assert.equal(delivery.state.turn, relit.turn, 'using the kite cannot spend another turn');
  assert.equal(stars(level, delivery.state), 2);

  const late = step(level, relit, 'wait').state;
  assert.match(scoreText(late), /本次最多一星/);
  assert.match(routeStatus({ level, state: late }).text, /本次送达得一星/);
  const lateDelivery = step(level, late, itemAction('kite', 2));
  assert.equal(lateDelivery.state.status, 'won');
  assert.equal(stars(level, lateDelivery.state), 1);
});
