import type { KeyActionBinding } from '../../kernel/input/ActionTypes';
import type { CharacterBrainSpec } from './ActorTypes';
import type { PlayerBrainCommonParams, PlayerBrainHoldMode } from './brains/PlayerBrains';

// The input schemes, before the player brains (p610 D5): `createDynamicCharacter`'s deprecated
// `input` option, mapped onto a player brain of the same name with the same keys.

/**
 * How keys map to a character's intent:
 * - `TANK`: turn keys turn the character, forward/backward keys move along its facing.
 * - `WORLD_FIXED`: the keys move North (-Z), South (+Z), West (-X) and East (+X); combinations
 *   move diagonally. The character turns toward the move direction.
 * - `CAMERA_RELATIVE`: like `WORLD_FIXED`, with forward = the camera's view direction on the
 *   ground (screen-up).
 * @deprecated Use a player brain of the same kind (`brain: { kind: 'TANK', params }`), removed in
 * engine 6.0.0.
 */
export type CharacterInputScheme = 'TANK' | 'WORLD_FIXED' | 'CAMERA_RELATIVE';

/**
 * `TOGGLE`: a key press switches the state (default). `HOLD`: on while the key is held.
 * @deprecated Use `PlayerBrainHoldMode` (removed in engine 6.0.0).
 */
export type CharacterInputHoldMode = PlayerBrainHoldMode;

/** The keys every scheme has (all optional). Keys are `KeyboardEvent.key` values
 * (case-insensitive); any of them triggers the action. */
export type CharacterActionMappings = {
  /** Jump (on key press). */
  jump?: string[];
  /** Run (see `runMode`). */
  run?: string[];
  /** Crouch (see `crouchMode`). */
  crouch?: string[];
};

/** `TANK` keys: turn left and right, and move along the facing. */
export type TankInputMappings = CharacterActionMappings & {
  rotateLeft: string[];
  rotateRight: string[];
  moveForward: string[];
  moveBackward: string[];
};

/** `WORLD_FIXED` keys: move North (-Z), South (+Z), West (-X) and East (+X). */
export type WorldFixedInputMappings = CharacterActionMappings & {
  moveNorth: string[];
  moveSouth: string[];
  moveWest: string[];
  moveEast: string[];
};

/** `CAMERA_RELATIVE` keys: move up, down, left and right on the screen (along the camera's view
 * on the ground). */
export type CameraRelativeInputMappings = CharacterActionMappings & {
  moveForward: string[];
  moveBackward: string[];
  moveLeft: string[];
  moveRight: string[];
};

/** The input options every scheme has. */
export type CharacterInputCommonOpts = {
  /** How the run key works (default `TOGGLE`). */
  runMode?: CharacterInputHoldMode;
  /** How the crouch key works (default `TOGGLE`). */
  crouchMode?: CharacterInputHoldMode;
};

/**
 * A character's keyboard input: a scheme and its key mappings.
 * @deprecated Use `createDynamicCharacter`'s `brain` (a player brain on an action map), removed in
 * engine 6.0.0.
 */
export type CharacterInputOpts = CharacterInputCommonOpts &
  (
    | { scheme: 'TANK'; mappings: TankInputMappings }
    | { scheme: 'WORLD_FIXED'; mappings: WorldFixedInputMappings }
    | {
        scheme: 'CAMERA_RELATIVE';
        mappings: CameraRelativeInputMappings;
        /** The camera whose view the keys follow (default: the main camera, also while the debug
         * camera is on). */
        cameraEntityId?: number;
      }
  );

/** Keys as a keyboard button binding, or none without keys. */
const keysBinding = (keys: string[] | undefined): KeyActionBinding[] =>
  keys?.length ? [{ device: 'KEYBOARD', keys }] : [];

/**
 * The player brain an input scheme is now (the same kind, its mappings as keyboard bindings):
 * what `createDynamicCharacter` makes for the deprecated `input` option.
 * @internal
 */
export const getInputBrainSpec = (opts: CharacterInputOpts): CharacterBrainSpec => {
  const m = opts.mappings;
  const common: PlayerBrainCommonParams = { runMode: opts.runMode, crouchMode: opts.crouchMode };
  const jump = keysBinding(m.jump);
  const run = keysBinding(m.run);
  const crouch = keysBinding(m.crouch);
  switch (opts.scheme) {
    case 'TANK':
      return {
        kind: 'TANK',
        params: {
          ...common,
          bindings: {
            turn: [
              {
                device: 'KEYBOARD',
                negative: opts.mappings.rotateRight,
                positive: opts.mappings.rotateLeft,
              },
            ],
            forward: [
              {
                device: 'KEYBOARD',
                negative: opts.mappings.moveBackward,
                positive: opts.mappings.moveForward,
              },
            ],
            jump,
            run,
            crouch,
          },
        },
      };
    case 'WORLD_FIXED': {
      const w = opts.mappings;
      return {
        kind: 'WORLD_FIXED',
        params: {
          ...common,
          bindings: {
            move: [
              {
                device: 'KEYBOARD',
                up: w.moveNorth,
                down: w.moveSouth,
                left: w.moveWest,
                right: w.moveEast,
              },
            ],
            jump,
            run,
            crouch,
          },
        },
      };
    }
    case 'CAMERA_RELATIVE': {
      const c = opts.mappings;
      return {
        kind: 'CAMERA_RELATIVE',
        params: {
          ...common,
          cameraEntityId: opts.cameraEntityId,
          bindings: {
            move: [
              {
                device: 'KEYBOARD',
                up: c.moveForward,
                down: c.moveBackward,
                left: c.moveLeft,
                right: c.moveRight,
              },
            ],
            jump,
            run,
            crouch,
          },
        },
      };
    }
  }
};
