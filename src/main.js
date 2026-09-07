'use strict';
const { createPlatform } = require('./platform');
const { createStore } = require('./storage');
const { createAds } = require('./ads');
const { createState, step, revive, stars } = require('./engine');
const { CAMPAIGN, getDaily } = require('./levels');
const { getChallenge } = require('./challenge');
const { getProgress } = require('./progression');
const { Renderer } = require('./renderer');
const { createSound } = require('./sound');
const config = require('./config');

function localDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

class Game {
  constructor(platform) {
    this.platform = platform;
    this.store = createStore(platform.storage);
    this.ads = createAds(platform, config);
    this.sound = createSound(platform);
    this.renderer = new Renderer(platform.canvas);
    this.page = 'home'; this.chapter = 0; this.modal = null; this.levelMode = 'campaign'; this.reviewing = false;
    this.level = null; this.state = null; this.actions = []; this.reviveAt = null;
    this.mode = 'campaign'; this.dateKey = localDate(); this.session = 0;
    this.toastText = ''; this.toastUntil = 0; this.transitionAt = 0;
    this.busy = false; this.hidden = false; this.lastFrame = 0; this.pointer = null;
    this.metrics = platform.resize();
    platform.onResize(() => { this.metrics = platform.resize(); });
    platform.onPointer((x, y, type) => this.pointerEvent(x, y, type));
    platform.onKey(key => {
      if (key === 'Escape') { if (!this.busy && this.page === 'game') this.pause(); return; }
      const action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'wait', Space: 'wait' }[key];
      if (action) this.act(action);
    });
    platform.onHide(() => {
      this.hidden = true; this.pointer = null; this.persist(); this.sound.stop();
      if (this.frameId != null) platform.cancelRaf(this.frameId);
      this.frameId = null;
      if (this.page === 'game' && this.state.status === 'playing' && !this.modal && !this.busy) this.pause();
    });
    platform.onShow(() => {
      this.hidden = false; this.pointer = null; this.dateKey = localDate(); this.metrics = platform.resize();
      if (this.frameId == null) this.loop();
    });
    this.loop();
  }
  profile() { return this.store.getProfile(); }
  progress() { return getProgress(this.profile(), this.dateKey); }
  record(level, mode) {
    const p = this.profile();
    return mode === 'daily' ? p.daily[this.runDate] : (mode === 'expert' ? p.expert : p.completed)[String(level.id)];
  }
  expertUnlocked(level) { return this.completion() >= 3 && !!this.profile().completed[String(level.id)]; }
  completion() { return Object.keys(this.profile().completed).length; }
  starCount() { return Object.values(this.profile().completed).reduce((n, c) => n + c.stars, 0); }
  unlocked(index) { return index === 0 || !!this.profile().completed[String(CAMPAIGN[index - 1].id)]; }
  nextLevel() { return CAMPAIGN.find((l, i) => this.unlocked(i) && !this.profile().completed[String(l.id)]) || CAMPAIGN[CAMPAIGN.length - 1]; }
  toast(message) { this.toastText = message; this.toastUntil = this.platform.now() + 2600; }
  cue(type) { if (this.profile().settings.sound) this.sound.play(type); }
  persist() {
    if (this.state && this.state.status !== 'won') this.store.saveRun({ mode: this.mode, levelId: this.level.id, revision: this.level.revision || '1', dateKey: this.runDate, actions: this.actions.slice(), reviveAt: this.reviveAt });
  }
  restore() {
    const run = this.store.loadRun();
    if (!run) return false;
    try {
      if (!Array.isArray(run.actions) || run.actions.length > 4096) throw new Error('invalid history');
      if (!['daily', 'campaign', 'expert'].includes(run.mode)) throw new Error('invalid mode');
      let level = run.mode === 'daily' ? getDaily(run.dateKey) : CAMPAIGN.find(l => l.id === run.levelId);
      if (!level || (run.mode === 'campaign' && !this.unlocked(CAMPAIGN.indexOf(level)))) throw new Error('invalid level');
      if (run.mode === 'expert') {
        if (!this.expertUnlocked(level) || run.reviveAt != null) throw new Error('invalid expert run');
        level = getChallenge(level);
      }
      if ((run.revision || '1') !== (level.revision || '1')) {
        this.store.clearRun();
        this.start(level, run.mode);
        this.toast('路线已升级，已重新出发；通关成绩保留');
        return true;
      }
      let state = createState(level);
      for (let i = 0; i <= run.actions.length; i++) {
        if (run.reviveAt === i) {
          if (state.status !== 'failed') throw new Error('invalid revive');
          state = revive(level, state);
        }
        if (i === run.actions.length) break;
        const result = step(level, state, run.actions[i]);
        if (!result.moved) throw new Error('invalid action');
        state = result.state;
      }
      if (state.status === 'won') throw new Error('already done');
      this.level = level; this.state = state; this.previousState = null;
      this.actions = run.actions.slice(); this.reviveAt = run.reviveAt;
      this.mode = run.mode; this.runDate = run.dateKey; this.page = 'game'; this.session++;
      this.modal = null; this.reviewing = false;
      if (state.status === 'failed') this.failure(); else this.toast('已接上上次的风，继续投递吧');
      return true;
    } catch (_) { this.store.clearRun(); this.toast('旧进度无法恢复，已保留通关记录'); return false; }
  }
  start(level, mode) {
    if (this.busy) return;
    if (mode === 'expert') {
      const base = CAMPAIGN.find(l => l.id === level.id);
      if (!base || !this.expertUnlocked(base)) { this.toast('完成前三封信，并通关对应邮路后开启高手挑战'); return; }
      level = getChallenge(base);
    }
    this.level = level; this.mode = mode || 'campaign';
    this.runDate = this.mode === 'daily' && /^daily-\d{4}-\d{2}-\d{2}$/.test(String(level.id)) ? String(level.id).slice(6) : localDate();
    this.state = createState(level); this.previousState = null; this.moveEvents = []; this.actions = []; this.reviveAt = null;
    this.page = 'game'; this.modal = null; this.reviewing = false; this.session++; this.transitionAt = 0; this.toastUntil = 0;
    this.persist(); this.cue('start');
    if (level === CAMPAIGN[0] && !this.profile().completed[String(level.id)]) this.help(true);
  }
  primary() {
    if (this.store.loadRun() && this.restore()) return;
    this.start(this.nextLevel(), 'campaign');
  }
  act(action) {
    if (this.page !== 'game' || this.modal || this.busy || !this.state || this.state.status !== 'playing') return;
    const now = this.platform.now();
    if (now - this.transitionAt < 135) return;
    const result = step(this.level, this.state, action);
    if (!result.moved) { this.toast('这边不通，换个方向试试'); return; }
    this.previousState = this.state; this.state = result.state;
    this.actions.push(action); this.transitionAt = now;
    this.moveEvents = result.events;
    this.cue(result.events.some(e => /letter|seal|light/.test(e.type)) ? 'collect' : 'move');
    if (this.profile().settings.haptics && result.events.some(e => /letter|seal|collect/.test(e.type))) this.platform.vibrate();
    this.persist();
    if (this.state.status === 'won') this.victory();
    else if (this.state.status === 'failed') this.failure();
    else if (this.state.player === this.level.exit && (this.state.letters.length || this.state.seals.length)) this.toast('还差信笺或回声邮票，集齐后再来投递');
    else if (result.events.some(e => e.type === 'light')) this.toast('点亮风灯 · 补充 3 拍');
    else if (this.state.energy <= 3 && this.previousState.energy > 3) this.toast('还剩 3 拍，留意回声与邮局的位置');
  }
  victory() {
    this.toastUntil = 0;
    const rating = stars(this.level, this.state);
    const before = this.record(this.level, this.mode), previousProgress = this.progress();
    this.store.recordWin(this.level.id, rating, this.state.turn, this.mode, this.runDate);
    this.store.clearRun(); this.cue('win');
    const index = CAMPAIGN.findIndex(l => l.id === this.level.id);
    const candidate = index >= 0 ? CAMPAIGN[index + 1] : null;
    const next = this.mode === 'campaign' ? candidate : this.mode === 'expert' && candidate && this.expertUnlocked(candidate) ? candidate : null;
    const after = this.progress();
    const bestLine = !before ? '首次送达！这条邮路有了你的纪录。' : this.state.turn < before.bestTurns ? '刷新个人最佳 · 比上次少走 ' + (before.bestTurns - this.state.turn) + ' 拍' : this.state.turn === before.bestTurns ? '追平个人最佳 · ' + before.bestTurns + ' 拍' : '个人最佳 ' + before.bestTurns + ' 拍 · 本次多走 ' + (this.state.turn - before.bestTurns) + ' 拍';
    const growth = after.rank.level > previousProgress.rank.level ? '晋升「' + after.rank.name + '」！' : previousProgress.nextStamp && after.stars >= previousProgress.nextStamp.target ? '新邮票「' + previousProgress.nextStamp.name + '」已入册' : this.mode === 'daily' ? '本周已完成 ' + after.weekly.count + '/3 天挑战 · 随时再来' : rating < 3 ? '再缩短 ' + Math.max(0, this.state.turn - this.level.par) + ' 拍，挑战三星路线。' : this.completion() === 3 && !before ? '高手邮路已解锁，试试更紧的灯火预算。' : '这一程已留在你的成长手记。';
    this.modal = {
      kind: 'win', title: this.mode === 'expert' ? '高手邮路，漂亮送达' : this.mode === 'daily' ? '今日来信，已送达' : '这一程，信已送达', kicker: this.mode === 'expert' ? 'MASTER DELIVERY' : 'DELIVERED WITH AN ECHO', stars: rating,
      lines: [this.state.turn + ' 拍完成  ·  三星目标 ' + this.level.par + ' 拍', bestLine, this.state.revived ? '本程使用过续灯，最高获得二星。' : growth],
      buttons: [
        { text: next ? (this.mode === 'expert' ? '下一条高手邮路  →' : '下一封信  →') : '返回邮局', primary: true, action: () => next ? this.start(next, this.mode) : this.home() },
        { text: rating < 3 ? '再试一次 · 冲击三星' : '再走一次 · 挑战纪录', action: () => this.start(this.level, this.mode) },
        { text: '查看成长与新邮票', textOnly: true, action: () => this.openPage('progress') }
      ]
    };
  }
  failureHint() {
    const s = this.state, l = this.level;
    if (!s.letters.length && !s.seals.length) return '收集已完成，下次为回邮局留出更多拍数。';
    if (!s.letters.length) return '先踩过蓝色邮票，再给回声留出三拍。';
    if (s.lights.length) return '试着把剩余风灯串进路线，每盏补充三拍。';
    return '先安排远端目标，再把回邮局的路留到最后。';
  }
  failure() {
    this.toastUntil = 0; this.reviewing = false;
    const canRevive = !this.state.revived && this.mode !== 'expert';
    this.modal = {
      kind: 'fail', title: '换条路线，再寄一次', kicker: 'EVERY ROUTE TEACHES SOMETHING',
      lines: ['走了 ' + this.state.turn + ' 拍 · 还差 ' + this.state.letters.length + ' 封信 / ' + this.state.seals.length + ' 枚邮票', this.failureHint(), this.mode === 'expert' ? '高手邮路不续灯，试着减少一次折返。' : '免费重试不限次数，已获得的星星会保留。'],
      buttons: [
        { text: '重新规划 · 免费再试', primary: true, action: () => this.start(this.level, this.mode) },
        { text: '看看刚才的路线', action: () => { this.modal = null; this.reviewing = true; } },
        ...(canRevive ? [{ text: '自愿看视频 · 续灯 +' + Math.max(8, Math.ceil(this.level.budget * .5)) + ' 拍', action: () => this.requestRevive() }] : []),
        { text: '返回邮局', textOnly: true, action: () => this.home() }
      ]
    };
  }
  async requestRevive() {
    if (this.busy || this.mode === 'expert' || !this.state || this.state.status !== 'failed' || this.state.revived) return;
    if (this.platform.kind === 'browser') {
      const session = this.session;
      this.modal = {
        title: '广告流程测试', kicker: 'LOCAL PREVIEW ONLY',
        lines: ['这里不播放广告。请选择一种测试结果。', '正式微信版本只接受真实广告完成回调。'],
        buttons: [
          { text: '模拟完整观看 · 续灯', primary: true, action: () => { if (session === this.session) this.applyRevive(); } },
          { text: '模拟中途关闭 · 不续灯', action: () => { this.failure(); this.toast('视频未看完，没有消耗本程续灯机会'); } },
          { text: '模拟加载失败 · 不续灯', action: () => { this.failure(); this.toast('广告暂时不可用，请稍后再试'); } }
        ]
      };
      return;
    }
    if (!this.ads.isConfigured()) {
      this.toast(config.REWARDED_AD_UNIT_ID ? '当前环境暂不支持激励视频，可直接重新出发' : '激励视频尚未配置，可直接重新出发'); return;
    }
    this.busy = true; const session = this.session;
    this.modal = { title: '正在连接广告', kicker: 'RELIGHT YOUR LANTERN', lines: ['请稍候，完成视频后将回到这条路线。'], buttons: [] };
    this.sound.stop();
    let result;
    try { result = await this.ads.showRevive(); } catch (_) { result = { rewarded: false, reason: 'error' }; }
    this.busy = false;
    if (session !== this.session) return;
    if (result.rewarded) this.applyRevive();
    else {
      this.failure();
      this.toast(result.reason === 'cancelled' ? '视频未看完，可重试或重新出发' : '广告暂时不可用，请稍后再试或重新出发');
    }
  }
  applyRevive() {
    if (this.mode === 'expert') return;
    const next = revive(this.level, this.state);
    if (next === this.state || next.status !== 'playing') return;
    this.state = next; this.previousState = null; this.reviveAt = this.actions.length;
    this.modal = null; this.reviewing = false; this.persist(); this.cue('collect'); this.toast('风灯重新亮起，沿途收集已保留');
  }
  pause() {
    if (this.busy) return;
    if (this.reviewing) { this.failure(); return; }
    if (this.modal && this.modal.kind === 'pause') { this.modal = null; return; }
    if (!this.state || this.state.status !== 'playing') return;
    this.modal = { kind: 'pause', title: '在回廊歇一会', kicker: 'THE WIND CAN WAIT', lines: ['这是一场没有倒计时的旅行。', '当前路线已自动保存在这台设备。'], buttons: [
      { text: '继续投递', primary: true, action: () => { this.modal = null; } },
      { text: '重新走这条路', action: () => this.start(this.level, this.mode) },
      { text: '返回邮局', textOnly: true, action: () => this.home() }
    ] };
  }
  help(first) {
    const old = this.modal;
    this.modal = { kind: 'help', title: '你走一步，回声晚三拍', kicker: 'A GUIDE FOR YOUR FIRST LETTER',
      lines: ['① 移动送信员，收起橙色信笺。', '② 回声晚三拍走过你的旧位置，收蓝色邮票。', '③ 都收齐后，让送信员到达绿色邮局。', '每次移动 / 等待消耗一拍。撞墙不消耗。', '风格顺箭头推一格；灯格一次补充三拍。'],
      buttons: [{ text: first ? '明白了，寄出第一封信' : '继续我的旅程', primary: true, action: () => { this.modal = old; } }]
    };
  }
  home() { if (this.busy) return; this.persist(); this.modal = null; this.reviewing = false; this.page = 'home'; this.dateKey = localDate(); this.session++; }
  openPage(page) {
    if (this.busy) return;
    this.persist(); this.page = page; this.modal = null; this.reviewing = false; this.dateKey = localDate();
    if (page === 'levels') this.chapter = Math.floor(CAMPAIGN.indexOf(this.nextLevel()) / 6);
    this.cue('move');
  }
  selectMode(mode) {
    if (mode === 'expert' && this.completion() < 3) { this.toast('送达前三封信后开启高手邮路 · ' + this.completion() + '/3'); return; }
    this.levelMode = mode;
  }
  goal(action) {
    if (action === 'daily') { this.daily(); return; }
    if (action === 'campaign') { this.start(this.nextLevel(), 'campaign'); return; }
    this.openPage('levels');
    this.levelMode = action === 'expert' ? 'expert' : 'campaign';
    const p = this.profile();
    const target = CAMPAIGN.find(l => action === 'expert' ? p.completed[String(l.id)] && !p.expert[String(l.id)] : p.completed[String(l.id)] && p.completed[String(l.id)].stars < 3);
    if (target) this.chapter = Math.floor(CAMPAIGN.indexOf(target) / 6);
  }
  levelInfo(level, mode) {
    if (mode === 'expert' && !this.expertUnlocked(level)) { this.toast('先在标准邮路送达这封信，再挑战高手'); return; }
    const selected = mode === 'expert' ? getChallenge(level) : level;
    const record = this.record(level, mode);
    this.modal = { title: level.title, kicker: mode === 'expert' ? 'MASTER ROUTE / 高手邮路' : 'YOUR NEXT DELIVERY / 标准邮路',
      lines: [selected.budget + ' 拍初始灯火 · 三星目标 ' + selected.par + ' 拍', mode === 'expert' ? '比标准少 ' + (level.budget - selected.budget) + ' 拍 · 不使用续灯' : level.letters.length + ' 封信笺 · ' + level.seals.length + ' 枚回声邮票', record ? '个人最佳 ' + record.bestTurns + ' 拍 · 已获 ' + record.stars + ' 星' : '规划收集顺序，再让回声跟上你。'],
      buttons: [{ text: mode === 'expert' ? '挑战高手邮路  →' : '出发，寄出这封信  →', primary: true, action: () => this.start(level, mode) }, { text: '再看看其他邮路', textOnly: true, action: () => { this.modal = null; } }]
    };
  }
  daily() {
    const date = localDate(); this.dateKey = date;
    const p = this.progress(), record = this.profile().daily[date];
    this.modal = { title: '一天，一封新来信', kicker: date.replace(/-/g, ' / '), lines: ['每天更新一条路线，同一天可反复精进。', record ? '今日最佳 ' + record.bestTurns + ' 拍 · 已获 ' + record.stars + ' 星' : '三信三票，给自己一场新的路线挑战。', '本周已送达 ' + p.weekly.count + '/3 天 · 无需连续签到'], buttons: [
      { text: '开启今日风笺  →', primary: true, action: () => { this.dateKey = localDate(); this.start(getDaily(this.dateKey), 'daily'); } },
      { text: '稍后再来', action: () => { this.modal = null; } }
    ] };
  }
  toggle(setting) { const value = !this.profile().settings[setting]; this.store.updateSettings({ [setting]: value }); if (value) this.cue('collect'); }
  resetPrompt() {
    this.modal = { title: '重新整理这间邮局？', kicker: 'LOCAL DATA', lines: ['将清除这台设备的关卡、邮票和当前路线。', '此操作不能恢复。'], buttons: [
      { text: '保留我的进度', primary: true, action: () => { this.modal = null; } },
      { text: '确认清除本地进度', action: () => { this.store.reset(); this.state = null; this.level = null; this.actions = []; this.home(); this.toast('本地进度已清除'); } }
    ] };
  }
  pointerEvent(x, y, type) {
    const p = this.renderer.toLogical(x, y);
    if (type === 'start') { this.pointer = { ...p, time: this.platform.now() }; return; }
    if (type === 'cancel') { this.pointer = null; return; }
    if (type !== 'end' || !this.pointer) return;
    const origin = this.pointer; this.pointer = null;
    const dx = p.x - origin.x, dy = p.y - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 25) {
      const b = this.renderer.boardRect;
      if (!this.modal && this.page === 'game' && b && origin.x >= b.x && origin.x <= b.x + b.w && origin.y >= b.y && origin.y <= b.y + b.h) this.act(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
      return;
    }
    const hit = this.renderer.hits.slice().reverse().find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h && origin.x >= h.x && origin.x <= h.x + h.w && origin.y >= h.y && origin.y <= h.y + h.h);
    if (hit) hit.action();
  }
  loop() {
    if (this.hidden) return;
    const now = this.platform.now();
    if (!this.dateCheckedAt || now - this.dateCheckedAt > 1000) { this.dateKey = localDate(); this.dateCheckedAt = now; }
    if (now - this.lastFrame > 30) { this.renderer.draw(this, now, this.metrics); this.lastFrame = now; }
    this.frameId = this.platform.raf(() => this.loop());
  }
}

new Game(createPlatform());
