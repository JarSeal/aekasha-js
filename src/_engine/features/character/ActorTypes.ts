// NOTE! Type-only file: everything here is erased at build time (as CharacterTypes.ts).
import type * as THREE from 'three/webgpu';
import type { CharacterConfigValues, CharacterIntent, CharacterObject } from './CharacterTypes';
import type {
  CameraRelativeBrainParams,
  TankBrainParams,
  WorldFixedBrainParams,
} from './brains/PlayerBrains';
import type { DynamicCharacterParams } from './DynamicCharacter';

// The actor contracts (p603 C1, C2, C4): what moves an actor (its controller) and what decides
// where it goes (its brain), named generically so a vehicle (p423) can lift them. Characters are
// the first kind of actor: the CHARACTER component is the actor record.

/**
 * What moves an actor's body: one per actor, ticked once per fixed physics step
 * (`APP_PHYSICS_STEP`). Only the tick writes the body: collision callbacks and other events record
 * what happened, and the tick applies it in its step.
 * @template TIntent the intent it reads (eg. `CharacterIntent`)
 */
export type ActorController<TIntent> = {
  /** Its registered kind (`registerControllerKind`), eg. `'DYNAMIC_CHARACTER'`. */
  readonly kind: string;
  /**
   * Runs once per fixed physics step, after the brains: reads the intent, moves the body and
   * clears the intent's per-step fields.
   * @param dt the fixed timestep (s)
   * @param intent the actor's intent (the same object every step)
   * @param step the step index (`getPhysicsSubStepIndex`): the controller's clock
   */
  tick: (dt: number, intent: TIntent, step: number) => void;
  /** Takes over an actor's body. Not called yet: a controller makes its own body until one is
   * swapped on a live actor (p421, p420). */
  attach?: (actorId: string) => void;
  /** Lets go of the body it attached. Not called yet (see `attach`). */
  detach?: () => void;
  /** Runs when the actor's entity is deleted, before its components are gone. */
  dispose?: () => void;
};

/**
 * What decides what an actor wants to do: a player's input, an AI, a script, a network peer. It
 * writes the actor's intent once per fixed physics step (`APP_PHYSICS_STEP`, before the
 * controllers) and never touches the body. Made from `{ kind, params }` by the factory registered
 * with `registerBrainKind`, so a save or a network message can rebuild it.
 * @template TIntent the intent it writes (eg. `CharacterIntent`)
 */
export type ActorBrain<TIntent> = {
  /** Its registered kind, eg. `'TANK'`. */
  readonly kind: string;
  /**
   * Writes this step's intent. Add to the summed fields (moves, turn) rather than overwrite them:
   * code may write the same intent.
   * @param intent the actor's intent (the same object every step)
   * @param step the step index (`getPhysicsSubStepIndex`): count durations in steps
   * @param dt the fixed timestep (s), to turn a duration into steps
   */
  think: (intent: TIntent, step: number, dt: number) => void;
  /** The controller configuration this brain suggests (eg. a player brain's
   * `_turnToMoveDirection`): set on the controller for every key its creation options didn't
   * give, when the brain is made and when it's switched in. */
  readonly configDefaults?: CharacterConfigValues;
  /** Runs when the brain is switched out or its actor is deleted (eg. deletes its action map). */
  dispose?: () => void;
};

/**
 * The character brain kinds and their params, by kind. The engine registers `TANK`, `WORLD_FIXED`
 * and `CAMERA_RELATIVE` (the player brains); add your own kind to it by declaration merging, then
 * register its factory with `registerBrainKind`.
 * @example
 * ```ts
 * declare module 'aekasha/character' {
 *   interface CharacterBrainKinds {
 *     PATROL: { waypoints: { x: number; z: number }[] };
 *   }
 * }
 * ```
 */
export interface CharacterBrainKinds {
  /** Turn and move along the facing ({@link TankBrainParams}). */
  TANK: TankBrainParams;
  /** Move in world directions ({@link WorldFixedBrainParams}). */
  WORLD_FIXED: WorldFixedBrainParams;
  /** Move along the camera's view ({@link CameraRelativeBrainParams}). */
  CAMERA_RELATIVE: CameraRelativeBrainParams;
}

/**
 * The character controller kinds and the params their factories take, by kind. The engine
 * registers `DYNAMIC_CHARACTER`; add a kind by declaration merging (as {@link CharacterBrainKinds})
 * and register its factory with `registerControllerKind`.
 */
export interface CharacterControllerKinds {
  /** `createDynamicCharacter`'s controller ({@link DynamicCharacterParams}). */
  DYNAMIC_CHARACTER: DynamicCharacterParams;
}

/** `{ kind, params }`, with `params` optional when every one of them is. */
type KindSpec<K extends string, P> = { kind: K } & (Partial<P> extends P
  ? { params?: P }
  : { params: P });

/** A character brain as plain data: its kind and that kind's params (see
 * {@link CharacterBrainKinds}). What a save or a network message records. */
export type CharacterBrainSpec = {
  [K in keyof CharacterBrainKinds & string]: KindSpec<K, CharacterBrainKinds[K]>;
}[keyof CharacterBrainKinds & string];

/** A character controller as data: its kind and that kind's params (see
 * {@link CharacterControllerKinds}). */
export type CharacterControllerSpec = {
  [K in keyof CharacterControllerKinds & string]: KindSpec<K, CharacterControllerKinds[K]>;
}[keyof CharacterControllerKinds & string];

/**
 * Makes a character brain from its kind's params (`registerBrainKind`).
 * @template TParams the kind's params
 */
export type CharacterBrainFactory<TParams> = (
  params: TParams,
  characterId: string
) => ActorBrain<CharacterIntent>;

/** What a controller kind's factory gets (`registerControllerKind`). */
export type CharacterControllerFactoryOpts<TParams> = {
  /** The character's id. */
  id: string;
  /** A display name. */
  name?: string;
  /** The visual root the body moves (resolved from an app id by `createCharacterOfKind`). */
  visual: THREE.Object3D;
  /** The kind's params. */
  params: TParams;
  /** Its brain, if any. */
  brain?: CharacterBrainSpec;
};

/**
 * Makes a character with its controller and body (`registerControllerKind`): resolves with the
 * character once it exists.
 * @template TParams the kind's params
 */
export type CharacterControllerFactory<TParams> = (
  opts: CharacterControllerFactoryOpts<TParams>
) => Promise<CharacterObject>;
