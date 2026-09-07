'use strict';
const { createPlatform } = require('./platform');
const { createStore } = require('./storage');
const { createAds } = require('./ads');
const { createState, step, revive, stars } = require('./engine');
const { CAMPAIGN, getDaily } = require('./levels');
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
    this.page = 'home'; this.chapter = 0; this.modal = null;
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
      if (run.mode !== 'daily' && run.mode !== 'campaign') throw new Error('invalid mode');
      const level = run.mode === 'daily' ? getDaily(run.dateKey) : CAMPAIGN.find(l => l.id === run.levelId);
      if (!level || (run.mode === 'campaign' && !this.unlocked(CAMPAIGN.indexOf(level)))) throw new Error('invalid level');
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
      this.modal = null;
      if (state.status === 'failed') this.failure(); else this.toast('已接上上次的风，继续投递吧');
      return true;
    } catch (_) { this.store.clearRun(); this.toast('旧进度无法恢复，已保留通关记录'); return false; }
  }
  start(level, mode) {
    if (this.busy) return;
    this.level = level; this.mode = mode || 'campaign';
    this.runDate = this.mode === 'daily' && /^daily-\d{4}-\d{2}-\d{2}$/.test(String(level.id)) ? String(level.id).slice(6) : localDate();
    this.state = createState(level); this.previousState = null; this.actions = []; this.reviveAt = null;
    this.page = 'game'; this.modal = null; this.session++; this.transitionAt = 0; this.toastUntil = 0;
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
    this.cue(result.events.some(e => /letter|seal|collect/.test(e.type)) ? 'collect' : 'move');
    if (this.profile().settings.haptics && result.events.some(e => /letter|seal|collect/.test(e.type))) this.platform.vibrate();
    this.persist();
    if (this.state.status === 'won') this.victory();
    else if (this.state.status === 'failed') this.failure();
    else if (this.state.player === this.level.exit && (this.state.letters.length || this.state.seals.length)) this.toast('还差信笺或回声邮票，集齐后再来投递');
  }
  victory() {
    this.toastUntil = 0;
    const rating = stars(this.level, this.state);
    this.store.recordWin(this.level.id, rating, this.state.turn, this.mode, this.runDate);
    this.store.clearRun(); this.cue('win');
    const index = CAMPAIGN.indexOf(this.level);
    const next = this.mode === 'campaign' && index >= 0 && index + 1 < CAMPAIGN.length ? CAMPAIGN[index + 1] : null;
    this.modal = {
      kind: 'win', title: this.mode === 'daily' ? '今日来信，已送达' : '这一程，信已送达', kicker: 'DELIVERED WITH AN ECHO', stars: rating,
      lines: [this.state.turn + ' 拍完成  ·  三星目标 ' + this.level.par + ' 拍', this.state.revived ? '本程使用过续灯，最高获得二星。' : rating === 3 ? '步调刚刚好，回声也准时抵达。' : '再试一条更短的路，点亮更多星星。'],
      buttons: [
        { text: next ? '下一封信  →' : '返回邮局', primary: true, action: () => next ? this.start(next, 'campaign') : this.home() },
        { text: '再走一次', action: () => this.start(this.level, this.mode) }
      ]
    };
  }
  failure() {
    this.toastUntil = 0;
    const canRevive = !this.state.revived;
    this.modal = {
      kind: 'fail', title: '风灯暂时熄灭了', kicker: 'A LITTLE PAUSE ON THE WAY',
      lines: ['已经走了 ' + this.state.turn + ' 拍，沿途收集会保留。', canRevive ? '完整观看视频可续灯一次，也可以直接重来。' : '本程续灯已用完。换条路线，重新出发吧。'],
      buttons: canRevive ? [
        { text: '看视频续灯  +' + Math.max(8, Math.ceil(this.level.budget * .5)) + ' 拍', primary: true, action: () => this.requestRevive() },
        { text: '重新出发', action: () => this.start(this.level, this.mode) },
        { text: '返回邮局', textOnly: true, action: () => this.home() }
      ] : [
        { text: '重新出发', primary: true, action: () => this.start(this.level, this.mode) },
        { text: '返回邮局', action: () => this.home() }
      ]
    };
  }
  async requestRevive() {
    if (this.busy || !this.state || this.state.status !== 'failed' || this.state.revived) return;
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
    const next = revive(this.level, this.state);
    if (next === this.state || next.status !== 'playing') return;
    this.state = next; this.previousState = null; this.reviveAt = this.actions.length;
    this.modal = null; this.persist(); this.cue('collect'); this.toast('风灯重新亮起，沿途收集已保留');
  }
  pause() {
    if (this.busy) return;
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
  home() { if (this.busy) return; this.persist(); this.modal = null; this.page = 'home'; this.dateKey = localDate(); this.session++; }
  openPage(page) { this.page = page; this.modal = null; this.cue('move'); }
  daily() {
    const date = localDate(); this.dateKey = date;
    this.modal = { title: '一天，一封新来信', kicker: date.replace(/-/g, ' / '), lines: ['今日所有本地挑战都使用同一条路线。', '可以不限次数重试，保留今天的最高星级。', '挑战不要求看广告，也没有连续签到惩罚。'], buttons: [
      { text: '开启今日风笺  →', primary: true, action: () => this.start(getDaily(date), 'daily') },
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
    if (now - this.lastFrame > 30) { this.renderer.draw(this, now, this.metrics); this.lastFrame = now; }
    this.frameId = this.platform.raf(() => this.loop());
  }
}

new Game(createPlatform());
