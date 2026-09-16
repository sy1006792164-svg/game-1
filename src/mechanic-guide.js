'use strict';

const { ACTIONS, neighbor, step } = require('./engine');
const { CAMPAIGN } = require('./levels');
const { campaignRecord } = require('./campaign-progress');
const { gateStatus } = require('./route-mechanics');
const { adjacentCell, echoArrival, gateMessage } = require('./route-mechanic-view');

const MECHANICS = ['order', 'wind', 'bridge', 'tide', 'echoGate'];
const NAMES = { wind: '风口', bridge: '纸桥', order: '顺序来信', tide: '潮汐门', echoGate: '回声门' };

function mechanicCells(level, id) {
  if (!level) return [];
  return id === 'wind' ? Object.keys(level.winds || {}).map(Number)
    : id === 'bridge' ? level.bridges || [] : id === 'order' ? level.letterOrder || []
    : id === 'tide' ? Object.keys(level.tideGates || {}).map(Number)
    : id === 'echoGate' ? Object.keys(level.echoGates || {}).map(Number) : [];
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
      availableMechanics(map, mode).filter(id => id === 'wind' || id === 'bridge').forEach(id => seen.add(id));
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
    : id === 'tide' ? events.some(event => event.type === 'tide-gate')
    : id === 'echoGate' ? events.some(event => event.type === 'echo-gate')
    : !!level.letterOrder && events.some(event => event.type === 'letter'));
}

function gateLesson(game, id) {
  const l = game.level, s = game.state, cells = mechanicCells(l, id);
  const cell = cells.find(target => adjacentCell(l, s.player, target));
  if (cell !== undefined) {
    const gate = gateStatus(l, s, cell), wait = !gate.open && (id === 'tide' || echoArrival(s, gate.plate) !== null);
    const focus = gate.open || id === 'tide' ? cell : gate.plate;
    const action = gate.open ? ACTIONS.find(name => neighbor(l, s.player, name, s) === cell) : wait ? 'wait' : null;
    return { kind: 'mechanic', interactive: true, mechanic: id, step: 1, total: 1,
      action, control: wait ? 'wait' : null, title: gate.open ? NAMES[id] + '已开，试着穿过去' : id === 'tide' ? '等潮退，再穿门' : '让回声替你压住踏板',
      text: gateMessage(l, s, gate), tip: '长按门格可查看开闭原因。',
      visual: { focus: { cell: focus, kind: id === 'tide' ? 'wind' : 'echo' },
        tapCell: gate.open ? cell : null, player: s.player, label: '穿过门', fromCell: null } };
  }
  if (id !== 'echoGate') return null;
  const plate = Object.values(l.echoGates || {}).map(gate => gate.plate)
    .find(target => adjacentCell(l, s.player, target));
  const action = ACTIONS.find(name => neighbor(l, s.player, name, s) === plate);
  if (plate === undefined || !action) return null;
  return { kind: 'mechanic', interactive: true, mechanic: id, step: 1, total: 1, action, control: null,
    title: '先在回声踏板上留下脚印', text: '门和踏板有相同纹样。回声晚 3 拍到达，压住踏板时才能进门。',
    tip: '先排好从踏板到门前的路线。', visual: { focus: { cell: plate, kind: 'echo' },
      tapCell: plate, player: s.player, label: '踩踏板', fromCell: null } };
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
    if (id === 'tide' || id === 'echoGate') {
      const guide = gateLesson(game, id);
      if (guide) return guide;
      continue;
    }
    const encounter = candidates.find(candidate => candidate.ids.includes(id));
    if (!encounter) continue;
    const { action, result } = encounter;
    const entry = neighbor(l, s.player, action, s);
    const cell = id === 'bridge' ? s.player : id === 'wind' ? entry : result.state.player;
    const titles = { wind: '试着借一阵风', bridge: '离开纸桥，就会断开', order: '从发亮的编号信开始' };
    const rules = {
      wind: result.events.some(event => event.type === 'wind') ? '走进箭头格，只扣 1 拍，顺风再走一格。' : '风口前方被挡，走上去会停在箭头格。',
      bridge: '这一步会踏碎身后的桥。先看清回程，回声仍可通过。',
      order: '按编号依次收信。提前经过后面的信不会收取。'
    };
    return { kind: 'mechanic', interactive: true, mechanic: id, step: 1, total: 1, action, control: null,
      title: titles[id], text: rules[id], tip: '长按亮格预览这一步；也可自由选择路线。',
      visual: { focus: { cell, kind: id === 'order' ? 'letter' : id },
        tapCell: entry, player: s.player, label: '试一试', fromCell: null } };
  }
  return null;
}

module.exports = { MECHANICS, NAMES, availableMechanics, createMechanicGuide, mechanicStep, triggeredMechanics };
