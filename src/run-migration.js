'use strict';

const { normalizeItemRewards } = require('./items');

/** Refund this run's recorded video tools when an update resets its effects.
 * Old station pickups never entered itemRewards. Refunding this ledger once
 * avoids guessing whether an old action spent a station or video tool.
 * start() immediately saves the new revision, so normal resumes do not refund.
 */
function upgradeVideoRewards(level, run) {
  return normalizeItemRewards(level, run.itemRewards);
}

module.exports = { upgradeVideoRewards };
