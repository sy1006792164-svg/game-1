'use strict';

const { ITEMS, itemOffer } = require('./items');
const { C } = require('./theme');
const { pendingSupplyCells } = require('./supply-stations');

const ITEM_TRAY_HEIGHT = 62;
const ITEM_TRAY_GAP = 8;
const TONES = Object.freeze({
  oil: { ink: '#986431', face: '#faf1d9', line: '#ccb58a' },
  kite: { ink: '#377c79', face: '#edf4e9', line: '#9fbfb1' },
  bridge: { ink: '#89694b', face: '#f3ecdc', line: '#c2b399' },
  echo: { ink: '#397d91', face: '#e9f2ef', line: '#9abdc6' }
});
const SHORT_REASONS = Object.freeze({
  '只能在投递中使用': '投递时可用',
  '下一封编号信不在两格内': '下封信超范围',
  '两格内没有待收的信': '信笺不在范围',
  '信笺已全部收齐': '信笺已齐',
  '先踩蓝票，趁回声还没到时使用': '先踩蓝票再用',
  '蓝票已全部盖好': '蓝票已齐',
  '先走到断桥旁，上下左右紧挨一格': '靠近断桥再修',
  '纸桥完好，无需修复': '纸桥完好'
});

function itemTrayLayout(game, guide, hintY) {
  const visible = !guide && !game.reviewing && game.level.id >= 4 && typeof game.selectItem === 'function';
  if (!visible) return { visible: false, height: 0, reserve: 0, cards: [] };
  const y = hintY - ITEM_TRAY_HEIGHT - ITEM_TRAY_GAP;
  // Keep the row stable during a route, but omit tools this route cannot use.
  const items = ITEMS.filter(item => game.level.id >= item.unlock &&
    (item.id !== 'bridge' || (game.level.bridges || []).length > 0));
  const gap = 6;
  const width = (342 - (items.length - 1) * gap) / items.length;
  return { visible: true, y, height: ITEM_TRAY_HEIGHT, reserve: ITEM_TRAY_HEIGHT + ITEM_TRAY_GAP,
    cards: items.map((item, index) => ({ item, x: 24 + index * (width + gap), y, w: width, h: ITEM_TRAY_HEIGHT })) };
}

// Small hand-painted objects keep the satchel in the same paper world as the board.
function drawItemArt(r, id, x, y, size, muted = false) {
  const c = r.ctx, tone = TONES[id] || TONES.oil;
  const ink = muted ? '#879087' : tone.ink;
  c.save(); c.translate(x, y); c.scale(size / 28, size / 28);
  if (id === 'oil') {
    r.line([[-2, -12], [3, -12]], ink, 2);
    r.round(-4, -10, 9, 5, 1.5, muted ? '#bfc4b5' : '#ad8750');
    r.round(-8, -5, 17, 17, 5, muted ? '#d2d6c8' : '#e5c68d', ink);
    r.line([[-5, -1], [-5, 6]], '#fff8e2', 1.5);
    r.round(-3, -2, 8, 10, 2, '#faf3dd');
    c.beginPath(); c.moveTo(1, -.5); c.bezierCurveTo(-5, 5, 1, 8, 3, 5); c.bezierCurveTo(5, 3, 2, 2, 1, -.5);
    c.fillStyle = ink; c.fill();
  } else if (id === 'kite') {
    c.beginPath(); c.moveTo(-1, -12); c.lineTo(11, -1); c.lineTo(0, 9); c.lineTo(-11, -2); c.closePath();
    c.fillStyle = muted ? '#d2d6c8' : '#b9d7c0'; c.fill(); c.strokeStyle = ink; c.lineWidth = 1; c.stroke();
    r.line([[-1, -12], [0, 9]], '#fbf5df', 1.2); r.line([[-11, -2], [11, -1]], '#fbf5df', 1.2);
    r.line([[0, 9], [3, 12], [0, 15], [4, 17]], ink, 1);
    r.line([[2, 12], [-1, 11], [0, 14], [4, 12]], muted ? ink : '#c48e65', 1.3);
  } else if (id === 'bridge') {
    c.save(); c.rotate(-.14);
    for (const dy of [-5, 0, 5]) r.round(-12, dy - 2, 24, 4, 1, muted ? '#d2d6c8' : '#ddc394', ink);
    r.line([[-7, -9], [-7, 9]], '#faf3dc', 2); r.line([[7, -9], [7, 9]], '#faf3dc', 2);
    r.line([[-7, -9], [-7, 9]], ink, .6); r.line([[7, -9], [7, 9]], ink, .6);
    c.restore();
    r.line([[0, -8], [-3, -11], [0, -12], [3, -9], [0, -8], [1, -13], [4, -12], [3, -9]], ink, .9);
  } else if (id === 'echo') {
    c.save(); c.rotate(-.62);
    r.round(-4, -12, 8, 24, 3, muted ? '#cbd4cb' : '#b4d4d3', ink);
    r.line([[-2, -10], [-2, 10]], '#f3ffff', 1);
    for (const offset of [-5, 0, 5]) r.circle(.6, offset, 1.25, ink);
    r.line([[-4, -8], [4, -8]], ink, 1.2);
    c.restore();
    for (const radius of [5, 9]) {
      c.beginPath(); c.arc(9, -9, radius, -.6, .65);
      c.strokeStyle = ink; c.lineWidth = 1.1; c.stroke();
    }
  }
  c.restore();
}

function itemTrayDetail(r, game, item, offer, remaining, advice, width) {
  if (game.selectedItem === item.id) return '点亮起的目标';
  if (game.state.status !== 'playing') return SHORT_REASONS[offer.reason] || offer.reason;
  if (!remaining && pendingSupplyCells(game.level, game.state, item.id).length > 0) return '驿站免费领取';
  if (!offer.eligible) {
    r.font(11);
    return r.ctx.measureText(offer.reason).width <= width ? offer.reason : SHORT_REASONS[offer.reason] || offer.reason;
  }
  if (remaining) return item.short;
  if (game.platform.kind === 'browser') return '微信视频获取';
  return advice && advice.itemId === item.id ? '建议看视频' : '看视频获取';
}

function drawItemTray(r, game, layout) {
  if (!layout.visible) return;
  const canInspect = !game.modal && !game.busy && game.state.status === 'playing';
  const advice = typeof game.supplyAdvice === 'function' ? game.supplyAdvice() : null;
  // One quiet tool band keeps the island as the focus. Only the tool currently
  // being pressed or aimed receives a face; every tool retains its full target.
  r.line([[24, layout.y], [366, layout.y]], C.line, 1);
  for (const [index, card] of layout.cards.entries()) {
    const { item, x, y, w, h } = card, tone = TONES[item.id];
    const compact = w < 100, spacious = w >= 160;
    const offer = itemOffer(game.level, game.state, item.id);
    const remaining = game.state.inventory && game.state.inventory[item.id] || 0;
    const selected = game.selectedItem === item.id;
    const muted = !offer.eligible && !selected;
    const pointer = r.pointer, pressed = canInspect && pointer && !pointer.dragging &&
      pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
    if (selected || pressed) r.round(x, y + 3, w, h - 3, 12, selected ? tone.face : C.soft,
      selected ? C.green : null);
    if (index > 0) r.line([[x - 3, y + 15], [x - 3, y + h - 13]], C.line, 1);
    drawItemArt(r, item.id, x + (compact ? 17 : 20), y + (spacious ? 31 : 23), compact ? 21 : 25, muted);
    const nameInset = compact ? 34 : spacious ? 42 : 38;
    r.text(item.name, x + nameInset, y + (spacious ? 22 : 16), compact ? 12 : 13,
      muted ? C.muted : C.ink, 'left', '600');
    r.font(13, '600');
    const stockX = x + nameInset + (spacious ? r.ctx.measureText(item.name).width + 10 : 0);
    r.text('×' + remaining, stockX, y + (spacious ? 22 : 32), 10, remaining ? C.green : C.muted, 'left', '600');
    const station = remaining === 0 && pendingSupplyCells(game.level, game.state, item.id).length > 0;
    // Use complete, concise state labels in narrow columns. The existing item
    // inspector provides the full rule when tapped, without spending a beat.
    const detailWidth = spacious ? w - nameInset - 6 : w - 14;
    const detail = itemTrayDetail(r, game, item, offer, remaining, advice, detailWidth);
    r.text(detail, spacious ? x + nameInset : x + w / 2, y + (spacious ? 43 : 51), 11,
      selected || station ? C.green : C.muted, spacious ? 'left' : 'center');
    // Temporarily unavailable tools explain their rule without changing row order.
    if (canInspect) {
      const action = Object.assign(() => game.selectItem(item.id), { itemId: item.id });
      r.hit(x, y, w, h, action, undefined, item.name + '，' + remaining + ' 件，' + detail);
    }
  }
}

function itemAimHint(game) {
  const held = game.state.inventory && game.state.inventory[game.selectedItem] > 0;
  if (!held && game.selectedItem === 'kite') return '点亮起的橙色信笺，选一封取回。\n看完视频后收信；没看完不发放道具。';
  if (!held && game.selectedItem === 'bridge') return '点身旁亮起的断桥，选一座修好。\n看完视频后修桥；没看完不发放道具。';
  if (!held && game.selectedItem === 'echo') return '离开蓝票后也能用，点亮起的票。\n看完视频后提前盖一张，省下等待。';
  if (game.selectedItem === 'kite') return '点亮起的橙色信笺，隔空取回一封。\n可隔墙，不收蓝票；你留在原地。';
  if (game.selectedItem === 'bridge') return '点身旁亮起的断桥，修好其中一座。\n修桥不耗拍；走上去再离开仍会碎。';
  if (game.selectedItem === 'echo') return '离开蓝票后也能用，点亮起的票。\n提前盖一张，省下等待；不耗拍。';
  return '';
}

function drawItemAimHint(r, game, layout) {
  if (!game.selectedItem) return false;
  const { hintY, hintHeight, hintLines } = layout;
  r.panel(24, hintY, 342, hintHeight, { radius: 14, fill: C.soft, stroke: C.green, flat: true });
  const y = hintY + hintHeight / 2 - (hintLines.length - 1) * 9;
  hintLines.forEach((line, index) => r.text(line, 195, y + index * 18, 13, C.green, 'center'));
  return true;
}

function selectedItemTargets(game) {
  return game.selectedItem && !game.reviewing && game.state.status === 'playing'
    ? new Set(itemOffer(game.level, game.state, game.selectedItem).targets) : null;
}

function drawItemTarget(r, id, projection, cell, now) {
  const [x, y] = projection.point(cell), hw = projection.halfW - 2, hh = projection.halfH - 1;
  const c = r.ctx, quiet = r.reducedMotion || r.effectsQuality === 'low';
  const pulse = quiet ? 1 : .8 + Math.sin(now / 370) * .2;
  c.save(); c.globalAlpha *= pulse;
  c.beginPath(); c.moveTo(x, y - hh); c.lineTo(x + hw, y); c.lineTo(x, y + hh); c.lineTo(x - hw, y); c.closePath();
  c.fillStyle = id === 'bridge' ? '#efd69d99' : id === 'echo' ? '#b2dce999' : '#b9e1d699'; c.fill();
  c.strokeStyle = id === 'bridge' ? '#b18341' : id === 'echo' ? '#397d91' : '#378d83'; c.lineWidth = 2; c.stroke();
  r.icon('check', x, y + hh * .4, Math.min(12, hw * .55), C.green);
  c.restore();
}

function drawItemEffects(r, game, now, projection) {
  if (game.reviewing || game.modal || !Number.isFinite(game.transitionAt)) return;
  const age = now - game.transitionAt;
  if (age < 0 || age > 850) return;
  const event = (game.moveEvents || []).find(item => item.type === 'item' && (item.item === 'bridge' || item.item === 'echo'));
  if (!event) return;
  const [x, y] = projection.point(event.cell), c = r.ctx;
  const progress = r.reducedMotion ? 0 : age / 850;
  c.save(); c.globalAlpha *= r.reducedMotion ? .65 : (1 - progress) * .85;
  const radius = projection.halfW * (.5 + progress * .6);
  c.beginPath(); c.ellipse(x, y, radius, radius * .55, 0, 0, Math.PI * 2);
  c.strokeStyle = event.item === 'echo' ? '#74b7c5' : '#e2bd75'; c.lineWidth = 2; c.stroke();
  if (r.effectsQuality !== 'low') r.icon('check', x, y - projection.halfH - 12, 16, '#759976');
  c.restore();
}

module.exports = { ITEM_TRAY_HEIGHT, ITEM_TRAY_GAP, itemTrayLayout, drawItemArt, drawItemTray,
  itemAimHint, drawItemAimHint, selectedItemTargets, drawItemTarget, drawItemEffects };
