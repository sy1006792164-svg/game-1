'use strict';
const { createPlatform } = require('./platform');
const { createStore } = require('./storage');
const { createAds } = require('./ads');
const { ACTIONS, DIRECTIONS, createState, step, replay, revive, stars } = require('./engine');
const { CAMPAIGN, getDaily } = require('./levels');
const { getProgress } = require('./progression');
const { Renderer } = require('./renderer');
const { MOVE_MS } = require('./motion');
const { SceneCamera } = require('./camera');
const { insideRect } = require('./board-projection');
const { playHint } = require('./play-guide');
const { createSound } = require('./sound');
const config = require('./config');

// Undos per run come from the route itself (levels.undoFor): three on the first chapter, one from route 19 on.
const DEFAULT_UNDO = 3;

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
    this.camera = new SceneCamera();
    this.page = 'home'; this.chapter = 0; this.modal = null; this.reviewing = false;
    this.level = null; this.state = null; this.actions = []; this.reviveAt = null; this.undosUsed = 0;
    this.mode = 'campaign'; this.dateKey = localDate(); this.session = 0;
    this.toastText = ''; this.toastUntil = 0; this.transitionAt = 0; this.motionPath = null;
    this.busy = false; this.hidden = false; this.lastFrame = 0; this.pointer = null; this.pendingAction = null; this.blockedAt = null;
    this.metrics = platform.resize();
    platform.onResize(() => { this.pointer = null; this.metrics = platform.resize(); this.renderer.draw(this, platform.now(), this.metrics); });
    platform.onPointer((x, y, type) => this.pointerEvent(x, y, type), (x, y, factor, pan) => this.zoomScene(x, y, factor, pan));
    platform.onKey(key => {
      if (key === 'Escape') { if (!this.busy && this.page === 'game') this.pause(); return; }
      let action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'wait', Space: 'wait' }[key];
      if (action && action !== 'wait' && this.page === 'game' && this.renderer.boardProjection) {
        action = this.renderer.boardProjection.direction(...DIRECTIONS[action]);
      }
      if (action) this.act(action);
      else if (key === 'z' || key === 'Backspace') this.undo();
    });
    platform.onHide(() => {
      this.hidden = true; this.pointer = null; this.pendingAction = null; this.persist(); this.sound.stop();
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
  playHint() { return playHint(this, this.platform.now()); }
  record(level, mode) {
    const p = this.profile();
    return mode === 'daily' ? p.daily[this.runDate] : p.completed[String(level.id)];
  }
  completion() { return Object.keys(this.profile().completed).length; }
  starCount() { return Object.values(this.profile().completed).reduce((n, c) => n + c.stars, 0); }
  unlocked(index) { return index === 0 || !!this.profile().completed[String(CAMPAIGN[index - 1].id)]; }
  nextLevel() { return CAMPAIGN.find((l, i) => this.unlocked(i) && !this.profile().completed[String(l.id)]) || CAMPAIGN[CAMPAIGN.length - 1]; }
  toast(message) { this.toastText = message; this.toastUntil = this.platform.now() + 2600; }
  cue(type) { if (this.profile().settings.sound) this.sound.play(type); }
  persist() {
    if (this.state && this.state.status !== 'won') this.store.saveRun({ mode: this.mode, levelId: this.level.id, revision: this.level.revision || '1', dateKey: this.runDate, actions: this.actions.slice(), reviveAt: this.reviveAt, undosUsed: this.undosUsed });
  }
  restore() {
    this.pendingAction = null; this.blockedAt = null;
    const run = this.store.loadRun();
    if (!run) return false;
    try {
      if (!Array.isArray(run.actions) || run.actions.length > 4096) throw new Error('invalid history');
      if (!['daily', 'campaign'].includes(run.mode)) throw new Error('invalid mode');
      const level = run.mode === 'daily' ? getDaily(run.dateKey) : CAMPAIGN.find(l => l.id === run.levelId);
      if (!level || (run.mode === 'campaign' && !this.unlocked(CAMPAIGN.indexOf(level)))) throw new Error('invalid level');
      if ((run.revision || '1') !== (level.revision || '1')) {
        this.store.clearRun();
        this.start(level, run.mode);
        this.toast('路线已升级，已重新出发；通关成绩保留');
        return true;
      }
      const state = replay(level, run.actions, run.reviveAt);
      if (state.status === 'won') throw new Error('already done');
      const undosUsed = run.undosUsed == null ? 0 : run.undosUsed;
      if (!Number.isInteger(undosUsed) || undosUsed < 0 || undosUsed > this.undoLimit(level)) throw new Error('invalid undo count');
      this.level = level; this.state = state; this.previousState = null; this.moveEvents = []; this.motionPath = null;
      this.transitionAt = this.platform.now() - MOVE_MS;
      this.actions = run.actions.slice(); this.reviveAt = run.reviveAt; this.undosUsed = undosUsed;
      this.mode = run.mode; this.runDate = run.dateKey; this.page = 'game'; this.session++;
      this.pointer = null; this.camera.enter(this.platform.now());
      this.modal = null; this.reviewing = false;
      if (state.status === 'failed') this.failure(); else this.toast('已接上上次的风，继续投递吧');
      return true;
    } catch (_) { this.store.clearRun(); this.toast('旧进度无法恢复，已保留通关记录'); return false; }
  }
  start(level, mode) {
    if (this.busy) return;
    this.pendingAction = null; this.blockedAt = null;
    this.level = level; this.mode = mode || 'campaign';
    this.runDate = this.mode === 'daily' && /^daily-\d{4}-\d{2}-\d{2}$/.test(String(level.id)) ? String(level.id).slice(6) : localDate();
    this.state = createState(level); this.previousState = null; this.moveEvents = []; this.motionPath = null; this.actions = []; this.reviveAt = null; this.undosUsed = 0;
    this.page = 'game'; this.modal = null; this.reviewing = false; this.session++; this.transitionAt = this.platform.now() - MOVE_MS; this.toastUntil = 0;
    this.pointer = null; this.camera.enter(this.platform.now());
    this.persist(); this.cue('start');
  }
  primary() {
    if (this.store.loadRun() && this.restore()) return;
    this.start(this.nextLevel(), 'campaign');
  }
  act(action) {
    if (this.page !== 'game' || this.modal || this.busy || this.hidden || this.reviewing || !this.state || this.state.status !== 'playing') { this.pendingAction = null; return; }
    if (!ACTIONS.includes(action)) return;
    const now = this.platform.now();
    if (now - this.transitionAt < MOVE_MS) { this.pendingAction = { action, at: now }; return; }
    this.pendingAction = null; this.blockedAt = null;
    const result = step(this.level, this.state, action);
    if (!result.moved) { this.blockedAt = now; return; }
    this.previousState = this.state; this.state = result.state;
    this.actions.push(action); this.transitionAt = now;
    this.moveEvents = result.events; this.motionPath = null;
    this.cue(result.events.some(e => /letter|seal|light/.test(e.type)) ? 'collect' : 'move');
    if (this.profile().settings.haptics && result.events.some(e => /letter|seal|collect/.test(e.type))) this.platform.vibrate();
    this.persist();
    if (this.state.status === 'won') this.victory();
    else if (this.state.status === 'failed') this.failure();
    else if (this.state.player === this.level.exit && (this.state.letters.length || this.state.seals.length)) this.toast('还差信笺或回声邮票，集齐后再来投递');
  }
  undoLeft() { return Math.max(0, this.undoLimit() - this.undosUsed); }
  undoLimit(level = this.level) { return level && Number.isInteger(level.undo) ? level.undo : DEFAULT_UNDO; }
  canUndo() {
    return this.page === 'game' && !this.modal && !this.busy && !this.reviewing && !!this.state && this.state.status === 'playing' &&
      this.undoLeft() > 0 && this.actions.length > (this.reviveAt == null ? 0 : this.reviveAt);
  }
  /** Take back the last turn. The route is rebuilt from history, so undo never invents a state the rules did not produce. */
  undo() {
    this.pendingAction = null; this.blockedAt = null;
    if (this.page !== 'game' || this.modal || this.busy || this.reviewing || !this.state || this.state.status !== 'playing') return;
    if (this.undoLeft() <= 0) { this.toast('本程的 ' + this.undoLimit() + ' 次回溯已用完'); return; }
    if (!this.actions.length) { this.toast('已经在起点了'); return; }
    if (this.reviveAt != null && this.actions.length <= this.reviveAt) { this.toast('续灯之前的路，回不去了'); return; }
    const actions = this.actions.slice(0, -1);
    let state;
    try { state = replay(this.level, actions, this.reviveAt); } catch (_) { return; }
    const undone = step(this.level, state, this.actions[this.actions.length - 1]);
    this.motionPath = [state.player, ...undone.events.filter(event => event.type === 'move' || event.type === 'wind').map(event => event.cell)].reverse();
    this.previousState = this.state; this.state = state; this.actions = actions; this.undosUsed += 1;
    this.moveEvents = []; this.transitionAt = this.platform.now(); this.persist(); this.cue('move');
  }
  victory() {
    this.pendingAction = null; this.toastUntil = 0;
    const rating = stars(this.level, this.state), before = this.record(this.level, this.mode);
    this.store.recordWin(this.level.id, rating, this.state.turn, this.mode, this.runDate);
    this.store.clearRun(); this.cue('win');
    const index = CAMPAIGN.findIndex(l => l.id === this.level.id);
    const candidate = index >= 0 ? CAMPAIGN[index + 1] : null;
    const next = this.mode === 'campaign' ? candidate : null;
    const saved = this.store.getStatus().persisted;
    const saveLine = saved ? '本次纪录已保存。' : '本次纪录仅在本次运行保留。';
    const bestLine = !before ? saveLine : this.state.turn < before.bestTurns ? '刷新纪录，比上次少走 ' + (before.bestTurns - this.state.turn) + ' 拍。' : this.state.turn === before.bestTurns ? '追平个人最佳 · ' + before.bestTurns + ' 拍' : '个人最佳 ' + before.bestTurns + ' 拍 · 本次多走 ' + (this.state.turn - before.bestTurns) + ' 拍';
    const lines = [this.state.turn + ' 拍完成' + (this.state.revived ? ' · 续灯最高二星' : ''), bestLine];
    if (before && !saved) lines.push(saveLine);
    this.modal = {
      kind: 'win', title: '信已送达', stars: rating,
      lines,
      buttons: [
        { text: next ? '下一封信' : '返回邮局', primary: true, action: () => next ? this.start(next, this.mode) : this.home() },
        { text: '再走一次', textOnly: true, action: () => this.start(this.level, this.mode) }
      ]
    };
  }
  failureHint() {
    const s = this.state, l = this.level;
    if (!s.letters.length && !s.seals.length) return '下次为回到邮局留出更多拍数。';
    if ((l.bridges || []).length && !s.bridges.length) return '纸桥都碎了。先想清楚哪一段只走一次，再踏上去。';
    if (!s.letters.length) return '先踩过蓝色邮票，再给回声留出三拍。';
    if (s.lights.length) return '试着把剩余风灯串进路线，每盏补充三拍。';
    return '先安排远端目标，再把回邮局的路留到最后。';
  }
  failure() {
    this.pendingAction = null; this.toastUntil = 0; this.reviewing = false;
    const canRevive = this.platform.kind === 'wechat' && this.ads.isConfigured() && !this.state.revived;
    const remaining = [];
    if (this.state.letters.length) remaining.push(this.state.letters.length + ' 封信');
    if (this.state.seals.length) remaining.push(this.state.seals.length + ' 枚邮票');
    // The one-time relight leads when it is available: the route, collected
    // letters and stamps all survive, so it is the natural way to finish.
    this.modal = {
      kind: 'fail', title: canRevive ? '灯灭了，路线还在' : '换条路线，再寄一次',
      lines: [remaining.length ? '还差 ' + remaining.join(' / ') : '信笺和邮票已收齐', this.failureHint()],
      buttons: [
        ...(canRevive ? [{ text: '看视频续灯 +' + Math.max(8, Math.ceil(this.level.budget * .5)) + ' 拍 · 接着送', primary: true, action: () => this.requestRevive() }] : []),
        { text: '重新规划 · 免费再试', primary: !canRevive, action: () => this.start(this.level, this.mode) },
        { text: '看看刚才的路线', action: () => { this.modal = null; this.reviewing = true; } },
        { text: '返回邮局', textOnly: true, action: () => this.home() }
      ]
    };
  }
  async requestRevive() {
    if (this.busy || !this.state || this.state.status !== 'failed' || this.state.revived) return;
    if (this.platform.kind !== 'wechat') return;
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
    this.modal = null; this.reviewing = false; this.persist(); this.cue('collect'); this.toast('风灯重新亮起，沿途收集已保留');
  }
  pause() {
    this.pendingAction = null;
    if (this.busy) return;
    if (this.reviewing) { this.failure(); return; }
    if (this.modal && this.modal.kind === 'pause') { this.modal = null; return; }
    if (!this.state || this.state.status !== 'playing') return;
    const saveLine = this.store.getStatus().persisted ? '路线已自动保存，没有倒计时。' : '没有倒计时。路线仅在本次运行保留。';
    this.modal = { kind: 'pause', title: '歇一会', lines: [saveLine], buttons: [
      { text: '继续投递', primary: true, action: () => { this.modal = null; } },
      { text: '重新开始', action: () => this.start(this.level, this.mode) },
      { text: '玩法说明', textOnly: true, action: () => this.help() },
      { text: '返回邮局', textOnly: true, action: () => this.home() }
    ] };
  }
  help() {
    this.pendingAction = null;
    const old = this.modal, l = this.page === 'game' ? this.level : null;
    const lines = ['点相邻亮格移动，点角色或“等一拍”等待。', '你收橙色信笺，晚三拍的回声收蓝色邮票。', '全部收齐后，走到邮局即可过关。'];
    if (l) lines.push('单指左右拖动转向，上下拖动调整俯视角度。', '双指捏合缩放、拖动平移；电脑滚轮缩放。');
    if (l && Object.keys(l.winds).length) lines.push('箭头会再推一格，等待不会触发风。');
    if (l && l.lights.length) lines.push('每盏风灯只补一次，共 3 拍。');
    if (l && (l.bridges || []).length) lines.push('纸桥离开后就碎，回声可以通过。');
    this.modal = { kind: 'help', title: '和回声一起送信', lines,
      buttons: [{ text: '明白了', primary: true, action: () => { this.modal = old; } }] };
  }
  home() { if (this.busy) return; this.pendingAction = null; this.persist(); this.modal = null; this.reviewing = false; this.page = 'home'; this.dateKey = localDate(); this.session++; }
  openPage(page) {
    if (this.busy) return;
    this.pendingAction = null; this.persist(); this.page = page === 'progress' ? 'collection' : page; this.modal = null; this.reviewing = false; this.dateKey = localDate();
    if (page === 'levels') this.chapter = this.nextLevel().chapter;
    this.cue('move');
  }
  goal(action) {
    if (action === 'daily') { this.daily(); return; }
    if (action === 'campaign') { this.start(this.nextLevel(), 'campaign'); return; }
    this.openPage('levels');
    const p = this.profile();
    const target = CAMPAIGN.find(l => p.completed[String(l.id)] && p.completed[String(l.id)].stars < 3);
    if (target) this.chapter = target.chapter;
  }
  levelInfo(level, mode) { this.start(level, mode); }
  daily() {
    this.dateKey = localDate();
    this.start(getDaily(this.dateKey), 'daily');
  }
  toggle(setting) { const value = !this.profile().settings[setting]; this.store.updateSettings({ [setting]: value }); if (value) this.cue('collect'); }
  resetPrompt() {
    this.modal = { title: '重新整理这间邮局？', kicker: 'LOCAL DATA', lines: ['将清除这台设备的关卡、邮票、每日记录和当前路线。', '音效与振动设置也会恢复默认，此操作不能恢复。'], buttons: [
      { text: '保留我的进度', primary: true, action: () => { this.modal = null; } },
      { text: '确认清除本地进度', action: () => {
        const cleared = this.store.reset();
        this.state = null; this.level = null; this.actions = []; this.home();
        this.toast(cleared ? '本地进度已清除，设置已恢复默认' : '本次运行已重置，本地数据未能完全清除');
      } }
    ] };
  }
  zoomScene(x, y, factor, pan = { dx: 0, dy: 0 }) {
    if (this.page !== 'game' || this.modal || this.busy || this.hidden) return;
    const p = this.renderer.toLogical(x, y), b = this.renderer.boardRect;
    if (!b || !insideRect(b, p.x, p.y)) return;
    this.pointer = null;
    const dx = pan.dx / this.renderer.scale / b.w, dy = pan.dy / this.renderer.scale / b.h;
    this.camera.zoomAt(factor, (p.x - b.x - b.w / 2) / b.w - dx, (p.y - b.y - b.h / 2 - 4) / b.h - dy, dx, dy);
    this.renderer.draw(this, this.platform.now(), this.metrics);
  }
  pointerEvent(x, y, type) {
    const p = this.renderer.toLogical(x, y);
    if (type === 'start') {
      const b = this.renderer.boardRect;
      this.pointer = { ...p, lastX: p.x, lastY: p.y, time: this.platform.now(), dragging: false,
        scene: this.page === 'game' && !this.modal && !this.busy && !this.hidden && b && insideRect(b, p.x, p.y) };
      return;
    }
    if (type === 'cancel') { this.pointer = null; return; }
    if (this.pointer && this.pointer.scene && (type === 'move' || type === 'end')) {
      const origin = this.pointer, b = this.renderer.boardRect;
      if (!b || this.modal || this.busy || this.hidden || this.page !== 'game') { this.pointer = null; return; }
      if (origin.dragging || Math.hypot(p.x - origin.x, p.y - origin.y) > 8) {
        origin.dragging = true;
        this.camera.orbit((p.x - origin.lastX) / b.w, (p.y - origin.lastY) / b.h);
        origin.lastX = p.x; origin.lastY = p.y;
        this.renderer.draw(this, this.platform.now(), this.metrics);
        if (type === 'end') this.pointer = null;
        return;
      }
    }
    if (type !== 'end' || !this.pointer) return;
    const origin = this.pointer; this.pointer = null;
    const dx = p.x - origin.x, dy = p.y - origin.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 25) return;
    const inside = (h, point) => point.x >= h.x && point.x <= h.x + h.w && point.y >= h.y && point.y <= h.y + h.h && (!h.contains || h.contains(point.x, point.y));
    const hit = this.renderer.hits.slice().reverse().find(h => inside(h, p) && inside(h, origin));
    if (hit) hit.action();
  }
  loop() {
    if (this.hidden) return;
    const now = this.platform.now();
    if (this.pendingAction && now - this.transitionAt >= MOVE_MS) {
      const pending = this.pendingAction; this.pendingAction = null;
      if (now - pending.at <= 500) this.act(pending.action);
    }
    if (!this.dateCheckedAt || now - this.dateCheckedAt > 1000) { this.dateKey = localDate(); this.dateCheckedAt = now; }
    if (now - this.lastFrame >= 16) { this.renderer.draw(this, now, this.metrics); this.lastFrame = now; }
    this.frameId = this.platform.raf(() => this.loop());
  }
}

new Game(createPlatform());
