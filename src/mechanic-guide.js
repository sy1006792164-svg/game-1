'use strict';

const { ACTIONS, neighbor, step } = require('./engine');
const { CAMPAIGN } = require('./levels');
const { campaignRecord } = require('./campaign-progress');

const MECHANICS = ['order', 'supply', 'wind', 'bridge', 'light'];
const NAMES = { wind: '风口', bridge: '纸桥', light: '风灯', supply: '补给驿站', order: '顺序来信' };

function mechanicCells(level, id) {
  if (!level) return [];
  return id === 'wind' ? Object.keys(level.winds || {}).map(Number)
    : id === 'bridge' ? level.bridges || [] : id === 'light' ? level.lights || []
    : id === 'supply' ? Object.keys(level.supplies || {}).map(Number) : id === 'order' ? level.letterOrder || [] : [];
}

function availableMechanics(level, mode = 'campaign') {
  return mode === 'campaign' ? MECHANICS.filter(id => mechanicCells(level, id).length) : [];
}

function createMechanicGuide(profile, level, mode) {
  const available = availableMechanics(level, mode), seen = new Set();
  MECHANICS.forEach(id => { if (profile.mechanicGuides && profile.mechanicGuides[id] === true) seen.add(id); });
  // Derive old encounters from actual completed maps, never the highest level number.
  CAMPAIGN.forEach(map => {
    if (campaignRecord(profile, map.id))
      availableMechanics(map, mode).filter(id => id !== 'supply' && id !== 'order').forEach(id => seen.add(id));
  });
  const ids = available.filter(id => !seen.has(id));
  if (!ids.length) return null;
  // The stage is UI state only; never store a synthetic player or route.
  return { ids, phase: 0 };
}

/** Knowledge comes from an actual rules event, never from showing a card. */
function triggeredMechanics(level, before, action, result) {
  if (!result.moved) return [];
  const events = result.events, entry = neighbor(level, before.player, action, before);
  return MECHANICS.filter(id => id === 'wind' ? entry !== null && !!level.winds[entry]
    : id === 'bridge' ? events.some(event => event.type === 'bridge')
    : id === 'light' ? events.some(event => event.type === 'light' && !event.source)
    : id === 'supply' ? events.some(event => event.type === 'supply')
    : !!level.letterOrder && events.some(event => event.type === 'letter'));
}

function mechanicStep(game) {
  const lesson = game.mechanicGuide, s = game.state, l = game.level;
  if (!lesson || !lesson.ids.length || !s || s.status !== 'playing' || game.reviewing || game.selectedItem) return null;
  // Explain a mechanism only when it can be experienced on the next real step.
  // Other legal moves and undo remain available: this is guidance, not a gate.
  const candidates = ACTIONS.filter(action => action !== 'wait').map(action => {
    const result = step(l, s, action);
    return { action, result, ids: triggeredMechanics(l, s, action, result) };
  });
  for (const id of lesson.ids) {
    const encounter = candidates.find(candidate => candidate.ids.includes(id));
    if (!encounter) continue;
    const { action, result } = encounter;
    const entry = neighbor(l, s.player, action, s);
    const cell = id === 'bridge' ? s.player : id === 'wind' ? entry : result.state.player;
    const titles = { wind: '试着借一阵风', light: '这盏灯能补三拍', bridge: '离开纸桥，就会断开',
      supply: '前面的驿站有补给', order: '从发亮的编号信开始' };
    const rules = {
      wind: result.events.some(event => event.type === 'wind') ? '走进箭头格，只扣 1 拍，顺风再走一格。' : '风口前方被挡，走上去会停在箭头格。',
      light: '走上风灯，移动扣 1 拍后补 3 拍；每盏仅一次。',
      bridge: '这一步会踏碎身后的桥。先看清回程，回声仍可通过。',
      supply: '走上驿站，免费领取箱中道具 1 份；无需看视频。',
      order: '按编号依次收信。提前经过后面的信不会收取。'
    };
    return { kind: 'mechanic', interactive: true, mechanic: id, step: 1, total: 1, action, control: null,
      title: titles[id], text: rules[id], tip: '长按亮格预览这一步；也可自由选择路线。',
      visual: { focus: { cell, kind: id === 'order' ? 'letter' : id === 'supply' ? 'light' : id },
        tapCell: entry, player: s.player, label: '试一试', fromCell: null } };
  }
  return null;
}

module.exports = { MECHANICS, NAMES, availableMechanics, createMechanicGuide, mechanicStep, triggeredMechanics };
