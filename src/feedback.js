'use strict';

// Resolve real turn events into at most two cues so simultaneous pickups stay clear.
function turnFeedback(events, before, after) {
  const types = new Set(events.map(event => event.type));
  if (types.has('win')) return { sounds: ['win'], haptic: true };
  if (types.has('fail')) return { sounds: ['fail'], haptic: false };
  const sounds = ['light', 'seal', 'letter', 'bridge', 'wind'].filter(type => types.has(type)).slice(0, 2);
  const low = before.energy > 3 && after.energy <= 3;
  const echoAppeared = before.echo === null && after.echo !== null;
  if (low && sounds.length < 2) sounds.push('low');
  else if (echoAppeared && sounds.length < 2) sounds.push('echo');
  if (!sounds.length) sounds.push(types.has('wait') ? 'wait' : 'move');
  return { sounds, haptic: ['letter', 'seal', 'light'].some(type => types.has(type)) };
}

module.exports = { turnFeedback };
