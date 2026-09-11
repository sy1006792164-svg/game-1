'use strict';

const { C } = require('./theme');
const { drawUiIcon } = require('./ui-icons');
const { objectiveFeedback, drawObjectiveFeedback } = require('./game-feedback');
const { COLLECTION_IMPACT_MS, OBJECTIVE_PULSE_MS } = require('./feedback-timing');

const OBJECTIVES = Object.freeze({ x: 24, y: 81, w: 342, h: 62, column: 114 });
const objectiveAnchor = index => ({ x: OBJECTIVES.x + index * OBJECTIVES.column + 22, y: 110 });

function drawObjectives(r, game, now, feedback) {
  const l = game.level, s = game.state, previous = game.previousState;
  const low = s.status === 'playing' && s.energy <= 3;
  const { x, y, w, h, column } = OBJECTIVES;
  r.panel(x, y, w, h, { radius: 10, accent: C.gold });
  const objectives = [
    { label: '剩余拍数', icon: 'lamp', value: s.energy, suffix: ' 拍', changed: previous && previous.energy !== s.energy,
      color: low || s.status === 'failed' ? '#ad5845' : '#98683f' },
    { label: !s.letters.length ? '信笺已齐' : '收集信笺', icon: 'letter', value: l.letters.length - s.letters.length,
      total: l.letters.length, suffix: ' / ' + l.letters.length, complete: !s.letters.length,
      changed: previous && previous.letters.length !== s.letters.length, color: !s.letters.length ? C.green : '#98683f' },
    { label: !s.seals.length ? '邮票已齐' : '回声邮票', icon: 'stamp', value: l.seals.length - s.seals.length,
      total: l.seals.length, suffix: ' / ' + l.seals.length, complete: !s.seals.length,
      changed: previous && previous.seals.length !== s.seals.length, color: !s.seals.length ? C.green : '#3c7c81' }
  ];
  objectives.forEach((objective, index) => {
    const left = x + index * column, anchor = objectiveAnchor(index), item = objectiveFeedback(feedback, index);
    const impactAt = item && item.collection ? item.at + COLLECTION_IMPACT_MS : game.transitionAt;
    const age = now - impactAt;
    const emphasized = index ? objective.changed || item : item;
    const pulse = !r.reducedMotion && emphasized && age >= 0 && age < OBJECTIVE_PULSE_MS ? Math.sin(age / OBJECTIVE_PULSE_MS * Math.PI) : 0;
    if (index) r.line([[left, 99], [left, 125]], '#d4dccd', .8);
    if (pulse) {
      r.ctx.save(); r.ctx.globalAlpha *= pulse * .32;
      r.circle(anchor.x, anchor.y, 13 + pulse * 4, null, objective.color);
      r.ctx.restore();
    }
    r.circle(anchor.x, anchor.y + 1.5, 15, '#b9bfa2');
    r.circle(anchor.x, anchor.y, 15, objective.complete ? '#e6edda' : '#f5ead1', '#d4c7a6');
    r.circle(anchor.x, anchor.y - .6, 12, null, '#fff8e3');
    drawUiIcon(r, objective.complete ? 'check' : objective.icon, anchor.x, anchor.y, objective.color, 21);
    r.label(objective.label, left + 42, 95, 66, 10, C.muted);
    const size = (index ? 23 : 25) + pulse * .8;
    r.text(objective.value, left + 42, 116, size, objective.color, 'left', '600');
    r.font(size, '600');
    const numberWidth = r.ctx.measureText(String(objective.value)).width;
    r.text(objective.suffix, left + 42 + numberWidth, 119, 12, C.muted);
    if (objective.total) {
      const tickWidth = Math.min(8, 58 / objective.total - 3);
      for (let tick = 0; tick < objective.total; tick++) {
        r.round(left + 42 + tick * (tickWidth + 3), 135, tickWidth, 2, 1,
          tick < objective.value ? objective.color : '#dce3d6');
      }
    }
    drawObjectiveFeedback(r, item, { x: left + 6, y: 124, w: 32, h: 16 }, now);
  });
  if (low && !game.modal && !game.busy) {
    r.ctx.save(); r.ctx.globalAlpha *= r.reducedMotion ? .5 : .3 + (Math.sin(now / 380) + 1) * .12;
    r.line([[x + 42, 135], [x + 91, 135]], '#bb715a', 1.5);
    r.ctx.restore();
  }
}

module.exports = { objectiveAnchor, drawObjectives };
