'use strict';

const { C } = require('./theme');
const { drawBurst } = require('./motion');
const { RESULT_DELAY_MS, RESULT_ANIMATION_MS } = require('./feedback-timing');

const clamp = value => Math.max(0, Math.min(1, value));
const easeOut = value => 1 - (1 - value) ** 3;

function drawDelivery(r, x, y, age) {
  const c = r.ctx, arrival = clamp(age / 420), eased = easeOut(arrival);
  if (age < 1100) {
    const spread = clamp(age / 1100);
    c.save(); c.globalAlpha *= (1 - spread) * .55;
    r.circle(x, y, 26 + spread * 30, null, C.gold);
    if (r.effectsQuality !== 'low') r.circle(x, y, 22 + spread * 18, null, C.green);
    c.restore();
  }
  const paper = (age - 140) / 1050;
  if (paper > 0 && paper < 1) {
    c.save(); c.globalAlpha *= Math.sin(paper * Math.PI) * .85;
    // Reuse the bounded, deterministic board burst.
    drawBurst(r, x - 58, y, 76, paper, C.gold, 17, true);
    drawBurst(r, x + 58, y, 76, paper, C.green, 61, true);
    c.restore();
  }
  c.save();
  c.translate(x, y + (1 - eased) * 13);
  c.rotate((1 - eased) * -.2);
  const scale = .74 + eased * .26 + Math.sin(arrival * Math.PI) * .13;
  r.icon('letter', 0, 0, 32 * scale, C.gold);
  c.restore();
  const seal = easeOut(clamp((age - 300) / 320));
  if (seal) {
    c.save(); c.globalAlpha *= seal;
    const radius = 10 * (.6 + seal * .4);
    r.circle(x + 22, y + 19, radius, C.green, C.white);
    r.icon('check', x + 22, y + 19, radius * 1.3, C.white);
    c.restore();
  }
}

function drawFadingLamp(r, x, y, age) {
  const c = r.ctx, progress = clamp(age / 800), light = (1 - progress) ** 2;
  if (light) {
    c.save(); c.globalAlpha *= light * .26;
    r.circle(x, y + 3, 25 + light * 11, C.gold);
    c.restore();
  }
  c.save(); c.translate(x, y);
  c.rotate(Math.sin(progress * Math.PI * 2) * (1 - progress) * .07);
  r.icon('lamp', 0, 0, 34, '#91a08d');
  if (light) {
    c.save(); c.globalAlpha *= light;
    r.icon('lamp', 0, 0, 34, C.gold);
    c.restore();
  }
  c.restore();
  // Failure motion ends quickly.
  const ember = (age - 100) / 850;
  if (ember > 0 && ember < 1) {
    c.save(); c.globalAlpha *= Math.sin(ember * Math.PI) * .6;
    for (let index = 0; index < (r.effectsQuality === 'low' ? 2 : 4); index++) {
      const drift = Math.sin(index * 2.1 + ember * 3) * (5 + index * 2);
      r.circle(x + drift, y - 11 - ember * (18 + index * 4), 1.5 - ember * .7, index % 2 ? C.gold : C.muted);
    }
    c.restore();
  }
}

function drawResultHeader(r, kind, ui, age) {
  const c = r.ctx, won = kind === 'win', x = ui.x + ui.w / 2, y = ui.y + 52;
  const elapsed = age === null || r.reducedMotion ? RESULT_ANIMATION_MS : Math.max(0, age);
  c.save();
  // Keep effects inside the existing emblem area.
  c.beginPath(); c.rect(ui.x + 8, ui.y + 8, ui.w - 16, 82); c.clip();
  r.circle(x, y, 31, won ? '#f5e9ca' : '#edeade', won ? '#c1ac72' : '#c1c6b4');
  r.circle(x, y, 25, won ? '#fff8e4' : '#f9f8ee', won ? '#ddc994' : '#d9dccc');
  c.beginPath(); c.arc(x, y, 29.5, Math.PI * 1.04, Math.PI * 1.88);
  c.strokeStyle = '#fffbea'; c.lineWidth = 1; c.stroke();
  c.beginPath(); c.arc(x, y, 29.5, .05, Math.PI * .87);
  c.strokeStyle = won ? '#98784380' : '#81917877'; c.lineWidth = .9; c.stroke();
  for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI / 8;
    r.circle(x + Math.cos(angle) * 28, y + Math.sin(angle) * 28, .75, won ? '#ba9a5f' : '#a7b39d');
  }
  if (won) drawDelivery(r, x, y, elapsed);
  else drawFadingLamp(r, x, y, elapsed);
  c.restore();
}

function drawResultStars(r, stars, y, age) {
  for (let index = 0; index < 3; index++) {
    const x = 150 + index * 45, size = index === 1 ? 36 : 29;
    r.icon('star', x, y, size, C.line);
    if (index >= stars) continue;
    const progress = age === null || r.reducedMotion ? 1 : clamp((age - 120 - index * 190) / 420);
    if (!progress) continue;
    const eased = easeOut(progress), pulse = Math.sin(progress * Math.PI);
    if (progress < 1) {
      r.ctx.save(); r.ctx.globalAlpha *= pulse * .3;
      r.circle(x, y, size * .48 + progress * 8, null, C.gold);
      r.ctx.restore();
    }
    r.ctx.save(); r.ctx.globalAlpha *= eased;
    r.icon('star', x, y, size * (.6 + eased * .4 + pulse * .14), C.yellow);
    r.ctx.restore();
    if (progress === 1 || r.effectsQuality === 'low') continue;
    r.ctx.save(); r.ctx.globalAlpha *= pulse * .8;
    for (let side = -1; side <= 1; side += 2) {
      const sparkX = x + side * (14 + progress * 8), sparkY = y - 12 - progress * 5;
      r.line([[sparkX - 2, sparkY], [sparkX + 2, sparkY]], C.gold, 1.2);
      r.line([[sparkX, sparkY - 2], [sparkX, sparkY + 2]], C.gold, 1.2);
    }
    r.ctx.restore();
  }
}

module.exports = { RESULT_DELAY_MS, drawResultHeader, drawResultStars };
