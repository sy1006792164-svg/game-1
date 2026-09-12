'use strict';

// Reproducible visual QA from legal campaign turns, with isolated memory storage.
// Run node tools/effects-audit.js, then open /work/effects-preview.html on the
// existing preview server. Generated files stay outside the game package.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step } = require('../src/engine');
const root = path.resolve(__dirname, '..');
const targets = [
  ['wind', '风推穿梭'], ['seal', '回声收蓝票'], ['letter', '拾取信笺'],
  ['bridge', '纸桥碎裂'], ['light', '风灯补光'], ['echo-born', '回声诞生'],
  ['ready', '邮局开放'], ['win', '抵达终点']
];

function collectSamples() {
  const samples = new Map();
  // Prefer the reference image's route, then fill any missing event samples.
  const reference = CAMPAIGN.find(level => level.title === '逆风回廊') || CAMPAIGN[19];
  const levels = [reference, ...CAMPAIGN.slice(18, 80).filter(level => level.id !== reference.id)];
  for (const level of levels) {
    let state = createState(level);
    for (const [index, action] of level.solution.entries()) {
      const result = step(level, state, action);
      assert.ok(result.moved, `QA sample must be a legal action: ${level.id}/${index + 1}`);
      const types = result.events.map(event => event.type);
      if (state.echo === null && result.state.echo !== null) types.push('echo-born');
      if ((state.letters.length || state.seals.length) && !result.state.letters.length &&
        !result.state.seals.length && result.state.status === 'playing') types.push('ready');
      for (const [type, title] of targets) if (!samples.has(type) && types.includes(type)) {
        samples.set(type, { type, title, levelId: level.id, levelTitle: level.title,
          turn: index + 1, actions: level.solution.slice(0, index + 1),
          previousState: state, state: result.state, events: result.events });
      }
      state = result.state;
    }
    if (samples.size === targets.length) break;
  }
  assert.equal(samples.size, targets.length, 'all effect samples must come from real game routes');
  return targets.map(([type]) => samples.get(type));
}

function browserAudit(Game, levels, samples) {
  const canvas = document.getElementById('game');
  const ageInput = document.getElementById('age');
  const qualityInput = document.getElementById('quality');
  const quietInput = document.getElementById('quiet');
  const info = document.getElementById('sample-info');
  const labels = document.getElementById('sample-events');
  const data = new Map();
  const metrics = { width: 390, height: 844, pixelRatio: 1, safeTop: 50, safeBottom: 34 };
  let now = 10000, chosen = 0, playing = false, playbackAt = 0;
  canvas.width = metrics.width; canvas.height = metrics.height;
  const noop = () => {};
  const platform = {
    kind: 'browser', isDevelopment: true, canvas,
    storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
    resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop,
    onResize: noop, onPointer: noop, onKey: noop, onHide: noop, onShow: noop,
    vibrate: noop, setFrameRate: noop
  };
  const game = new Game(platform);
  const clone = value => JSON.parse(JSON.stringify(value));
  function select(index) {
    chosen = index;
    const sample = samples[index];
    game.page = 'home'; game.start(levels.find(level => level.id === sample.levelId));
    game.guideEnabled = false; game.mechanicGuide = null;
    game.previousState = clone(sample.previousState); game.state = clone(sample.state);
    game.moveEvents = clone(sample.events); game.actions = sample.actions.slice();
    game.transitionAt = 10000; game.toastUntil = 0; game.modal = null;
    game.motionPath = null; game.camera.reset();
    info.textContent = `第 ${sample.levelId} 关 · ${sample.levelTitle} · 合法路线第 ${sample.turn} 拍`;
    labels.textContent = sample.events.map(event => `${event.type}@${event.cell}`).join(' · ');
    document.querySelectorAll('[data-sample]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    if (!playing) ageInput.value = '280';
    draw(Number(ageInput.value));
  }
  function draw(age) {
    now = 10000 + age;
    platform.effectsQuality = qualityInput.value;
    platform.reducedMotion = quietInput.checked;
    // Seeking is deliberate QA behavior. Each frame starts from the same legal
    // event so the timeline is deterministic in either direction.
    game.renderer.motionEffects = null; game.renderer.gameFeedback = null;
    game.renderer.draw(game, now, metrics);
    document.getElementById('age-label').textContent = `${Math.round(age)} ms`;
    document.getElementById('quality-label').textContent = qualityInput.value === 'low' ? '低画质' : '完整特效';
  }
  samples.forEach((sample, index) => {
    const button = document.createElement('button');
    button.textContent = sample.title; button.dataset.sample = sample.type;
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => { select(index); if (playing) playbackAt = performance.now(); };
    document.getElementById('scenarios').appendChild(button);
  });
  for (const age of [0, 140, 280, 420, 620, 900, 1200]) {
    const button = document.createElement('button'); button.textContent = `${age} ms`;
    button.onclick = () => { stop(); ageInput.value = String(age); draw(age); };
    document.getElementById('times').appendChild(button);
  }
  function stop() { playing = false; document.getElementById('play').textContent = '播放特效'; }
  document.getElementById('play').onclick = () => {
    if (playing) { stop(); return; }
    playing = true; playbackAt = performance.now(); document.getElementById('play').textContent = '暂停采样';
    requestAnimationFrame(tick);
  };
  function tick(time) {
    if (!playing) return;
    const age = (time - playbackAt) % 1650;
    ageInput.value = String(age); draw(age); requestAnimationFrame(tick);
  }
  ageInput.oninput = () => { stop(); draw(Number(ageInput.value)); };
  qualityInput.onchange = quietInput.onchange = () => draw(Number(ageInput.value));
  document.getElementById('export').onclick = () => {
    const link = document.createElement('a');
    link.download = `effects-${samples[chosen].type}-${ageInput.value}ms-${qualityInput.value}.png`;
    link.href = canvas.toDataURL('image/png'); link.click();
  };
  document.getElementById('filmstrip').onclick = () => {
    stop();
    const initial = chosen, initialAge = ageInput.value, container = document.getElementById('frames');
    container.replaceChildren();
    for (let index = 0; index < samples.length; index++) {
      const section = document.createElement('section');
      const heading = document.createElement('h2'); heading.textContent = samples[index].title; section.appendChild(heading);
      const row = document.createElement('div'); row.className = 'frame-row';
      select(index);
      for (const age of [140, 320, 560]) {
        draw(age);
        const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
        image.src = canvas.toDataURL('image/png'); image.alt = `${samples[index].title}，动作后 ${age} 毫秒`;
        caption.textContent = `${age} ms`; figure.append(image, caption); row.appendChild(figure);
      }
      section.appendChild(row); container.appendChild(section);
    }
    select(initial); ageInput.value = initialAge; draw(Number(initialAge));
    container.hidden = false; container.scrollIntoView({ behavior: 'smooth' });
  };
  document.getElementById('measure').onclick = () => {
    stop();
    const initial = chosen, initialAge = ageInput.value, initialQuality = qualityInput.value;
    const results = [];
    for (const quality of ['high', 'low']) {
      qualityInput.value = quality;
      for (let index = 0; index < 12; index++) draw(index * 50);
      const durations = [];
      for (let index = 0; index < 120; index++) {
        if (index % 15 === 0) select(Math.floor(index / 15) % samples.length);
        const started = performance.now();
        draw(index % 15 * 60);
        durations.push(performance.now() - started);
      }
      durations.sort((a, b) => a - b);
      results.push(`${quality === 'high' ? '完整特效' : '低画质'}：中位 ${durations[60].toFixed(2)} ms / P95 ${durations[113].toFixed(2)} ms`);
    }
    qualityInput.value = initialQuality; select(initial); ageInput.value = initialAge; draw(Number(initialAge));
    document.getElementById('performance').textContent = '当前桌面浏览器，每种画质 120 帧，390 × 844 Canvas 的 CPU 提交耗时；' +
      results.join('；') + '。此值不包含 GPU 合成，也不代表手机帧率。';
  };
  window.addEventListener('error', event => {
    const error = document.getElementById('error'); error.hidden = false; error.textContent = event.message;
  });
  select(0);
}

function bundle(samples) {
  const modules = new Map();
  function add(filename) {
    const id = path.relative(root, filename).replace(/\\/g, '/');
    if (modules.has(id)) return id;
    let source = fs.readFileSync(filename, 'utf8');
    modules.set(id, '');
    if (id === 'src/main.js') {
      const bootstrap = `(${browserAudit.toString()})(Game, CAMPAIGN, ${JSON.stringify(samples)});`;
      assert.ok(source.includes('new Game(createPlatform());'), 'QA entry must replace the real bootstrap');
      source = source.replace('new Game(createPlatform());', bootstrap);
    }
    source = source.replace(/require\(['"](\.[^'"]+)['"]\)/g, (_, relative) => {
      const dependency = path.resolve(path.dirname(filename), relative + (path.extname(relative) ? '' : '.js'));
      return '__require(' + JSON.stringify(add(dependency)) + ')';
    });
    modules.set(id, source); return id;
  }
  const entry = add(path.join(root, 'src/main.js'));
  return '(function(){"use strict";var cache={};var modules={\n' + [...modules].map(([id, source]) =>
    JSON.stringify(id) + ':function(module,exports,__require){\n' + source + '\n}').join(',\n') +
    '\n};function __require(id){if(cache[id])return cache[id].exports;var m={exports:{}};cache[id]=m;modules[id](m,m.exports,__require);return m.exports;}__require(' + JSON.stringify(entry) + ');})();\n';
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>对局特效 · 真实路线验收</title><style>
*{box-sizing:border-box}body{margin:0;background:#e6ebdf;color:#244d48;font:14px/1.6 "Microsoft YaHei",sans-serif}
main{max-width:1020px;margin:auto;padding:28px;display:grid;grid-template-columns:1fr 390px;gap:38px;align-items:center}
h1{font-size:28px;margin:0 0 12px}p{margin:10px 0}.sub{color:#597065}label{display:block;margin:20px 0 8px}
button,select{font:inherit;color:#305c50;background:#f9f9ef;border:1px solid #a8bda7;border-radius:9px;padding:8px 12px;cursor:pointer}
button[aria-pressed=true],#play{background:#315c50;color:#fff7df}#scenarios,#times,.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
#age{width:100%;accent-color:#315c50}#age-label{font-variant-numeric:tabular-nums;font-weight:600}
#sample-events{font-size:11px;word-break:break-word;color:#758678}canvas{width:390px;height:844px;display:block;background:#f6f4e5;border-radius:28px;box-shadow:0 18px 60px #435f4428}
#frames{max-width:1000px;margin:10px auto 70px;padding:20px}#frames section{margin:20px 0 35px}.frame-row{display:flex;gap:18px}figure{margin:0;flex:1}figure img{width:100%;border-radius:18px}figcaption{text-align:center}
#error{background:#943b2b;color:white;padding:16px}a{color:inherit}@media(max-width:850px){main{grid-template-columns:1fr;padding:18px;gap:20px}canvas{width:min(100%,390px);height:auto;justify-self:center}.frame-row{gap:8px}}
</style></head><body><div id="error" hidden role="alert"></div><main><aside>
<p class="sub">风笺回廊 · 对局画面验收</p><h1>风、纸与回声</h1>
<p>从原版引擎的合法解中截取真实动作，观察棋盘特效、回声移动与收集飞行。</p>
<div id="scenarios" aria-label="特效场景"></div><p id="sample-info"></p><p id="sample-events"></p>
<label for="age">动作时间 <span id="age-label">280 ms</span></label>
<input id="age" type="range" min="0" max="1650" step="1" value="280"><div id="times"></div>
<label for="quality">显示质量 · <span id="quality-label">完整特效</span></label>
<select id="quality"><option value="high">完整特效</option><option value="low">低画质</option></select>
<label><input type="checkbox" id="quiet"> 减少动态效果</label>
<div class="actions"><button id="play">播放特效</button><button id="export">导出当前帧</button><button id="filmstrip">生成三帧对照</button><button id="measure">采样绘制耗时</button></div>
<output id="performance" class="sub" aria-live="polite"></output>
<p class="sub">独立内存存档。终点样本只展示棋盘反馈，以便查看到达效果。三帧对照为 140 / 320 / 560 ms。</p>
<p class="sub"><a href="/">打开可操作的游戏预览</a></p></aside>
<canvas id="game" aria-label="真实游戏特效采样画面"></canvas></main><div id="frames" hidden></div>
<script src="/work/effects-preview.js"></script></body></html>`;

if (require.main === module) {
  const samples = collectSamples(), output = path.join(root, 'work');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'effects-preview.html'), html);
  fs.writeFileSync(path.join(output, 'effects-preview.js'), bundle(samples));
  fs.writeFileSync(path.join(output, 'effects-audit.json'), JSON.stringify(samples, null, 2) + '\n');
  console.log('Effects QA: http://127.0.0.1:8765/work/effects-preview.html');
  console.log(samples.map(sample => `${sample.type}: level ${sample.levelId}, turn ${sample.turn}`).join('\n'));
}

module.exports = { collectSamples, bundle };
