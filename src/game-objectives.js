'use strict';

const { C } = require('./theme');
const { drawUiIcon } = require('./ui-icons');
const { GAME_LAYOUT } = require('./game-layout');
const { objectiveFeedback, drawObjectiveFeedback } = require('./game-feedback');
const { COLLECTION_IMPACT_MS, OBJECTIVE_PULSE_MS } = require('./feedback-timing');

const OBJECTIVES = Object.freeze({ x: GAME_LAYOUT.x, y: GAME_LAYOUT.objectivesY,
  w: GAME_LAYOUT.width, h: GAME_LAYOUT.objectivesHeight, column: 114 });
const objectiveAnchor = index => ({ x: OBJECTIVES.x + index * OBJECTIVES.column + 22, y: OBJECTIVES.y + 31 });

function drawObjectives(r, game, now, feedback) {
  const l = game.level, s = game.state, previous = game.previousState;
  const low = s.status === 'playing' && s.energy <= 3;
  const { x, y, h, column } = OBJECTIVES;
  // Keep each objective on its own paper face; flight anchors stay unchanged.
  r.round(x, y, column - 8, h, 16, low || s.status === 'failed' ? C.dangerText : C.green);
  for (let index = 1; index <= 2; index++) {
    const complete = index === 1 ? !s.letters.length : !s.seals.length;
    r.round(x + index * column + 4, y, column - 4, h, 14,
      complete ? C.soft : C.panel, C.line);
  }
  const objectives = [
    { label: low ? '即将耗尽' : s.status === 'failed' ? '灯火已尽' : '剩余拍数', icon: 'lamp', value: s.energy, suffix: ' 拍', changed: previous && previous.energy !== s.energy,
      color: C.white },
    { label: !s.letters.length ? '信笺已齐' : '收集信笺', icon: 'letter', value: l.letters.length - s.letters.length,
      suffix: ' / ' + l.letters.length, complete: !s.letters.length,
      changed: previous && previous.letters.length !== s.letters.length,
      color: !s.letters.length ? C.green : C.orange, numberColor: C.goldText },
    { label: !s.seals.length ? '蓝票已齐' : '回声蓝票', icon: 'stamp', value: l.seals.length - s.seals.length,
      suffix: ' / ' + l.seals.length, complete: !s.seals.length,
      changed: previous && previous.seals.length !== s.seals.length, color: !s.seals.length ? C.green : C.blueText }
  ];
  objectives.forEach((objective, index) => {
    const left = x + index * column, anchor = objectiveAnchor(index);
    let item = objectiveFeedback(feedback, index);
    // Walking and waiting spend the same budget. Keep an arriving lamp gain
    // visible, otherwise acknowledge the real debit beneath the lamp icon.
    if (!index && !item && previous && previous.energy > s.energy && Number.isFinite(game.transitionAt) &&
        s.status === 'playing' && !game.reviewing && !game.modal && now - game.transitionAt < 1000) {
      item = { at: game.transitionAt, duration: 1000, value: '−' + (previous.energy - s.energy), color: C.white };
    }
    const impactAt = item && item.collection
      ? Number.isFinite(item.impactAt) ? item.impactAt : item.at + COLLECTION_IMPACT_MS
      : game.transitionAt;
    const age = now - impactAt;
    const emphasized = index ? objective.changed || item : item;
    const pulse = !r.reducedMotion && emphasized && age >= 0 && age < OBJECTIVE_PULSE_MS ? Math.sin(age / OBJECTIVE_PULSE_MS * Math.PI) : 0;
    if (pulse) {
      r.ctx.save(); r.ctx.globalAlpha *= pulse * .65;
      r.circle(anchor.x, anchor.y, 13 + pulse * 4, null, objective.color);
      if (r.effectsQuality !== 'low' && item && item.collection) {
        const travel = age / OBJECTIVE_PULSE_MS;
        for (let spark = 0; spark < 5; spark++) {
          const angle = spark * Math.PI * 2 / 5 - Math.PI / 2, distance = 12 + travel * 10;
          const sx = anchor.x + Math.cos(angle) * distance, sy = anchor.y + Math.sin(angle) * distance;
          r.line([[sx - Math.cos(angle) * 2, sy - Math.sin(angle) * 2], [sx, sy]], objective.color, 1.3);
        }
      }
      r.ctx.restore();
    }
    drawUiIcon(r, objective.complete ? 'check' : objective.icon, anchor.x, anchor.y, objective.color, 21);
    r.label(objective.label, left + 42, y + 16, 66, 12, index ? C.muted : C.white);
    const preferred = index ? 22 : 30;
    r.font(preferred, '700');
    const size = Math.min(preferred, preferred * 42 / Math.max(1, r.ctx.measureText(String(objective.value)).width)) + pulse * .8;
    r.text(objective.value, left + 42, y + 40, size, objective.complete ? objective.color : objective.numberColor || objective.color, 'left', '700');
    r.font(size, '700');
    const numberWidth = r.ctx.measureText(String(objective.value)).width;
    r.text(objective.suffix, left + 42 + numberWidth, y + 43, 12, index ? C.muted : C.white);
    if (index) {
      const total = index === 1 ? l.letters.length : l.seals.length;
      r.meter(left + 42, y + h - 11, 62, total ? objective.value : 1, total || 1, objective.color);
    }
    drawObjectiveFeedback(r, index === 0 && item ? { ...item, color: C.white } : item,
      { x: left + 6, y: y + 45, w: 32, h: 16 }, now);
  });
  if (low && !game.modal && !game.busy) {
    r.ctx.save(); r.ctx.globalAlpha *= r.reducedMotion ? .5 : .3 + (Math.sin(now / 380) + 1) * .12;
    r.line([[x + 42, y + 57], [x + 91, y + 57]], C.white, 1.5);
    r.ctx.restore();
  }
}

module.exports = { objectiveAnchor, drawObjectives };
