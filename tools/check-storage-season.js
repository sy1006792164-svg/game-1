'use strict';

// In-memory storage fixtures exercise migration boundaries only. This script
// writes no game save, cloud record, product fallback, or temporary file.
const assert = require('node:assert/strict');
const config = require('../src/config');
const { CAMPAIGN } = require('../src/levels');
const keys = require('../src/storage');
const { createFriendLeaderboard } = require('../src/friend-leaderboard');
const board = require('../open-data/leaderboard-data');
const { createHostedScoreSync } = require('../open-data/hosted-score');

const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

function storage() {
  const values = new Map(), failedReads = new Set(), failedWrites = new Set(), writes = [];
  return {
    values, failedReads, failedWrites, writes,
    get(key) {
      if (failedReads.has(key)) throw new Error('STORAGE_READ_FAILED');
      return values.has(key) ? copy(values.get(key)) : null;
    },
    set(key, value) {
      if (failedWrites.has(key)) throw new Error('STORAGE_WRITE_FAILED');
      values.set(key, copy(value)); writes.push(key);
    },
    remove(key) {
      if (failedWrites.has(key)) throw new Error('STORAGE_WRITE_FAILED');
      values.delete(key); writes.push(key);
    }
  };
}

function legacySave(adapter, development = false) {
  const store = keys.createStore(adapter, { season: 1, development });
  const level = CAMPAIGN[0];
  store.updateSettings({ sound: false, music: false, haptics: false, reducedMotion: true });
  store.recordWin(level.id, 3, level.solution.length);
  store.recordJourneyWin(level.id, '2026-09-17');
  store.setGuideDismissed(true);
  store.markMechanicSeen('wind');
  assert.equal(store.saveRun({ mode: 'campaign', levelId: level.id, actions: [] }), true);
  assert.equal(store.getStatus().persisted, true);
}

function archived(adapter, profileKey = keys.PROFILE_KEY, runKey = keys.RUN_KEY) {
  return { profile: copy(adapter.values.get(profileKey)), run: copy(adapter.values.get(runKey)) };
}

function assertArchive(adapter, before, profileKey = keys.PROFILE_KEY, runKey = keys.RUN_KEY) {
  assert.deepEqual(adapter.values.get(profileKey), before.profile);
  assert.deepEqual(adapter.values.get(runKey), before.run);
}

function checkMigration() {
  const adapter = storage();
  legacySave(adapter);
  const before = archived(adapter);
  adapter.writes.length = 0;
  const store = keys.createStore(adapter, { season: 2 });
  assert.equal(store.getMigrationState().status, 'required');
  assert.equal(store.getMigrationState().hasLegacyProgress, true);
  assert.deepEqual(adapter.writes, []);
  assert.equal(store.saveRun({ mode: 'campaign', levelId: 1, actions: [] }), false);
  assert.equal(store.clearRun(), false);
  assert.equal(store.reset(), false);
  assert.deepEqual(store.recordWin(2, 3, 4).completed, {});
  assert.deepEqual(adapter.writes, []);
  assert.equal(store.confirmMigration(), true);
  assert.deepEqual(adapter.writes, [keys.RUN_V2_KEY, keys.PROFILE_V2_KEY]);
  assert.equal(store.getMigrationState().status, 'ready');
  assert.equal(store.getProfile().version, 2);
  assert.deepEqual(store.getProfile().completed, {});
  assert.deepEqual(store.getProfile().daily, {});
  assert.equal(store.getProfile().journey, undefined);
  assert.equal(store.getProfile().guideDismissed, undefined);
  assert.equal(store.getProfile().mechanicGuides, undefined);
  assert.deepEqual(store.getProfile().settings, before.profile.settings);
  assert.equal(store.loadRun(), null);
  assertArchive(adapter, before);

  store.recordWin(2, 3, CAMPAIGN[1].solution.length);
  assert.equal(keys.createStore(adapter, { season: 2 }).getProfile().completed['2'].stars, 3);
  assert.equal(keys.createStore(adapter, { season: 1 }).getProfile().completed['2'], undefined);
  assertArchive(adapter, before);

  const settingsOnly = storage();
  keys.createStore(settingsOnly, { season: 1 }).updateSettings({ sound: false });
  const existingPlayer = keys.createStore(settingsOnly, { season: 2 });
  assert.equal(existingPlayer.getMigrationState().status, 'required');
  assert.equal(existingPlayer.confirmMigration(), true);
  assert.equal(existingPlayer.getProfile().settings.sound, false);
  assert.deepEqual(existingPlayer.getProfile().completed, {});
  console.log('PASS v2 confirmation, settings-only migration, progression and archive isolation');
}

function checkReadFailures() {
  for (const failedKey of [keys.PROFILE_KEY, keys.RUN_KEY, keys.PROFILE_V2_KEY, keys.RUN_V2_KEY]) {
    const adapter = storage();
    legacySave(adapter);
    const before = archived(adapter);
    adapter.writes.length = 0;
    adapter.failedReads.add(failedKey);
    const store = keys.createStore(adapter, { season: 2 });
    assert.equal(store.getMigrationState().status, 'error');
    assert.equal(store.confirmMigration(), false, 'An error must never count as reset consent');
    assert.deepEqual(adapter.writes, []);
    adapter.failedReads.clear();
    assert.equal(store.retryMigration(), false);
    assert.equal(store.getMigrationState().status, 'required');
    assert.deepEqual(adapter.writes, [], 'Recovered legacy data still requires confirmation');
    assert.equal(adapter.values.has(keys.PROFILE_V2_KEY), false);
    assert.equal(store.confirmMigration(), true);
    assertArchive(adapter, before);
  }
  console.log('PASS failed old/new reads recover to consent gate without v2 writes');
}

function checkWriteFailures() {
  for (const failedKey of [keys.RUN_V2_KEY, keys.PROFILE_V2_KEY]) {
    const adapter = storage();
    legacySave(adapter);
    const before = archived(adapter);
    adapter.failedWrites.add(failedKey);
    const store = keys.createStore(adapter, { season: 2 });
    assert.equal(store.getMigrationState().status, 'required');
    assert.equal(store.confirmMigration(), false);
    assert.equal(store.getMigrationState().status, 'error');
    assert.equal(store.confirmMigration(), false);
    assert.equal(adapter.values.has(keys.PROFILE_V2_KEY), false);
    assertArchive(adapter, before);
    adapter.failedWrites.clear();
    const restarted = keys.createStore(adapter, { season: 2 });
    assert.equal(restarted.getMigrationState().status, 'required');
    assert.equal(restarted.confirmMigration(), true);
    assertArchive(adapter, before);
  }
  const fresh = storage();
  fresh.failedWrites.add(keys.PROFILE_V2_KEY);
  const store = keys.createStore(fresh, { season: 2 });
  assert.equal(store.getMigrationState().status, 'error');
  assert.equal(store.confirmMigration(), false);
  fresh.failedWrites.clear();
  assert.equal(store.retryMigration(), true);
  assert.equal(store.getMigrationState().status, 'ready');
  assert.equal(store.getProfile().version, 2);
  assert.deepEqual(store.getProfile().completed, {});
  console.log('PASS partial v2 writes, restart recovery and genuinely new player retry');
}

function checkDevelopmentAndNotice() {
  const adapter = storage();
  legacySave(adapter);
  legacySave(adapter, true);
  const production = archived(adapter), development = archived(adapter, keys.DEV_PROFILE_KEY, keys.DEV_RUN_KEY);
  const prod = keys.createStore(adapter, { season: 1 });
  const dev = keys.createStore(adapter, { season: 1, development: true });
  assert.equal(prod.hasSeenSeasonNotice(), false);
  assert.equal(dev.hasSeenSeasonNotice(), false);
  assert.equal(prod.markSeasonNoticeSeen(), true);
  assert.equal(prod.hasSeenSeasonNotice(), true);
  assert.equal(dev.hasSeenSeasonNotice(), false);
  const migrated = keys.createStore(adapter, { season: 2, development: true });
  assert.equal(migrated.getMigrationState().status, 'required');
  assert.equal(migrated.confirmMigration(), true);
  assert.equal(adapter.values.has(keys.DEV_PROFILE_V2_KEY), true);
  assert.equal(adapter.values.has(keys.PROFILE_V2_KEY), false);
  assertArchive(adapter, production);
  assertArchive(adapter, development, keys.DEV_PROFILE_KEY, keys.DEV_RUN_KEY);
  console.log('PASS development save and notice keys remain separate');
}

async function mainBoardKey(season, development) {
  const messages = [];
  const wx = {
    getOpenDataContext: () => ({ canvas: { width: 1, height: 1 }, postMessage: message => messages.push(message) }),
    authorize: () => {}
  };
  const leaderboard = createFriendLeaderboard({ kind: 'wechat', wx, isDevelopment: development },
    { ...config, PROGRESSION_SEASON: season }, { canSync: () => false });
  await leaderboard.open(null, { 'scope.WxFriendInteraction': true });
  const opened = messages.find(message => message.action === 'open');
  assert.ok(opened);
  leaderboard.close();
  return opened.key;
}

async function checkLeaderboard() {
  assert.equal(await mainBoardKey(1, false), 'stars');
  assert.equal(await mainBoardKey(2, false), 'stars_v2');
  assert.equal(await mainBoardKey(2, true), 'stars_v2_development');
  assert.equal(board.legacyKeyFor('stars'), 'wind_letter_rank_v1');
  assert.equal(board.legacyKeyFor('stars_development'), 'wind_letter_rank_v1_development');
  assert.equal(board.legacyKeyFor('stars_v2'), '');
  assert.equal(board.legacyKeyFor('stars_v2_development'), '');

  const oldScore = board.serializeScore({ stars: 3, completed: 1, turns: 4 }, 'stars');
  const oldFriend = [{ openid: 'existing-friend', KVDataList: [{ key: 'stars', value: oldScore }] }];
  assert.equal(board.buildRows(oldFriend, [], 'stars', null).rows.length, 1);
  assert.equal(board.buildRows(oldFriend, [], 'stars_v2', null).rows.length, 0);

  const reads = [], writes = [];
  const api = {
    getUserCloudStorage(options) { reads.push(options.keyList); options.success({ KVDataList: [] }); },
    setUserCloudStorage(options) { writes.push(options.KVDataList[0]); options.success({}); }
  };
  const candidate = { stars: 3, completed: 1, turns: 4 };
  assert.equal(await createHostedScoreSync(api, { key: () => 'stars' }).submit(candidate), true);
  assert.equal(await createHostedScoreSync(api, { key: () => 'stars_v2' }).submit(candidate), true);
  assert.deepEqual(reads, [['stars', 'wind_letter_rank_v1'], ['stars_v2']]);
  assert.deepEqual(writes.map(entry => entry.key), ['stars', 'stars_v2']);
  console.log('PASS season 1/2 hosted friend key routing and no old-score backfill');
}

async function main() {
  checkMigration();
  checkReadFailures();
  checkWriteFailures();
  checkDevelopmentAndNotice();
  await checkLeaderboard();
  console.log('Storage season checks passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
