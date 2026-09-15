'use strict';

const { C } = require('./theme');
const { CONTROL } = require('./controls');
const { drawPostalPaper, drawPostmark } = require('./postal-paper');
const { drawStampArt } = require('./stamp-art');
const { drawResultStars } = require('./result-effects');
const { drawArtSprite } = require('./art-sprites');

const DELIVERY_MS = 2800;
const PHASES = Object.freeze([
  { start: 0, end: 480, title: '抵达山间邮局', icon: 'home' },
  { start: 480, end: 950, title: '把这一路的心意投递', icon: 'letter' },
  { start: 950, end: 1400, title: '为这一程，盖上邮戳', icon: 'stamp' },
  { start: 1400, end: 2100, title: '每一步，都成为星光', icon: 'star' },
  { start: 2100, end: DELIVERY_MS, title: '收好沿途的纪念', icon: 'stamp' }
]);
const skipped = new WeakSet();
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => 1 - (1 - value) ** 3;

// This object is a view of a result already settled by Game.victory(). Nothing
// in this module writes inventory, progress, storage or reward callbacks.
function deliveryFrame(modal, age, reducedMotion = false) {
  if (!modal.delivery || modal.kind !== 'win' || !Number.isFinite(age) || reducedMotion || skipped.has(modal) || age >= DELIVERY_MS) return null;
  const elapsed = Math.max(0, age);
  const index = PHASES.findIndex(phase => elapsed < phase.end), phase = PHASES[index];
  return { ...phase, index, age: elapsed, progress: clamp((elapsed - phase.start) / (phase.end - phase.start)) };
}

function skipDelivery(modal) { skipped.add(modal); }

function drawPostbox(r, x, y) {
  if (drawArtSprite(r, 'office', x, y + 57, 140, 133)) return;
  r.round(x - 57, y + 41, 114, 12, 6, '#5d68441c');
  r.round(x - 47, y - 33, 94, 81, 8, '#53705a', '#334b3f');
  r.round(x - 43, y - 29, 86, 73, 7, '#79916a');
  r.round(x - 52, y - 42, 104, 17, 5, '#bb7953', '#935a43');
  r.round(x - 48, y - 40, 95, 3, 1, '#f2c58d');
  r.round(x - 31, y - 14, 62, 10, 5, '#304d40');
  r.round(x - 31, y - 3, 62, 2, 1, '#b3c28c');
  r.circle(x, y + 23, 16, '#edf0d6', '#adbe8c');
  r.icon('letter', x, y + 23, 22, '#637c5c');
}

function drawArrival(r, frame, x, y) {
  const arrived = ease(clamp(frame.age / 480));
  r.line([[x - 112, y + 55], [x - 22, y + 55], [x + 65, y + 40]], '#c5b78e', 3, [3, 7]);
  drawPostbox(r, x + 42, y);
  const stride = Math.sin(arrived * Math.PI * 6) * (1 - arrived);
  r.courier(x - 113 + arrived * 61, y + 39, 52, false,
    { stride, lift: Math.abs(stride) * 2, cloak: stride, facing: 1, moving: arrived < 1 });
  r.courier(x - 124 + arrived * 38, y + 47, 40, true, { alpha: .62, cloak: stride * .4, moving: arrived < 1 });
  if (frame.age >= 480) {
    const flight = ease(clamp((frame.age - 480) / 470));
    r.ctx.save();
    r.ctx.globalAlpha *= 1 - clamp((flight - .76) / .24);
    r.icon('letter', x - 47 + flight * 89, y + 10 - Math.sin(flight * Math.PI) * 42 - flight * 18,
      31 - flight * 8, C.goldText);
    r.ctx.restore();
  }
}

function drawReceipt(r, frame, modal, x, y) {
  drawPostalPaper(r, x - 98, y - 68, 196, 133, { binding: false, radius: 8 });
  r.text('风笺回廊 · 投递回执', x, y - 44, 11, C.goldText, 'center', '600');
  r.line([[x - 75, y - 26], [x + 75, y - 26]], '#cfbea0', 1, [2, 4]);
  r.label('第 ' + modal.delivery.levelId + ' 封来信', x, y - 8, 166, 14, C.ink, 'center', '600');
  r.label(modal.delivery.title, x, y + 14, 166, 11, C.muted, 'center');
  const strike = ease(clamp((frame.age - 950) / 270));
  r.ctx.save(); r.ctx.globalAlpha *= strike;
  const scale = 1.65 - strike * .65;
  r.ctx.translate(x + 58, y + 35 - (1 - strike) * 44); r.ctx.scale(scale, scale); r.ctx.rotate(-.19);
  drawPostmark(r, 0, 0, 45, 'check', '#ad654d');
  r.ctx.restore();
}

function drawRewards(r, modal, frame, x, y) {
  const rewards = modal.delivery.rewards, count = Math.min(3, rewards.length);
  if (!count) {
    drawPostmark(r, x, y - 15, 70, 'check', C.green);
    r.text('投递成绩已记入这段邮路', x, y + 53, 13, C.ink, 'center');
    return;
  }
  const width = count === 1 ? 88 : 78, height = width * 144 / 106, gap = 12;
  const left = x - (count * width + (count - 1) * gap) / 2;
  for (let index = 0; index < count; index++) {
    const progress = ease(clamp((frame.progress - index * .09) / .7));
    r.ctx.save(); r.ctx.globalAlpha *= progress;
    drawStampArt(r, rewards[index], { x: left + index * (width + gap), y: y - 61 + (1 - progress) * 13, w: width, h: height }, { scrolling: true });
    r.ctx.restore();
  }
  r.text('收到 ' + rewards.length + ' 枚新邮票', x, y + 75, 12, C.goldText, 'center', '600');
}

function drawDeliveryIntro(r, modal, now, age) {
  const frame = deliveryFrame(modal, age, r.reducedMotion);
  if (!frame) return null;
  const height = Math.min(472, r.H - 48), ui = { x: 22, y: Math.max(24, (r.H - height) / 2), w: 346, h: height };
  const x = 195, y = ui.y + Math.min(229, height * .485);
  r.scrim('#2c423daa');
  drawPostalPaper(r, ui.x, ui.y, ui.w, ui.h, { radius: 20 });
  r.text('山 间 邮 政', x, ui.y + 31, 11, C.goldText, 'center', '600');
  r.text('信已送达', x, ui.y + 70, 28, C.ink, 'center', '700');
  r.label(frame.title, x, ui.y + 103, 294, 13, C.muted, 'center');
  const c = r.ctx;
  c.save(); c.beginPath(); c.rect(ui.x + 18, ui.y + 125, ui.w - 36, Math.max(0, ui.h - 234)); c.clip();
  if (frame.index < 2) drawArrival(r, frame, x, y);
  else if (frame.index < 4) {
    drawReceipt(r, frame, modal, x, y - 11);
    if (frame.index === 3) drawResultStars(r, modal.stars, y + 83, (frame.age - 1400) * 1.4);
  } else drawRewards(r, modal, frame, x, y);
  c.restore();
  const progressY = ui.y + ui.h - 93;
  PHASES.forEach((phase, index) => {
    const markX = x - 64 + index * 32;
    if (index < PHASES.length - 1) r.line([[markX + 6, progressY], [markX + 26, progressY]], '#cfc2a3', 1);
    r.circle(markX, progressY, index === frame.index ? 4 : 2.5, index <= frame.index ? C.goldText : '#d0c5aa');
  });
  if (!r.deliveryPresentation || r.deliveryPresentation.modal !== modal) {
    r.deliveryPresentation = { modal, skip: () => { skipDelivery(modal); r.hits = []; } };
  }
  r.button('跳过演出 · 查看回执', 69, ui.y + ui.h - 74, 252, CONTROL.compactHeight,
    r.deliveryPresentation.skip, { style: 'text', size: 12, color: C.muted });
  return ui;
}

module.exports = { DELIVERY_MS, deliveryFrame, skipDelivery, drawDeliveryIntro };
