'use strict';

const TIDE_PERIOD = 3;

/** Describe entry using the state before the next action, shared by rules and UI. */
function gateStatus(level, state, cell) {
  const tide = level.tideGates && level.tideGates[cell];
  if (tide) {
    const arrivalPhase = ((state ? state.turn : 0) + 1) % TIDE_PERIOD;
    const waitTurns = (tide.phase - arrivalPhase + TIDE_PERIOD) % TIDE_PERIOD;
    return { type: 'tide', cell, open: waitTurns === 0, phase: tide.phase, arrivalPhase, waitTurns };
  }
  const echo = level.echoGates && level.echoGates[cell];
  if (echo) return { type: 'echo', cell, plate: echo.plate, open: !!state && state.echo === echo.plate };
  return null;
}

function canEnter(level, state, cell) {
  const gate = gateStatus(level, state, cell);
  return !gate || gate.open;
}

module.exports = { TIDE_PERIOD, gateStatus, canEnter };
