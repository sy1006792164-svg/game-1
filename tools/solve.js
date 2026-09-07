'use strict';

const { createState, step, ACTIONS } = require('../src/engine');

/** Breadth-first reference solver. Light is unlimited while finding a witness. */
function solve(level, limit = 350000) {
  const unlimited = { ...level, budget: 9999 };
  const first = createState(unlimited);
  const key = state => [state.player, state.history.slice(-3).join('.'), state.letters.join('.'), state.seals.join('.')].join('|');
  const queue = [{ state: first, parent: -1, action: null }];
  const seen = new Set([key(first)]);
  for (let head = 0; head < queue.length && queue.length <= limit; head++) {
    const current = queue[head];
    if (current.state.status === 'won') {
      const route = [];
      for (let at = head; queue[at].parent >= 0; at = queue[at].parent) route.push(queue[at].action);
      return route.reverse();
    }
    for (const action of ACTIONS) {
      const result = step(unlimited, current.state, action);
      if (!result.moved) continue;
      const signature = key(result.state);
      if (seen.has(signature)) continue;
      seen.add(signature);
      queue.push({ state: result.state, parent: head, action });
    }
  }
  return null;
}

module.exports = { solve };

if (require.main === module) {
  const { CAMPAIGN } = require('../src/levels');
  for (const level of CAMPAIGN) {
    const solution = solve(level);
    console.log(JSON.stringify({ id: level.id, turns: solution && solution.length, par: level.par, solution }));
    if (!solution) process.exitCode = 1;
  }
}
