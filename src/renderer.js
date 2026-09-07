'use strict';
const { CAMPAIGN, chapterNames } = require('./levels');
const { VERSION } = require('./config');
const C = { paper: '#f5f2e8', ink: '#24473d', green: '#315e4c', soft: '#e6eadb', line: '#d5dccb', muted: '#647660', orange: '#c96b3d', peach: '#f3ddc8', blue: '#6493a8', bluePale: '#dfedf0', white: '#fffdf6', yellow: '#c39b45' };
const STAMPS = [
  ['第一缕风', 1, 'leaf'], ['三拍之后', 3, 'echo'], ['纸翼初展', 6, 'letter'], ['苔阶来信', 12, 'tree'],
  ['巷口微光', 18, 'lamp'], ['随风远行', 24, 'wind'], ['林间回响', 30, 'echo'], ['不迷路的月', 40, 'moon'],
  ['星光邮戳', 50, 'star'], ['长长的回廊', 65, 'home'], ['满天风笺', 80, 'letter'], ['今日的问候', 'daily', 'sun']
];
class Renderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hits = []; this.scale = 1; this.ox = 0; this.oy = 0; this.H = 844; }
  toLogical(x, y) { return { x: (x - this.ox) / this.scale, y: (y - this.oy) / this.scale }; }
  round(x, y, w, h, r, fill, stroke) {
    const c = this.ctx; r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
  }
  text(text, x, y, size, color, align, weight) {
    const c = this.ctx; c.font = (weight || '400') + ' ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif'; c.fillStyle = color || C.ink; c.textAlign = align || 'left'; c.textBaseline = 'middle'; c.fillText(String(text), x, y);
  }
  line(points, color, width, dash) {
    const c = this.ctx; c.beginPath(); c.strokeStyle = color || C.line; c.lineWidth = width || 1.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.setLineDash(dash || []);
    points.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); c.setLineDash([]);
  }
  circle(x, y, r, fill, stroke) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = 1.3; c.strokeStyle = stroke; c.stroke(); } }
  hit(x, y, w, h, action) { this.hits.push({ x, y, w, h, action }); }
  button(text, x, y, w, h, action, style) {
    const primary = style === 'primary', quiet = style === 'quiet';
    if (!quiet) this.round(x, y, w, h, 15, primary ? C.green : C.white, primary ? null : C.line);
    this.text(text, x + w / 2, y + h / 2, quiet ? 13 : 15, primary ? C.white : C.ink, 'center', primary ? '600' : '500');
    this.hit(x, y, w, h, action);
  }
  meter(x, y, w, value, target, color) {
    this.round(x, y, w, 5, 2.5, '#dce2d2');
    const filled = Math.max(0, Math.min(1, value / Math.max(1, target))) * w;
    if (filled > 0) this.round(x, y, Math.max(5, filled), 5, 2.5, color || C.green);
  }
  wrapped(text, x, y, width, size, color, lineHeight) {
    let line = '', row = 0;
    this.ctx.font = '400 ' + size + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    for (const char of String(text)) {
      if (line && this.ctx.measureText(line + char).width > width) { this.text(line, x, y + row++ * lineHeight, size, color); line = char; }
      else line += char;
    }
    if (line) this.text(line, x, y + row++ * lineHeight, size, color);
    return row;
  }
  nav(game, selected) {
    this.line([[24, this.H - 68], [366, this.H - 68]], C.line, 1);
    [['邮局', 'home', 'home'], ['旅程', 'levels', 'wind'], ['成长', 'progress', 'star'], ['邮票册', 'collection', 'letter']].forEach(([name, page, icon], i) => {
      const x = 60 + i * 90;
      this.icon(icon, x, this.H - 47, 18, selected === page ? C.green : '#94a087');
      this.text(name, x, this.H - 24, 10, selected === page ? C.ink : C.muted, 'center', selected === page ? '600' : '400');
      this.hit(x - 41, this.H - 66, 82, 61, () => page === 'home' ? game.home() : game.openPage(page));
    });
  }
  icon(type, x, y, size, color) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(size / 24, size / 24); color = color || C.green;
    if (type === 'letter') {
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
      this.round(-6, -6, 12, 14, 3, color); this.line([[-4, -7], [-4, -11], [4, -11], [4, -7]], color, 1.5); this.line([[-8, 10], [8, 10]], color, 1.8); this.line([[0, -2], [-2, 2], [2, 2], [0, 5]], C.white, 1.5);
    } else if (type === 'sun' || type === 'moon') {
      this.circle(0, 0, 7, color); if (type === 'moon') this.circle(4, -3, 6, C.paper);
      else for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; this.line([[Math.cos(a) * 10, Math.sin(a) * 10], [Math.cos(a) * 12, Math.sin(a) * 12]], color, 1.5); }
    } else if (type === 'tree' || type === 'leaf') {
      c.beginPath(); c.moveTo(-8, 7); c.quadraticCurveTo(-13, -11, 9, -11); c.quadraticCurveTo(13, 10, -8, 7); c.fillStyle = color; c.fill(); this.line([[-9, 11], [4, -5]], C.paper, 1.1);
    } else if (type === 'pause') {
      this.round(-6, -8, 4, 16, 1, color); this.round(2, -8, 4, 16, 1, color);
    } else if (type === 'back') this.line([[4, -8], [-4, 0], [4, 8]], color, 1.8);
    else if (type === 'lock') { this.round(-6, -1, 12, 11, 2, color); this.line([[-4, -1], [-4, -6], [0, -9], [4, -6], [4, -1]], color, 1.7); this.circle(0, 4, 1.3, C.paper); }
    c.restore();
  }
  courier(x, y, size, ghost) {
    const c = this.ctx; c.save(); c.translate(x, y); c.scale(size / 40, size / 40);
    if (ghost) { this.circle(0, 5, 18, '#7babc01c'); this.icon('echo', 0, 0, 33, C.blue); }
    else {
      c.fillStyle = '#193e3020'; c.beginPath(); c.ellipse(0, 16, 13, 4, 0, 0, Math.PI * 2); c.fill();
      this.line([[-5, 11], [-6, 16]], C.ink, 4); this.line([[5, 11], [6, 16]], C.ink, 4);
      this.round(-10, -1, 20, 17, 6, C.orange); this.round(-9, -17, 18, 19, 8, '#f0d7a5');
      this.round(-13, -18, 26, 8, 4, C.green); this.round(-8, -23, 18, 9, 4, C.green);
      this.circle(-3, -6, 1.2, C.ink); this.circle(4, -6, 1.2, C.ink);
      this.line([[-7, 1], [8, 13]], C.ink, 2); this.round(5, 6, 10, 9, 3, C.yellow);
      this.line([[10, 2], [16, -1]], C.orange, 4); this.icon('letter', 18, -3, 13, C.white);
    }
    c.restore();
  }
  postmark(x, y, radius, label, color) {
    this.circle(x, y, radius, null, color || C.muted); this.circle(x, y, radius - 5, null, color || C.muted);
    this.text('风 · 邮', x, y - 7, 10, color || C.muted, 'center'); this.text(label, x, y + 9, 10, color || C.muted, 'center');
  }
  header(title, subtitle, back) {
    this.icon('back', 34, 31, 21); this.hit(12, 8, 44, 44, back);
    this.text(title, 66, 29, 19, C.ink, 'left', '600'); this.text(subtitle, 66, 53, 10, C.muted);
    this.line([[24, 77], [366, 77]], C.line, 1);
  }
  draw(game, now, metrics) {
    const c = this.ctx; const ratio = metrics.pixelRatio || 1;
    const safeTop = metrics.safeTop || 0, safeBottom = metrics.safeBottom || 0;
    const available = metrics.height - safeTop - safeBottom;
    this.scale = Math.min(metrics.width / 390, available / 700);
    this.H = available / this.scale; this.ox = (metrics.width - 390 * this.scale) / 2; this.oy = safeTop;
    c.setTransform(ratio, 0, 0, ratio, 0, 0); c.fillStyle = C.paper; c.fillRect(0, 0, metrics.width, metrics.height);
    c.translate(this.ox, this.oy); c.scale(this.scale, this.scale);
    this.hits = []; this.boardRect = null;
    if (game.page === 'game') this.game(game, now);
    else if (game.page === 'levels') this.levels(game);
    else if (game.page === 'collection') this.collection(game);
    else if (game.page === 'settings') this.settings(game);
    else if (game.page === 'progress') this.progress(game);
    else this.home(game, now);
    if (game.modal) { this.hits = []; this.modal(game.modal); }
    if (game.toastUntil > now) {
      const msg = game.toastText; c.font = '12px "Microsoft YaHei",sans-serif'; const w = Math.min(362, c.measureText(msg).width + 30);
      this.round((390 - w) / 2, this.H - 74, w, 40, 12, '#24473df2'); this.text(msg, 195, this.H - 54, 12, C.white, 'center');
    }
    const status = game.store.getStatus();
    if (!status.persisted) { this.round(18, this.H - 28, 354, 22, 5, C.peach); this.text('存储不可用：当前进度仅在本次运行保留', 195, this.H - 17, 10, C.ink, 'center'); }
  }
  home(game, now) {
    const H = this.H, p = game.progress(), next = game.nextLevel(), saved = game.store.loadRun();
    this.icon('wind', 37, 34, 26); this.text('风笺回廊', 60, 33, 17, C.ink, 'left', '600');
    this.text('WIND LETTER', 60, 54, 8, C.muted);
    this.round(276, 17, 50, 31, 16, C.soft); this.icon('star', 290, 32, 12, C.yellow); this.text(p.stars, 310, 33, 12, C.ink, 'center');
    this.text('设置', 351, 33, 11, C.muted, 'center'); this.hit(329, 11, 43, 44, () => game.openPage('settings'));
    const heroH = Math.min(250, H - 526), heroBottom = 77 + heroH;
    this.round(24, 77, 342, heroH, 20, '#e7ebdc');
    this.text('每一步，都有回响', 42, 101, 10, C.muted);
    this.text('把下一步，', 42, 132, 24, C.ink, 'left', '600');
    this.text('寄给未来的自己。', 42, 163, 22, C.ink, 'left', '600');
    if (heroH > 220) this.text('你负责前行，回声替你盖章。', 42, 194, 10, C.muted);
    this.round(42, heroBottom - 44, 135, 27, 13, C.white);
    this.text('回合解谜  ·  三拍回声', 109, heroBottom - 30, 10, C.green, 'center');
    const c = this.ctx; c.save(); c.beginPath(); c.rect(187, 84, 176, heroH - 9); c.clip(); c.translate(282, 77 + heroH * .59); c.scale(.54, .54); this.scene(now); c.restore();
    const rankY = heroBottom + 12;
    this.round(24, rankY, 342, 65, 14, C.white, C.line); this.icon('leaf', 47, rankY + 25, 23);
    this.text(p.rank.name, 67, rankY + 23, 13, C.ink, 'left', '600');
    this.text('成长手记  ↗', 348, rankY + 23, 10, C.muted, 'right');
    this.meter(43, rankY + 43, 202, p.rank.current, p.rank.target);
    this.text(p.rank.nextName ? p.rank.current + '/' + p.rank.target + ' 成长' : '最高称号', 348, rankY + 45, 10, C.muted, 'right');
    this.hit(24, rankY, 342, 65, () => game.openPage('progress'));
    const routeY = rankY + 78;
    let routeLabel = '第 ' + String(CAMPAIGN.indexOf(next) + 1).padStart(2, '0') + ' 封 · ' + next.title;
    if (saved) { const l = CAMPAIGN.find(item => item.id === saved.levelId); routeLabel = (saved.mode === 'daily' ? '每日风笺 · ' + saved.dateKey : (saved.mode === 'expert' ? '高手 · ' : '') + (l ? l.title : '上次的路线')) + ' · 已走 ' + (Array.isArray(saved.actions) ? saved.actions.length : 0) + ' 拍'; }
    this.text(routeLabel, 26, routeY + 9, 11, C.muted);
    this.text(p.totalCompleted + '/30 送达', 365, routeY + 9, 10, C.muted, 'right');
    this.button(saved ? '继续上次的投递  →' : p.totalCompleted ? '继续我的旅程  →' : '寄出第一封信  →', 24, routeY + 25, 342, 52, () => game.primary(), 'primary');
    const dailyY = routeY + 91;
    this.round(24, dailyY, 165, 91, 15, C.bluePale); this.icon('sun', 45, dailyY + 23, 19, C.orange);
    this.text('今日风笺', 63, dailyY + 23, 14, C.ink, 'left', '600');
    this.text(game.profile().daily[game.dateKey] ? '已送达 · 再挑战纪录' : '新路线，等你来解', 40, dailyY + 51, 10, C.muted);
    this.text('本周 ' + p.weekly.count + '/3 天  →', 40, dailyY + 73, 11, C.green); this.hit(24, dailyY, 165, 91, () => game.daily());
    this.round(201, dailyY, 165, 91, 15, C.peach); this.icon('wind', 222, dailyY + 23, 19, C.orange);
    this.text('高手邮路', 240, dailyY + 23, 14, C.ink, 'left', '600');
    this.text(p.totalCompleted >= 3 ? '更少灯火，更精妙的路线' : '完成前三封信后开启', 217, dailyY + 51, 10, C.muted);
    this.text(p.totalCompleted >= 3 ? p.expertCompleted + '/30 已征服  →' : p.totalCompleted + '/3 封送达', 217, dailyY + 73, 11, C.orange);
    this.hit(201, dailyY, 165, 91, () => { if (game.completion() < 3) game.selectMode('expert'); else game.goal('expert'); });
    const stampY = dailyY + 106;
    this.icon('letter', 39, stampY + 13, 19, C.orange);
    this.text(p.nextStamp ? '下一枚 · ' + p.nextStamp.name : '成长邮票已全部点亮', 58, stampY + 6, 12, C.ink, 'left', '500');
    this.text(p.nextStamp ? '再得 ' + (p.nextStamp.target - p.stars) + ' 星，收进邮票册' : '去每日风笺，留下今天的邮戳', 58, stampY + 26, 10, C.muted);
    this.text('↗', 348, stampY + 15, 19, C.green); this.hit(24, stampY - 6, 342, 50, () => game.openPage('collection'));
    const goal = p.goals.find(item => !item.complete);
    if (goal && H - 68 - stampY > 122) {
      const y = H - 155;
      this.round(24, y, 342, 65, 14, C.soft);
      this.text('下一小步', 42, y + 17, 9, C.muted);
      this.text(goal.title, 42, y + 40, 13, C.ink, 'left', '500');
      this.text('去挑战  ↗', 346, y + 40, 11, C.green, 'right');
      this.hit(24, y, 342, 65, () => game.goal(goal.action));
    }
    this.nav(game, 'home');
  }
  scene(now) {
    const c = this.ctx, t = now / 1900;
    this.circle(0, 0, 132, '#e6e9d9'); this.circle(0, 0, 113, null, '#d3dac7');
    c.save(); c.rotate(-.13); this.postmark(106, -91, 30, '03 拍', '#96a28a'); c.restore();
    for (let i = 0; i < 4; i++) { const y = -75 + i * 42; c.beginPath(); c.moveTo(-167, y); c.bezierCurveTo(-70, y - 30, 60, y + 50, 166, y + 4); c.strokeStyle = i % 2 ? '#d2d9c5' : '#cad4be'; c.lineWidth = 1; c.setLineDash([4, 7]); c.stroke(); c.setLineDash([]); }
    const stones = [[-104, 78], [-62, 50], [-10, 66], [30, 32], [72, 5]];
    stones.forEach(([x, y], i) => { this.round(x - 21, y - 6, 47, 22, 7, '#b6c5a2'); this.round(x - 21, y - 11, 47, 18, 7, i === 3 ? '#f1d9b6' : '#fcf9e9'); });
    this.line([[-103, 63], [-62, 41], [-10, 55], [31, 23]], '#7fa7aa', 2, [3, 6]);
    this.courier(-64, 27 + Math.sin(t) * 2, 40, true); this.courier(28, 8 + Math.sin(t + 1) * 2, 53, false);
    this.round(66, -63, 69, 64, 7, '#f9ebcd');
    c.beginPath(); c.moveTo(55, -62); c.lineTo(100, -99); c.lineTo(145, -62); c.closePath(); c.fillStyle = C.green; c.fill();
    this.line([[63, -64], [100, -93], [139, -64]], '#96af83', 1.4);
    this.round(92, -35, 19, 36, 8, '#7d9e7c'); this.round(75, -47, 13, 15, 3, C.yellow); this.round(116, -47, 11, 15, 3, C.yellow);
    this.round(83, -64, 35, 15, 3, C.white); this.text('风邮局', 101, -56, 8, C.green, 'center');
    this.line([[136, -6], [136, -36], [151, -36]], C.ink, 2); this.icon('lamp', 150, -27, 17, C.yellow);
    [[-134, 25, 1], [-114, 2, .9], [126, 62, 1], [145, 34, .7], [97, 91, .55]].forEach(([x, y, s]) => { this.line([[x, y + 23 * s], [x, y - 18 * s]], '#76916d', 2); c.save(); c.translate(x, y); c.rotate(-.65); this.icon('leaf', -7 * s, -8, 27 * s, '#79966d'); c.rotate(1.25); this.icon('leaf', 2, -6, 22 * s, '#9cac7c'); c.restore(); });
    c.save(); c.translate(-69, -77 + Math.sin(t + 2) * 4); c.rotate(-.24); this.icon('letter', 0, 0, 34, C.orange); c.restore();
    this.icon('letter', -14, -105 + Math.sin(t) * 3, 19, '#adbc94');
    this.text('你', 28, 64, 11, C.green, 'center'); this.text('三拍前的你', -65, 94, 10, '#799ba8', 'center');
  }
  levels(game) {
    this.header('沿风的旅程', '30 封来信 / 5 段回廊', () => game.home());
    const expert = game.levelMode === 'expert', profile = game.profile();
    this.button('标准邮路', 24, 91, 165, 42, () => game.selectMode('campaign'), expert ? 'secondary' : 'primary');
    this.button('高手邮路' + (game.completion() < 3 ? ' · 待解锁' : ''), 201, 91, 165, 42, () => game.selectMode('expert'), expert ? 'primary' : 'secondary');
    this.text(String(game.chapter + 1).padStart(2, '0'), 26, 168, 31, '#90a487', 'left', '500');
    this.text(chapterNames[game.chapter], 80, 158, 21, C.ink, 'left', '600');
    this.text(expert ? '收紧灯火预算 · 不续灯 · 独立纪录' : ['学会和三拍后的自己同行', '安排支路顺序，让每次折返都有价值', '借一阵风，改变脚下的路线', '串起补给，让灯火刚好照到终点', '长路线与多目标，每一拍都算数'][game.chapter], 80, 184, 10, C.muted);
    const top = 209, cardH = Math.min(137, (this.H - 341) / 3);
    CAMPAIGN.slice(game.chapter * 6, game.chapter * 6 + 6).forEach((l, j) => {
      const i = game.chapter * 6 + j, x = 24 + (j % 2) * 178, y = top + Math.floor(j / 2) * (cardH + 13);
      const record = (expert ? profile.expert : profile.completed)[String(l.id)], unlocked = expert ? game.expertUnlocked(l) : game.unlocked(i);
      this.round(x, y, 164, cardH, 16, unlocked ? C.white : '#eeeee3', unlocked ? C.line : '#e2e5d7');
      this.text(String(i + 1).padStart(2, '0'), x + 17, y + 29, 23, unlocked ? C.green : '#aeb6a4', 'left', '500');
      this.icon(unlocked ? 'letter' : 'lock', x + 134, y + 29, 20, record ? C.orange : '#b5c2a9');
      this.text(l.title, x + 17, y + 61, 14, unlocked ? C.ink : C.muted, 'left', '500');
      this.text(record ? '最佳 ' + record.bestTurns + ' 拍' : '三星 ' + l.par + ' 拍', x + 17, y + 82, 10, C.muted);
      for (let s = 0; s < 3; s++) this.icon('star', x + 24 + s * 20, y + cardH - 23, 14, record && record.stars > s ? C.yellow : '#e0e4d6');
      this.hit(x, y, 164, cardH, () => unlocked ? game.levelInfo(l, game.levelMode) : game.toast(expert ? '先在标准邮路完成这封信' : '先送达上一封信，就能开启这里'));
    });
    for (let i = 0; i < 5; i++) { this.circle(159 + i * 18, this.H - 99, i === game.chapter ? 4 : 3, i === game.chapter ? C.green : C.line); }
    this.button('← 上一章', 24, this.H - 74, 153, 47, () => { game.chapter = Math.max(0, game.chapter - 1); });
    this.button('下一章 →', 213, this.H - 74, 153, 47, () => { game.chapter = Math.min(4, game.chapter + 1); });
  }
  collection(game) {
    this.header('沿途邮票册', '把每一次抵达，慢慢收集起来', () => game.home());
    const stars = game.starCount(), daily = Object.keys(game.profile().daily).length;
    const owned = STAMPS.filter(s => s[1] === 'daily' ? daily > 0 : stars >= s[1]).length;
    this.text(owned + ' / 12', 27, 116, 31, C.green, 'left', '500'); this.text('枚邮票已点亮', 149, 117, 13, C.muted);
    const progress = game.progress();
    this.text(progress.nextStamp ? '再得 ' + (progress.nextStamp.target - stars) + ' 星，点亮「' + progress.nextStamp.name + '」' : '成长邮票全部收齐，今天也来寄一封信吧。', 27, 151, 12, C.muted);
    const h = Math.min(139, (this.H - 282) / 4);
    STAMPS.forEach(([name, goal, type], i) => {
      const x = 24 + (i % 3) * 118, y = 180 + Math.floor(i / 3) * h;
      const unlocked = goal === 'daily' ? daily > 0 : stars >= goal;
      this.round(x + 4, y, 98, h - 15, 3, unlocked ? ['#e3ead8', '#f2e2ca', '#dfebeb'][i % 3] : '#eaece2');
      for (let d = 0; d < 6; d++) { this.circle(x + 4, y + 9 + d * ((h - 33) / 5), 3, C.paper); this.circle(x + 102, y + 9 + d * ((h - 33) / 5), 3, C.paper); }
      this.round(x + 13, y + 10, 80, h - 35, 1, null, unlocked ? '#becbad' : '#d4dacb');
      this.icon(type, x + 53, y + (h - 35) * .42, 31, unlocked ? [C.green, C.orange, C.blue][i % 3] : '#b4bfa9');
      this.text(name, x + 53, y + h - 50, 11, unlocked ? C.ink : C.muted, 'center');
      this.text(unlocked ? '已收藏' : goal === 'daily' ? '完成每日挑战' : '累计 ' + goal + ' 星', x + 53, y + h - 31, 9, C.muted, 'center');
      this.hit(x, y, 110, h - 10, () => game.toast(unlocked ? '「' + name + '」已经收入你的邮票册' : goal === 'daily' ? '完成一次每日挑战即可获得' : '累计获得 ' + goal + ' 颗关卡星星即可获得'));
    });
    this.nav(game, 'collection');
  }
  progress(game) {
    this.header('送信员成长手记', '每一次精进，都留下自己的印记', () => game.home());
    const p = game.progress();
    this.round(24, 94, 342, 111, 18, C.green);
    this.icon('leaf', 53, 129, 30, '#d9dda8');
    this.text('LV.' + p.rank.level + '  ' + p.rank.name, 79, 121, 20, C.white, 'left', '600');
    this.text(p.rank.nextName ? '下一站 · ' + p.rank.nextName : '已抵达最高称号', 79, 150, 11, '#d1debe');
    this.meter(43, 177, 225, p.rank.current, p.rank.target, '#dfbd6e');
    this.text(p.rank.current + '/' + p.rank.target, 346, 180, 11, C.white, 'right');
    this.round(24, 219, 342, 133, 17, C.white, C.line);
    this.text('本周，寄出三天的问候', 42, 244, 15, C.ink, 'left', '600');
    this.text(p.weekly.count + '/3 天', 347, 244, 12, p.weekly.count >= 3 ? C.green : C.orange, 'right');
    p.weekly.days.forEach((day, i) => {
      const x = 52 + i * 47.5;
      this.circle(x, 288, 15, day.done ? C.green : day.today ? C.peach : C.soft, day.today ? C.orange : null);
      this.text(day.done ? '✓' : day.label, x, 288, 12, day.done ? C.white : C.muted, 'center');
      if (day.today) this.text('今天', x, 312, 8, C.orange, 'center');
    });
    this.text(p.weekly.count >= 3 ? '本周目标已完成，下一封信随时再寄。' : '任意三天完成每日风笺，不要求连续签到。', 42, 332, 10, C.muted);
    this.hit(24, 219, 342, 133, () => game.daily());
    this.text('接下来，想挑战哪一封？', 25, 377, 14, C.ink, 'left', '600');
    p.goals.forEach((goal, i) => {
      const y = 397 + i * 69;
      this.round(24, y, 342, 59, 13, goal.complete ? C.soft : C.white, C.line);
      this.circle(47, y + 26, 12, goal.complete ? C.green : C.peach);
      this.text(goal.complete ? '✓' : String(i + 1).padStart(2, '0'), 47, y + 27, 10, goal.complete ? C.white : C.orange, 'center');
      this.text(goal.title, 69, y + 19, 13, C.ink, 'left', '500');
      this.text(goal.detail, 69, y + 40, 10, C.muted);
      this.text('↗', 345, y + 27, 18, C.green);
      this.hit(24, y, 342, 59, () => game.goal(goal.action));
    });
    this.text('主线 ' + p.totalCompleted + '/30   ·   星星 ' + p.stars + '/90   ·   高手 ' + p.expertCompleted + '/30', 195, Math.max(617, this.H - 90), 11, C.muted, 'center');
    this.nav(game, 'progress');
  }
  settings(game) {
    this.header('邮局小记', '设置 / 玩法 / 本地数据', () => game.home());
    const settings = game.profile().settings;
    [['sound', '风铃音效', '由四组原创合成音组成'], ['haptics', '轻触反馈', '收集成功时轻轻振动']].forEach(([key, title, desc], i) => {
      const y = 101 + i * 88; this.round(24, y, 342, 76, 15, C.white, C.line);
      this.text(title, 42, y + 26, 16, C.ink, 'left', '500'); this.text(desc, 42, y + 52, 11, C.muted);
      this.round(295, y + 24, 49, 28, 14, settings[key] ? C.green : '#c8d0bd'); this.circle(settings[key] ? 330 : 309, y + 38, 10, C.white);
      this.hit(24, y, 342, 76, () => game.toggle(key));
    });
    this.button('阅读投递指南  ↗', 24, 289, 342, 51, () => game.help());
    this.round(24, 361, 342, 179, 15, C.soft);
    this.text('进度只留在这台设备', 43, 389, 17, C.ink, 'left', '600');
    ['不要求登录，不收集姓名、头像或位置。', '关卡、星级、设置使用本地缓存保存。', '清理微信缓存或更换设备可能丢失进度。', '广告由微信提供，播放视频需要联网。', '不设置云端账号、排名或数据库。'].forEach((t, i) => this.text(t, 43, 422 + i * 23, 11, C.muted));
    this.button('清除本地进度', 24, 561, 342, 44, () => game.resetPrompt(), 'quiet');
    this.icon('wind', 195, this.H - 77, 27, '#9eae90'); this.text('风笺回廊  /  ' + VERSION, 195, this.H - 45, 11, C.muted, 'center');
  }
  game(game, now) {
    const l = game.level, s = game.state, H = this.H;
    const index = CAMPAIGN.findIndex(item => item.id === l.id), low = s.energy <= 3;
    this.text(game.mode === 'daily' ? '今日风笺 · ' + game.runDate : (game.mode === 'expert' ? '高手邮路 · ' : '标准邮路 · ') + String(index + 1).padStart(2, '0') + '/30', 25, 27, 11, game.mode === 'expert' ? C.orange : C.muted);
    this.text(l.title, 25, 53, 23, C.ink, 'left', '600');
    this.round(315, 17, 51, 45, 13, C.soft); this.icon('pause', 340, 39, 20); this.hit(312, 14, 57, 51, () => game.pause());
    this.round(24, 85, 342, 64, 16, low ? '#89503a' : C.green);
    this.icon('lamp', 48, 116, 25, '#ebd99c'); this.text(s.energy, 82, 111, 26, C.white, 'center', '600'); this.text(low ? '灯火吃紧' : '剩余拍数', 82, 133, 9, '#e2e6d4');
    this.line([[117, 101], [117, 134]], '#577963', 1);
    this.icon('letter', 143, 112, 22, '#e6a478'); this.text((l.letters.length - s.letters.length) + '/' + l.letters.length, 175, 112, 16, C.white, 'center'); this.text('你收信笺', 158, 133, 9, '#c0d0b6');
    this.icon('echo', 236, 111, 24, '#acd0da'); this.text((l.seals.length - s.seals.length) + '/' + l.seals.length, 271, 112, 16, C.white, 'center'); this.text('回声收邮票', 255, 133, 9, '#c0d0b6');
    this.text('?', 341, 116, 19, '#c0d0b6', 'center'); this.hit(319, 94, 43, 45, () => game.help());
    const brief = game.reviewing ? '路线复盘 · 橙线是刚才走过的路，目标留在原处。' : s.turn === 0 ? l.brief : s.letters.length === 0 && s.seals.length === 0 ? '收集完成！前往绿色邮局，寄出这封信。' : s.turn < 3 ? '回声还有 ' + (3 - s.turn) + ' 拍出现。等待也会推进它。' : '① 是下一拍回声落点；先经过蓝票，再等回声盖章。';
    this.meter(31, 151, 328, s.energy, l.budget, low ? C.orange : C.green);
    this.wrapped(brief, 26, 169, 338, 10.5, C.muted, 14);
    const size = Math.min(342, H - 433), bx = (390 - size) / 2, by = 209;
    this.boardRect = { x: bx, y: by, w: size, h: size };
    this.board(game, now, bx, by, size);
    const queueY = by + size + 24;
    this.icon('echo', 38, queueY, 17, C.blue); this.text('回声预告', 53, queueY, 10, C.muted);
    const queue = (s.history || []).slice(-3);
    while (queue.length < 3) queue.unshift(null);
    queue.forEach((pos, i) => {
      const x = 132 + i * 50; this.round(x, queueY - 13, 43, 26, 7, C.bluePale);
      this.text(pos == null ? '—' : String.fromCharCode(65 + pos % l.width) + (Math.floor(pos / l.width) + 1), x + 21, queueY, 11, '#5a8697', 'center');
      this.text(['① 下一拍', '② 两拍后', '③ 三拍后'][i], x + 21, queueY + 22, 8, C.muted, 'center');
    });
    this.text(s.turn + ' 拍', 350, queueY, 11, C.muted, 'right');
    const controlY = H - 151;
    if (game.reviewing) {
      this.wrapped(game.failureHint(), 31, controlY + 4, 327, 12, C.ink, 18);
      this.button('重新规划 · 免费再试', 24, controlY + 44, 342, 48, () => game.start(game.level, game.mode), 'primary');
      this.button('返回结果', 24, controlY + 101, 164, 40, () => game.failure(), 'quiet');
      this.button('返回邮局', 202, controlY + 101, 164, 40, () => game.home(), 'quiet');
      return;
    }
    this.text('滑动棋盘', 73, controlY + 33, 12, C.ink, 'center'); this.text('或点相邻格移动', 73, controlY + 56, 10, C.muted, 'center');
    this.button('↑', 170, controlY - 20, 50, 42, () => game.act('up'));
    this.button('←', 114, controlY + 29, 50, 42, () => game.act('left'));
    this.button('等一拍', 170, controlY + 29, 50, 42, () => game.act('wait'), 'primary');
    this.button('→', 226, controlY + 29, 50, 42, () => game.act('right'));
    this.button('↓', 170, controlY + 78, 50, 42, () => game.act('down'));
    const rating = s.revived ? Math.min(2, s.turn <= l.par ? 3 : s.turn <= Math.ceil(l.par * 1.35) ? 2 : 1) : s.turn <= l.par ? 3 : s.turn <= Math.ceil(l.par * 1.35) ? 2 : 1;
    for (let i = 0; i < 3; i++) this.icon('star', 301 + i * 18, controlY + 20, 14, i < rating ? C.yellow : C.line);
    this.text('三星 ≤ ' + l.par + ' 拍', 319, controlY + 44, 10, C.muted, 'center');
    const best = game.record(l, game.mode);
    this.text(best ? '最佳 ' + best.bestTurns + ' 拍' : game.mode === 'expert' ? '高手 · 不续灯' : '首次探索', 319, controlY + 65, 10, C.muted, 'center');
    this.text('可以停下来想一想，风不会催你。', 195, H - 12, 10, C.muted, 'center');
  }
  board(game, now, x, y, size) {
    const l = game.level, s = game.state, c = this.ctx, cell = size / Math.max(l.width, l.height), pad = 3;
    this.round(x - 7, y - 7, cell * l.width + 14, cell * l.height + 14, 18, '#e0e5d5');
    const point = pos => [x + (pos % l.width + .5) * cell, y + (Math.floor(pos / l.width) + .5) * cell];
    for (let i = 0; i < l.width * l.height; i++) {
      const [cx, cy] = point(i), wall = l.walls.includes(i);
      this.round(cx - cell / 2 + pad, cy - cell / 2 + pad, cell - pad * 2, cell - pad * 2, 8, wall ? '#c2ceb5' : C.white);
      if (!wall && !game.reviewing && Math.abs(i % l.width - s.player % l.width) + Math.abs(Math.floor(i / l.width) - Math.floor(s.player / l.width)) === 1) this.round(cx - cell / 2 + pad, cy - cell / 2 + pad, cell - pad * 2, cell - pad * 2, 8, null, '#b2c29f');
      if (wall) {
        this.icon('leaf', cx + 6, cy - 2, cell * .29, '#94aa84'); this.icon('leaf', cx - 7, cy + 6, cell * .22, '#a6b695');
      } else {
        if (l.winds && l.winds[i]) {
          this.round(cx - cell / 2 + pad, cy - cell / 2 + pad, cell - pad * 2, cell - pad * 2, 8, '#e8eccc');
          this.text({ up: '↑', down: '↓', left: '←', right: '→' }[l.winds[i]], cx, cy, cell * .43, '#94a36b', 'center');
        }
        if (s.lights && s.lights.includes(i)) this.icon('lamp', cx, cy, cell * .45, C.yellow);
        if (i === l.exit) {
          this.round(cx - cell / 2 + pad, cy - cell / 2 + pad, cell - pad * 2, cell - pad * 2, 8, '#dce9d7');
          this.icon('home', cx, cy, cell * .47, s.letters.length === 0 && s.seals.length === 0 ? C.green : '#86a079');
          if (!s.letters.length && !s.seals.length) this.circle(cx, cy, cell * (.33 + Math.sin(now / 300) * .03), null, '#769969');
        }
        if (s.letters.includes(i)) this.icon('letter', cx, cy - Math.sin(now / 600 + i) * 1.8, cell * .46, C.orange);
        if (s.seals.includes(i)) { this.circle(cx, cy, cell * .21, C.bluePale, C.blue); this.icon('star', cx, cy, cell * .23, C.blue); }
      }
      this.hit(cx - cell / 2, cy - cell / 2, cell, cell, () => {
        const dx = i % l.width - s.player % l.width, dy = Math.floor(i / l.width) - Math.floor(s.player / l.width);
        if (!dx && !dy) game.act('wait');
        else if (Math.abs(dx) + Math.abs(dy) === 1) game.act(dx ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
        else game.toast('点相邻格移动，点送信员原地等一拍');
      });
    }
    if (game.reviewing) this.line((s.history || []).map(point), '#c96b3d90', 2.5, [4, 5]);
    const forecast = (s.history || []).slice(-3); while (forecast.length < 3) forecast.unshift(null);
    forecast.forEach((pos, i) => {
      if (pos == null) return;
      const [px, py] = point(pos);
      if (i === 0) this.round(px - cell / 2 + 4, py - cell / 2 + 4, cell - 8, cell - 8, 8, null, C.blue);
      this.circle(px - cell * .29 + i * 10, py + cell * .30, 5.5, i === 0 ? C.blue : '#b8d1d7');
      this.text(i + 1, px - cell * .29 + i * 10, py + cell * .30, 8, i === 0 ? C.white : C.ink, 'center');
    });
    const feedbackAge = now - game.transitionAt;
    if (feedbackAge >= 0 && feedbackAge < 550 && !game.reviewing) (game.moveEvents || []).filter(e => ['letter', 'seal', 'light'].includes(e.type)).forEach(e => {
      const [fx, fy] = point(e.cell); c.save(); c.globalAlpha = 1 - feedbackAge / 550;
      this.circle(fx, fy, cell * (.22 + feedbackAge / 1600), null, e.type === 'seal' ? C.blue : C.orange);
      this.text(e.type === 'light' ? '+3 拍' : '+1', fx, fy - cell * .3 - feedbackAge / 35, 13, e.type === 'seal' ? C.blue : C.orange, 'center', '600'); c.restore();
    });
    const progress = Math.min(1, Math.max(0, (now - game.transitionAt) / 140));
    const ease = 1 - Math.pow(1 - progress, 3);
    if (s.echo != null) {
      let [ex, ey] = point(s.echo);
      if (game.previousState && game.previousState.echo != null) { const [px, py] = point(game.previousState.echo); ex = px + (ex - px) * ease; ey = py + (ey - py) * ease; }
      this.courier(ex + (s.echo === s.player ? cell * .22 : 0), ey - 2, cell * (s.echo === s.player ? .53 : .69), true);
    }
    let [px, py] = point(s.player);
    if (game.previousState) { const [oldX, oldY] = point(game.previousState.player); px = oldX + (px - oldX) * ease; py = oldY + (py - oldY) * ease; }
    this.courier(px, py - 2, cell * .78, false);
    for (let i = 0; i < l.width; i++) this.text(String.fromCharCode(65 + i), x + (i + .5) * cell, y - 16, 8, '#98a58d', 'center');
    for (let i = 0; i < l.height; i++) this.text(i + 1, x - 14, y + (i + .5) * cell, 8, '#98a58d', 'center');
    c.globalAlpha = 1;
  }
  modal(modal) {
    const c = this.ctx; c.fillStyle = '#183a32ad'; c.fillRect(-this.ox / this.scale, -this.oy / this.scale, 390 + this.ox * 2 / this.scale, this.H + this.oy * 2 / this.scale + 80);
    const hasStars = !!modal.stars, help = modal.kind === 'help';
    const contentH = 145 + modal.lines.length * 25 + (hasStars ? 66 : 0), height = contentH + modal.buttons.length * 57 + 22;
    const x = 22, y = Math.max(22, (this.H - height) / 2), w = 346;
    this.round(x, y, w, height, 25, C.paper);
    this.line([[x + 24, y + 13], [x + 81, y + 13]], '#d79471', 3); this.line([[x + 92, y + 13], [x + 149, y + 13]], '#91b0b7', 3); this.line([[x + 160, y + 13], [x + 217, y + 13]], '#d79471', 3); this.line([[x + 228, y + 13], [x + 284, y + 13]], '#91b0b7', 3);
    this.icon(modal.kind === 'win' ? 'letter' : modal.kind === 'fail' ? 'lamp' : help ? 'echo' : 'wind', 195, y + 52, 33, modal.kind === 'fail' ? C.orange : C.green);
    this.text(modal.kicker || '', 195, y + 89, 8, C.muted, 'center');
    this.text(modal.title, 195, y + 120, help ? 20 : 22, C.ink, 'center', '600');
    let lineY = y + 159;
    if (hasStars) { for (let i = 0; i < 3; i++) this.icon('star', 150 + i * 45, y + 167, i === 1 ? 36 : 29, i < modal.stars ? C.yellow : C.line); lineY += 66; }
    modal.lines.forEach((line, i) => this.text(line, help ? 43 : 195, lineY + i * 25, help ? 11 : 11, C.muted, help ? 'left' : 'center'));
    modal.buttons.forEach((b, i) => this.button(b.text, x + 22, y + contentH + i * 57, w - 44, 47, b.action, b.primary ? 'primary' : b.textOnly ? 'quiet' : 'secondary'));
  }
}
module.exports = { Renderer };
