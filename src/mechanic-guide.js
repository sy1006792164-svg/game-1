'use strict';

const { neighbor } = require('./engine');
const { CAMPAIGN } = require('./levels');

const MECHANICS = ['wind', 'bridge', 'light'];
const NAMES = { wind: '风口', bridge: '纸桥', light: '风灯' };

function mechanicCells(level, id) {
  if (!level) return [];
  return id === 'wind' ? Object.keys(level.winds || {}).map(Number)
    : id === 'bridge' ? level.bridges || [] : id === 'light' ? level.lights || [] : [];
}

function availableMechanics(level, mode = 'campaign') {
  return mode === 'campaign' ? MECHANICS.filter(id => mechanicCells(level, id).length) : [];
}

function createMechanicGuide(profile, level, mode) {
  const available = availableMechanics(level, mode), seen = new Set();
  MECHANICS.forEach(id => { if (profile.mechanicGuides && profile.mechanicGuides[id] === true) seen.add(id); });
  // Derive old encounters from actual completed maps, never the highest level number.
  CAMPAIGN.forEach(map => {
    const record = profile.completed && profile.completed[map.id];
    if (record && Number.isInteger(record.stars) && record.stars >= 1 && record.stars <= 3 &&
        Number.isInteger(record.bestTurns) && record.bestTurns >= 0 && record.bestTurns <= 100000)
      availableMechanics(map, mode).forEach(id => seen.add(id));
  });
  const ids = available.filter(id => !seen.has(id));
  if (!ids.length) return null;
  // The stage is UI state only; never store a synthetic player or route.
  return { ids, phase: 0 };
}

function mechanicStep(game) {
  const lesson = game.mechanicGuide, s = game.state, l = game.level;
  if (!lesson || !lesson.ids.length || !s || s.status !== 'playing' || game.reviewing) return null;
  const id = lesson.ids[0], cells = mechanicCells(l, id);
  if (!cells.length) return null;
  const available = id === 'light' ? s.lights : id === 'bridge' ? s.bridges : cells;
  // Prefer a still usable prop; legacy resumed routes can already have used them all.
  const cell = cells.find(item => available.includes(item)) ?? cells[0], phase = lesson.phase;
  const used = !available.includes(cell);
  const landing = id === 'wind' ? neighbor(l, cell, l.winds[cell], s) : null;
  const focusCell = phase && landing !== null ? landing : cell;
  const titles = { wind: '风口会再推一格', light: '风灯只补一次', bridge: '离开纸桥，它就会碎' };
  const rules = {
    wind: landing === null ? '走进箭头格，只扣 1 拍。\n前方被挡住时，就停在箭头格。'
      : '点相邻箭头格，会顺风再走一格。\n光圈是落点；只扣 1 拍，不连续吹。',
    light: used ? '这盏灯已在本次路线中用过。\n每盏只补 3 拍，回头不会再补。'
      : '走到风灯格，移动扣 1 拍后补 3 拍。\n每盏只能补一次，要沿路安排好。',
    bridge: used ? '这座纸桥已经碎了，不能再走。\n回声仍会沿旧脚印经过，不受影响。'
      : '可以走上纸桥；离开后，桥就会碎。\n你不能再回来，回声仍可沿脚印通过。'
  };
  return {
    kind: 'mechanic', mechanic: id, step: phase + 1, total: 2, action: null,
    control: 'mechanic-next', buttonLabel: phase ? lesson.ids.length > 1 ? '认识下个道具' : '开始投递' : '看看规则',
    title: phase ? titles[id] : '新' + (id === 'light' ? '道具' : '机关') + '：' + NAMES[id],
    text: phase ? rules[id] : '手指指向本关的' + NAMES[id] + '。\n先点它认识规则，再自己规划路线。',
    tip: phase && id === 'wind' ? '原地等待不会触发风；收集以最终落点为准。' : '讲解不会移动、不扣拍；也可以点“跳过”。',
    visual: { focus: { cell: focusCell, kind: id }, tapCell: focusCell, player: s.player,
      label: phase ? '记住了' : '认识' + NAMES[id],
      fromCell: phase && id === 'wind' && landing !== null ? cell : null }
  };
}

module.exports = { MECHANICS, NAMES, availableMechanics, createMechanicGuide, mechanicStep };
