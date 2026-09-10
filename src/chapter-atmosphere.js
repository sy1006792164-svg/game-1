'use strict';

function freezeMood(mood) {
  return Object.freeze({
    ...mood,
    leaves: Object.freeze(mood.leaves.slice()),
    particles: Object.freeze(mood.particles.slice())
  });
}

// Six quiet, paper-friendly palettes describe the journey without recoloring
// gameplay symbols. Chapters are zero-based and move through these in order.
const CHAPTER_MOODS = Object.freeze([
  freezeMood({
    id: 'dawn',
    skyTop: '#fbf5e8', skyMid: '#e8f0e5', skyBottom: '#d6e5d9',
    celestial: '#f1d99f', celestialGlow: '#fff2c766',
    ridgeFar: '#d8e3d4', ridgeNear: '#c6d8c7',
    fogFar: '#f4f5e9a8', fogNear: '#edf2e6cc',
    treeFar: '#aac5b0', treeNear: '#789b84',
    light: '#efc879', mote: '#e2b96f', wind: '#6f9a88', windWarm: '#b78667',
    cloud: '#b9cdbd', cloudCore: '#8fac98', mistA: '#e4eee4', mistB: '#f5eddb',
    leaves: ['#537b66', '#789c79', '#a7b88a'],
    particles: ['#d9aa62', '#fff2c2', '#d9977d', '#eed5a2']
  }),
  freezeMood({
    id: 'green-mist',
    skyTop: '#f4f7ed', skyMid: '#dfeee5', skyBottom: '#ccdfd6',
    celestial: '#e8dfa9', celestialGlow: '#f8efc45c',
    ridgeFar: '#cfdfd2', ridgeNear: '#b7d0c2',
    fogFar: '#edf4e9b5', fogNear: '#e4efe8d1',
    treeFar: '#98bba6', treeNear: '#648f78',
    light: '#d8c47b', mote: '#c5ad68', wind: '#5d9484', windWarm: '#aa8064',
    cloud: '#abc8bb', cloudCore: '#7fa99b', mistA: '#d8ebe1', mistB: '#eef3e5',
    leaves: ['#426f5e', '#6d9979', '#9eb78a'],
    particles: ['#c9aa64', '#eef2bf', '#b98672', '#d9d9a0']
  }),
  freezeMood({
    id: 'soft-rain',
    skyTop: '#f1f3ef', skyMid: '#dfe9e7', skyBottom: '#cfdedb',
    celestial: '#e5e6d7', celestialGlow: '#f7f5df4f',
    ridgeFar: '#d3dddd', ridgeNear: '#bdcfcb',
    fogFar: '#eef2efb8', fogNear: '#e2ece9d6',
    treeFar: '#a2b9ad', treeNear: '#708f82',
    light: '#d8bd7d', mote: '#bda874', wind: '#6e9692', windWarm: '#a68470',
    cloud: '#b8c8c5', cloudCore: '#8ca7a3', mistA: '#d7e5e3', mistB: '#e9ece5',
    leaves: ['#55766c', '#78958a', '#9eaea0'],
    particles: ['#aebfba', '#e8eee8', '#c29d8d', '#d8cda9']
  }),
  freezeMood({
    id: 'sunset',
    skyTop: '#fbefe5', skyMid: '#efdfda', skyBottom: '#d9e0d5',
    celestial: '#edbd84', celestialGlow: '#ffd7a06b',
    ridgeFar: '#dfd5cf', ridgeNear: '#c9d2c4',
    fogFar: '#f7e9dfad', fogNear: '#efe7d9cf',
    treeFar: '#b4bba1', treeNear: '#7f9778',
    light: '#e5ac70', mote: '#d38f65', wind: '#7f9986', windWarm: '#c37f68',
    cloud: '#cbbcb6', cloudCore: '#a58f8a', mistA: '#e8dcd6', mistB: '#f4e4d0',
    leaves: ['#6e7e62', '#a08e67', '#bd846e'],
    particles: ['#d28b68', '#f4d49b', '#c8786d', '#ead2ad']
  }),
  freezeMood({
    id: 'moon-path',
    skyTop: '#edf0f4', skyMid: '#dfe7e9', skyBottom: '#cedddc',
    celestial: '#f2eccf', celestialGlow: '#f8f0c95c',
    ridgeFar: '#d3dce0', ridgeNear: '#bdced0',
    fogFar: '#eef2f1ad', fogNear: '#e0e9e8cf',
    treeFar: '#9fb5ae', treeNear: '#687f79',
    light: '#dbc48a', mote: '#c4b27e', wind: '#688d91', windWarm: '#9a7d73',
    cloud: '#b4c5c8', cloudCore: '#879fa3', mistA: '#d6e3e5', mistB: '#ebe9df',
    leaves: ['#4f6b66', '#738b82', '#98a89a'],
    particles: ['#aebfc2', '#ece7c8', '#b39a91', '#d6cfb1']
  }),
  freezeMood({
    id: 'home-lights',
    skyTop: '#f8f0e2', skyMid: '#eadfd4', skyBottom: '#d6ded3',
    celestial: '#e9c48e', celestialGlow: '#f9dfad66',
    ridgeFar: '#ded8cb', ridgeNear: '#c5d0bf',
    fogFar: '#f3ebdfad', fogNear: '#e9e8d9cf',
    treeFar: '#a9b99d', treeNear: '#728a70',
    light: '#e2b06d', mote: '#cf965f', wind: '#789484', windWarm: '#b8765f',
    cloud: '#c5c2b5', cloudCore: '#9da28f', mistA: '#dfe4d7', mistB: '#f1dfca',
    leaves: ['#536f5b', '#7d906b', '#aa9a72'],
    particles: ['#d59a61', '#f4dda6', '#c77e68', '#e5c9a0']
  })
]);

function chapterMood(chapter, totalChapters = 167) {
  const total = Number.isInteger(totalChapters) && totalChapters > 0 ? totalChapters : 167;
  const index = Number.isInteger(chapter) && chapter >= 0 && chapter < total ? chapter : 0;
  const bucket = Math.min(CHAPTER_MOODS.length - 1, Math.floor(index * CHAPTER_MOODS.length / total));
  return CHAPTER_MOODS[bucket];
}

module.exports = Object.freeze({ CHAPTER_MOODS, chapterMood });
