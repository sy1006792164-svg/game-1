'use strict';

const { createState, step } = require('./engine');
const { addRouteMechanics } = require('./mechanic-placement');

// Each chapter gives players room to learn, vary a route and finish a trial.
// Every star target is backed by a complete route through its actual mechanics.
const PHASES = Object.freeze([
  { id: 'learn', name: '启程', ratio: .32, minimum: 6, maximum: 10, undo: 6, guidance: '先认清目标，留些脚步试一试路线。' },
  { id: 'practice', name: '练习', ratio: .28, minimum: 5, maximum: 9, undo: 5, guidance: '把收信与盖票接在一起，练习少走回头路。' },
  { id: 'variation', name: '变奏', ratio: .24, minimum: 4, maximum: 8, undo: 4, guidance: '换一条邮路，观察本关机关与回声的配合。' },
  { id: 'rest', name: '漫游', ratio: .38, minimum: 7, maximum: 14, undo: 6, guidance: '这一程灯火更宽裕，可以从容探索岔路。' },
  { id: 'refine', name: '进阶', ratio: .22, minimum: 4, maximum: 7, undo: 4, guidance: '出发前安排远端目标，把最后三拍留给回声。' },
  { id: 'trial', name: '试炼', ratio: .16, minimum: 3, maximum: 5, undo: 3, guidance: '串起本章所学；先送达，再向三星目标挑战。' }
]);

const THEMES = Object.freeze({
  echo: { name: '回声合奏', focus: '蓝票要提前三拍经过，让回声盖好再到邮局。' },
  route: { name: '岔路寻信', focus: '先看最远的信与票，再安排支路的往返顺序。' },
  wind: { name: '借风远行', focus: '风口只推一次，从落点继续规划下一拍。' },
  tide: { name: '潮汐择时', focus: '潮汐门三拍一开；看下一拍的门色，必要时等一拍。' },
  echoGate: { name: '双身开门', focus: '先踩踏板，再让三拍后的回声留在踏板上；趁回声开门时通过。' },
  bridge: { name: '纸桥渡信', focus: '纸桥离开即断，先确定过桥顺序；回声不受断桥影响。' }
});
const THEME_ORDER = ['echo', 'tide', 'echoGate', 'bridge', 'wind', 'route'];

function phaseFor(index) {
  // The final chapter has three routes; its last delivery is still a finale.
  return PHASES[index === 998 ? 5 : index % PHASES.length];
}

function legacyPracticeReserve(index, par) {
  const phase = phaseFor(index);
  return Math.max(phase.minimum, Math.ceil(par * Math.round(phase.ratio * 100) / 100));
}

function practiceReserve(index, par) {
  const reserve = legacyPracticeReserve(index, par), maximum = phaseFor(index).maximum;
  // Preserve the first 30 teaching routes, then tighten gradually through 300.
  // Long routes still cover their complete witness; spare turns stop growing
  // without bound, so one +6 relight remains a meaningful correction.
  const progress = Math.max(0, Math.min(1, (index - 29) / 270));
  return reserve - Math.floor(Math.max(0, reserve - maximum) * progress);
}

function themeFor(level) {
  const available = ['echo', 'route'];
  if (Object.keys(level.winds || {}).length) available.push('wind');
  if (Object.keys(level.tideGates || {}).length) available.push('tide');
  if (Object.keys(level.echoGates || {}).length) available.push('echoGate');
  if ((level.bridges || []).length) available.push('bridge');
  const chapter = Math.floor((level.id - 1) / PHASES.length);
  const preferred = THEME_ORDER[chapter % THEME_ORDER.length];
  return available.includes(preferred) ? preferred : available[available.length - 1];
}

/** Add real route rules only where the existing witness proves they work. */
function addCampaignMechanics(level) {
  const index = level.id - 1, slot = index % PHASES.length;
  const ordered = level.id >= 7 && slot === 2 && level.letters.length >= 2;
  if (!ordered) { addRouteMechanics(level); return; }
  const probe = { ...level, budget: level.par + 1 }, order = [];
  let state = createState(probe);
  for (const action of level.solution) {
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Invalid campaign mechanic route: ' + level.id);
    result.events.forEach(event => { if (event.type === 'letter') order.push(event.cell); });
    state = result.state;
  }
  if (state.status !== 'won') throw new Error('Unfinished campaign mechanic route: ' + level.id);
  if (ordered) {
    if (order.length !== level.letters.length) throw new Error('Incomplete letter order: ' + level.id);
    level.letterOrder = order;
  }
  addRouteMechanics(level);
}

/** A presentation contract built exclusively from each shipped map's rules. */
function campaignExperience(level) {
  const index = level.id - 1, phase = phaseFor(index), theme = themeFor(level);
  const chapterSize = index >= 996 ? 3 : PHASES.length;
  const features = [];
  if (level.letterOrder) features.push({ id: 'orderedLetters', name: '编号投递',
    description: '按信笺编号依次收取；提前经过后面的信不会收取。' });
  if (Object.keys(level.tideGates || {}).length) features.push({ id: 'tideGates', name: '潮汐门',
    description: '潮汐门每三拍开放一拍，按到达时刻通行；等待也会推进一拍。' });
  if (Object.keys(level.echoGates || {}).length) features.push({ id: 'echoGates', name: '回声门',
    description: '行动前回声站在配对踏板上才能进入回声门；人物踩板后，回声三拍后到达。' });
  return {
    phase: phase.id, phaseName: phase.name, chapterStep: index % PHASES.length + 1,
    chapterSize, chapterFinale: index % PHASES.length === chapterSize - 1,
    theme, themeName: THEMES[theme].name,
    focus: THEMES[theme].focus, guidance: phase.guidance,
    orderedLetters: !!level.letterOrder, supplyCount: 0, supplyItems: [], features,
    objectives: [
      { id: 'letters', label: level.letterOrder ? '按编号收齐信笺' : '收齐信笺', count: level.letters.length, optional: false },
      { id: 'seals', label: '回声盖票', count: level.seals.length, optional: false },
      { id: 'delivery', label: '抵达邮局', count: 1, optional: false },
      { id: 'perfect', label: level.par + ' 拍内无道具、无续灯送达', count: level.par, optional: true }
    ]
  };
}

module.exports = { PHASES, THEMES, phaseFor, practiceReserve, legacyPracticeReserve, addCampaignMechanics, campaignExperience };
