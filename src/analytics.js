'use strict';

// WeChat events are optional telemetry, never part of game progression.
function createReporter(platform) {
  const api = platform && platform.kind === 'wechat' && platform.wx;
  return function reportEvent(id, fields = {}) {
    if (!api || platform.isDevelopment === true || typeof api.reportEvent !== 'function') return false;
    try {
      api.reportEvent(id, fields);
      return true;
    } catch (_) { return false; }
  };
}

function reportGameEvent(game, id, fields = {}) {
  if (!game || typeof game.reportEvent !== 'function') return false;
  const state = game.state || {};
  try {
    return game.reportEvent(id, {
      level_id: game.level && game.level.id || 0,
      content_version: game.level && game.level.revision || '',
      environment: game.development ? 'development' : 'production',
      mode: game.mode || 'campaign', turn: state.turn || 0, energy: state.energy || 0,
      revive_count: state.reviveCount || 0,
      remaining_letters: (state.letters || []).length,
      remaining_seals: (state.seals || []).length,
      ...fields
    }) !== false;
  } catch (_) { return false; }
}

module.exports = { createReporter, reportGameEvent };
