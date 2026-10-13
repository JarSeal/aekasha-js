import type { ActionBindings } from '../../../kernel/input/ActionTypes';

/** `TOGGLE`: a press switches the state (default). `HOLD`: on while the binding is held. */
export type PlayerBrainHoldMode = 'TOGGLE' | 'HOLD';

/** The actions every player brain has besides its movement. */
type PlayerBrainCommonActions = {
  /** A press jumps (on the step it's sampled for). */
  jump: { type: 'BUTTON' };
  /** Run (see `runMode`). */
  run: { type: 'BUTTON' };
  /** Crouch (see `crouchMode`). */
  crouch: { type: 'BUTTON' };
};

/** The `TANK` brain's actions: `turn` positive to the left (counter-clockwise, as the intent's
 * `turn`) and `forward` positive forward, both -1 to 1. */
export type TankBrainActions = PlayerBrainCommonActions & {
  turn: { type: 'AXIS_1D' };
  forward: { type: 'AXIS_1D' };
};

/** The `WORLD_FIXED` and `CAMERA_RELATIVE` brains' actions: `move` up = North (`WORLD_FIXED`) or
 * screen-up (`CAMERA_RELATIVE`), right = East or screen-right. */
export type DirectionalBrainActions = PlayerBrainCommonActions & {
  move: { type: 'AXIS_2D' };
};

/** The params every player brain has. */
export type PlayerBrainCommonParams = {
  /** How the run binding works (default `TOGGLE`). */
  runMode?: PlayerBrainHoldMode;
  /** How the crouch binding works (default `TOGGLE`). */
  crouchMode?: PlayerBrainHoldMode;
  /** Turn toward the move direction while moving: sets the controller's `_turnToMoveDirection`
   * unless the character's `charData` gives it. Default: off for `TANK`, on for the others. */
  turnToMoveDirection?: boolean;
};

/**
 * The `TANK` player brain's params: turn bindings turn the character, forward bindings move it
 * along its facing. Its action map is `<characterId>:input`.
 * @example
 * ```ts
 * const params: TankBrainParams = {
 *   bindings: {
 *     turn: [
 *       { device: 'KEYBOARD', negative: ['d'], positive: ['a'] },
 *       { device: 'GAMEPAD', axis: 'LEFT_X', invert: true },
 *     ],
 *     forward: [
 *       { device: 'KEYBOARD', negative: ['s'], positive: ['w'] },
 *       { device: 'GAMEPAD', axis: 'LEFT_Y' },
 *     ],
 *     jump: [{ device: 'KEYBOARD', keys: [' '] }, { device: 'GAMEPAD', button: 'SOUTH' }],
 *   },
 * };
 * ```
 */
export type TankBrainParams = PlayerBrainCommonParams & {
  /** Each action's bindings (an action without any reads idle). */
  bindings: ActionBindings<TankBrainActions>;
};

/** The `WORLD_FIXED` player brain's params: `move` goes North (-Z), South, West (-X) and East.
 * Its action map is `<characterId>:input`. */
export type WorldFixedBrainParams = PlayerBrainCommonParams & {
  /** Each action's bindings (an action without any reads idle). */
  bindings: ActionBindings<DirectionalBrainActions>;
  /** When the move stops, keep turning in place (at `_rotateSpeed`) until the character faces the
   * last direction it moved in: a tap turns it all the way. Default false. */
  turnToLastMoveDirection?: boolean;
  /**
   * With `turnToLastMoveDirection`: a diagonal held this long (ms, counted in steps) before the
   * move stops is the last direction, so keys of a diagonal let go a step or two apart don't end
   * on one of its two directions. Default 80, 0 turns it off.
   */
  releaseGraceMs?: number;
};

/** The `CAMERA_RELATIVE` player brain's params: as `WORLD_FIXED`, with `move` along the camera's
 * view on the ground (up = screen-up), read at the step. */
export type CameraRelativeBrainParams = WorldFixedBrainParams & {
  /** The camera's entity (default: the main camera, also while the debug camera is on). */
  cameraEntityId?: number;
};
