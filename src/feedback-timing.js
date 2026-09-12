'use strict';

const MOVE_MS = 180;
const COLLECTION_DELAY_MS = 100;
const COLLECTION_FLIGHT_MS = 520;
const OBJECTIVE_PULSE_MS = 480;
const FEEDBACK_ENTER_MS = 160;
const FEEDBACK_FADE_MS = 260;
const RESULT_DELAY_MS = 400;
const RESULT_ANIMATION_MS = 1200;
const PICKUP = Object.freeze({ delay: MOVE_MS * .6, duration: 650 });
const EVENT_TIMINGS = Object.freeze({
  move: Object.freeze({ delay: MOVE_MS * .7, duration: 540 - MOVE_MS * .7 }),
  letter: PICKUP, seal: PICKUP, light: PICKUP,
  bridge: Object.freeze({ delay: 25, duration: 700 }),
  repair: Object.freeze({ delay: 0, duration: 700 }),
  wind: Object.freeze({ delay: 0, duration: 600 }),
  wait: Object.freeze({ delay: 0, duration: 650 }),
  'echo-born': Object.freeze({ delay: 0, duration: 780 }),
  undo: Object.freeze({ delay: 0, duration: 650 }),
  blocked: Object.freeze({ delay: 0, duration: 650 }),
  ready: Object.freeze({ delay: 0, duration: 950 }),
  win: Object.freeze({ delay: 0, duration: 950 }),
  fail: Object.freeze({ delay: 0, duration: 950 })
});
const EFFECT_BATCH_MS = Math.max(...Object.values(EVENT_TIMINGS).map(timing => timing.delay + timing.duration));
const COLLECTION_IMPACT_MS = COLLECTION_DELAY_MS + COLLECTION_FLIGHT_MS;
const COLLECTION_TYPES = new Set(['letter', 'seal', 'light']);

function active(now, at, duration) {
  return Number.isFinite(at) && now >= at && now - at < duration;
}

function batchActive(batch, now) {
  return !!batch && (batch.events || []).some(event => {
    const timing = event && EVENT_TIMINGS[event.type];
    const duration = COLLECTION_TYPES.has(event && event.type) ? COLLECTION_IMPACT_MS + OBJECTIVE_PULSE_MS
      : timing ? timing.delay + timing.duration : 0;
    return active(now, batch.at, duration);
  });
}

function sameSession(buffer, game) {
  return buffer && buffer.game === game && buffer.session === game.session && buffer.level === game.level &&
    !(Number.isFinite(buffer.turn) && buffer.turn > game.state.turn);
}

// Keep deliberate feedback at the input frame rate until it settles. Decorative
// loops do not qualify, and old batches cannot prolong another route or an undo.
function hasActiveFeedback(game, now) {
  if (!game || game.page !== 'game' || !game.state || game.reviewing || !Number.isFinite(now)) return false;
  const events = game.moveEvents || [];
  if (game.modal) {
    const kind = game.modal.kind;
    const result = (kind === 'win' && game.state.status === 'won') || (kind === 'fail' && game.state.status === 'failed');
    return result && events.some(event => event && event.type === kind) &&
      active(now, game.transitionAt, RESULT_DELAY_MS + RESULT_ANIMATION_MS);
  }
  if (active(now, game.blockedAt, EVENT_TIMINGS.blocked.duration) ||
      batchActive({ at: game.transitionAt, events }, now)) return true;
  const renderer = game.renderer || {}, effects = renderer.motionEffects, feedback = renderer.gameFeedback;
  if (sameSession(effects, game) && effects.undosUsed === game.undosUsed &&
      effects.batches.some(batch => batchActive(batch, now))) return true;
  if (!sameSession(feedback, game)) return false;
  for (const item of feedback.items.values()) {
    if (!active(now, item.at, item.duration)) continue;
    const age = now - item.at;
    if (item.collection && age < COLLECTION_IMPACT_MS + OBJECTIVE_PULSE_MS) return true;
    if (age < FEEDBACK_ENTER_MS || age >= item.duration - FEEDBACK_FADE_MS) return true;
  }
  return false;
}

module.exports = { MOVE_MS, EVENT_TIMINGS, EFFECT_BATCH_MS, COLLECTION_DELAY_MS, COLLECTION_FLIGHT_MS,
  COLLECTION_IMPACT_MS, OBJECTIVE_PULSE_MS, FEEDBACK_ENTER_MS, FEEDBACK_FADE_MS,
  RESULT_DELAY_MS, RESULT_ANIMATION_MS, hasActiveFeedback };
