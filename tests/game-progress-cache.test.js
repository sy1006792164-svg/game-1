'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CAMPAIGN } = require('../src/levels');
const { createStore } = require('../src/storage');

const filename = path.join(__dirname, '../src/main.js');
const source = fs.readFileSync(filename, 'utf8').replace(/new Game\(createPlatform\(\)\);\s*$/, 'module.exports = { Game };');
const loaded = { exports: {} };
vm.runInThisContext('(function(require, module, exports) {\n' + source + '\n})', { filename })(createRequire(filename), loaded, loaded.exports);
const { Game } = loaded.exports;

test('repeated home frames do not rescan late campaign records', () => {
  const completed = Object.fromEntries(CAMPAIGN.slice(0, -1).map(level => [level.id, { stars: 3, bestTurns: level.par }]));
  let reads = 0;
  const profile = { completed: new Proxy(completed, { get(target, key) { reads++; return target[key]; } }) };
  const game = Object.create(Game.prototype);
  game.profile = () => profile;
  for (let frame = 0; frame < 120; frame++) assert.equal(game.nextLevel(), CAMPAIGN[998]);
  assert.ok(reads <= CAMPAIGN.length * 2, 'four seconds of home frames should read each record at most twice');
});

test('next route refreshes after a win, a saved replay and a complete local reset', () => {
  const data = new Map();
  const game = Object.create(Game.prototype);
  game.store = createStore({ get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) });
  assert.equal(game.nextLevel(), CAMPAIGN[0]);
  game.store.recordWin(1, 3, CAMPAIGN[0].par, 'campaign');
  assert.equal(game.nextLevel(), CAMPAIGN[1]);
  game.store.saveRun({ mode: 'campaign', levelId: 1, actions: [], revision: CAMPAIGN[0].revision || '1' });
  assert.equal(game.nextLevel(), CAMPAIGN[1], 'a saved replay does not replace the next unfinished route');
  game.store.recordWin(2, 2, CAMPAIGN[1].par, 'campaign');
  assert.equal(game.nextLevel(), CAMPAIGN[2]);
  game.store.reset();
  assert.equal(game.nextLevel(), CAMPAIGN[0], 'reset must discard cached progress immediately');
});

test('the next unfinished route keeps gaps and the final campaign route reachable', () => {
  let profile = { completed: { 1: { stars: 3, bestTurns: 6 }, 3: { stars: 3, bestTurns: 8 } } };
  const game = Object.create(Game.prototype);
  game.profile = () => profile;
  assert.equal(game.nextLevel(), CAMPAIGN[1]);
  profile = { completed: Object.fromEntries(CAMPAIGN.map(level => [level.id, { stars: 3, bestTurns: level.par }])) };
  assert.equal(game.nextLevel(), CAMPAIGN[998]);
});

test('help respects the two-star cap in a legacy relit state without reviveCount', () => {
  const game = Object.create(Game.prototype);
  Object.assign(game, { page: 'game', level: CAMPAIGN[19], state: { turn: 0, revived: true },
    platform: { kind: 'browser' }, ads: { isConfigured: () => false }, cancelRankingPointer() {} });
  game.help();
  assert.match(JSON.stringify(game.modal.sections), /二星/);
  assert.doesNotMatch(JSON.stringify(game.modal.sections), /未使用道具.*三星/);
});
