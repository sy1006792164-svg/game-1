'use strict';

const { C } = require('./theme');
const { COLLECTION_DELAY_MS, COLLECTION_FLIGHT_MS, COLLECTION_IMPACT_MS,
  FEEDBACK_ENTER_MS, FEEDBACK_FADE_MS } = require('./feedback-timing');

const STYLES = {
  letter: { label: '信笺', objective: 1, icon: 'letter', color: '#98683f', collection: true, duration: 2200 },
  seal: { label: '邮票', objective: 2, icon: 'stamp', color: '#3c7c81', collection: true, duration: 2200 },
  light: { label: '风灯', objective: 0, icon: 'lamp', color: '#98683f', collection: true, duration: 2200 },
  bridge: { label: '纸桥碎了', icon: 'bridge', detail: '这格不能再走，回声仍能通过', duration: 1800 },
  wait: { label: '等一拍', objective: 0, color: C.green, duration: 1300 },
  undo: { label: '已撤回', color: C.green, duration: 1300 },
  blocked: { label: '这边不通', icon: 'close', detail: '试试相邻亮格，这次没有消耗拍数', duration: 1800 }
};

function recordEvents(items, events, at) {
  const counts = new Map();
  for (const event of events) {
    if (STYLES[event.type]) counts.set(event.type, (counts.get(event.type) || 0) + 1);
  }
  counts.forEach((amount, type) => {
    const style = STYLES[type], previous = items.get(type);
    if (style.objective === 0) {
      for (const [other, item] of items) if (other !== type && item.objective === 0) items.delete(other);
    }
    const count = amount + (style.collection && previous ? previous.count : 0);
    const value = type === 'light' ? '+' + count * 3 + ' 拍'
      : style.collection ? '+' + count : type === 'wait' ? '−1 拍' : '';
    items.set(type, { ...style, type, at, count, value });
  });
}

function gameFeedback(r, game, now) {
  let buffer = r.gameFeedback;
  if (!buffer || buffer.game !== game || buffer.session !== game.session || buffer.level !== game.level) {
    buffer = r.gameFeedback = { game, session: game.session, level: game.level, items: new Map() };
  }
  const changed = buffer.at !== game.transitionAt || buffer.events !== game.moveEvents;
  const blocked = Number.isFinite(game.blockedAt) && buffer.blockedAt !== game.blockedAt;
  const backwards = Number.isFinite(buffer.turn) && game.state.turn < buffer.turn;
  buffer.at = game.transitionAt; buffer.events = game.moveEvents;
  buffer.blockedAt = game.blockedAt; buffer.turn = game.state.turn;
  // Consume events behind overlays, so closing one cannot replay old feedback.
  if (game.modal || game.reviewing || game.state.status !== 'playing') {
    buffer.items.clear();
    return null;
  }
  if (backwards) buffer.items.clear();
  if (!Number.isFinite(game.blockedAt)) buffer.items.delete('blocked');
  for (const [type, item] of buffer.items) {
    if (now < item.at || now - item.at >= item.duration) buffer.items.delete(type);
  }
  if (changed) {
    const events = game.moveEvents || [];
    if (events.some(event => event.type === 'undo')) buffer.items.clear();
    buffer.items.delete('wait'); buffer.items.delete('undo');
    // Collection acknowledgements survive subsequent moves; undo removes their gains.
    recordEvents(buffer.items, events, game.transitionAt);
  }
  if (blocked) recordEvents(buffer.items, [{ type: 'blocked' }], game.blockedAt);
  const items = [...buffer.items.values()].filter(item => now >= item.at && now - item.at < item.duration);
  return items.length ? { items } : null;
}

function feedbackOpacity(r, item, now) {
  if (r.reducedMotion) return 1;
  const delay = item.collection ? COLLECTION_IMPACT_MS : 0;
  const age = now - item.at - delay;
  const enter = Math.max(0, Math.min(1, age / FEEDBACK_ENTER_MS));
  const fade = Math.max(0, Math.min(1, (item.duration - (now - item.at)) / FEEDBACK_FADE_MS));
  return enter * fade;
}

function objectiveFeedback(feedback, index) {
  if (!feedback) return null;
  return feedback.items.filter(item => item.objective === index).reduce((latest, item) =>
    !latest || item.at >= latest.at ? item : latest, null);
}

// Keep the gain in the icon's own column, inside the paper and clear of the progress ticks.
function drawObjectiveFeedback(r, item, bounds, now) {
  if (!item || !item.value) return;
  const opacity = feedbackOpacity(r, item, now);
  if (!opacity) return;
  const c = r.ctx, { x, y, w, h } = bounds;
  c.save(); c.globalAlpha *= opacity;
  r.font(13, '600');
  const size = Math.min(13, 13 * w / Math.max(1, c.measureText(item.value).width));
  const rise = r.reducedMotion ? 0 : (1 - Math.min(1, Math.max(0, now - item.at -
    (item.collection ? COLLECTION_IMPACT_MS : 0)) / FEEDBACK_FADE_MS)) * 1.5;
  r.text(item.value, x + w / 2, y + h / 2 + rise, size, item.color, 'center', '600');
  c.restore();
}

// Contextual warnings share the existing help card instead of adding another overlay.
function drawContextFeedback(r, notice, layout, now) {
  const item = notice && notice.items.filter(entry => entry.detail).sort((a, b) => b.at - a.at)[0];
  if (!item) return false;
  const { hintY: y, hintHeight: h } = layout, c = r.ctx;
  r.panel(24, y, 342, h, { fill: C.panel, stroke: C.line, radius: 13 });
  r.line([[26, y + 12], [26, y + h - 12]], '#b68b67', 2);
  r.icon(item.icon, 46, y + h / 2, 17, '#93613f');
  c.save(); c.globalAlpha *= feedbackOpacity(r, item, now);
  r.text(item.label, 70, y + h / 2 - 9, 14, '#805237', 'left', '600');
  r.text(item.detail, 70, y + h / 2 + 10, 11, '#826d53');
  c.restore();
  return true;
}

module.exports = { COLLECTION_DELAY_MS, COLLECTION_FLIGHT_MS, STYLES,
  gameFeedback, objectiveFeedback, drawObjectiveFeedback, drawContextFeedback };
