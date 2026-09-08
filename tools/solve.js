'use strict';

const { createState, step, ACTIONS } = require('../src/engine');

/**
 * Breadth-first reference solver driven only by engine.step, so it shares no
 * code with the generator's search. Light is unlimited while finding a witness.
 * Expanded states are released and history keeps only the three positions
 * the echo can still read. Rebase turn to that short history: engine.step
 * reads history[turn - 3], while route length comes from the parent chain.
 * `limit` caps the number of queued states; null means exhausted, not unsolvable.
 */
function solve(level, limit = 400000) {
  const unlimited = { ...level, budget: 9999 };
  const trim = state => {
    if (state.history.length <= 3) return state;
    return { ...state, turn: 2, history: state.history.slice(-3) };
  };
  const key = state => state.player + '|' + state.history.slice(-3).join('.') + '|' + state.letters.join('.') + '|' + state.seals.join('.') + '|' + (state.bridges || []).join('.');
  const first = createState(unlimited);
  const queue = [{ state: first, parent: -1, action: null }];
  const seen = new Set([key(first)]);
  for (let head = 0; head < queue.length && queue.length <= limit; head++) {
    const current = queue[head], state = current.state;
    current.state = null;
    if (state.status === 'won') {
      const route = [];
      for (let at = head; queue[at].parent >= 0; at = queue[at].parent) route.push(queue[at].action);
      return route.reverse();
    }
    for (const action of ACTIONS) {
      const result = step(unlimited, state, action);
      if (!result.moved) continue;
      const next = trim(result.state);
      const signature = key(next);
      if (seen.has(signature)) continue;
      seen.add(signature);
      queue.push({ state: next, parent: head, action });
    }
  }
  return null;
}

module.exports = { solve };

if (require.main === module) {
  const { CAMPAIGN } = require('../src/levels');
  const limit = Number(process.argv[2]) || 400000;
  for (const level of CAMPAIGN) {
    const solution = solve(level, limit);
    console.log(JSON.stringify({ id: level.id, turns: solution && solution.length, par: level.par, solution }));
    if (!solution) process.exitCode = 1;
  }
}
