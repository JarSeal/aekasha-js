import { afterEach, describe, expect, it } from 'vitest';
import { playActionRecording } from '../../../kernel/input/ActionRecording';
import { getActionMap, sampleActions } from '../../../kernel/input/Actions';
import type { ActionFrame, ActionFrameState } from '../../../kernel/input/ActionTypes';
import { clearIntentSubStep, createIntent } from '../CharacterIntent';
import type { CharacterIntent } from '../CharacterTypes';
import type { ActorBrain } from '../ActorTypes';
import {
  createWorldFixedBrain,
  getPlayerBrainActionMapId,
  type WorldFixedBrainParams,
} from './PlayerBrains';

// The brains are driven by a replayed recording of their action map (no bindings, so no device),
// with the controller's part played by clearing the intent's per-step fields after each think.

const DT = 1 / 60;
const NORTH = Math.PI / 2;
const EAST = 0;
const NORTH_EAST = Math.PI / 4;
const D = Math.SQRT1_2;

const UP: ActionFrameState = { isDown: true, value: 1, y: 1 };
const RIGHT: ActionFrameState = { isDown: true, value: 1, x: 1 };
const UP_RIGHT: ActionFrameState = { isDown: true, value: 1, x: D, y: D };

let brain: ActorBrain<CharacterIntent> | null = null;
afterEach(() => {
  brain?.dispose?.();
  brain = null;
});

/** Plays `moves` (step → the move action, idle when missing) through a WORLD_FIXED brain for
 * steps 0..lastStep, calling `beforeThink` first (code writing the intent), and returns the
 * intent's faceYaw after each step's think. */
const runBrain = (
  params: Omit<WorldFixedBrainParams, 'bindings'>,
  moves: { [step: number]: ActionFrameState },
  lastStep: number,
  beforeThink?: (intent: CharacterIntent, step: number) => void
) => {
  brain = createWorldFixedBrain({ bindings: {}, ...params }, 'brainTest');
  const map = getActionMap(getPlayerBrainActionMapId('brainTest'))!;
  const frames: ActionFrame[] = Object.keys(moves).map((step) => ({
    step: Number(step),
    actions: { move: moves[Number(step)] },
  }));
  playActionRecording(map, { mapId: map.id, firstStep: 0, lastStep, frames });

  const intent = createIntent();
  const faceYaws: (number | null)[] = [];
  for (let step = 0; step <= lastStep; step++) {
    sampleActions(step);
    beforeThink?.(intent, step);
    brain.think(intent, step, DT);
    faceYaws.push(intent.faceYaw);
    clearIntentSubStep(intent);
  }
  return faceYaws;
};

/** The same move for steps from..to. */
const hold = (move: ActionFrameState, from: number, to: number) => {
  const moves: { [step: number]: ActionFrameState } = {};
  for (let step = from; step <= to; step++) moves[step] = move;
  return moves;
};

describe('turnToLastMoveDirection', () => {
  it('is off by default: no faceYaw', () => {
    expect(runBrain({}, hold(UP, 2, 2), 6)).toEqual([null, null, null, null, null, null, null]);
  });

  it('turns all the way to a tap: faceYaw is the last move once it stops', () => {
    const faceYaws = runBrain({ turnToLastMoveDirection: true }, hold(UP, 2, 2), 6);
    // While moving the controller turns toward the move; from the release on, the heading stays
    expect(faceYaws).toEqual([null, null, null, NORTH, NORTH, NORTH, NORTH]);
  });

  it('keeps a diagonal let go of a step apart', () => {
    const moves = { ...hold(UP_RIGHT, 2, 10), ...hold(RIGHT, 11, 12) };
    const faceYaws = runBrain({ turnToLastMoveDirection: true }, moves, 15);
    expect(faceYaws[13]).toBeCloseTo(NORTH_EAST);
  });

  it('ends on the single direction held longer than releaseGraceMs', () => {
    // 80 ms: 4 steps at 60 Hz are inside it (66.7 ms), 5 aren't (83.3 ms)
    const inside = { ...hold(UP_RIGHT, 2, 10), ...hold(RIGHT, 11, 14) };
    expect(runBrain({ turnToLastMoveDirection: true }, inside, 16)[15]).toBeCloseTo(NORTH_EAST);
    const outside = { ...hold(UP_RIGHT, 2, 10), ...hold(RIGHT, 11, 15) };
    expect(runBrain({ turnToLastMoveDirection: true }, outside, 17)[16]).toBe(EAST);
  });

  it('ends on the last move with releaseGraceMs 0', () => {
    const moves = { ...hold(UP_RIGHT, 2, 10), ...hold(RIGHT, 11, 11) };
    const faceYaws = runBrain({ turnToLastMoveDirection: true, releaseGraceMs: 0 }, moves, 13);
    expect(faceYaws[12]).toBe(EAST);
  });

  it('gives way to turn input, which cancels the heading', () => {
    const faceYaws = runBrain({ turnToLastMoveDirection: true }, hold(UP, 2, 2), 8, (intent, s) => {
      if (s === 5) intent.turn = 1;
    });
    expect(faceYaws).toEqual([null, null, null, NORTH, NORTH, null, null, null, null]);
  });

  it('leaves a faceYaw written by code alone', () => {
    const faceYaws = runBrain({ turnToLastMoveDirection: true }, hold(UP, 4, 4), 6, (intent, s) => {
      if (s === 1) intent.faceYaw = 1;
    });
    // Neither the move nor its release replaces code's faceYaw
    expect(faceYaws).toEqual([null, 1, 1, 1, 1, 1, 1]);
  });
});
