'use strict';
const { createPlatform } = require('./platform');
const { createStore } = require('./storage');
const { createAds } = require('./ads');
const { createGameCircle } = require('./game-circle');
const { createFriendLeaderboard } = require('./friend-leaderboard');
const { createRankingAuthorization } = require('./ranking-authorization');
const { campaignScore } = require('./friend-score');
const { enableSharing } = require('./sharing');
const { ACTIONS, DIRECTIONS, STAR_TWO_MARGIN, createState, step, replay, revive, stars } = require('./engine');
const { CAMPAIGN } = require('./levels');
const { getAlbum } = require('./stamp-album');
const { ListScroll } = require('./list-scroll');
const { levelListLayout, levelProgressOffset } = require('./level-view');
const { leaderboardRect } = require('./leaderboard-view');
const { developmentLevelNumber } = require('./developer-view');
const { Renderer } = require('./renderer');
const { MOVE_MS } = require('./motion');
const { SceneCamera, INTRO_MS, SHAKE_MS } = require('./camera');
const { insideRect } = require('./board-projection');
const { BOARD_DRAG_SLOP, containsHit, captureBoardTap } = require('./board-input');
const { playHint, canGuide, autoGuide, guideStep } = require('./play-guide');
const { NAMES, availableMechanics, createMechanicGuide, mechanicStep } = require('./mechanic-guide');
const { createSound } = require('./sound');
const { turnFeedback } = require('./feedback');
const config = require('./config');
const { publicationLines, StartupLoader } = require('./startup');

// Undos per run come from the route itself (levels.undoFor): three on the first chapter, one from route 19 on.
const DEFAULT_UNDO = 3;

class Game {
  constructor(platform) {
    this.platform = platform;
    Object.defineProperty(this, 'development', { value: platform.isDevelopment === true });
    this.store = createStore(platform.storage, { development: this.development });
    this.sound = createSound(platform);
    this.gameCircle = createGameCircle(platform, config.GAME_CIRCLE_OPENLINK, message => this.toast(message));
    this.rankingProfile = null; this.friendResumeRevision = 0;
    const rankingAllowed = () => !this.hidden && !!this.rankingAuthorization && this.rankingAuthorization.getState().enabled;
    this.friendLeaderboard = createFriendLeaderboard(platform, config,
      { canSync: rankingAllowed, canShow: rankingAllowed,
        canPreview: () => !this.hidden && !!this.rankingAuthorization && this.rankingAuthorization.getState().canDisplay });
    this.rankingAuthorization = createRankingAuthorization(platform, {
      onProfile: profile => { this.rankingProfile = profile; this.syncFriendScore(); return true; },
      onReady: result => {
        if (this.hidden || this.page !== 'leaderboard') return;
        // Recheck friend permission before a changed profile can dispatch a score.
        this.openFriendLeaderboard({ automatic: true, checked: result && result.authSetting });
      }
    });
    this.ads = createAds(platform, config, active => {
      if (active) this.sound.suspend('ad');
      else { this.syncMusic(); this.sound.resume('ad'); }
    });
    this.musicActive = false; this.cueCount = 0;
    this.renderer = new Renderer(platform.canvas);
    this.camera = new SceneCamera();
    this.cameraMovedAt = -Infinity;
    this.startupPublication = publicationLines(config.PUBLICATION_INFO);
    this.startup = new StartupLoader([
      { label: '正在整理本机进度', run: () => this.profile() },
      { label: '正在准备上次路线', run: () => this.savedRun() },
      { label: '正在整理邮票收藏', run: () => this.album() },
      { label: '正在准备首页', run: () => this.nextLevel() }
    ]);
    this.startupLastAt = null; this.startupPublicationMs = 0;
    this.startupPublicationPage = 0; this.startupPublicationPages = 0;
    this.page = 'startup'; this.collectionScroll = new ListScroll(); this.levelScroll = new ListScroll(); this.modal = null; this.reviewing = false;
    this.guideEnabled = false;
    this.mechanicGuide = null;
    this.level = null; this.state = null; this.actions = []; this.reviveAt = null; this.undosUsed = 0;
    this.mode = 'campaign'; this.session = 0;
    this.toastText = ''; this.toastUntil = 0; this.transitionAt = 0; this.motionPath = null;
    this.busy = false; this.hidden = false; this.lastFrame = -Infinity; this.pointer = null; this.pendingAction = null; this.blockedAt = null;
    this.metrics = { ...platform.resize() };
    platform.onResize(() => { this.cancelRankingPointer(); this.stopListScrolling(); this.camera.stopShake(); this.pointer = null; this.pendingAction = null; this.setMetrics(platform.resize()); this.lastFrame = -Infinity; });
    platform.onPointer((x, y, type) => this.pointerEvent(x, y, type), (x, y, factor, pan) => this.zoomScene(x, y, factor, pan), (x, y, delta) => this.scrollList(x, y, delta));
    platform.onKey(key => {
      if (this.startupActive()) return;
      this.unlockAudio();
      if (this.development && this.modal && this.modal.kind === 'developer-level') { this.developmentKey(key); return; }
      if (this.rankingInteractive()) {
        const delta = { ArrowUp: -100, ArrowDown: 100, PageUp: -340, PageDown: 340, ' ': 340 }[key];
        if (key === 'Home' || key === 'End') {
          if (this.pointer && this.pointer.ranking) this.cancelRankingPointer();
          this.friendLeaderboard.scroll(key === 'Home' ? 'start' : 'end', this.platform.now()); return;
        }
        if (delta) {
          if (this.pointer && this.pointer.ranking) this.cancelRankingPointer();
          this.friendLeaderboard.wheel(delta, this.platform.now()); return;
        }
      }
      const scroll = this.listScroll();
      if (scroll && !this.modal && !this.busy) {
        const delta = { ArrowUp: -100, ArrowDown: 100, PageUp: -340, PageDown: 340, ' ': 340 }[key];
        if (key === 'Home' || key === 'End') { this.pointer = null; scroll.stop(); scroll.offset = key === 'Home' ? 0 : scroll.max; return; }
        if (delta) { this.pointer = null; scroll.wheel(delta, this.platform.now()); return; }
      }
      if (key === 'Escape') { if (!this.busy && this.page === 'game') this.pause(); return; }
      let action = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'wait', Space: 'wait' }[key];
      if (action && action !== 'wait' && this.page === 'game' && this.renderer.boardProjection) {
        action = this.renderer.boardProjection.direction(...DIRECTIONS[action]);
      }
      if (action) this.act(action);
      else if (key === 'z' || key === 'Backspace') this.undo();
    });
    platform.onHide(() => {
      this.startupLastAt = null;
      this.friendResumeRevision++;
      this.cancelRankingPointer();
      this.friendLeaderboard.suspend();
      this.rankingAuthorization.hide();
      this.hidden = true; this.stopListScrolling(); this.camera.stopShake(); this.pointer = null; this.pendingAction = null; this.persist();
      this.sound.suspend('hidden'); this.syncMusic();
      if (this.frameId != null) platform.cancelRaf(this.frameId);
      this.frameId = null;
      this.renderer.clearCaches();
      if (this.page === 'game' && this.state.status === 'playing' && !this.modal && !this.busy) this.pause();
    });
    platform.onShow(() => {
      this.startupLastAt = null;
      this.hidden = false;
      if (this.page === 'leaderboard') this.rankingAuthorization.show();
      const token = ++this.friendResumeRevision;
      const checking = this.rankingAuthorization.revalidate();
      if (this.page === 'leaderboard') this.previewRanking();
      checking.then(settings => {
        if (token !== this.friendResumeRevision || this.hidden) return;
        if (!settings) {
          if (!this.rankingAuthorization.getState().canDisplay) this.friendLeaderboard.revalidate(null);
          return;
        }
        if (!this.rankingAuthorization.getState().enabled) { this.friendLeaderboard.revalidate(null); return; }
        if (!this.friendLeaderboard.revalidate(settings)) return;
        this.syncFriendScore();
        if (this.page === 'leaderboard') this.friendLeaderboard.refresh(); else this.friendLeaderboard.retry();
      });
      this.pointer = null; this.setMetrics(platform.resize()); this.lastFrame = -Infinity;
      this.syncMusic(); this.sound.resume('hidden');
      if (this.frameId == null) this.loop();
    });
    if (platform.onMemoryWarning) platform.onMemoryWarning(() => {
      this.cancelRankingPointer();
      this.stopListScrolling();
      this.pointer = null; this.pendingAction = null;
      this.renderer.clearCaches(); this.sound.release();
      this.musicActive = false;
      this.profileCache = null; this.runCache = null; this.albumCache = null;
      this.metrics = platform.reduceMemory(); this.lastFrame = -Infinity;
    });
    enableSharing(platform, config);
    this.loop();
  }
  startupActive() { return this.page === 'startup' || this.page === 'publication'; }
  setMetrics(metrics) {
    if (this.page === 'publication' && ['width', 'height', 'safeTop', 'safeBottom'].some(key => metrics[key] !== this.metrics[key])) {
      // A new line wrap can redistribute text across pages; show all of it again.
      this.startupPublicationPage = 0; this.startupPublicationPages = 0;
      this.startupPublicationMs = 0; this.startupLastAt = null;
    }
    this.metrics = { ...metrics };
  }
  updateStartup(now) {
    if (!this.startupActive()) return;
    // Never count time in the background or skip the initial 0% paint.
    if (this.startupLastAt === null) { this.startupLastAt = now; return; }
    const dt = Math.max(0, Math.min(100, now - this.startupLastAt));
    this.startupLastAt = now;
    if (this.page === 'startup') {
      this.startup.update(dt);
      if (this.startup.ready) this.finishStartup();
    } else if (this.startupPublicationPages > 0) {
      this.startupPublicationMs += dt;
      if (this.startupPublicationMs >= 2500) {
        if (this.startupPublicationPage + 1 < this.startupPublicationPages) {
          this.startupPublicationPage++; this.startupPublicationMs = 0;
        }
        else this.finishStartup();
      }
    }
  }
  retryStartup() {
    if (this.page !== 'startup' || this.hidden || !this.startup.error) return;
    this.startup.retry(); this.startupLastAt = null;
    this.pointer = null; this.renderer.hits = []; this.lastFrame = -Infinity;
  }
  finishStartup() {
    if (!this.startupActive() || this.hidden || this.busy || !this.startup.ready) return false;
    if (this.page === 'publication' && (this.startupPublicationMs < 2500 || this.startupPublicationPage + 1 < this.startupPublicationPages)) return false;
    this.page = this.page === 'startup' && this.startupPublication.length ? 'publication' : 'home';
    // The same pointer release must never activate a button on the next page.
    this.pointer = null; this.pendingAction = null; this.renderer.hits = [];
    this.lastFrame = -Infinity;
    if (!this.startupActive()) this.syncMusic();
    return true;
  }
  /** Snapshots are cloned by the store; reuse one per store revision so a frame never clones the save hundreds of times. */
  profile() {
    const revision = this.store.revision();
    if (!this.profileCache || this.profileCache.revision !== revision) this.profileCache = { revision, value: this.store.getProfile() };
    return this.profileCache.value;
  }
  savedRun() {
    const revision = this.store.revision();
    if (!this.runCache || this.runCache.revision !== revision) this.runCache = { revision, value: this.store.loadRun() };
    return this.runCache.value;
  }
  album() {
    const revision = this.store.revision();
    if (!this.albumCache || this.albumCache.revision !== revision) this.albumCache = { revision, value: getAlbum(this.profile()) };
    return this.albumCache.value;
  }
  playHint() { return playHint(this, this.platform.now()); }
  guideStep() { return mechanicStep(this) || guideStep(this, this.platform.now()); }
  canShowGuide() { return canGuide(this.level, this.mode) || availableMechanics(this.level, this.mode).length > 0; }
  advanceMechanicGuide(skip = false) {
    if (this.page !== 'game' || this.modal || this.busy || this.hidden || !mechanicStep(this)) return false;
    const lesson = this.mechanicGuide, id = lesson.ids[0];
    this.pendingAction = null; this.pointer = null; this.blockedAt = null; this.toastUntil = 0;
    if (lesson.phase === 0 && !skip) lesson.phase = 1;
    else {
      this.store.markMechanicSeen(id);
      lesson.ids.shift(); lesson.phase = 0;
      if (!lesson.ids.length) this.mechanicGuide = null;
      if (skip) this.toast('已跳过' + NAMES[id] + '讲解，可从“操作引导”重看');
    }
    this.renderer.hits = []; this.persist(); this.lastFrame = -Infinity;
    return true;
  }
  inspectGuideCell(cell) {
    const guide = mechanicStep(this);
    if (!guide || this.modal || this.busy || this.hidden) return false;
    if (cell === guide.visual.tapCell) this.advanceMechanicGuide();
    else this.guideMisstep();
    return true;
  }
  dismissGuide() {
    if (mechanicStep(this)) { this.advanceMechanicGuide(true); return; }
    this.pendingAction = null; this.guideEnabled = false;
    this.store.setGuideDismissed(true);
    this.persist();
    this.toast('已跳过引导，点上方“操作引导”可重新开启');
  }
  showGuide() {
    if (!this.canShowGuide() || this.page !== 'game' || this.busy || !this.state || this.state.status !== 'playing') return;
    this.pendingAction = null; this.pointer = null; this.blockedAt = null; this.toastUntil = 0;
    if (!canGuide(this.level, this.mode)) {
      this.mechanicGuide = createMechanicGuide(this.profile(), this.level, this.mode, null, true);
      this.modal = null; this.reviewing = false; this.persist(); this.syncMusic(); return;
    }
    this.store.setGuideDismissed(false);
    this.guideEnabled = true; this.modal = null; this.reviewing = false; this.persist(); this.syncMusic();
  }
  restartGuide() {
    if (!canGuide(this.level, this.mode) || this.page !== 'game' || this.busy || this.hidden) return;
    this.start(this.level, this.mode); this.showGuide();
  }
  guideMisstep() {
    const guide = this.guideStep();
    if (!guide) return false;
    this.pendingAction = null; this.blockedAt = this.platform.now();
    if (guide.kind === 'mechanic') { this.toast('先点手指指向的道具或下方按钮；讲解不扣拍。'); return true; }
    this.toast(guide.control === 'undo' ? '先点下方“撤回”，恢复拍数后继续学。'
      : guide.control === 'restart' ? '点下方“重新学一遍”，从起点跟着走。'
      : guide.control === 'wait' ? '点下方“等一拍”，让回声继续走。'
      : '直接点手指指向的亮格，不用先选人物。');
    return true;
  }
  record(level, mode) {
    const p = this.profile();
    return p.completed[String(level.id)];
  }
  completion() { return Object.keys(this.profile().completed).length; }
  starCount() { return Object.values(this.profile().completed).reduce((n, c) => n + c.stars, 0); }
  unlocked(index) {
    if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN.length) return false;
    return this.development || index === 0 || !!this.profile().completed[String(CAMPAIGN[index - 1].id)];
  }
  selectLevel(id) {
    if (this.hidden || this.busy || !Number.isInteger(id) || !this.unlocked(id - 1)) return false;
    if (this.modal && this.modal.kind !== 'developer-level') return false;
    const saved = this.savedRun();
    if (saved && saved.levelId === id && this.restore()) return true;
    this.start(CAMPAIGN[id - 1], 'campaign');
    return true;
  }
  openDevelopmentPicker() {
    if (!this.development || this.page !== 'levels' || this.busy || this.hidden || this.modal) return false;
    this.pointer = null; this.stopListScrolling(); this.toastUntil = 0;
    this.modal = { kind: 'developer-level', digits: '', error: '' }; this.syncMusic();
    return true;
  }
  developmentKey(key) {
    if (!this.development || !this.modal || this.modal.kind !== 'developer-level' || this.hidden || this.busy) return false;
    const modal = this.modal;
    if (typeof key === 'string' && /^\d$/.test(key)) {
      if (modal.digits.length < 4) modal.digits += key;
      modal.error = modal.digits.length > 3 ? '关卡编号不能超过 ' + CAMPAIGN.length : '';
    } else if (key === 'Backspace') { modal.digits = modal.digits.slice(0, -1); modal.error = ''; }
    else if (key === 'Delete') { modal.digits = ''; modal.error = ''; }
    else if (key === 'Escape') { this.modal = null; this.syncMusic(); }
    else if (key === 'Enter') {
      const id = developmentLevelNumber(modal.digits);
      if (id === null) { modal.error = '请输入 1–' + CAMPAIGN.length + ' 的整数'; return false; }
      return this.selectLevel(id);
    }
    return true;
  }
  nextLevel() {
    const completed = this.profile().completed;
    return CAMPAIGN.find((l, i) => (i === 0 || !!completed[String(CAMPAIGN[i - 1].id)]) && !completed[String(l.id)]) || CAMPAIGN[CAMPAIGN.length - 1];
  }
  toast(message) { this.toastText = message; this.toastUntil = this.platform.now() + 2600; }
  cue(type) {
    this.cueCount++;
    if (!this.hidden && !this.busy && !this.startupActive()) this.sound.play(type);
  }
  unlockAudio() {
    if (this.hidden || this.busy || this.startupActive()) return;
    this.syncMusic(true); this.sound.unlock();
  }
  syncMusic(force = false) {
    const enabled = !this.hidden && !this.busy && !this.modal && !this.startupActive();
    if (force || enabled !== this.musicActive) { this.musicActive = enabled; this.sound.ambience(enabled); }
  }
  persist() {
    if (this.state && this.state.status !== 'won') this.store.saveRun({ mode: this.mode, levelId: this.level.id, revision: this.level.revision || '1', actions: this.actions.slice(), reviveAt: this.reviveAt, undosUsed: this.undosUsed,
      ...(this.mechanicGuide ? { mechanicGuide: { id: this.mechanicGuide.ids[0], phase: this.mechanicGuide.phase, repeat: this.mechanicGuide.repeat } } : {}),
      ...(this.guideEnabled ? { guide: true } : {}) });
    else this.store.flush();
  }
  restore() {
    if (this.startupActive()) return false;
    this.cancelRankingPointer();
    this.pendingAction = null; this.blockedAt = null;
    const run = this.store.loadRun();
    if (!run) return false;
    try {
      if (!Array.isArray(run.actions) || run.actions.length > 4096) throw new Error('invalid history');
      if (run.mode !== 'campaign') throw new Error('invalid mode');
      const level = CAMPAIGN.find(l => l.id === run.levelId);
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
      this.mode = run.mode; this.page = 'game'; this.session++;
      this.guideEnabled = autoGuide(this.profile(), level, this.mode) ||
        (canGuide(level, this.mode) && run.guide === true && !this.profile().guideDismissed);
      this.mechanicGuide = createMechanicGuide(this.profile(), level, this.mode, run.mechanicGuide,
        !!run.mechanicGuide && run.mechanicGuide.repeat === true);
      this.pointer = null; this.camera.enter(this.platform.now());
      this.modal = null; this.reviewing = false;
      if (state.status === 'failed') this.failure();
      else { this.cue('start'); this.toast('已接上上次的风，继续投递吧'); }
      return true;
    } catch (_) { this.store.clearRun(); this.toast('旧进度无法恢复，已保留通关记录'); return false; }
  }
  start(level, mode = 'campaign') {
    if (this.busy || this.startupActive() || mode !== 'campaign') return;
    this.cancelRankingPointer();
    const keepGuide = this.guideEnabled && this.level === level && this.state && this.state.status !== 'won';
    this.stopListScrolling(); this.pointer = null;
    this.pendingAction = null; this.blockedAt = null;
    this.level = level; this.mode = mode || 'campaign';
    this.guideEnabled = canGuide(level, this.mode) && (keepGuide || autoGuide(this.profile(), level, this.mode));
    this.mechanicGuide = createMechanicGuide(this.profile(), level, this.mode);
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
    const guide = this.guideStep();
    if (guide && action !== guide.action) { this.guideMisstep(); return; }
    if (now - this.transitionAt < MOVE_MS) { this.pendingAction = guide ? null : { action, at: now }; return; }
    this.pendingAction = null;
    const result = step(this.level, this.state, action);
    if (!result.moved) {
      if (this.blockedAt === null || now - this.blockedAt >= 300) this.cue('blocked');
      this.blockedAt = now; return;
    }
    this.blockedAt = null;
    if (guide) this.toastUntil = 0;
    this.previousState = this.state; this.state = result.state;
    this.actions.push(action); this.transitionAt = now;
    this.moveEvents = result.events; this.motionPath = null;
    const feedback = turnFeedback(result.events, this.previousState, this.state);
    feedback.sounds.forEach(type => this.cue(type));
    if (feedback.haptic) {
      this.camera.shake(now, this.state.status === 'won' ? 1 : .6);
      this.platform.vibrate();
    }
    this.persist();
    if (this.state.status === 'won') this.victory();
    else if (this.state.status === 'failed') this.failure();
    else if (this.state.player === this.level.exit && (this.state.letters.length || this.state.seals.length)) this.toast(this.playHint());
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
    if (mechanicStep(this)) { this.guideMisstep(); return; }
    if (this.page !== 'game' || this.modal || this.busy || this.reviewing || !this.state || this.state.status !== 'playing') return;
    if (this.undoLeft() <= 0) { this.toast('本程的 ' + this.undoLimit() + ' 次回溯已用完'); return; }
    if (!this.actions.length) { this.toast('已经在起点了'); return; }
    if (this.reviveAt != null && this.actions.length <= this.reviveAt) { this.toast('续灯之前的路，回不去了'); return; }
    const actions = this.actions.slice(0, -1);
    let state;
    try { state = replay(this.level, actions, this.reviveAt); } catch (_) { return; }
    const undone = step(this.level, state, this.actions[this.actions.length - 1]);
    this.motionPath = [state.player, ...undone.events.filter(event => event.type === 'move' || event.type === 'wind').map(event => event.cell)].reverse();
    this.camera.stopShake();
    this.previousState = this.state; this.state = state; this.actions = actions; this.undosUsed += 1;
    this.moveEvents = [{ type: 'undo', cell: state.player }]; this.transitionAt = this.platform.now(); this.persist(); this.cue('undo');
  }
  victory() {
    this.pendingAction = null; this.toastUntil = 0;
    const albumBefore = this.album();
    const rating = stars(this.level, this.state), before = this.record(this.level, this.mode);
    this.store.recordWin(this.level.id, rating, this.state.turn, this.mode);
    this.syncFriendScore();
    this.store.clearRun();
    const index = CAMPAIGN.findIndex(l => l.id === this.level.id);
    const candidate = index >= 0 ? CAMPAIGN[index + 1] : null;
    const next = this.mode === 'campaign' ? candidate : null;
    const saved = this.store.getStatus().persisted;
    const saveLine = saved ? '本次纪录已保存。' : '本次纪录仅在本次运行保留。';
    const bestLine = !before ? saveLine : this.state.turn < before.bestTurns ? '刷新纪录，比上次少走 ' + (before.bestTurns - this.state.turn) + ' 拍。' : this.state.turn === before.bestTurns ? '追平个人最佳 · ' + before.bestTurns + ' 拍' : '个人最佳 ' + before.bestTurns + ' 拍 · 本次多走 ' + (this.state.turn - before.bestTurns) + ' 拍';
    const lines = [this.state.turn + ' 拍完成' + (this.state.revived ? ' · 续灯最高二星' : ''), bestLine];
    if (this.guideEnabled && canGuide(this.level, this.mode)) {
      lines.push('你收信；回声晚 3 次行动，替你收蓝票。', '收齐信和票，再走进邮局就能过关。');
    }
    if (before && !saved) lines.push(saveLine);
    const rewards = this.album().stamps.filter(stamp => stamp.owned && !albumBefore.stamps[stamp.index].owned);
    if (rewards.length) lines.push(rewards.length > 1 ? '收到 ' + rewards.length + ' 枚新邮票' : '收到新邮票「' + rewards[0].name + '」');
    this.modal = {
      kind: 'win', title: '信已送达', stars: rating,
      lines,
      buttons: [
        { text: next ? '下一封信' : '返回邮局', primary: true, action: () => next ? this.start(next, this.mode) : this.home() },
        { text: '再走一次', textOnly: true, icon: 'restart', action: () => this.start(this.level, this.mode) },
        ...(rewards.length ? [{ text: '看看邮票册', textOnly: true, icon: 'stamp', action: () => this.openPage('collection') }] : [])
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
      lines: [remaining.length ? '还差 ' + remaining.join(' / ') : '信笺和邮票已收齐', this.failureHint(),
        ...(canRevive ? ['续灯保留路线与收集，本次最高二星。'] : [])],
      buttons: [
        ...(canRevive ? [{ text: '看视频续灯 +' + Math.max(8, Math.ceil(this.level.budget * .5)) + ' 拍 · 接着送', primary: true, icon: 'lamp', action: () => this.requestRevive() }] : []),
        { text: '重新规划 · 免费再试', primary: !canRevive, icon: 'restart', action: () => this.start(this.level, this.mode) },
        { text: '看看刚才的路线', icon: 'route', action: () => { this.modal = null; this.reviewing = true; } },
        { text: '返回邮局', textOnly: true, action: () => this.home() }
      ]
    };
  }
  async requestRevive() {
    if (this.hidden || this.busy || this.ads.isActive() || !this.state || this.state.status !== 'failed' || this.state.revived) return;
    if (this.platform.kind !== 'wechat') return;
    if (!this.ads.isConfigured()) {
      this.toast(config.REWARDED_AD_UNIT_ID ? '当前环境暂不支持激励视频，可直接重新出发' : '激励视频尚未配置，可直接重新出发'); return;
    }
    this.busy = true; const session = this.session;
    this.modal = { title: '正在连接广告', kicker: 'RELIGHT YOUR LANTERN', lines: ['请稍候，完成视频后将回到这条路线。'], buttons: [] };
    this.sound.suspend('ad'); this.syncMusic();
    let result;
    try { result = await this.ads.showRevive(); } catch (_) { result = { rewarded: false, reason: 'error' }; }
    this.busy = false;
    if (session === this.session) {
      if (result.rewarded) this.applyRevive();
      else {
        this.failure();
        this.toast(result.reason === 'cancelled' ? '视频未看完，可重试或重新出发' : '广告暂时不可用，请稍后再试或重新出发');
      }
    }
    this.syncMusic();
    if (!this.ads.isActive()) this.sound.resume('ad');
  }
  applyRevive() {
    const next = revive(this.level, this.state);
    if (next === this.state || next.status !== 'playing') return;
    this.state = next; this.previousState = null; this.reviveAt = this.actions.length;
    this.moveEvents = []; this.motionPath = null; this.transitionAt = this.platform.now() - MOVE_MS;
    this.modal = null; this.reviewing = false; this.persist(); this.cue('light'); this.toast('风灯重新亮起，沿途收集已保留');
  }
  pause() {
    this.pendingAction = null;
    this.camera.stopShake();
    if (this.busy) return;
    if (this.reviewing) { this.failure(); return; }
    if (this.modal && this.modal.kind === 'pause') { this.modal = null; this.syncMusic(); return; }
    if (!this.state || this.state.status !== 'playing') return;
    const saveLine = this.store.getStatus().persisted ? '路线已自动保存，没有倒计时。' : '没有倒计时。路线仅在本次运行保留。';
    this.modal = { kind: 'pause', title: '歇一会', lines: [saveLine], buttons: [
      { text: '继续投递', primary: true, action: () => { this.modal = null; this.syncMusic(); } },
      { text: '重新开始', icon: 'restart', action: () => this.start(this.level, this.mode) },
      ...(this.canShowGuide() ? [{ text: '操作引导', textOnly: true, icon: 'route', action: () => this.showGuide() }] : []),
      { text: '玩法说明', textOnly: true, icon: 'book', action: () => this.help() },
      { text: '返回邮局', textOnly: true, action: () => this.home() }
    ] };
    this.sound.stop(); this.musicActive = false;
  }
  help() {
    this.cancelRankingPointer();
    this.pendingAction = null;
    const old = this.modal, l = this.page === 'game' ? this.level : null;
    const lines = ['点相邻亮格移动，点脚下格或“等一拍”等待。', '你收橙色信笺，晚三拍的回声收蓝色邮票。', '全部收齐后，走到邮局即可过关。'];
    if (l) {
      lines.push(this.state.revived ? '本次已续灯，最高二星；' + (l.par + STAR_TWO_MARGIN) + ' 拍内得二星。'
        : '评分：' + l.par + ' 拍内三星，' + (l.par + STAR_TWO_MARGIN) + ' 拍内二星。');
      lines.push('双指捏合缩放，放大后拖动；电脑用滚轮。');
    }
    if (l && Object.keys(l.winds).length) lines.push('箭头会再推一格，等待不会触发风。');
    if (l && l.lights.length) lines.push('每盏风灯只补一次，共 3 拍。');
    if (l && (l.bridges || []).length) lines.push('纸桥离开后就碎，回声可以通过。');
    this.modal = { kind: 'help', title: '和回声一起送信', lines,
      buttons: [{ text: '明白了', primary: true, action: () => { this.modal = old; } }] };
  }
  home() { if (this.busy || this.startupActive()) return; this.cancelRankingPointer(); this.rankingAuthorization.close(); this.friendLeaderboard.close(); this.pendingAction = null; this.persist(); this.modal = null; this.reviewing = false; this.page = 'home'; this.pointer = null; this.stopListScrolling(); this.session++; }
  openGameCircle() {
    if (!this.gameCircle.available || this.page !== 'home' || this.busy || this.hidden || this.modal) return;
    this.cue('tap');
    return this.gameCircle.open();
  }
  openPage(page) {
    if (this.busy || this.startupActive() || !['home', 'levels', 'collection', 'leaderboard'].includes(page)) return;
    this.cancelRankingPointer();
    this.rankingAuthorization.close();
    this.friendLeaderboard.close();
    this.pendingAction = null; this.persist(); this.page = page; this.modal = null; this.reviewing = false; this.pointer = null; this.stopListScrolling();
    if (page === 'levels') this.scrollToProgress();
    if (page === 'collection') this.collectionScroll.reset(this.platform.now());
    if (page === 'leaderboard') {
      this.rankingAuthorization.open().then(() => {
        const state = this.rankingAuthorization.getState();
        if (this.page === 'leaderboard' && !this.hidden && !state.enabled && !state.canDisplay) this.friendLeaderboard.revalidate(null);
      });
      this.previewRanking();
    }
    this.cue('tap');
  }
  syncFriendScore() {
    if (this.hidden || !this.rankingAuthorization.getState().enabled) return;
    return this.friendLeaderboard.submit(campaignScore(this.profile(), this.rankingProfile));
  }
  previewRanking() {
    if (!this.rankingAuthorization.getState().canDisplay) return false;
    return this.friendLeaderboard.preview({ width: 354, height: leaderboardRect(this.renderer.H).h,
      pixelRatio: Math.min(2, (this.metrics.pixelRatio || 1) * this.renderer.scale) });
  }
  openFriendLeaderboard(options) {
    if (this.hidden || !this.rankingAuthorization.getState().enabled) return;
    // openSetting must originate from the visible "去授权" button itself.
    if (options && options.automatic && this.friendLeaderboard.getState().status === 'denied' &&
      !(options.checked && options.checked['scope.WxFriendInteraction'] === true)) return;
    this.cancelRankingPointer();
    const rect = leaderboardRect(this.renderer.H);
    const opening = this.friendLeaderboard.open({ width: rect.w, height: rect.h, pixelRatio: Math.min(2, (this.metrics.pixelRatio || 1) * this.renderer.scale) }, options && options.checked);
    this.syncFriendScore();
    return opening;
  }
  listScroll() { return this.page === 'collection' ? this.collectionScroll : this.page === 'levels' ? this.levelScroll : null; }
  listRect() { return this.page === 'collection' ? this.renderer.collectionRect : this.page === 'levels' ? this.renderer.levelRect : null; }
  rankingInteractive() {
    return this.page === 'leaderboard' && !this.hidden && !this.modal && !this.busy &&
      (this.rankingAuthorization.getState().enabled && this.friendLeaderboard.getState().status === 'ready' ||
        this.rankingAuthorization.getState().canDisplay && this.friendLeaderboard.getState().status === 'preview');
  }
  cancelRankingPointer() {
    const pointer = this.pointer;
    if (pointer && pointer.ranking) this.pointer = null;
    // A cancellation also stops the child's inertia/landing when a modal,
    // pinch, resize or lifecycle event takes over without an active finger.
    if (this.page === 'leaderboard' || pointer && pointer.ranking) {
      const rect = pointer && pointer.ranking || leaderboardRect(this.renderer.H);
      this.friendLeaderboard.pointer('cancel', pointer && pointer.ranking ? pointer.lastX - rect.x : 0,
        pointer && pointer.ranking ? pointer.lastY - rect.y : 0, this.platform.now());
    }
  }
  stopListScrolling() { this.collectionScroll.stop(); this.levelScroll.stop(); }
  scrollToProgress() {
    if (this.page !== 'levels') return;
    const now = this.platform.now(), scroll = this.levelScroll;
    this.pointer = null; scroll.reset(now);
    scroll.setBounds(levelListLayout(this.renderer.H).maxScroll);
    scroll.offset = levelProgressOffset(this.nextLevel(), this.renderer.H);
    scroll.activeAt = now;
  }
  scrollList(x, y, delta) {
    if (this.rankingInteractive()) {
      const p = this.renderer.toLogical(x, y), rect = leaderboardRect(this.renderer.H);
      if (!insideRect(rect, p.x, p.y)) return false;
      if (this.pointer && this.pointer.ranking) this.cancelRankingPointer();
      return this.friendLeaderboard.wheel(delta / this.renderer.scale, this.platform.now());
    }
    const scroll = this.listScroll();
    if (!scroll || this.modal || this.busy || this.hidden) return false;
    const p = this.renderer.toLogical(x, y), rect = this.listRect();
    if (!rect || !insideRect(rect, p.x, p.y)) return false;
    this.pointer = null; scroll.wheel(delta / this.renderer.scale, this.platform.now());
    return true;
  }
  zoomScene(x, y, factor, pan = { dx: 0, dy: 0 }) {
    this.cancelRankingPointer();
    if (this.page !== 'game' || this.modal || this.busy || this.hidden) return;
    const p = this.renderer.toLogical(x, y), b = this.renderer.boardRect;
    if (!b || !insideRect(b, p.x, p.y)) return;
    this.pointer = null; this.pendingAction = null;
    const dx = pan.dx / this.renderer.scale / b.w, dy = pan.dy / this.renderer.scale / b.h;
    this.camera.zoomAt(factor, (p.x - b.x - b.w / 2) / b.w - dx, (p.y - b.y - b.h / 2 - 4) / b.h - dy, dx, dy);
    this.cameraMovedAt = this.platform.now();
  }
  pointerEvent(x, y, type) {
    if (this.hidden) { this.cancelRankingPointer(); return; }
    const p = this.renderer.toLogical(x, y);
    if (type === 'cancel') { this.cancelRankingPointer(); this.pointer = null; this.pendingAction = null; this.stopListScrolling(); return; }
    if (type !== 'start' && this.pointer && this.pointer.ranking) {
      if (!this.rankingInteractive()) { this.cancelRankingPointer(); return; }
      const origin = this.pointer, rect = origin.ranking;
      origin.lastX = p.x; origin.lastY = p.y;
      this.friendLeaderboard.pointer(type, p.x - rect.x, p.y - rect.y, this.platform.now());
      if (type === 'end') this.pointer = null;
      return;
    }
    if (type === 'start') {
      this.unlockAudio();
      if (this.pointer && this.pointer.ranking) this.cancelRankingPointer();
      const ranking = this.rankingInteractive() && leaderboardRect(this.renderer.H);
      if (ranking && insideRect(ranking, p.x, p.y)) {
        this.pointer = null;
        if (this.friendLeaderboard.pointer('start', p.x - ranking.x, p.y - ranking.y, this.platform.now()))
          this.pointer = { ...p, lastX: p.x, lastY: p.y, ranking };
        return;
      }
      const b = this.renderer.boardRect;
      const rect = this.listRect(), scroll = this.listScroll();
      const list = scroll && !this.modal && !this.busy && rect && insideRect(rect, p.x, p.y) ? this.page : null;
      if (list) scroll.begin(p.y, this.platform.now());
      this.pointer = { ...p, deviceX: x, deviceY: y, list, lastX: p.x, lastY: p.y, time: this.platform.now(), dragging: false,
        scene: this.page === 'game' && !this.modal && !this.busy && !this.hidden && b && insideRect(b, p.x, p.y) };
      if (this.pointer.scene) {
        this.pointer.boardTap = captureBoardTap(this.renderer, p);
        this.pointer.boardState = this.state;
      }
      return;
    }
    if (this.pointer && this.pointer.list && (type === 'move' || type === 'end')) {
      if (this.page !== this.pointer.list || this.modal || this.busy) { this.pointer = null; this.stopListScrolling(); return; }
      const scroll = this.listScroll();
      scroll.move(p.y, this.platform.now(), Math.abs(p.x - this.pointer.x) > 6);
      this.pointer.dragging = scroll.dragged;
      if (type === 'move') return;
      if (scroll.end(this.platform.now())) { this.pointer = null; return; }
    }
    if (this.pointer && this.pointer.scene && (type === 'move' || type === 'end')) {
      const origin = this.pointer, b = this.renderer.boardRect;
      if (!b || this.modal || this.busy || this.hidden || this.page !== 'game') { this.pointer = null; return; }
      if (origin.dragging || Math.hypot(x - origin.deviceX, y - origin.deviceY) > BOARD_DRAG_SLOP) {
        origin.dragging = true; this.pendingAction = null;
        this.camera.pan((p.x - origin.lastX) / b.w, (p.y - origin.lastY) / b.h);
        this.cameraMovedAt = this.platform.now();
        origin.lastX = p.x; origin.lastY = p.y;
        if (type === 'end') this.pointer = null;
        return;
      }
    }
    if (type !== 'end' || !this.pointer) return;
    const origin = this.pointer; this.pointer = null;
    const dx = p.x - origin.x, dy = p.y - origin.y;
    if (!origin.scene && Math.max(Math.abs(dx), Math.abs(dy)) > 25) return;
    // A short finger release retains its pressed cell even if the floor or prop
    // moved during a draw. A queued turn changing the board cancels stale presses.
    if (origin.scene && origin.boardState !== this.state) return;
    const pressed = origin.scene && origin.boardTap && insideRect(this.renderer.boardRect, p.x, p.y) ? origin.boardTap : null;
    const hit = pressed || this.renderer.hits.slice().reverse().find(h => containsHit(h, p) && containsHit(h, origin));
    if (hit) {
      const cues = this.cueCount;
      hit.action(p, origin);
      if (!origin.scene && cues === this.cueCount) this.cue('tap');
      this.syncMusic();
    } else if (origin.scene) this.guideMisstep();
  }
  loop() {
    if (this.hidden) return;
    if (this.page === 'leaderboard' && !this.rankingAuthorization.getState().canDisplay &&
        !this.rankingAuthorization.getState().enabled && ['ready', 'preview'].includes(this.friendLeaderboard.getState().status))
      this.friendLeaderboard.revalidate(null);
    if (this.pointer && this.pointer.ranking && !this.rankingInteractive()) this.cancelRankingPointer();
    const now = this.platform.now();
    this.updateStartup(now);
    this.syncMusic();
    if (this.pendingAction && now - this.transitionAt >= MOVE_MS) {
      const pending = this.pendingAction; this.pendingAction = null;
      if (now - pending.at <= 500) this.act(pending.action);
    }
    const smoothList = !!this.listScroll() && !this.modal;
    const smoothScene = this.page === 'game' && !this.modal && (
      now - this.transitionAt < MOVE_MS || now - this.camera.enteredAt < INTRO_MS ||
      now - this.camera.shakeAt < SHAKE_MS || now - this.cameraMovedAt < 250 || !!this.pointer);
    const smooth = smoothList || smoothScene || this.rankingInteractive();
    if (this.platform.setFrameRate) this.platform.setFrameRate(smooth ? 60 : 30);
    // Use every native RAF during a gesture or movement; quiet scenes return to 30 FPS.
    const frameInterval = this.platform.kind === 'wechat' ? smooth ? 0 : 1000 / 30 : 16;
    if (now - this.lastFrame >= frameInterval - .5) { this.renderer.draw(this, now, this.metrics); this.lastFrame = now; }
    this.frameId = this.platform.raf(() => this.loop());
  }
}

new Game(createPlatform());
