'use strict';

const { ITEMS, itemOffer } = require('./items');
const { C } = require('./theme');
const { drawPaperPlaque } = require('./controls');

const ITEM_TRAY_HEIGHT = 58;
const ITEM_TRAY_GAP = 8;
const TONES = Object.freeze({
  oil: { ink: '#986431', face: '#faf1d9', line: '#ccb58a' },
  kite: { ink: '#377c79', face: '#edf4e9', line: '#9fbfb1' },
  bridge: { ink: '#89694b', face: '#f3ecdc', line: '#c2b399' }
});

function itemTrayLayout(game, guide, hintY) {
  const visible = !guide && !game.reviewing && game.level.id >= 4 && typeof game.selectItem === 'function';
  if (!visible) return { visible: false, height: 0, reserve: 0, cards: [] };
  const y = hintY - ITEM_TRAY_HEIGHT - ITEM_TRAY_GAP;
  return { visible: true, y, height: ITEM_TRAY_HEIGHT, reserve: ITEM_TRAY_HEIGHT + ITEM_TRAY_GAP,
    cards: ITEMS.map((item, index) => ({ item, x: 24 + index * 116, y, w: 110, h: ITEM_TRAY_HEIGHT })) };
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
  }
  c.restore();
}

function drawItemTray(r, game, layout) {
  if (!layout.visible) return;
  const canInspect = !game.modal && !game.busy && game.state.status === 'playing';
  for (const card of layout.cards) {
    const { item, x, y, w, h } = card, tone = TONES[item.id];
    const offer = itemOffer(game.level, game.state, item.id);
    const locked = game.level.id < item.unlock;
    const remaining = game.state.inventory && game.state.inventory[item.id] || 0;
    const selected = game.selectedItem === item.id;
    const muted = !offer.eligible && !selected;
    const pointer = r.pointer, pressed = canInspect && pointer && !pointer.dragging &&
      pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;
    const face = selected ? '#e2eddb' : pressed ? '#e5ebdc' : muted ? '#f0f1e7' : tone.face;
    drawPaperPlaque(r, x, y + 3, w, h - 3, 7, false, '#aab9a785');
    drawPaperPlaque(r, x, y, w, h - 3, 7, false, face, selected ? C.green : muted ? '#c5cec0' : tone.line);
    r.line([[x + 8, y + 2], [x + w - 9, y + 2]], '#fffdf3b8', .8);
    drawItemArt(r, item.id, x + 20, y + 21, 24, muted);
    r.text(item.name, x + 38, y + 16, 12, muted ? '#68796d' : C.ink, 'left', '600');
    if (locked) r.icon('lock', x + w - 12, y + 15, 10, '#7a897b');
    else r.text('×' + remaining, x + w - 9, y + 16, 11, muted ? '#68796d' : tone.ink, 'right', '600');
    const video = !selected && !locked && offer.eligible && remaining === 0;
    const detail = selected ? '请点亮起的目标' : locked ? '第 ' + item.unlock + ' 关开启' :
      item.id === 'bridge' && !(game.level.bridges || []).length ? '本关没有纸桥' :
      !offer.eligible ? '暂无可用目标' : video ? game.platform.kind === 'browser' ? '微信内视频获取' : '看视频获取' : item.short;
    if (video) {
      r.round(x + 9, y + 36, 13, 10, 2, null, tone.ink);
      const c = r.ctx; c.beginPath(); c.moveTo(x + 14, y + 38); c.lineTo(x + 18, y + 41); c.lineTo(x + 14, y + 44); c.closePath();
      c.fillStyle = tone.ink; c.fill();
    }
    r.label(detail, x + w / 2 + (video ? 9 : 0), y + 41, w - (video ? 34 : 14), 10, muted ? '#68796d' : tone.ink, 'center');
    // Locked and temporarily unavailable tools stay inspectable, explaining their rule.
    if (canInspect) {
      const action = Object.assign(() => game.selectItem(item.id), { itemId: item.id });
      r.hit(x, y, w, h, action);
    }
  }
}

function itemAimHint(game) {
  const held = game.state.inventory && game.state.inventory[game.selectedItem] > 0;
  if (!held && game.selectedItem === 'kite') return '点亮起的信笺，看视频获取纸鸢。\n完整观看后收取；取消不发放道具。';
  if (!held && game.selectedItem === 'bridge') return '点亮起的断桥，看视频获取修桥包。\n完整观看后修复；取消不发放道具。';
  if (game.selectedItem === 'kite') return '点亮起的信笺，用纸鸢取回一封。\n可越过障碍；你与回声都留在原地。';
  if (game.selectedItem === 'bridge') return '点亮起的断桥，用修桥包修复。\n不耗拍；修好后，离开仍会塌落。';
  return '';
}

function drawItemAimHint(r, game, layout) {
  if (!game.selectedItem) return false;
  const { hintY, hintHeight, hintLines } = layout;
  r.panel(24, hintY, 342, hintHeight, { radius: 13, fill: '#eaf2e4', stroke: '#9fbaa0', accent: C.green });
  const y = hintY + hintHeight / 2 - (hintLines.length - 1) * 9;
  hintLines.forEach((line, index) => r.text(line, 195, y + index * 18, 12, C.green, 'center'));
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
  c.fillStyle = id === 'bridge' ? '#efd69d99' : '#b9e1d699'; c.fill();
  c.strokeStyle = id === 'bridge' ? '#b18341' : '#378d83'; c.lineWidth = 2; c.stroke();
  r.icon('check', x, y + hh * .4, Math.min(12, hw * .55), C.green);
  c.restore();
}

function drawItemEffects(r, game, now, projection) {
  if (game.reviewing || game.modal || !Number.isFinite(game.transitionAt)) return;
  const age = now - game.transitionAt;
  if (age < 0 || age > 850) return;
  const event = (game.moveEvents || []).find(item => item.type === 'item' && item.item === 'bridge');
  if (!event) return;
  const [x, y] = projection.point(event.cell), c = r.ctx;
  const progress = r.reducedMotion ? 0 : age / 850;
  c.save(); c.globalAlpha *= r.reducedMotion ? .65 : (1 - progress) * .85;
  const radius = projection.halfW * (.5 + progress * .6);
  c.beginPath(); c.ellipse(x, y, radius, radius * .55, 0, 0, Math.PI * 2);
  c.strokeStyle = '#e2bd75'; c.lineWidth = 2; c.stroke();
  if (r.effectsQuality !== 'low') r.icon('check', x, y - projection.halfH - 12, 16, '#759976');
  c.restore();
}

module.exports = { ITEM_TRAY_HEIGHT, ITEM_TRAY_GAP, itemTrayLayout, drawItemArt, drawItemTray,
  itemAimHint, drawItemAimHint, selectedItemTargets, drawItemTarget, drawItemEffects };
