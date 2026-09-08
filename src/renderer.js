'use strict';
const { C } = require('./theme');
const { drawHome } = require('./home-view');
const { drawGame } = require('./game-view');
const { drawLevels } = require('./level-view');
const { drawCollection } = require('./collection-view');
const { drawModal } = require('./modal-view');
const { drawSettings } = require('./settings-view');
const { drawBackdrop } = require('./scene');
const SYMBOLS = Object.freeze({ '→': 'arrow-right', '←': 'arrow-left', '↑': 'arrow-up', '↓': 'arrow-down', '↗': 'arrow-ne', '↘': 'arrow-se', '↙': 'arrow-sw', '↖': 'arrow-nw', '✓': 'check' });
const ARROW_ANGLES = Object.freeze({ right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2, ne: -Math.PI / 4, se: Math.PI / 4, sw: Math.PI * .75, nw: -Math.PI * .75 });
class Renderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hits = []; this.scale = 1; this.ox = 0; this.oy = 0; this.H = 844; this.safeBottom = 0; }
  clearCaches() {
    if (this.wrapCache) this.wrapCache.clear();
    this.boardGeometry = null; this.motionEffects = null;
    this.hits = []; this.boardProjection = null; this.boardRect = null;
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
    // iOS renders several Unicode arrows as colored emoji, even in Canvas.
    // Draw those symbols as paths while keeping mixed labels aligned as one run.
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
    const style = options || {}, radius = style.radius == null ? 16 : style.radius;
    this.round(x, y + 3, w, h, radius, '#091f262e');
    this.round(x, y, w, h, radius, style.fill || C.panel, style.stroke || C.line);
    if (style.accent) this.line([[x + 18, y + 1], [x + Math.min(w - 18, 66), y + 1]], style.accent, 1.5);
  }
  line(points, color, width, dash) {
    const c = this.ctx; c.beginPath(); c.strokeStyle = color || C.line; c.lineWidth = width || 1.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash || []);
    points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); c.setLineDash([]);
  }
  circle(x, y, r, fill, stroke) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = 1.3; c.strokeStyle = stroke; c.stroke(); } }
  hit(x, y, w, h, action, contains) { this.hits.push({ x, y, w, h, action, contains }); }
  button(text, x, y, w, h, action, style) {
    const options = typeof style === 'object' && style ? style : { style };
    const primary = options.style === 'primary', quiet = options.style === 'quiet', disabled = !!options.disabled;
    const c = this.ctx, p = this.pointer, pressed = !disabled && p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
    const top = y + (pressed && !quiet ? 2 : 0);
    c.save();
    if (disabled) c.globalAlpha *= .45;
    if (!quiet) {
      this.round(x, y + 3, w, h, 13, primary ? '#805c37' : '#0b2529');
      this.round(x, top, w, h, 13, primary ? pressed ? '#dca962' : C.gold : pressed ? C.soft : C.raised, primary ? '#f3ce94' : C.line);
      this.line([[x + 15, top + 2], [x + w - 15, top + 2]], primary ? '#ffe6b377' : '#50727088', .8);
    } else if (pressed) this.round(x, y, w, h, 12, C.soft);
    const size = w < 70 ? String(text).length > 1 ? 11 : 23 : quiet ? 13 : 15, weight = primary ? '700' : '500';
    const lines = this.wrapLines(text, w - 32, size, weight), lineHeight = 20;
    const textY = top + h / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach((line, i) => this.text(line, x + w / 2, textY + i * lineHeight, size, primary ? C.dark : C.ink, 'center', weight));
    c.restore();
    if (!disabled) this.hit(x, y, w, h, action);
  }
  meter(x, y, w, value, target, color) {
    this.round(x, y, w, 5, 2.5, '#18383a');
    const filled = Math.max(0, Math.min(1, value / Math.max(1, target))) * w;
    if (filled > 0) this.round(x, y, Math.max(5, filled), 5, 2.5, color || C.green);
  }
  wrapped(text, x, y, width, size, color, lineHeight) {
    const lines = this.wrapLines(text, width, size);
    lines.forEach((line, row) => this.text(line, x, y + row * lineHeight, size, color));
    return lines.length;
  }
  wrapLines(text, width, size, weight) {
    // Callers rely on the font being set afterwards; keep that even on a cache hit.
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
    c.restore();
  }
  courier(x, y, size, ghost, pose) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(size / 40, size / 40);
    pose = pose || {};
    const stride = pose.stride || 0;
    c.globalAlpha *= pose.alpha == null ? 1 : pose.alpha;
    c.scale(pose.facing === -1 ? -1 : 1, 1);
    if (ghost) {
      this.circle(0, -2, 22, '#87dce416'); this.circle(0, -2, 15, '#87dce422');
      this.round(-11, -20, 22, 29, 11, '#94dfdfb8', '#c5ffff');
      this.circle(-4, -9, 1.6, '#244652'); this.circle(4, -9, 1.6, '#244652');
      this.line([[-9, 10], [-5, 6], [0, 10], [5, 6], [9, 8]], '#dbffff', 2);
      this.line([[-13, -17], [13, -17]], '#c0f0e9', 3);
      this.line([[-6, -24], [8, -24]], '#97d8d1', 4);
    }
    else {
      c.fillStyle = '#132c3040'; c.beginPath(); c.ellipse(1, 17, 14, 4, 0, 0, Math.PI * 2); c.fill();
      this.line([[-5, 10], [-6 - stride * 3, 17 - stride * 2]], '#293b39', 5);
      this.line([[5, 10], [6 + stride * 3, 17 + stride * 2]], '#293b39', 5);
      this.line([[-7 - stride * 3, 18 - stride * 2], [-3 - stride * 3, 18 - stride * 2]], '#d6b77c', 3);
      this.line([[5 + stride * 3, 18 + stride * 2], [9 + stride * 3, 18 + stride * 2]], '#d6b77c', 3);
      this.round(-12, -3, 24, 18, 7, '#ba6a43');
      this.round(-10, -3, 15, 16, 6, '#efac62');
      this.round(-9, -20, 18, 20, 8, '#e9b881');
      this.round(-8, -20, 14, 16, 6, '#ffe2af');
      this.round(-14, -22, 29, 7, 4, '#2c6558');
      this.round(-9, -29, 20, 11, 5, '#427d61');
      this.line([[-6, -27], [6, -27]], '#77a17a', 1.5);
      this.circle(5, -21, 2, C.gold);
      this.circle(-2, -10, 1.3, '#293b39'); this.circle(5, -10, 1.3, '#293b39');
      this.line([[-9, -1], [-18, -5 + stride * 2], [-23, -1 + stride * 3]], '#bb6248', 5);
      this.line([[-7, 0], [8, 12]], '#5b4938', 2.5);
      this.round(5, 4, 12, 11, 3, '#91643b'); this.round(5, 3, 12, 4, 2, '#e0b56b');
      this.circle(11, 8, 1, '#ffe2ac');
      this.line([[10, 1], [15, -2 - stride * 2]], '#efac62', 4);
      this.icon('letter', 18, -5 - stride * 2, 13, '#fff3cd');
    }
    c.restore();
  }
  postmark(x, y, radius, label, color) {
    this.circle(x, y, radius, null, color || C.muted); this.circle(x, y, radius - 5, null, color || C.muted);
    this.text('风 · 邮', x, y - 7, 10, color || C.muted, 'center'); this.text(label, x, y + 9, 10, color || C.muted, 'center');
  }
  header(title, subtitle, back) {
    this.round(21, 15, 34, 34, 11, '#224348');
    this.icon('back', 38, 32, 17, C.green); this.hit(16, 10, 44, 44, back);
    this.label(title, 69, 29, 291, 19, C.ink, 'left', '600'); this.label(subtitle, 69, 53, 291, 10, C.muted);
    this.line([[24, 77], [366, 77]], '#345254', .7);
  }
  draw(game, now, metrics) {
    const c = this.ctx; const ratio = metrics.pixelRatio || 1;
    const safeTop = metrics.safeTop || 0, safeBottom = metrics.safeBottom || 0;
    this.safeBottom = safeBottom;
    const available = metrics.height - safeTop - safeBottom;
    this.scale = Math.min(metrics.width / 390, available / 700);
    this.H = available / this.scale; this.ox = (metrics.width - 390 * this.scale) / 2; this.oy = safeTop;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.fillStyle = C.paper; c.fillRect(0, 0, metrics.width, metrics.height);
    c.translate(this.ox, this.oy); c.scale(this.scale, this.scale);
    this.hits = []; this.boardRect = null; this.boardProjection = null; this.pointer = game.modal ? null : game.pointer;
    this.now = now;
    c.save();
    drawBackdrop(this, now, game.page === 'game' && game.level ? game.level.chapter || 0 : 0);
    c.globalAlpha = game.page === 'game' ? .1 : game.page === 'home' ? .25 : .72;
    c.fillStyle = C.paper; c.fillRect(0, 0, 390, this.H);
    c.restore();
    if (game.page === 'game') this.game(game, now);
    else if (game.page === 'levels') this.levels(game);
    else if (game.page === 'collection') this.collection(game);
    else if (game.page === 'settings') this.settings(game);
    else this.home(game, now);
    if (game.modal !== this.currentModal) { this.currentModal = game.modal; this.modalAt = now; }
    let modalBounds = null;
    if (game.modal) {
      this.hits = [];
      this.pointer = game.pointer;
      const result = (game.modal.kind === 'win' || game.modal.kind === 'fail') &&
        (game.moveEvents || []).some(event => event.type === 'win' || event.type === 'fail');
      if (!result || now - game.transitionAt >= 400) modalBounds = this.modal(game.modal, now);
      else this.modalAt = now;
    }
    if (game.toastUntil > now) {
      const lines = this.wrapLines(game.toastText, 326, 12);
      const w = Math.min(358, Math.max(...lines.map(line => c.measureText(line).width), 0) + 32), h = 20 + Math.max(1, lines.length) * 18;
      const preferred = game.page === 'game' ? 231 - h : this.H - 12 - h;
      const y = modalBounds ? Math.max(8, modalBounds.y - h - 12) : preferred;
      this.round((390 - w) / 2, y, w, h, 12, '#16363bf2', '#7b9280');
      lines.forEach((line, i) => this.text(line, 195, y + 19 + i * 18, 12, C.white, 'center'));
    }
    const status = game.store.getStatus();
    const footerToast = game.toastUntil > now && game.page !== 'game' && !game.modal;
    if (!status.persisted && !footerToast) { this.round(18, this.H - 28, 354, 22, 5, C.peach); this.text('存储不可用：当前进度仅在本次运行保留', 195, this.H - 17, 11, C.ink, 'center'); }
  }
  home(game, now) { drawHome(this, game, now); }
  levels(game) { drawLevels(this, game); }
  collection(game) { drawCollection(this, game); }
  settings(game) { drawSettings(this, game); }
  game(game, now) { drawGame(this, game, now); }
  modal(modal, now) { return drawModal(this, modal, now); }
}
module.exports = { Renderer };
