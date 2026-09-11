'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { C } = require('../src/theme');
const { CHAPTER_MOODS } = require('../src/chapter-atmosphere');

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4));
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function blend(foreground, background, alpha) {
  const channels = color => color.slice(1).match(/../g).map(value => parseInt(value, 16));
  const front = channels(foreground), back = channels(background);
  return '#' + front.map((value, index) => Math.round(value * alpha + back[index] * (1 - alpha))
    .toString(16).padStart(2, '0')).join('');
}

test('small interface text palette keeps AA contrast on common surfaces', () => {
  const surfaces = ['paper', 'panel', 'raised', 'bluePale', 'peach'];
  const textColors = ['ink', 'muted', 'green', 'blueText', 'goldText'];
  for (const textColor of textColors) {
    for (const surface of surfaces) {
      assert.ok(contrast(C[textColor], C[surface]) >= 4.5,
        `${textColor} on ${surface} must have at least 4.5:1 contrast`);
    }
  }
});

test('small text keeps AA contrast on its custom and atmospheric surfaces', () => {
  const pairs = [
    [C.goldText, '#f5dfb5', 'next-stamp badge'],
    [C.muted, '#e2eade', 'unowned stamp'],
    ['#70482d', '#e8c7a4', 'bronze rank'],
    ['#536c69', '#e0e8e4', 'silver rank'],
    ['#92643c', '#fff0d5', 'next-stamp name'],
    [C.muted, '#efe0bd', 'held collection card'],
    ['#2b737b', '#e9f2ee', 'active echo counter'],
  ];
  for (const [foreground, background, label] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${label} must have at least 4.5:1 contrast`);
  }
  for (const mood of CHAPTER_MOODS) {
    for (const key of ['skyTop', 'skyMid', 'skyBottom']) {
      const washedSky = blend(C.paper, mood[key], .02);
      assert.ok(contrast(C.muted, washedSky) >= 4.5,
        `muted home text over ${mood.id} ${key} must have at least 4.5:1 contrast`);
    }
  }
});
