'use strict';

const { createState, step } = require('./engine');

// Version 4: tighter light budgets on every chapter, fewer undos, and the
// generated routes 31+ (src/levels-extra.js) with bigger boards and paper bridges.
const CONTENT_VERSION = '4';
const PER_CHAPTER = 6;
const chapterNames = [
  '初寄微光', '双生回廊', '风过纸巷', '灯火借路', '星夜长信',
  '雾巷折返', '纸桥残页', '逆风而行', '薄暮邮差', '灯塔守夜',
  '雪线来信', '潮汐回声', '千折回廊', '暗巷灯语', '风眼之中',
  '星海长路', '孤岛邮局', '霜夜远信', '旧城重游', '寄往终章'
];
const specs = [
  ["第一封信",["######","######","#ST.LE","######","######","######"],"你拾信，三步后的回声盖邮票。沿路走到信箱。"],
  ["转角的脚步",["######","#S..##","###T##","#EL.##","######","######"],"回声记住每一次转弯，比你晚三步抵达。"],
  ["寄往岔路",["######","#L..E#","###.##","#S.T##","######","######"],"先经过邮票，再走去取信；回声会替你完成盖章。"],
  ["绕行的问候",["E#T###","...L##","#.####","#.....","#####S","######"],"先经过邮票，再去取信；返回途中，回声会替你盖章。"],
  ["留白三拍",["######","T#.###","....##","#.#S##","...###","L#..E#"],"先走到远处的邮票，再折回取信，最后前往邮局。"],
  ["第一座回廊",["#E.#.L","T#.#.#","....T#",".###LS","####.#","######"],"先收身边的信。沿回廊收齐两封信、两枚邮票，再到邮局。"],
  ["交错信笺",[".....#",".#E#.L",".##..#",".##.#L","......","#S#T#T"],"两条支路都要去，试着把短的折返留在顺路的位置。"],
  ["对岸来信",["##T#..","#.....","L.#.##","#.##.T","S....#","#L#E##"],"先绕过断墙取票，再收拾信箱附近的分支。"],
  ["折页之间",["##T#..","#.....","E.##L#","#...#S","L.#.#.","#T#..."],"信箱在左，起点在右；沿路把最远的角落一起走完。"],
  ["两次回望",[".....L",".##T#.","...##.","T#....","##.#L#","E..S##"],"先看清上下两端的目标，单看信箱方向容易白走。"],
  ["长短两封",["T...L#","#.###T","..E#S.",".##.#.","......","L#..##"],"五处岔口通向不同目标，把最后一枚邮票提前三步经过。"],
  ["环形邮路",["##....","T..#.#","#T#E.L","##.#.#","......","..#L#S"],"同一个路口会经过不止一次，先安排支路的顺序。"],
  ["迎风的纸角",["E#L##T","......",".###.#","..S#.T","T###.#",">.L..L"],"箭头只推一次。三信三票，从风后的落点规划下一拍。"],
  ["借一阵东风",["TT#...","L#..#S","...###","##..T#",".L.#.#","E#.<.L"],"借风抵达回廊后，别漏掉另一条分支的邮票。"],
  ["风信双折",["L.L###","#.#TE#","T.#T#L","#.....","S##.#.","....>."],"狭巷尽头需要折返，先观察风口把你送往哪一格。"],
  ["南北来风",["#L...L","E=#T#v","#....T","..##.#","T#....","#S.##L"],"邮局旁的纸桥只能踏过一次；回声是记忆，不会压垮它。先想好从哪边回家。"],
  ["逆风绕行",["###..L","##T.##","#T#..v","S.#.#.","#...L.","E.#T#L"],"每条长支路都藏着目标；决定顺序再动身。"],
  ["风中的回廊",["v.....","L.#S#.","#..#T.","##.E#.","...##L","L#TT##"],"先分清哪些角落需要往返，再把整条邮路连成一笔。"],
  ["灯下暂歇",["Tv#L..","....#+","##E#.T","TL#..#","#.#.##","L+..S#"],"灯只补三拍、每盏一次。预算已计入路上的两盏灯。"],
  ["借来的三步",["+L#T#S",".#....","..+##L",".#=E.L","T#.#..","##^T.#"],"先看补给在哪；邮局左侧的纸桥只承一次脚步，别把它用在往返的路上。"],
  ["灯塔往返",["##L#T.","#T+L#+","E#.#..",".....<",".#.#.#","T#.L=S"],"起点旁就是纸桥。三条远路共用狭巷，踏碎纸桥之后就只剩一条回路。"],
  ["两盏纸灯",["#.<L#T","L.#.+.","#.##T#","S..+..","#.#E#.","#.L#T."],"最后的票要提前三拍，灯火补给也要顺路拿到。"],
  ["折巷灯影",["...###","E#.S##","#L.#Tv","L#....","+..##.","#T#LT+"],"留意补给与远端目标；多绕一次可能耗尽最后的灯。"],
  ["一夜的余光",["#LT#.E","v.##.#","..+..L","T##.#S","##...#","L+.#.T"],"一段长路多次回访，先确定最后盖章的位置。"],
  ["三封远信",[".+..v<","T#....","#T=.#S","#E#.L#","###.#L","#L+.T."],"两处风口不会连推；邮票旁的纸桥只能走一次，落点不同会改变下一次折返。"],
  ["星图折线",["S..#T+","##T.#.","#L#...","L+#E#.","#.L#v.","##.T.."],"长支路藏着连续目标，先找能一起完成的投递段。"],
  ["风与灯的约定",["L#L<#T","......","#+=#.#","#+#S.E","...#T#","L#.T##"],"上下远端都要走到，两盏灯是路线的一部分；灯旁的纸桥是一次性的近路。"],
  ["回廊九转",["#E##L.","S..L#.","#=T#.+","T#...#",".+.#..","#><L#T"],"风口交错的路段可进可退，纸桥却只让你过一次；每一次回头都有代价。"],
  ["黎明前的邮局",["#L#.+.","T.L.#T","#.#.+#","S.E#.v","=.##.<","#..T#L"],"四十拍的远信：起点下方的纸桥架起一条近路，先分配两端顺序，再留出回声的三拍。"],
  ["寄给明天",["+.....","L#><#+","#T.#T.","E#.L#T","...###","S#.L##"],"这是最终长信：远端、风口、两盏灯与三拍回声都要算进路线。"]
];

const encodedSolutions = [
  "RRRR",
  "RRDDLL",
  "RRUULLRRR",
  "ULLLLUURUDRLLLU",
  "ULLLUDRDDLDURRDRR",
  "LUUURLDDLLLLUDRRUUL",
  "URRDURRUDDULLUURURLULLD",
  "RUUURUDLDLRDDDURRRURLDLD",
  "DDLLUULLDDULRUUURUDRRDULLLDL",
  "LUUULLDUUURRRDURRDDDLDULLDDLL",
  "RUDDDLLLLLDUUURUULRRRRLLLDDR",
  "ULLDURUUUULLDLDULRRURRDDRLL",
  "LLDDRRRRLUURLUURUDLLLUDLLU",
  "ULLDLDLLUURLDDRRDRRDDRLLULLD",
  "DRRRRUUUDLLLLUUULRRLDDLRDRRUUDUR",
  "RURRRDULUULUULLRRRRDLLLLDLDURUUL",
  "RUDDRRUUUURRLLDLRDRRDDULLDULLDL",
  "URRDDDDUULRUULLLLLRDRDDDRLULLDURRUR",
  "LLLUULRDDLRRRUURURUULLDLLLURRD",
  "DDDDLDLLUULLUURLDDDDUURRURUDRRDDLL",
  "LLLUUUUUDLRRLDDRRURUULRDDDLLLLDDUUU",
  "RDDRLUURRRRDDLRUULUURUDLLULDLRDDRRD",
  "LDDDLDULUDRRURRURDDLLRRUULLLULRUULLD",
  "ULLDDLDLLRRURRDRLULUULLUURLDLDURRRRUUR",
  "UULLLLDURRDRDDDDLLRRRRUDLLUURLULLDUD",
  "RRDRDRRUULRDDDDLLLULUUDLRDRDRRRUUULLD",
  "RDUUULUDDLDDLDURRDRLULUUULUDRRRRRUDLDDR",
  "RDRDDLDRLULUDRRURRURUULRDDLDDRDULULLUURLLU",
  "DRDRRLLUUUUUDLRRRURRDULLDDRDRDUUULULLDDR",
  "URRUUUULLLDURRRRRDDDULRUULLDDLRDRLDDRLULLU"
];
// Generated routes carry their own witness as a fourth entry.
for (const entry of require('./levels-extra')) { specs.push(entry.slice(0, 3)); encodedSolutions.push(entry[3]); }
const decode = code => code.split('').map(letter => ({ U: 'up', D: 'down', L: 'left', R: 'right', W: 'wait' })[letter]);

/** Spare light after the shortest route. Only the three tutorial routes forgive; from route 19 one wasted turn ends the delivery. */
function reserveFor(index) {
  if (index < 3) return null;
  if (index < 6) return 3;
  if (index < 18) return 2;
  return 1;
}

/** Undos per run shrink with the chapters, so a mis-tap on a late route costs the lantern. */
function undoFor(index) {
  if (index < 6) return 3;
  if (index < 18) return 2;
  return 1;
}

/** Initial light = what the verified witness actually spends after its lamp income, plus the chapter reserve. */
function budgetFor(level, reserve) {
  const probe = { ...level, budget: level.solution.length + 1 };
  let state = createState(probe);
  let required = 1;
  for (const action of level.solution) {
    const result = step(probe, state, action);
    if (!result.moved) throw new Error('Invalid witness: ' + level.id);
    state = result.state;
    required = Math.max(required, probe.budget - state.energy + (state.status === 'won' ? 0 : 1));
  }
  if (state.status !== 'won') throw new Error('Unfinished witness: ' + level.id);
  return Math.max(required, probe.budget - state.energy + reserve);
}

function parseLevel(spec, index, code) {
  const rows = spec[1];
  const level = { id: index + 1, revision: CONTENT_VERSION, title: spec[0], chapter: Math.floor(index / PER_CHAPTER), width: rows[0].length, height: rows.length, walls: [], start: 0, exit: 0, letters: [], seals: [], winds: {}, lights: [], bridges: [], budget: 100, par: 100, undo: undoFor(index), brief: spec[2], solution: decode(code === undefined ? encodedSolutions[index] || '' : code) };
  const windNames = { '^': 'up', 'v': 'down', '<': 'left', '>': 'right' };
  rows.forEach((row, y) => {
    if (row.length !== level.width) throw new Error('Invalid map width: ' + level.id);
    row.split('').forEach((character, x) => {
      const cell = y * level.width + x;
      if (character === '#') level.walls.push(cell);
      if (character === 'S') level.start = cell;
      if (character === 'E') level.exit = cell;
      if (character === 'L') level.letters.push(cell);
      if (character === 'T') level.seals.push(cell);
      if (character === '+') level.lights.push(cell);
      if (character === '=') level.bridges.push(cell);
      if (windNames[character]) level.winds[cell] = windNames[character];
    });
  });
  level.par = level.solution.length || 100;
  if (!level.solution.length) return level;
  const reserve = reserveFor(index);
  level.budget = budgetFor(level, reserve === null ? Math.max(4, Math.ceil(level.par * 0.6)) : reserve);
  return level;
}

const CAMPAIGN = specs.map((spec, index) => parseLevel(spec, index));

function getDaily(dateKey) {
  const key = String(dateKey || '1970-01-01');
  let seed = 2166136261;
  for (let index = 0; index < key.length; index++) seed = Math.imul(seed ^ key.charCodeAt(index), 16777619) >>> 0;
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = array => {
    for (let index = array.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      const value = array[index]; array[index] = array[other]; array[other] = value;
    }
    return array;
  };
  const deltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const actions = ['up', 'down', 'left', 'right', 'wait'];
  const adjacent = (cell, direction) => {
    const x = cell % 6 + deltas[direction][0];
    const y = Math.floor(cell / 6) + deltas[direction][1];
    return x < 0 || x > 5 || y < 0 || y > 5 ? -1 : y * 6 + x;
  };
  const floors = new Set(Array.from({ length: 36 }, (_, index) => index));
  const reachable = (start, winds) => {
    const distances = new Map([[start, 0]]);
    const queue = [start];
    for (let index = 0; index < queue.length; index++) {
      for (let direction = 0; direction < 4; direction++) {
        let next = adjacent(queue[index], direction);
        if (!floors.has(next)) continue;
        if (winds && winds[next]) {
          const pushed = adjacent(next, actions.indexOf(winds[next]));
          if (floors.has(pushed)) next = pushed;
        }
        if (distances.has(next)) continue;
        distances.set(next, distances.get(queue[index]) + 1);
        queue.push(next);
      }
    }
    return distances;
  };
  // Remove walls only when the remaining floor stays connected.
  for (const candidate of shuffle(Array.from(floors))) {
    if (floors.size <= 23) break;
    floors.delete(candidate);
    if (reachable(floors.values().next().value).size !== floors.size) floors.add(candidate);
  }
  const floorList = Array.from(floors).sort((a, b) => a - b);
  const start = floorList[Math.floor(random() * floorList.length)];
  const winds = {};
  for (const candidate of shuffle(floorList.slice())) {
    if (candidate === start) continue;
    const directions = [0, 1, 2, 3].filter(direction => floors.has(adjacent(candidate, direction)));
    if (directions.length < 3) continue;
    winds[candidate] = actions[directions[Math.floor(random() * directions.length)]];
    if (floorList.every(cell => cell === candidate || reachable(cell, winds).size >= floors.size - 1)) break;
    delete winds[candidate];
  }
  const distances = reachable(start, winds);
  const exit = Array.from(distances.keys()).sort((a, b) => distances.get(b) - distances.get(a) || a - b)[0];
  const candidates = shuffle(Array.from(distances.keys()).filter(cell => cell !== start && cell !== exit && !winds[cell]));
  // Spread objectives across distinct branches instead of letting all six
  // cluster beside the same corridor. Seeded tie-breaking keeps dates stable.
  const selected = [];
  const separation = [distances, reachable(exit, winds)];
  for (let index = 0; index < 6; index++) {
    let best = null;
    let bestDistance = -1;
    for (const cell of candidates) {
      if (selected.includes(cell)) continue;
      const distance = Math.min(...separation.map(map => map.get(cell) || 0));
      if (distance > bestDistance) { best = cell; bestDistance = distance; }
    }
    selected.push(best);
    separation.push(reachable(best, winds));
  }
  shuffle(selected);
  const letters = selected.slice(0, 3);
  const seals = selected.slice(3, 6);
  const lights = candidates.filter(cell => !selected.includes(cell)).slice(0, 2);
  const level = {
    id: 'daily-' + key, revision: CONTENT_VERSION, title: '今日邮路', chapter: 4, width: 6, height: 6,
    walls: Array.from({ length: 36 }, (_, index) => index).filter(cell => !floors.has(cell)),
    start, exit, letters, seals, winds, lights, bridges: [], budget: 100, par: 100, undo: 2,
    brief: '每日一张离线邮路。灯火按最短路线安排，只容许多走一两拍。', solution: []
  };
  // Exact compact BFS: the last three positions + six collection bits suffice.
  // Empty history slots use cell 63; a next action plays back the oldest slot.
  const letterBits = {}; const sealBits = {};
  letters.forEach((cell, index) => { letterBits[cell] = 1 << index; });
  seals.forEach((cell, index) => { sealBits[cell] = 1 << (index + letters.length); });
  const fullMask = (1 << (letters.length + seals.length)) - 1;
  const first = 63 | (63 << 6) | (start << 12);
  const queue = [first]; const parents = [-1]; const moves = [-1]; const seen = new Set(queue);
  let finish = -1;
  for (let head = 0; head < queue.length; head++) {
    const signature = queue[head];
    const oldest = signature & 63;
    const previous = (signature >>> 6) & 63;
    const player = (signature >>> 12) & 63;
    const collected = signature >>> 18;
    if (player === exit && collected === fullMask) { finish = head; break; }
    for (let action = 0; action < 5; action++) {
      let next = action === 4 ? player : adjacent(player, action);
      if (!floors.has(next)) continue;
      if (action !== 4 && winds[next]) {
        const pushed = adjacent(next, actions.indexOf(winds[next]));
        if (floors.has(pushed)) next = pushed;
      }
      const mask = collected | (letterBits[next] || 0) | (sealBits[oldest] || 0);
      const nextKey = previous | (player << 6) | (next << 12) | (mask << 18);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey); queue.push(nextKey); parents.push(head); moves.push(action);
    }
  }
  // Connectivity checks above guarantee every target is reachable and can be
  // followed by three waits. The fallback still provides a known playable map.
  if (finish < 0) {
    const fallback = JSON.parse(JSON.stringify(CAMPAIGN[24]));
    return { ...fallback, id: level.id, title: level.title, brief: level.brief };
  }
  for (let index = finish; parents[index] >= 0; index = parents[index]) level.solution.push(actions[moves[index]]);
  level.solution.reverse();
  level.par = level.solution.length;
  // Count only lamps actually visited by the optimal witness. A lamp outside
  // that route must not reduce the initial energy and make the witness fail.
  let player = start;
  const collectedLights = new Set();
  let requiredBudget = 1;
  level.solution.forEach((action, index) => {
    const direction = actions.indexOf(action);
    let next = direction === 4 ? player : adjacent(player, direction);
    if (direction !== 4 && winds[next]) {
      const pushed = adjacent(next, actions.indexOf(winds[next]));
      if (floors.has(pushed)) next = pushed;
    }
    player = next;
    if (lights.includes(player)) collectedLights.add(player);
    const spent = index + 1 - collectedLights.size * 3;
    requiredBudget = Math.max(requiredBudget, spent + (index + 1 < level.par ? 1 : 0));
  });
  level.budget = Math.max(requiredBudget, level.par - collectedLights.size * 3 + 1);
  return level;
}

module.exports = { CAMPAIGN, getDaily, chapterNames, CONTENT_VERSION, PER_CHAPTER, parseLevel, reserveFor, undoFor, SPECS: specs.map(spec => spec[1]) };
