import type * as THREE from 'three/webgpu';
import type {
  ActionBindings,
  ActionDefs,
  ActionMap,
  ActionState,
} from '../../../kernel/input/ActionTypes';
import { createActionMap } from '../../../kernel/input/Actions';
import { getMainCamera } from '../../../kernel/camera/Camera';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { addIntentMove, yawFromDirection } from '../CharacterIntent';
import type { CharacterIntent } from '../CharacterTypes';
import type { ActorBrain } from '../ActorTypes';
import { registerBrainKind } from '../ActorKinds';

// The engine's player brains (p603 C4, p610 D5): each owns an action map (`<characterId>:input`,
// GAMEPLAY context) read at the step, so the intent is written once per fixed step from the same
// sample on every run. They write the intent only; the controller's tick is what moves the body.

/** `TOGGLE`: a press switches the state (default). `HOLD`: on while the binding is held. */
export type PlayerBrainHoldMode = 'TOGGLE' | 'HOLD';

/** The actions every player brain has besides its movement: part of {@link TankBrainActions} and
 * {@link DirectionalBrainActions}. */
export type PlayerBrainCommonActions = {
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
  /** Turn toward the move direction while moving: sets the controller's `turnToMoveDirection`
   * unless the character's `config` gives it. Default: off for `TANK`, on for the others. */
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

const COMMON_ACTIONS = {
  jump: { type: 'BUTTON', name: 'Jump' },
  run: { type: 'BUTTON', name: 'Run' },
  crouch: { type: 'BUTTON', name: 'Crouch' },
} as const satisfies ActionDefs;

const TANK_ACTIONS = {
  turn: { type: 'AXIS_1D', name: 'Turn', description: 'Positive turns left' },
  forward: { type: 'AXIS_1D', name: 'Forward', description: 'Positive moves forward' },
  ...COMMON_ACTIONS,
} as const satisfies ActionDefs;

const DIRECTIONAL_ACTIONS = {
  move: { type: 'AXIS_2D', name: 'Move' },
  ...COMMON_ACTIONS,
} as const satisfies ActionDefs;

/** A player brain's action map id: `<characterId>:input`. */
export const getPlayerBrainActionMapId = (characterId: string) => `${characterId}:input`;

/** A run or crouch action into the intent: `HOLD` follows the binding, `TOGGLE` switches on each
 * press (two presses in one sample switch twice). */
const applyStateAction = (
  intent: CharacterIntent,
  key: 'run' | 'crouch',
  action: Readonly<ActionState>,
  mode: PlayerBrainHoldMode
) => {
  if (mode === 'HOLD') intent[key] = action.isDown;
  else if (action.pressedCount % 2 === 1) intent[key] = !intent[key];
};

/** The parts every player brain has: the map, jump, run and crouch, and its config default. */
const createPlayerBrain = <TActions extends ActionDefs & typeof COMMON_ACTIONS>(
  kind: string,
  characterId: string,
  actions: TActions,
  params: PlayerBrainCommonParams & { bindings: ActionBindings<TActions> },
  turnsToMoveDirection: boolean,
  thinkMove: (map: ActionMap<TActions>, intent: CharacterIntent, step: number, dt: number) => void
): ActorBrain<CharacterIntent> => {
  const map: ActionMap<TActions> = createActionMap({
    id: getPlayerBrainActionMapId(characterId),
    actions,
    bindings: params.bindings,
  });
  // The actions every player brain has (a generic map can't name them)
  const common = map as unknown as ActionMap<typeof COMMON_ACTIONS>;
  const runMode = params.runMode ?? 'TOGGLE';
  const crouchMode = params.crouchMode ?? 'TOGGLE';
  return {
    kind,
    configDefaults: Object.freeze({
      turnToMoveDirection: params.turnToMoveDirection ?? turnsToMoveDirection,
    }),
    think: (intent, step, dt) => {
      thinkMove(map, intent, step, dt);
      if (common.read('jump').pressedCount > 0) intent.jump = true;
      applyStateAction(intent, 'run', common.read('run'), runMode);
      applyStateAction(intent, 'crouch', common.read('crouch'), crouchMode);
    },
    dispose: () => map.delete(),
  };
};

const _cameraForward = { x: 0, z: -1 };
/** The camera's screen-up direction on the ground, into _cameraForward (North without one). */
const readCameraForward = (cameraEntityId?: number) => {
  const camera =
    cameraEntityId === undefined
      ? getMainCamera()
      : (getECSWorld().getComponent(cameraEntityId, ComponentType.OBJECT3D)?.value as
          | THREE.Object3D
          | undefined);
  _cameraForward.x = 0;
  _cameraForward.z = -1;
  if (!camera) return _cameraForward;
  const e = camera.matrixWorld.elements;
  // The view direction (-Z axis) on the ground, or the up axis for a camera looking straight down
  let x = -e[8];
  let z = -e[10];
  let length = Math.hypot(x, z);
  if (length < 1e-4) {
    x = e[4];
    z = e[6];
    length = Math.hypot(x, z);
  }
  if (length < 1e-4) return _cameraForward;
  _cameraForward.x = x / length;
  _cameraForward.z = z / length;
  return _cameraForward;
};

/** {@link WorldFixedBrainParams.releaseGraceMs}' default. */
const DEFAULT_RELEASE_GRACE_MS = 80;

/** The last heading's per-step update: this step's `move` action and the world move the brain
 * made of it (0, 0 without one). */
type LastHeadingFn = (
  intent: CharacterIntent,
  step: number,
  dt: number,
  move: Readonly<ActionState>,
  worldX: number,
  worldZ: number
) => void;

/**
 * D10's turn to the last heading (`turnToLastMoveDirection`), or null when it's off. While there's
 * move input it remembers the move's yaw and leaves `faceYaw` to the controller's turn toward the
 * move; on the first step without one it writes the last heading to `faceYaw`, which the
 * controller turns toward until it's reached. The last heading is the last diagonal when one was
 * held within `releaseGraceMs` (counted in steps) of the move's last step, else the last move. A
 * turn in the intent (code, before the brain) cancels it, and a `faceYaw` written by anyone else
 * is left alone (and kept over the last heading).
 */
const createLastHeading = (params: WorldFixedBrainParams): LastHeadingFn | null => {
  if (!params.turnToLastMoveDirection) return null;
  const graceMs = Math.max(0, params.releaseGraceMs ?? DEFAULT_RELEASE_GRACE_MS);
  let isMoving = false;
  let lastStep = -1;
  let lastYaw = 0;
  let diagonalStep = -1;
  let diagonalYaw = 0;
  /** The faceYaw this brain wrote, while the intent still holds it. */
  let writtenYaw: number | null = null;

  const clearWrittenYaw = (intent: CharacterIntent) => {
    if (writtenYaw !== null && intent.faceYaw === writtenYaw) intent.faceYaw = null;
    writtenYaw = null;
  };

  return (intent, step, dt, move, worldX, worldZ) => {
    if (intent.turn !== 0) {
      isMoving = false;
      clearWrittenYaw(intent);
      return;
    }
    if (move.value !== 0) {
      const yaw = yawFromDirection(worldX, worldZ);
      lastStep = step;
      lastYaw = yaw;
      if (move.x !== 0 && move.y !== 0) {
        diagonalStep = step;
        diagonalYaw = yaw;
      }
      isMoving = true;
      clearWrittenYaw(intent);
      return;
    }
    if (!isMoving) return;
    isMoving = false;
    // Someone else's heading wins (eg. code aiming the character)
    if (intent.faceYaw !== null) return;
    const isDiagonalRecent = diagonalStep >= 0 && (lastStep - diagonalStep) * dt * 1000 <= graceMs;
    writtenYaw = isDiagonalRecent ? diagonalYaw : lastYaw;
    intent.faceYaw = writtenYaw;
  };
};

/** Makes a `TANK` player brain ({@link TankBrainParams}). */
export const createTankBrain = (
  params: TankBrainParams,
  characterId: string
): ActorBrain<CharacterIntent> =>
  createPlayerBrain('TANK', characterId, TANK_ACTIONS, params, false, (map, intent) => {
    intent.turn += map.read('turn').value;
    intent.moveForward += map.read('forward').value;
  });

/** Makes a `WORLD_FIXED` player brain ({@link WorldFixedBrainParams}): up is North (-Z). */
export const createWorldFixedBrain = (
  params: WorldFixedBrainParams,
  characterId: string
): ActorBrain<CharacterIntent> => {
  const lastHeading = createLastHeading(params);
  return createPlayerBrain(
    'WORLD_FIXED',
    characterId,
    DIRECTIONAL_ACTIONS,
    params,
    true,
    (map, intent, step, dt) => {
      const move = map.read('move');
      if (move.value !== 0) addIntentMove(intent, move.x, -move.y);
      lastHeading?.(intent, step, dt, move, move.x, -move.y);
    }
  );
};

/** Makes a `CAMERA_RELATIVE` player brain ({@link CameraRelativeBrainParams}): the camera is
 * read at the step, so the intent (and a recording of it) carries the world move, not the camera. */
export const createCameraRelativeBrain = (
  params: CameraRelativeBrainParams,
  characterId: string
): ActorBrain<CharacterIntent> => {
  const cameraEntityId = params.cameraEntityId;
  const lastHeading = createLastHeading(params);
  return createPlayerBrain(
    'CAMERA_RELATIVE',
    characterId,
    DIRECTIONAL_ACTIONS,
    params,
    true,
    (map, intent, step, dt) => {
      const move = map.read('move');
      if (move.value === 0) {
        lastHeading?.(intent, step, dt, move, 0, 0);
        return;
      }
      // Up = the camera's forward f, right = f turned 90° clockwise seen from above: (-f.z, f.x)
      const f = readCameraForward(cameraEntityId);
      const worldX = f.x * move.y - f.z * move.x;
      const worldZ = f.z * move.y + f.x * move.x;
      addIntentMove(intent, worldX, worldZ);
      lastHeading?.(intent, step, dt, move, worldX, worldZ);
    }
  );
};

/**
 * Registers the engine's player brain kinds, `TANK`, `WORLD_FIXED` and `CAMERA_RELATIVE` (the
 * character feature's install).
 * @internal
 */
export const registerPlayerBrains = () => {
  registerBrainKind('TANK', createTankBrain);
  registerBrainKind('WORLD_FIXED', createWorldFixedBrain);
  registerBrainKind('CAMERA_RELATIVE', createCameraRelativeBrain);
};
