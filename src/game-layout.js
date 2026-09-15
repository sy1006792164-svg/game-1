'use strict';

// One set of measurements keeps HUD, collection flights and the board aligned.
const GAME_LAYOUT = Object.freeze({
  x: 24, width: 342, objectivesY: 82, objectivesHeight: 64,
  timelineY: 154, boardTop: 154, gap: 8, bottomInset: 8,
  hintHeight: 50, hintSize: 13, hintLineHeight: 18
});

module.exports = { GAME_LAYOUT };
