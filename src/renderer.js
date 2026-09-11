'use strict';
const { C } = require('./theme');
const { drawPanel, drawMeter } = require('./ui-surface');
const { drawCourier } = require('./courier-art');
const { CONTROL, drawButton } = require('./controls');
const { drawUiIcon, UI_ICON } = require('./ui-icons');
const { drawHome } = require('./home-view');
const { drawStartup, drawPublication } = require('./startup-view');
const { drawGame } = require('./game-view');
const { drawLevels, levelBrowserChapter } = require('./level-view');
const { drawCollection } = require('./collection-view');
const { drawStampDetail } = require('./stamp-detail-view');
const { drawLeaderboard } = require('./leaderboard-view');
const { drawSettings } = require('./settings-view');
const { drawModal } = require('./modal-view');
const { RESULT_DELAY_MS } = require('./result-effects');
const { drawDeveloperPicker } = require('./developer-view');
const { drawBackdrop } = require('./scene');
const { atmosphereTreatment, drawAmbientOverlay } = require('./ambient-effects');
const { chapterNames } = require('./levels');
const { chapterMood } = require('./chapter-atmosphere');
const { AmbientClock } = require('./ambient-clock');
const SYMBOLS = Object.freeze({ '→': 'arrow-right', '←': 'arrow-left', '↑': 'arrow-up', '↓': 'arrow-down', '↗': 'arrow-ne', '↘': 'arrow-se', '↙': 'arrow-sw', '↖': 'arrow-nw', '✓': 'check' });
const ARROW_ANGLES = Object.freeze({ right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2, ne: -Math.PI / 4, se: Math.PI / 4, sw: Math.PI * .75, nw: -Math.PI * .75 });

function atmosphereChapter(game, height) {
  if (game.page === 'game' && game.level) return game.level.chapter || 0;
  if (game.page === 'levels' && game.levelScroll) return levelBrowserChapter(game, height);
  if (['home', 'collection', 'settings'].includes(game.page) && typeof game.nextLevel === 'function') {
    const next = game.nextLevel();
    if (next) return next.chapter || 0;
  }
  return 0;
}

function ambientRect(page, viewport) {
  const quietTop = { publication: 92, levels: 148, collection: 251, leaderboard: 94 }[page];
  if (quietTop == null) return viewport;
  const bottom = viewport.y + viewport.h, y = Math.max(viewport.y, quietTop);
  return { x: viewport.x, y, w: viewport.w, h: Math.max(0, bottom - y) };
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hits = []; this.scale = 1;
    this.ox = 0; this.oy = 0; this.H = 844; this.safeBottom = 0; this.ambientFreezeAt = null;
    this.ambientClock = new AmbientClock();
  }
  pauseAmbient(now) { this.ambientClock.sample(now, true); }
  clearCaches() {
    if (this.wrapCache) this.wrapCache.clear();
    this.boardGeometry = null; this.motionEffects = null; this.routePreview = null;
    this.hits = []; this.boardProjection = null; this.boardRect = null; this.collectionRect = null; this.levelRect = null;
  }
  toLogical(x, y) { return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale }; }
  font(size, weight) { this.ctx.font = (weight || '400') + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif'; }
  round(x, y, w, h, r, fill, stroke) {
    const c = this.ctx; r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  text(text, x, y, size, color, align, weight) {
    const c = this.ctx, value = String(text);
    this.font(size, weight); c.fillStyle = color || C.ink; c.textAlign = align || 'left'; c.textBaseline = 'middle';
    // Vector arrows avoid iOS emoji rendering while retaining text alignment.
    if (!/[→←↑↓↗↘↙↖✓]/.test(value)) { c.fillText(value, x, y); return; }
    const parts = value.split(/([→←↑↓↗↘↙↖✓])/).filter(Boolean);
    const widths = parts.map(part => SYMBOLS[part] ? size : c.measureText(part).width);
    const width = widths.reduce((total, part) => total + part, 0);
    let left = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
    c.textAlign = 'left';
    parts.forEach((part, i) => {
      if (SYMBOLS[part]) this.icon(SYMBOLS[part], left + size / 2, y, size, color || C.ink);
      else { c.fillStyle = color || C.ink; c.fillText(part, left, y); }
      left += widths[i];
    });
    c.textAlign = align || 'left';
  }
  label(text, x, y, width, size, color, align, weight) {
    const c = this.ctx; let value = String(text);
    this.font(size, weight);
    if (c.measureText(value).width > width) {
      const chars = Array.from(value);
      while (chars.length && c.measureText(chars.join('') + '…').width > width) chars.pop();
      value = chars.length ? chars.join('') + '…' : '';
    }
    this.text(value, x, y, size, color, align, weight);
  }
  panel(x, y, w, h, options) {
    drawPanel(this, x, y, w, h, options);
  }
  line(points, color, width, dash) {
    const c = this.ctx; c.beginPath(); c.strokeStyle = color || C.line; c.lineWidth = width || 1.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash || []);
    points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); c.setLineDash([]);
  }
  circle(x, y, r, fill, stroke) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = 1.3; c.strokeStyle = stroke; c.stroke(); } }
  hit(x, y, w, h, action, contains) { this.hits.push({ x, y, w, h, action, contains }); }
  button(text, x, y, w, h, action, style) {
    drawButton(this, text, x, y, w, h, action, style);
  }
  actionIcon(type, x, y, color) { drawUiIcon(this, type, x, y, color || C.green); }
  meter(x, y, w, value, target, color) {
    drawMeter(this, x, y, w, value, target, color);
  }
  wrapped(text, x, y, width, size, color, lineHeight) {
    const lines = this.wrapLines(text, width, size);
    lines.forEach((line, row) => this.text(line, x, y + row * lineHeight, size, color));
    return lines.length;
  }
  wrapLines(text, width, size, weight) {
    // Set the font even on cache hits.
    this.font(size, weight);
    const key = this.ctx.font + '|' + width + '|' + text;
    const cache = this.wrapCache || (this.wrapCache = new Map());
    const cached = cache.get(key);
    if (cached) return cached.slice();
    const lines = [];
    for (const paragraph of String(text).split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (line && this.ctx.measureText(line + char).width > width) { lines.push(line); line = char; }
        else line += char;
      }
      lines.push(line);
    }
    if (cache.size >= 256) cache.clear();
    cache.set(key, lines);
    return lines.slice();
  }
  icon(type, x, y, size, color) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(size / 24, size / 24); color = color || C.green;
    if (type === 'chevron') {
      this.line([[-3, -6], [3, 0], [-3, 6]], color, 1.8);
    } else if (type === 'check') {
      this.line([[-7, 0], [-2, 5], [8, -6]], color, 2.2);
    } else if (type.startsWith('arrow-')) {
      c.rotate(ARROW_ANGLES[type.slice(6)] || 0);
      this.line([[-8, 0], [8, 0]], color, 1.8); this.line([[2, -6], [8, 0], [2, 6]], color, 1.8);
    } else if (type === 'letter') {
      this.round(-10, -7, 20, 14, 3, color); this.line([[-8, -5], [0, 1], [8, -5]], C.white, 1.4); this.line([[-8, 5], [-3, 0]], C.white, 1); this.line([[8, 5], [3, 0]], C.white, 1);
    } else if (type === 'echo') {
      c.globalAlpha *= .85; this.round(-8, -9, 16, 19, 7, color); this.circle(-3, -1, 1.5, C.white); this.circle(3, -1, 1.5, C.white); this.line([[-5, 10], [-2, 7], [1, 10], [4, 7], [7, 9]], C.paper, 2);
    } else if (type === 'star') {
      c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4.7 : 11; i ? c.lineTo(Math.cos(a) * r, Math.sin(a) * r) : c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fillStyle = color; c.fill();
    } else if (type === 'home') {
      this.round(-8, -4, 16, 14, 2, color); this.line([[-11, -4], [0, -12], [11, -4]], color, 3); this.round(-3, 1, 6, 9, 1, C.white); this.circle(4, -1, 1, C.yellow);
    } else if (type === 'wind') {
      this.line([[-11, -5], [5, -5], [9, -8], [7, -10]], color, 1.8); this.line([[-8, 1], [11, 1]], color, 1.8); this.line([[-11, 6], [3, 6], [7, 9], [5, 11]], color, 1.8);
    } else if (type === 'lamp') {
      this.line([[-4, -7], [-4, -10], [0, -12], [4, -10], [4, -7]], color, 1.5);
      this.round(-6, -5, 12, 13, 3, null, color);
      this.line([[-7, -6], [7, -6]], color, 2); this.line([[-7, 9], [7, 9]], color, 2);
      this.round(-3, -2, 6, 8, 2, color); this.line([[0, -4], [0, 8]], color, 1);
    } else if (type === 'moon') {
      c.beginPath(); c.moveTo(5, -8); c.bezierCurveTo(-11, -12, -14, 9, 1, 10); c.bezierCurveTo(6, 10, 10, 6, 10, 2); c.bezierCurveTo(0, 6, -4, -2, 5, -8); c.closePath(); c.fillStyle = color; c.fill();
    } else if (type === 'sun') {
      this.circle(0, 0, 6, color);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; this.line([[Math.cos(a) * 9, Math.sin(a) * 9], [Math.cos(a) * 11, Math.sin(a) * 11]], color, 1.5); }
    } else if (type === 'tree') {
      this.line([[0, 3], [0, 11]], color, 2);
      for (let i = 0; i < 3; i++) {
        const top = -11 + i * 5, width = 5 + i * 2;
        c.beginPath(); c.moveTo(0, top); c.lineTo(width, top + 9); c.lineTo(-width, top + 9); c.closePath(); c.fillStyle = color; c.fill();
      }
    } else if (type === 'leaf') {
      c.beginPath(); c.moveTo(-8, 7); c.quadraticCurveTo(-13, -11, 9, -11); c.quadraticCurveTo(13, 10, -8, 7); c.fillStyle = color; c.fill(); this.line([[-9, 11], [4, -5]], C.paper, 1.1);
    } else if (type === 'pause') {
      this.round(-6, -8, 4, 16, 1, color); this.round(2, -8, 4, 16, 1, color);
    } else if (type === 'undo') {
      c.beginPath(); c.arc(1, 1, 8, Math.PI * 1.15, Math.PI * 0.35, false); c.strokeStyle = color; c.lineWidth = 2.2; c.lineCap = 'round'; c.stroke();
      this.line([[-8, -7], [-8, 0], [-1, 0]], color, 2.2);
    } else if (type === 'bridge') {
      this.round(-11, -3, 22, 8, 2, color); this.line([[-7, -3], [-7, 5]], C.paper, 1.2); this.line([[0, -3], [0, 5]], C.paper, 1.2); this.line([[7, -3], [7, 5]], C.paper, 1.2);
      this.line([[-11, -3], [-4, -9], [4, -9], [11, -3]], color, 1.8);
    } else if (type === 'back') this.line([[4, -8], [-4, 0], [4, 8]], color, 1.8);
    else if (type === 'lock') { this.round(-6, -1, 12, 11, 2, color); this.line([[-4, -1], [-4, -6], [0, -9], [4, -6], [4, -1]], color, 1.7); this.circle(0, 4, 1.3, C.paper); }
    else drawUiIcon(this, type, 0, 0, color, UI_ICON.viewBox);
    c.restore();
  }
  courier(x, y, size, ghost, pose) { drawCourier(this, x, y, size, ghost, pose); }
  postmark(x, y, radius, label, color) {
    this.circle(x, y, radius, null, color || C.muted); this.circle(x, y, radius - 5, null, color || C.muted);
    this.text('风 · 邮', x, y - 7, 10, color || C.muted, 'center'); this.text(label, x, y + 9, 10, color || C.muted, 'center');
  }
  header(title, subtitle, back) {
    this.button('', 16, 10, 44, CONTROL.compactHeight, back, { style: 'quiet', icon: 'back' });
    this.label(title, 69, 29, 291, 19, C.ink, 'left', '600'); this.label(subtitle, 69, 53, 291, 10, C.muted);
    this.line([[24, 77], [366, 77]], C.line, .7);
  }
  scrim(color) {
    const bounds = this.viewport || { x: -this.ox / this.scale, y: -this.oy / this.scale,
      w: 390 + this.ox * 2 / this.scale, h: this.H + (this.oy + this.safeBottom) / this.scale };
    this.ctx.fillStyle = color;
    this.ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  draw(game, now, metrics) {
    const c = this.ctx; const ratio = metrics.pixelRatio || 1;
    const safeTop = metrics.safeTop || 0, safeBottom = metrics.safeBottom || 0;
    this.safeBottom = safeBottom;
    const available = metrics.height - safeTop - safeBottom;
    this.scale = Math.min(metrics.width / 390, available / 700);
    this.H = available / this.scale; this.ox = (metrics.width - 390 * this.scale) / 2; this.oy = safeTop;
    // Content respects safe areas; scenery spans the canvas.
    this.viewport = { x: -this.ox / this.scale, y: -safeTop / this.scale,
      w: metrics.width / this.scale, h: metrics.height / this.scale };
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.translate(this.ox, this.oy); c.scale(this.scale, this.scale);
    this.hits = []; this.boardRect = null; this.boardProjection = null; this.collectionRect = null; this.levelRect = null; this.pointer = game.modal ? null : game.pointer;
    this.now = now;
    this.reducedMotion = typeof game.reducedMotion === 'function' ? game.reducedMotion() :
      !!(game.platform && game.platform.reducedMotion);
    this.effectsQuality = game.platform && game.platform.effectsQuality === 'low' ? 'low' : 'high';
    this.ambientImpulse = 0;
    if (!game.modal) this.ambientFreezeAt = null;
    else if (!Number.isFinite(this.ambientFreezeAt)) this.ambientFreezeAt = now;
    const backgroundNow = this.ambientClock.sample(now,
      !!game.modal || this.reducedMotion || this.effectsQuality === 'low');
    this.ambientNow = backgroundNow;
    c.save();
    const treatment = atmosphereTreatment(game.page);
    const chapter = atmosphereChapter(game, this.H), mood = chapterMood(chapter, chapterNames.length);
    this.atmosphereMood = mood;
    drawBackdrop(this, backgroundNow, chapter, { page: game.page,
      reducedMotion: this.reducedMotion || this.effectsQuality === 'low',
      quality: this.effectsQuality, strength: treatment.depth, treatment, mood, totalChapters: chapterNames.length });
    c.globalAlpha = treatment.wash;
    this.scrim(C.paper);
    c.restore();
    if (game.page !== 'startup' && game.page !== 'home' && game.page !== 'game') {
      drawAmbientOverlay(this, backgroundNow, game.page, ambientRect(game.page, this.viewport), {
        reducedMotion: this.reducedMotion, quality: this.effectsQuality, treatment, mood,
        scrollOffset: game.page === 'levels' && game.levelScroll ? game.levelScroll.offset : 0
      });
    }
    // Gameplay keeps real time for short-lived movement and camera feedback;
    // its decorative layers read ambientNow and remain frozen behind a modal.
    const pageNow = game.modal && game.page !== 'game' ? this.ambientFreezeAt : now;
    this.pageNow = pageNow;
    if (game.page === 'startup') drawStartup(this, game, pageNow);
    else if (game.page === 'publication') drawPublication(this, game);
    else if (game.page === 'game') this.game(game, pageNow);
    else if (game.page === 'levels') this.levels(game);
    else if (game.page === 'collection') this.collection(game);
    else if (game.page === 'leaderboard') drawLeaderboard(this, game);
    else if (game.page === 'settings') drawSettings(this, game);
    else this.home(game, pageNow);
    if (game.modal !== this.currentModal) { this.currentModal = game.modal; this.modalAt = now; }
    let modalBounds = null;
    if (game.modal) {
      this.hits = [];
      this.pointer = game.pointer;
      const kind = game.modal.kind;
      const result = game.page === 'game' && game.state &&
        ((kind === 'win' && game.state.status === 'won') || (kind === 'fail' && game.state.status === 'failed')) &&
        Number.isFinite(game.transitionAt) && (game.moveEvents || []).some(event => event && event.type === kind);
      // Reviewing a result must not restart its effects.
      const resultAge = result && !this.reducedMotion ? now - game.transitionAt - RESULT_DELAY_MS : null;
      if (game.modal.kind === 'developer-level') {
        if (game.development) modalBounds = drawDeveloperPicker(this, game);
      }
      else if (game.modal.kind === 'stamp-detail') modalBounds = drawStampDetail(this, game, now);
      else if (resultAge === null || resultAge >= 0) modalBounds = this.modal(game.modal, now, resultAge);
      else this.modalAt = now;
    }
    if (game.toastUntil > now) {
      const lines = this.wrapLines(game.toastText, 326, 13);
      const w = Math.min(358, Math.max(...lines.map(line => c.measureText(line).width), 0) + 32), h = 20 + Math.max(1, lines.length) * 18;
      const preferred = game.page === 'game' ? Math.max(151, 231 - h) : this.H - 12 - h;
      const y = modalBounds ? Math.max(8, modalBounds.y - h - 12) : preferred;
      this.panel((390 - w) / 2, y, w, h, { radius: 12, fill: C.panel, stroke: C.line, accent: C.green });
      lines.forEach((line, i) => this.text(line, 195, y + 19 + i * 18, 13, C.ink, 'center'));
    }
    const status = game.store.getStatus();
    const footerToast = game.toastUntil > now && game.page !== 'game' && !game.modal;
    if (!status.persisted && !footerToast) { this.round(18, this.H - 28, 354, 22, 5, C.peach); this.text('存储不可用：当前进度仅在本次运行保留', 195, this.H - 17, 11, C.ink, 'center'); }
  }
  home(game, now) { drawHome(this, game, now); }
  levels(game) { drawLevels(this, game); }
  collection(game) { drawCollection(this, game); }
  game(game, now) { drawGame(this, game, now); }
  modal(modal, now, resultAge = null) { return drawModal(this, modal, now, resultAge); }
}
module.exports = { Renderer };
