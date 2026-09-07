'use strict';

const { createState, step } = require('./engine');

const CHALLENGE_VERSION = '1';
const TARGET_RESERVE = 1;

/** Tighten an existing route while preserving its map, targets and witness. */
function getChallenge(level) {
  if (!level || !Array.isArray(level.solution) || !level.solution.length) {
    throw new Error('A challenge needs a non-empty verified solution.');
  }

  // Replay the real engine so wind landings, starting lamps and one-use lamp
  // income follow exactly the same rules as play. Merely subtracting every
  // map lamp from par can exhaust the player before a late lamp is reached.
  const probe = { ...level, budget: level.solution.length + 1 };
  let state = createState(probe);
  let requiredBudget = 1;
  let netSpent = 0;
  for (const action of level.solution) {
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Invalid challenge solution: ' + level.id);
    state = result.state;
    // The probe's change in energy is turns spent minus actual lamp income.
    netSpent = probe.budget - state.energy;
    // Every unfinished prefix needs positive energy; the winning turn may
    // spend the final unit because the engine resolves victory first.
    requiredBudget = Math.max(requiredBudget, netSpent + (state.status === 'won' ? 0 : 1));
  }
  if (state.status !== 'won') throw new Error('Unfinished challenge solution: ' + level.id);

  const standardRevision = level.standardRevision === undefined ? level.revision : level.standardRevision;
  const standardBudget = level.standardBudget === undefined ? level.budget : level.standardBudget;
  const budget = Math.max(requiredBudget, netSpent + TARGET_RESERVE);

  return {
    ...level,
    // Copies keep derived maps safe to cache or annotate without changing the
    // campaign, a daily source level, or another call to getChallenge.
    walls: (level.walls || []).slice(),
    letters: (level.letters || []).slice(),
    seals: (level.seals || []).slice(),
    winds: { ...(level.winds || {}) },
    lights: (level.lights || []).slice(),
    solution: level.solution.slice(),
    challenge: true,
    revision: String(standardRevision || '1') + '-challenge-' + CHALLENGE_VERSION,
    standardRevision,
    standardBudget,
    budget,
    challengeReserve: budget - netSpent
  };
}

module.exports = { getChallenge, CHALLENGE_VERSION, TARGET_RESERVE };
