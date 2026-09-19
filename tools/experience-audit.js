'use strict';

// This preview uses the actual Game and renderer with a fresh memory-only store.
// No browser storage, friend fixtures, platform permissions, or live account data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { CAMPAIGN } = require('../src/levels');
const { createState, step, replay, stars } = require('../src/engine');
const { ITEMS, itemOffer, itemAction } = require('../src/items');
const root = path.resolve(__dirname, '..');

function collectExperienceSamples() {
  const scenes = [
    ['home', '首页'], ['levels', '选关'], ['chapters', '章节目录'], ['collection', '邮票册'],
    ['settings', '体验设置'], ['leaderboard', '好友排行 · 浏览器状态'], ['game', '真实投递'],
    ['guide', '首次操作引导'], ['low-light', '最后三拍'], ['fail', '灯灭后的重试'], ['help', '当前路线说明'],
    ['pause', '对局暂停'], ['stamp', '已收藏邮票详情'], ['next-stamp', '下一枚邮票详情'],
    ['win', '送达结算'], ['save-warning', '通关保存失败'],
    ['echo-ready', '回声笛 · 末段补救'], ['echo-target', '回声笛 · 选取蓝票'], ['echo-finish', '回声笛 · 二星送达'],
    ['item-oil', '灯油 · 使用说明'], ['item-kite', '纸鸢 · 使用说明'],
    ['item-bridge', '修桥包 · 使用说明'], ['item-echo', '回声笛 · 使用说明']
  ];
  const samples = scenes.map(([id, title]) => ({ id, title }));
  const sampleById = new Map(samples.map(sample => [sample.id, sample]));
  function assign(id, level, actions, itemRewards = {}) {
    let state = createState(level, itemRewards);
    for (const [index, action] of actions.entries()) {
      const result = step(level, state, action);
      assert.ok(result.moved, `${id}: level ${level.id}, action ${index + 1} must be legal`);
      state = result.state;
    }
    assert.deepEqual(replay(level, actions, [], itemRewards), state, id + ': route must restore exactly');
    const expected = ['win', 'save-warning', 'echo-finish'].includes(id) ? 'won' : id === 'fail' ? 'failed' : 'playing';
    assert.equal(state.status, expected, id + ': expected route status');
    Object.assign(sampleById.get(id), { levelId: level.id, levelTitle: level.title,
      actions: actions.slice(), itemRewards: { ...itemRewards }, status: state.status, turn: state.turn });
    return state;
  }
  const ordinary = CAMPAIGN.find(level => level.title === '逆风回廊') || CAMPAIGN[19];
  for (const id of ['game', 'pause', 'help']) assign(id, ordinary, ordinary.solution.slice(0, 4));
  assign('guide', CAMPAIGN[0], []);
  for (const [id, energy] of [['low-light', 3], ['fail', 0]]) {
    let state = createState(ordinary); const actions = [];
    while (state.status === 'playing' && state.energy > energy) {
      const result = step(ordinary, state, 'wait');
      assert.ok(result.moved, id + ': waiting must advance the route');
      state = result.state; actions.push('wait');
    }
    assert.equal(assign(id, ordinary, actions).energy, energy, id + ': expected lamp level');
  }
  for (const id of ['win', 'save-warning']) assign(id, CAMPAIGN[14], CAMPAIGN[14].solution);
  const preferred = CAMPAIGN[52];
  const candidates = [preferred, ...CAMPAIGN.filter(level => level !== preferred && level.id >= 31)];
  for (const item of ITEMS) {
    let chosen = null;
    for (const level of candidates) {
      if (level.id < item.unlock || item.id === 'bridge' && !(level.bridges || []).length) continue;
      const rewards = { [item.id]: 1 }, actions = [];
      let state = createState(level, rewards);
      for (let index = 0; index <= level.solution.length && state.status === 'playing'; index++) {
        if (itemOffer(level, state, item.id).eligible) { chosen = { level, actions, rewards }; break; }
        if (index === level.solution.length) break;
        const action = level.solution[index], result = step(level, state, action);
        assert.ok(result.moved, 'item samples must follow a real campaign solution');
        state = result.state; actions.push(action);
      }
      if (chosen) break;
    }
    assert.ok(chosen, item.id + ': a legal item inspection sample must exist');
    assign('item-' + item.id, chosen.level, chosen.actions, chosen.rewards);
  }
  let echo = null;
  for (const level of candidates) {
    const rewards = { echo: 1 }, actions = [];
    let state = createState(level, rewards);
    for (let index = 0; index <= level.solution.length && state.status === 'playing'; index++) {
      for (const cell of itemOffer(level, state, 'echo').targets) {
        const action = itemAction('echo', cell), result = step(level, state, action);
        if (result.moved && result.state.status === 'won') { echo = { level, actions, rewards, action, cell }; break; }
      }
      if (echo || index === level.solution.length) break;
      const action = level.solution[index], result = step(level, state, action);
      assert.ok(result.moved, 'echo samples must follow a real campaign solution');
      state = result.state; actions.push(action);
    }
    if (echo) break;
  }
  assert.ok(echo, 'a legal winning echo-tool sample must exist');
  for (const id of ['echo-ready', 'echo-target', 'echo-finish']) {
    const actions = id === 'echo-finish' ? [...echo.actions, echo.action] : echo.actions;
    const state = assign(id, echo.level, actions, echo.rewards), sample = sampleById.get(id);
    sample.title += ' · 第 ' + echo.level.id + ' 关「' + echo.level.title + '」';
    sample.targetCell = echo.cell;
    if (id === 'echo-finish') assert.equal(stars(echo.level, state), 2, 'echo finish must earn two stars');
    else assert.ok(itemOffer(echo.level, state, 'echo').targets.includes(echo.cell), id + ': selected stamp must be eligible');
  }
  assert.equal(samples.length, 23, 'the full experience catalogue must stay available');
  assert.equal(samples.filter(sample => sample.levelId).length, 15, 'all route scenes must have verified actions');
  const pages = new Set(['home', 'levels', 'chapters', 'collection', 'settings', 'leaderboard', 'stamp', 'next-stamp']);
  assert.ok(samples.every(sample => sample.levelId || pages.has(sample.id)), 'every specimen must have a supported page or verified route');
  const completed = Object.fromEntries(CAMPAIGN.slice(0, 14).map(level => [level.id,
    { stars: level.id === 7 ? 2 : 3, bestTurns: level.id === 7 ? level.par + 1 : level.par }]));
  const album = require('../src/stamp-album').getAlbum({ completed });
  assert.ok(album.stamps[4].owned && album.next && !album.next.owned, 'both stamp-detail scenes must have valid collection targets');
  return samples;
}

async function browserAudit(Game, levels, helpers, samples) {
  const canvas = document.getElementById('game'), sceneInput = document.getElementById('scene');
  const ageInput = document.getElementById('age'), screenInput = document.getElementById('screen');
  const qualityInput = document.getElementById('quality'), quietInput = document.getElementById('quiet');
  const report = document.getElementById('report'), errors = document.getElementById('errors');
  const scenes = samples.map(sample => [sample.id, sample.title]);
  const baseTime = 10000, noop = () => {};
  let game = null, now = baseTime, sampleAge = 900, metrics, playing = false, playbackAt = 0, frameId = null, interactionAt = null;
  let currentAudio = null;
  function fail(error) {
    const message = error && (error.stack || error.message) || String(error);
    errors.hidden = false; errors.textContent += (errors.textContent ? '\n\n' : '') + message;
    document.documentElement.dataset.auditError = 'true';
  }
  window.addEventListener('error', event => fail(event.error || event.message));
  window.addEventListener('unhandledrejection', event => fail(event.reason));
  // Every specimen uses the same decoded production atlas. Loading before the
  // first isolated Game avoids capturing the renderer's emergency vector art.
  const controls = Array.from(document.querySelectorAll('button, input, select'));
  controls.forEach(control => { control.disabled = true; });
  report.textContent = '正在加载游戏原版插画…';
  function createImage() {
    const image = document.createElement('img');
    // The audit lives below /work, while runtime asset paths start at the root.
    // Keep the actual image element so Canvas drawImage accepts the atlas.
    Object.defineProperty(image, 'src', {
      get: () => image.getAttribute('src') || '',
      set: value => image.setAttribute('src', '/' + value.replace(/^\/+/, ''))
    });
    return image;
  }
  const artAssets = helpers.createArtAssets({ createImage });
  try { await artAssets.load(); }
  catch (error) { fail(error); report.textContent = '原版插画加载失败，请刷新后重试。'; return; }
  function guard(action) { try { return action(); } catch (error) { fail(error); stop(); return null; } }
  function render(age) {
    sampleAge = age;
    now = baseTime + age;
    game.platform.effectsQuality = qualityInput.value;
    game.platform.reducedMotion = quietInput.checked;
    // Use the real loop so buffered inputs and scrolling advance as in game.
    game.lastFrame = -Infinity; game.loop();
    document.getElementById('age-label').textContent = Math.round(age) + ' ms';
    report.textContent = metrics.width + ' × ' + metrics.height + ' · ' + game.page +
      (game.modal ? ' / ' + game.modal.kind : '') + ' · ' + game.renderer.hits.length + ' 个可操作区域 · ' +
      (interactionAt === null ? '独立测试进度' : '正在操作独立预览') +
      (game.page === 'game' ? ' · 第 ' + game.level.id + ' 关「' + game.level.title + '」 · ' + game.state.turn + ' 拍' : '');
    document.documentElement.dataset.auditScene = sceneInput.value;
    document.documentElement.dataset.auditAge = String(Math.round(age));
  }
  function prepare() {
    if (game) { game.ads.destroy(); game.sound.release(); game.friendLeaderboard.close(); game.renderer.clearCaches(); }
    const small = screenInput.value === 'small', data = new Map();
    metrics = small ? { width: 320, height: 568, pixelRatio: 1, safeTop: 20, safeBottom: 0 } :
      { width: 390, height: 844, pixelRatio: 1, safeTop: 50, safeBottom: 34 };
    canvas.width = metrics.width; canvas.height = metrics.height;
    canvas.style.width = metrics.width + 'px'; canvas.style.height = 'auto';
    const platform = {
      kind: 'browser', isDevelopment: false, canvas, createImage,
      createSurface: () => document.createElement('canvas'),
      storage: { get: key => data.get(key), set: (key, value) => data.set(key, value), remove: key => data.delete(key) },
      resize: () => metrics, now: () => now, raf: () => 1, cancelRaf: noop,
      onResize: noop, onPointer: noop, onKey: listener => { canvas.onkeydown = event => {
        if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        if (event.key !== 'Tab') event.preventDefault();
        guard(() => {
          stop();
          const handled = listener(event.key === 'Tab' && event.shiftKey ? 'Shift+Tab' : event.key);
          if (event.key === 'Tab' && handled) event.preventDefault();
          animateInteraction();
        });
      }; }, onHide: noop, onShow: noop,
      vibrate: noop, setFrameRate: noop,
      effectsQuality: qualityInput.value, reducedMotion: quietInput.checked
    };
    now = baseTime - 1200;
    game = new Game(platform);
    game.artAssets = artAssets; game.renderer.artAssets = artAssets;
    // UI specimens contain real campaign records in an isolated memory-only
    // profile. A two-star route keeps the replay and album goals meaningful.
    for (const level of levels.slice(0, 14)) game.store.recordWin(level.id, level.id === 7 ? 2 : 3,
      level.id === 7 ? level.par + 1 : level.par, 'campaign');
    game.page = sceneInput.value === 'home' ? 'settings' : 'home';
    game.modal = null; game.guideEnabled = false; game.mechanicGuide = null;
    game.renderer.draw(game, now, metrics);
    now = baseTime;
    const scene = sceneInput.value, sample = samples.find(entry => entry.id === scene);
    if (!sample) throw new Error('未知体验样本：' + scene);
    if (sample.levelId) {
      const level = levels.find(entry => entry.id === sample.levelId);
      for (const earlier of levels.slice(14, sample.levelId - 1)) game.store.recordWin(earlier.id, 3, earlier.par);
      game.start(level); game.guideEnabled = scene === 'guide'; game.mechanicGuide = null; game.camera.reset();
      // Tool stock models only already completed videos in this memory-only
      // fixture. All state changes and effect events come from real actions.
      game.itemRewards = { ...sample.itemRewards };
      game.state = helpers.replay(level, [], [], game.itemRewards);
      for (const action of sample.actions) {
        const result = helpers.step(level, game.state, action);
        if (!result.moved) throw new Error(scene + ' 样本动作不合法：第 ' + level.id + ' 关');
        game.previousState = game.state; game.state = result.state;
        game.moveEvents = result.events; game.actions.push(action);
      }
      if (game.state.status !== sample.status) throw new Error(scene + ' 样本结果与验证不符');
      game.transitionAt = baseTime - 2000;
      if (sample.status === 'won') {
        game.transitionAt = baseTime - helpers.resultDelay;
        if (scene === 'save-warning') platform.storage.set = () => { throw new Error('QA storage quota'); };
        game.victory();
      } else if (scene === 'fail') game.failure();
      else if (scene === 'pause') game.pause();
      else if (scene === 'help') game.help();
      else if (scene.startsWith('item-')) game.selectItem(scene.slice(5));
      else if (scene === 'echo-target') game.selectedItem = 'echo';
    } else if (scene === 'chapters') game.openLevelBrowser('chapters', 15);
    else if (scene === 'stamp' || scene === 'next-stamp') {
      now = baseTime - 1000;
      game.openPage('collection');
      game.renderer.draw(game, now, metrics);
      now = baseTime - 1;
      game.renderer.draw(game, now, metrics);
      now = baseTime;
      // Open the existing detail controller; no alternate modal layout is used.
      helpers.openStampDetail(game, scene === 'stamp' ? game.album().stamps[4].id : game.album().next.id);
    } else game.openPage(scene);
    game.toastUntil = 0; game.renderer.uiFeedback = null; interactionAt = null;
    render(0);
  }
  function seek(age) {
    stop();
    guard(() => { prepare(); ageInput.value = String(age); render(age); });
  }
  function stop() {
    playing = false;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; document.getElementById('play').textContent = '播放入场与环境动作';
  }
  function animateInteraction() {
    const startAge = sampleAge, started = performance.now();
    render(startAge);
    const animate = time => {
      guard(() => {
        const age = startAge + time - started;
        ageInput.value = String(Math.min(9000, age)); render(age);
        if (time - started < 1000) frameId = requestAnimationFrame(animate); else frameId = null;
      });
    };
    frameId = requestAnimationFrame(animate);
  }
  function tick(time) {
    if (!playing) return;
    guard(() => {
      const elapsed = time - playbackAt;
      const age = elapsed % 9000;
      if (age < Number(ageInput.value)) prepare();
      ageInput.value = String(age); render(age);
      frameId = requestAnimationFrame(tick);
    });
  }
  for (const [id, title] of scenes) {
    const option = document.createElement('option'); option.value = id; option.textContent = title; sceneInput.appendChild(option);
  }
  for (const age of [0, 120, 300, 900]) {
    const button = document.createElement('button'); button.textContent = age + ' ms';
    button.onclick = () => seek(age); document.getElementById('times').appendChild(button);
  }
  sceneInput.onchange = screenInput.onchange = qualityInput.onchange = quietInput.onchange = () => seek(Number(ageInput.value));
  ageInput.oninput = () => seek(Number(ageInput.value));
  document.getElementById('play').onclick = () => {
    if (playing) return stop();
    guard(() => {
      prepare(); ageInput.value = '0'; playing = true; playbackAt = performance.now();
      document.getElementById('play').textContent = '暂停采样'; frameId = requestAnimationFrame(tick);
    });
  };
  document.getElementById('export').onclick = () => guard(() => {
    const link = document.createElement('a');
    link.download = 'experience-' + sceneInput.value + '-' + metrics.width + '-' + Math.round(Number(ageInput.value)) + 'ms.png';
    link.href = canvas.toDataURL('image/png'); link.click();
  });
  document.getElementById('contact-sheet').onclick = () => guard(() => {
    stop();
    const original = sceneInput.value, age = ageInput.value, container = document.getElementById('frames');
    container.replaceChildren();
    for (const [id, title] of scenes) {
      const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
      sceneInput.value = id; prepare(); render(900);
      image.src = canvas.toDataURL('image/png'); image.alt = title + '，900 ms'; caption.textContent = title + ' · 900 ms';
      figure.append(image, caption); container.appendChild(figure);
    }
    sceneInput.value = original; prepare(); ageInput.value = age; render(Number(age));
    container.hidden = false;
  });
  for (const [id, label] of [['page', '翻页'], ['open', '展开'], ['close', '收起'], ['toggle', '切换'], ['reward', '领取补给']]) {
    const button = document.createElement('button'); button.textContent = label; button.dataset.audio = id;
    button.onclick = () => {
      if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
      currentAudio = new Audio('/assets/' + id + '.wav'); currentAudio.volume = .28;
      currentAudio.play().catch(fail);
    };
    document.getElementById('audio').appendChild(button);
  }
  function pointer(event, type) {
    guard(() => {
      stop();
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * metrics.width / rect.width, y = (event.clientY - rect.top) * metrics.height / rect.height;
      if (type === 'start') {
        canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId); interactionAt = performance.now();
      }
      game.pointerEvent(x, y, type); render(sampleAge);
      if (type === 'end') animateInteraction();
    });
  }
  canvas.addEventListener('pointerdown', event => pointer(event, 'start'));
  canvas.addEventListener('pointermove', event => { if (event.buttons) pointer(event, 'move'); });
  canvas.addEventListener('pointerup', event => pointer(event, 'end'));
  canvas.addEventListener('pointercancel', event => pointer(event, 'cancel'));
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    guard(() => {
      stop();
      const rect = canvas.getBoundingClientRect();
      game.scrollList((event.clientX - rect.left) * metrics.width / rect.width,
        (event.clientY - rect.top) * metrics.height / rect.height, event.deltaY);
      const age = sampleAge + 64; ageInput.value = String(Math.min(9000, age)); render(age);
    });
  }, { passive: false });
  window.experienceAudit = { seek, select(id) { sceneInput.value = id; seek(900); }, get game() { return game; } };
  controls.forEach(control => { control.disabled = false; });
  seek(900);
  document.documentElement.dataset.auditReady = 'true';
}

function bundle(samples = collectExperienceSamples()) {
  const modules = new Map();
  function add(filename) {
    const id = path.relative(root, filename).replace(/\\/g, '/');
    if (modules.has(id)) return id;
    let source = fs.readFileSync(filename, 'utf8'); modules.set(id, '');
    if (id === 'src/main.js') {
      assert.ok(source.includes('new Game(createPlatform());'));
      source = source.replace('new Game(createPlatform());', '(' + browserAudit.toString() +
        ')(Game, CAMPAIGN, { step, replay, itemOffer, createArtAssets, openStampDetail: require("./stamp-detail-view").openStampDetail, resultDelay: require("./feedback-timing").RESULT_DELAY_MS }, ' + JSON.stringify(samples) + ');');
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

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>风笺回廊 · 全游戏体验验收</title><style>
*{box-sizing:border-box}body{margin:0;color:#294d49;background:#e8eddf;font:14px/1.65 "Microsoft YaHei",sans-serif}
main{display:grid;grid-template-columns:minmax(280px,450px) minmax(320px,390px);max-width:1020px;gap:48px;margin:auto;padding:32px;align-items:start}
h1{font-size:28px;margin:0 0 14px}h2{font-size:15px;margin:20px 0 10px}p{margin:10px 0}.muted{color:#536c5e}label{display:block;margin:16px 0 7px}
button,select{font:inherit;padding:8px 12px;border:1px solid #acc0a8;border-radius:8px;background:#fffaf0;color:inherit;cursor:pointer}select{width:100%}
button:hover{background:#dce9d8}#play{background:#316c5f;color:#fffdf4}.row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}input[type=range]{width:100%;accent-color:#316c5f}
canvas{display:block;max-width:100%;border-radius:26px;box-shadow:0 15px 48px #314d392b;touch-action:none;background:#f8f6e8;justify-self:center}
canvas:focus-visible{outline:2px solid #316c5f;outline-offset:3px}
#age-label{font-variant-numeric:tabular-nums}#errors{white-space:pre-wrap;background:#842f29;color:#fff;padding:18px;margin:0}#report{display:block;margin:14px 0;color:#536c5e;font-size:12px}
#frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;max-width:1440px;padding:24px;margin:auto}#frames[hidden]{display:none}figure{margin:0}figure img{width:100%;border-radius:16px}figcaption{text-align:center}
a{color:inherit}@media(max-width:800px){main{grid-template-columns:1fr;padding:18px;gap:24px}canvas{max-height:none}}
</style></head><body><pre id="errors" hidden role="alert"></pre><main><aside><p class="muted">风笺回廊 · 全游戏体验验收</p><h1>每一页，都有来信</h1>
<p>使用游戏实际页面和绘制流程。可观察页面入场、纸面动作、收藏光泽和结算反馈，也可直接点击画面操作。</p>
<label for="scene">场景</label><select id="scene"></select><label for="screen">屏幕尺寸</label><select id="screen"><option value="normal">390 × 844 · 安全区 50 / 34</option><option value="small">320 × 568 · 安全区 20 / 0</option></select>
<label for="age">入场时间 <strong id="age-label">900 ms</strong></label><input id="age" type="range" min="0" max="9000" step="1" value="900"><div class="row" id="times"></div>
<label for="quality">效果质量</label><select id="quality"><option value="high">完整特效</option><option value="low">低画质</option></select><label><input id="quiet" type="checkbox"> 减少动态效果</label>
<div class="row"><button id="play">播放入场与环境动作</button><button id="export">导出当前帧</button><button id="contact-sheet">生成全页面对照</button></div><output id="report" aria-live="polite"></output>
<h2>操作音效试听</h2><div id="audio" class="row"></div><p class="muted">试听只在点击后播放，使用游戏当前 WAV 音源。</p>
<p class="muted">独立内存中的正式版界面测试：基础样本前 14 封已送达，第 7 封为两星；道具样本模拟已完成的视频补给。回声笛场景从当前真实解中寻找，具体关卡、名称和拍数见场景选项与画面下方。此预览不会读取或写入浏览器及微信存档。</p>
<p class="muted">点击画面后也可用方向键操作、空格等待、Z 撤回、Esc 暂停、Enter 继续。</p>
<p class="muted"><a href="/">打开正常游戏</a> · <a href="/work/effects-preview.html">查看对局特效</a></p></aside><canvas id="game" tabindex="0" aria-label="真实游戏页面采样"></canvas></main><section id="frames" hidden aria-label="各页面对照图"></section>
<script>window.addEventListener('error',function(event){var box=document.getElementById('errors');box.hidden=false;box.textContent=event.message;document.documentElement.dataset.auditError='true';});</script>
<script src="/work/experience-preview.js"></script></body></html>`;

function verifyResultSample() {
  const level = CAMPAIGN[14]; let state = createState(level);
  for (const action of level.solution) {
    const result = step(level, state, action); assert.ok(result.moved, 'result sample action is legal'); state = result.state;
  }
  assert.equal(state.status, 'won');
  return { levelId: level.id, turns: state.turn };
}

if (require.main === module) {
  const samples = collectExperienceSamples(), result = verifyResultSample(), source = bundle(samples), output = path.join(root, 'work');
  new vm.Script(source, { filename: 'experience-preview.js' });
  for (const cue of ['page', 'open', 'close', 'toggle', 'reward']) assert.ok(fs.existsSync(path.join(root, 'assets', cue + '.wav')), cue + ' audio exists');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'experience-preview.html'), html);
  fs.writeFileSync(path.join(output, 'experience-preview.js'), source);
  console.log('Experience QA: http://127.0.0.1:8765/work/experience-preview.html');
  console.log('23 real page/modal specimens, 2 screen sizes, 4 entry samples; legal result from level ' + result.levelId + ' in ' + result.turns + ' turns.');
  const echo = samples.find(sample => sample.id === 'echo-finish');
  console.log('All 23 specimens validated; 15 routes replay exactly. Echo finish: level ' + echo.levelId + ' (' + echo.levelTitle + '), turn ' + echo.turn + ', ' + echo.actions[echo.actions.length - 1] + '.');
}

module.exports = { bundle, verifyResultSample, collectExperienceSamples };
