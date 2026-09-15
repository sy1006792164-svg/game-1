'use strict';

const { createState, step } = require('./engine');
const { ITEMS, itemOffer } = require('./items');

// Each chapter gives players room to learn, vary a route and finish a trial.
// These rules change the cost of experimenting, never the verified star target.
const PHASES = Object.freeze([
  { id: 'learn', name: '启程', ratio: .32, minimum: 6, undo: 6, guidance: '先认清目标，留些脚步试一试路线。' },
  { id: 'practice', name: '练习', ratio: .28, minimum: 5, undo: 5, guidance: '把收信与盖票接在一起，练习少走回头路。' },
  { id: 'variation', name: '变奏', ratio: .24, minimum: 4, undo: 4, guidance: '换一条邮路，观察本关机关与回声的配合。' },
  { id: 'rest', name: '漫游', ratio: .38, minimum: 7, undo: 6, guidance: '这一程灯火更宽裕，可以从容探索岔路。' },
  { id: 'refine', name: '进阶', ratio: .22, minimum: 4, undo: 4, guidance: '出发前安排远端目标，把最后三拍留给回声。' },
  { id: 'trial', name: '试炼', ratio: .16, minimum: 3, undo: 3, guidance: '串起本章所学；先送达，再向最短路线挑战。' }
]);

const THEMES = Object.freeze({
  echo: { name: '回声合奏', focus: '蓝票要提前三拍经过，让回声盖好再到邮局。' },
  route: { name: '岔路寻信', focus: '先看最远的信与票，再安排支路的往返顺序。' },
  wind: { name: '借风远行', focus: '风口只推一次，从落点继续规划下一拍。' },
  light: { name: '灯火接力', focus: '沿途纸灯每盏补三拍，把补给排进投递路线。' },
  bridge: { name: '纸桥渡信', focus: '纸桥离开即断，先确定过桥顺序；回声不受断桥影响。' }
});
const THEME_ORDER = ['echo', 'route', 'wind', 'light', 'bridge'];

function phaseFor(index) {
  // The final chapter has three routes; its last delivery is still a finale.
  return PHASES[index === 998 ? 5 : index % PHASES.length];
}

function practiceReserve(index, par) {
  const phase = phaseFor(index);
  return Math.max(phase.minimum, Math.ceil(par * Math.round(phase.ratio * 100) / 100));
}

function themeFor(level) {
  const available = ['echo', 'route'];
  if (Object.keys(level.winds || {}).length) available.push('wind');
  if ((level.lights || []).length) available.push('light');
  if ((level.bridges || []).length) available.push('bridge');
  const chapter = Math.floor((level.id - 1) / PHASES.length);
  const preferred = THEME_ORDER[chapter % THEME_ORDER.length];
  return available.includes(preferred) ? preferred : available[available.length - 1];
}

/** Add real route rules only where the existing witness proves they work. */
function addCampaignMechanics(level) {
  const index = level.id - 1, slot = index % PHASES.length;
  const ordered = level.id >= 7 && slot === 2 && level.letters.length >= 2;
  const supply = level.id >= 4 && (slot === 1 || slot === 3);
  if (!ordered && !supply) return;
  const probe = { ...level, budget: level.par + 1 }, trace = [], order = [];
  let state = createState(probe);
  for (const action of level.solution) {
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Invalid campaign mechanic route: ' + level.id);
    result.events.forEach(event => { if (event.type === 'letter') order.push(event.cell); });
    state = result.state;
    trace.push(state);
  }
  if (state.status !== 'won') throw new Error('Unfinished campaign mechanic route: ' + level.id);
  if (ordered) {
    if (order.length !== level.letters.length) throw new Error('Incomplete letter order: ' + level.id);
    level.letterOrder = order;
  }
  if (supply) placeSupply(level, trace);
}

function placeSupply(level, trace) {
  const occupied = new Set([level.start, level.exit, ...level.walls, ...level.letters,
    ...level.seals, ...level.lights, ...level.bridges, ...Object.keys(level.winds).map(Number)]);
  const seen = new Set(), candidates = trace.filter(state => {
    if (seen.has(state.player)) return false;
    seen.add(state.player);
    return state.status === 'playing' && state.turn <= level.par * .6 && !occupied.has(state.player);
  });
  // Vary the tool across chapters. A station is placed only when the real
  // route state proves its tool is unlocked and usable at the pickup point.
  const tools = ['oil', 'kite', 'echo', 'bridge'], chapter = Math.floor((level.id - 1) / PHASES.length);
  const priority = tools.slice(chapter % tools.length).concat(tools.slice(0, chapter % tools.length));
  for (const item of priority) {
    const useful = candidates.filter(state => itemOffer(level, state, item).eligible);
    if (!useful.length) continue;
    useful.sort((a, b) => Math.abs(a.turn - level.par * .3) - Math.abs(b.turn - level.par * .3));
    level.supplies = { [useful[0].player]: item };
    return;
  }
}

/** A presentation contract built exclusively from each shipped map's rules. */
function campaignExperience(level) {
  const index = level.id - 1, phase = phaseFor(index), theme = themeFor(level);
  const chapterSize = index >= 996 ? 3 : PHASES.length;
  const supplyItems = Object.values(level.supplies || {});
  const features = [];
  if (level.letterOrder) features.push({ id: 'orderedLetters', name: '编号投递',
    description: '按信笺编号依次收取；提前经过后面的信不会收取。' });
  if (supplyItems.length) features.push({ id: 'supplies', name: '沿途驿站',
    description: '踩上驿站免费领取' + supplyItems.map(id => ITEMS.find(item => item.id === id).name).join('、') +
      '。每站一次，领取不影响三星；使用道具最高二星。' });
  return {
    phase: phase.id, phaseName: phase.name, chapterStep: index % PHASES.length + 1,
    chapterSize, chapterFinale: index % PHASES.length === chapterSize - 1,
    theme, themeName: THEMES[theme].name,
    focus: THEMES[theme].focus, guidance: phase.guidance,
    orderedLetters: !!level.letterOrder, supplyCount: supplyItems.length, supplyItems, features,
    objectives: [
      { id: 'letters', label: level.letterOrder ? '按编号收齐信笺' : '收齐信笺', count: level.letters.length, optional: false },
      { id: 'seals', label: '回声盖票', count: level.seals.length, optional: false },
      { id: 'delivery', label: '抵达邮局', count: 1, optional: false },
      { id: 'perfect', label: level.par + ' 拍内无道具、无续灯送达', count: level.par, optional: true }
    ]
  };
}

module.exports = { PHASES, THEMES, phaseFor, practiceReserve, addCampaignMechanics, campaignExperience };
