'use strict';

const { neighbor } = require('./engine');
const { CAMPAIGN } = require('./levels');
const { campaignRecord } = require('./campaign-progress');

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
    if (campaignRecord(profile, map.id))
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
  const titles = { wind: '顺着风口，多走一格', light: '走上风灯，补回三拍', bridge: '离开纸桥，无法折返' };
  const rules = {
    wind: landing === null ? '前方被挡住时，就停在箭头格。'
      : '走进箭头格，顺风多走一格。\n只扣 1 拍，不连续吹。',
    light: used ? '这盏灯已在本次路线中用过。'
      : '移动扣 1 拍后补 3 拍，每盏仅一次。',
    bridge: used ? '这座纸桥已经碎了，不能再走。'
      : '可以走上纸桥；离开后，桥就会碎。'
  };
  return {
    kind: 'mechanic', mechanic: id, step: phase + 1, total: 2, action: null,
    control: 'mechanic-next', buttonLabel: phase ? lesson.ids.length > 1 ? '认识下个道具' : '开始投递' : '看看规则',
    title: phase ? titles[id] : '新' + (id === 'light' ? '道具' : '机关') + '：' + NAMES[id],
    text: phase ? rules[id] : '点手指指向的' + NAMES[id] + '，看看它的用法。',
    tip: !phase ? '这里只看规则，不移动也不扣拍。'
      : id === 'wind' ? '等待不会触发风；只在落点收集。'
      : id === 'bridge' ? '回声仍可沿旧脚印通过。'
      : used ? '回头经过不会再次补拍。' : '尽量顺路取灯，留好回邮局的拍数。',
    visual: { focus: { cell: focusCell, kind: id }, tapCell: focusCell, player: s.player,
      label: phase ? '记住了' : '认识' + NAMES[id],
      fromCell: phase && id === 'wind' && landing !== null ? cell : null }
  };
}

module.exports = { MECHANICS, NAMES, availableMechanics, createMechanicGuide, mechanicStep };
