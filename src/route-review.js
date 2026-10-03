'use strict';

const { createState, step, revive, replay, normalizeReviveHistory, normalizeSupplyPolicy, RELIGHT_ACTION } = require('./engine');
const { parseItemAction, ITEMS } = require('./items');
const { SceneCamera } = require('./camera');

const ACTION_NAMES = { up: '向上走', down: '向下走', left: '向左走', right: '向右走', wait: '等一拍' };
const KEY_EVENTS = new Set(['letter', 'seal', 'wind', 'bridge', 'order-blocked', 'echo-plate', 'tide-gate', 'echo-gate', 'item', 'relight', 'win', 'fail']);

function actionName(action) {
  if (action === null) return '视频续灯';
  if (action === RELIGHT_ACTION) return '用已有灯油续灯';
  const item = parseItemAction(action), entry = item && ITEMS.find(value => value.id === item.id);
  return entry ? '使用' + entry.name : ACTION_NAMES[action] || '出发';
}

function describeMoment(moment, state) {
  const names = { letter: '收起信笺', seal: '回声收起蓝票', wind: '顺风多走一格', bridge: '离开的纸桥已断',
    'order-blocked': '顺序未到，这封信还不能收', 'echo-plate': '踩到回声机关',
    'tide-gate': '通过潮汐门', 'echo-gate': '通过回声门', win: '全部收齐，信已送达', fail: '灯火耗尽' };
  const details = [...new Set(moment.events.map(event => names[event.type]).filter(Boolean))];
  if (moment.events.some(event => event.type === 'light')) {
    const amount = moment.events.filter(event => event.type === 'light').reduce((sum, event) => sum + (event.amount || 0), 0);
    details.push('灯火补充 +' + amount + ' 拍');
  }
  if (!details.length) details.push(moment.index === 0 ? '从起点回看，每一步都来自你刚才的操作。' :
    state.echo === null ? '回声还未出现，第三拍开始跟上。' : '回声落在三拍前的位置。');
  return details.join(' · ');
}

/** Read-only route analysis. Never writes a score, calls an ad, or consumes a tool.
 * At most 18 sparse state checkpoints are retained even at the 4096-action limit.
 * Revivals are separate moments: their zero-turn effect stays visible.
 */
function createRouteReview(level, actions, revivalHistory = [], itemRewards, supplyPolicy) {
  if (!Array.isArray(actions) || actions.length > 4096) throw new Error('invalid review history');
  const recorded = actions.slice(), history = normalizeReviveHistory(revivalHistory, recorded.length);
  const policy = normalizeSupplyPolicy(supplyPolicy, recorded.length, history.length);
  // The canonical replay validates legacy policy boundaries and every recorded action.
  const expected = replay(level, recorded, history, itemRewards, policy);
  const transitions = [], moments = [], checkpoints = new Map();
  const interval = Math.max(1, Math.ceil((recorded.length + history.length) / 16));
  let state = createState(level, itemRewards), revivalIndex = 0;
  function append(action, events) {
    const index = moments.length;
    moments.push({ index, action, label: index ? actionName(action) : '起点', turn: state.turn,
      events, key: index === 0 || events.some(event => KEY_EVENTS.has(event.type)) });
    if (index % interval === 0) checkpoints.set(index, state);
  }
  append(undefined, []);
  for (let index = 0; index <= recorded.length; index++) {
    if (history[revivalIndex] === index) {
      const version = revivalIndex < policy.legacyReviveCount ? 1 : 2, before = state;
      state = revive(level, state, version);
      transitions.push({ revival: true, version });
      append(null, [{ type: 'relight' }, { type: 'light', amount: state.energy - before.energy }]);
      revivalIndex++;
    }
    if (index === recorded.length) break;
    const action = recorded[index], version = index < policy.legacyActionCount ? 1 : 2;
    const result = step(level, state, action, version);
    state = result.state; transitions.push({ action, version }); append(action, result.events);
  }
  checkpoints.set(moments.length - 1, expected);
  const landmarks = moments.filter(moment => moment.key).map(moment => moment.index);
  if (landmarks[landmarks.length - 1] !== moments.length - 1) landmarks.push(moments.length - 1);
  let cached = { index: moments.length - 1, state: expected };
  function at(index) {
    if (!Number.isInteger(index) || index < 0 || index >= moments.length) return null;
    if (cached.index === index) return cached;
    const start = Math.floor(index / interval) * interval;
    let frame = checkpoints.get(start);
    for (let offset = start; offset < index; offset++) {
      const entry = transitions[offset];
      frame = entry.revival ? revive(level, frame, entry.version) : step(level, frame, entry.action, entry.version).state;
    }
    cached = { index, state: frame };
    return cached;
  }
  return { moments, landmarks, at, length: moments.length, checkpointCount: checkpoints.size };
}

function clearReviewInput(game) {
  game.pendingAction = null; game.pointer = null; game.actionPreview = null; game.keyboardFocus = null;
  game.renderer.pointer = null; game.renderer.hits = []; game.renderer.boardGeometry = null;
  game.lastFrame = -Infinity;
}

function openReview(game) {
  if (game.page !== 'game' || game.hidden || game.busy || !game.state || !game.actions.length ||
      game.modal && !['pause', 'win', 'fail'].includes(game.modal.kind)) return false;
  let model;
  try { model = createRouteReview(game.level, game.actions, game.reviveHistory, game.itemRewards, game.supplyPolicy); }
  catch (_) { game.toast('这段路线暂时无法复盘，当前进度已保留'); return false; }
  game.cancelItem();
  game.routeReview = { model, index: model.length - 1, returnModal: game.modal, session: game.session,
    level: game.level, camera: new SceneCamera() };
  game.page = 'review'; game.modal = null; game.toastUntil = 0;
  clearReviewInput(game); game.syncMusic();
  return true;
}

function seekReview(game, index) {
  const review = game.routeReview;
  if (game.page !== 'review' || game.hidden || game.busy || !review || review.session !== game.session ||
      review.level !== game.level || !Number.isInteger(index)) return false;
  review.index = Math.max(0, Math.min(review.model.length - 1, index));
  clearReviewInput(game);
  return true;
}

function reviewLandmark(game, direction) {
  const review = game.routeReview;
  if (!review || ![-1, 1].includes(direction)) return false;
  const points = review.model.landmarks;
  const index = direction > 0 ? points.find(value => value > review.index) : points.slice().reverse().find(value => value < review.index);
  return index === undefined ? false : seekReview(game, index);
}

function closeReview(game) {
  const review = game.routeReview;
  if (game.page !== 'review' || game.hidden || game.busy || !review || review.session !== game.session) return false;
  game.page = 'game'; game.modal = review.returnModal; game.routeReview = null;
  clearReviewInput(game); game.syncMusic();
  return true;
}

function reviewKey(game, key) {
  if (game.page !== 'review' || !game.routeReview || game.modal) return false;
  const review = game.routeReview;
  if (key === 'Escape' || key === 'Backspace') closeReview(game);
  else if (key === 'ArrowLeft') seekReview(game, review.index - 1);
  else if (key === 'ArrowRight') seekReview(game, review.index + 1);
  else if (key === 'Home') seekReview(game, 0);
  else if (key === 'End') seekReview(game, review.model.length - 1);
  else if (key === 'PageUp') reviewLandmark(game, -1);
  else if (key === 'PageDown') reviewLandmark(game, 1);
  else return false;
  return true;
}

module.exports = { createRouteReview, describeMoment, openReview, seekReview, reviewLandmark, closeReview, reviewKey };
