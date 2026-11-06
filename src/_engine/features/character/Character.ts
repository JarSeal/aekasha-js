import type * as THREE from 'three/webgpu';
import { createPhysicsEntity } from '../physics/PhysicsEntity';
import { getPhysicsSubStepIndex } from '../physics/PhysicsStepping';
import type { RigidBodyParams } from '../physics/types/PhysicsBodyTypes';
import type { ColliderParams } from '../physics/types/PhysicsColliderTypes';
import { type ECSWorld, getECSWorld, getEntityIdByAppId } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type {
  CharacterBodyKindField,
  CharacterControlMode,
  CharacterIntent,
  CharacterObject,
  LocomotionState,
  LocomotionStateListener,
} from './CharacterTypes';
import { createIntent } from './CharacterIntent';
import type { ActorBrain, CharacterBrainSpec } from './ActorTypes';
import { createBrain } from './ActorKinds';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import {
  loadDebugModuleAsync,
  useDebug,
  type DebugModuleRef,
} from '../../kernel/config/DebugModules';

export type {
  CharacterBodyPlan,
  CharacterConfigValues,
  CharacterControllerConfig,
  CharacterControlMode,
  CharacterController,
  CharacterIntent,
  CharacterObject,
  LocomotionState,
  LocomotionStateListener,
} from './CharacterTypes';

/** Character id → entity id, in the default ECS world (where createCharacter puts every
 * character). The characters themselves live in the CHARACTER component storage. */
const characterEntityIds = new Map<string, number>();
let onDeleteCharacter: { [characterId: string]: () => void } = {};
/** Entity id → its character's locomotion state listeners (gone with the entity). */
const locomotionStateListeners = new Map<number, LocomotionStateListener[]>();

/** After the other APP_PHYSICS_STEP systems (default order 0), so what those write to a
 * character's intent applies in the same sub-step, and after the brains. */
const CHARACTER_SYSTEM_ORDER = -10;
/** Between the app's systems (order 0) and the controllers: a brain sees what code wrote to the
 * intent this sub-step (eg. a turn overriding a player brain's heading). */
const CHARACTER_BRAIN_SYSTEM_ORDER = -5;

/** Runs every character's brain once per fixed physics sub-step, before the controllers. */
const characterBrainSystem = (world: ECSWorld, dt: number) => {
  const storage = world.getStorage(ComponentType.CHARACTER);
  const step = getPhysicsSubStepIndex();
  // keys() + get(): the storage's own iterator allocates a [key, value] pair per entry
  for (const entityId of storage.keys()) {
    const char = storage.get(entityId)!;
    char.brain?.think(char.intent, step, dt);
  }
};

/** Ticks every character's controller once per fixed physics sub-step. */
const characterControllerSystem = (world: ECSWorld, dt: number) => {
  const storage = world.getStorage(ComponentType.CHARACTER);
  const step = getPhysicsSubStepIndex();
  for (const entityId of storage.keys()) {
    const char = storage.get(entityId)!;
    char.controller?.tick(dt, char.intent, step);
  }
};

/**
 * Installs the characters' brain and controller systems and the `CHARACTER` delete hook (the
 * character feature's install).
 * @internal
 */
export const installCharacters = (ctx: FeatureContext) => {
  ctx.registerPlugin((world) => {
    world.addSystem(
      ECSSystemStage.APP_PHYSICS_STEP,
      'characterBrainSystem',
      characterBrainSystem,
      CHARACTER_BRAIN_SYSTEM_ORDER
    );
    world.addSystem(
      ECSSystemStage.APP_PHYSICS_STEP,
      'characterControllerSystem',
      characterControllerSystem,
      CHARACTER_SYSTEM_ORDER
    );
  });

  // Every way a character's entity goes (deleteCharacter, a scene change, the debugger, a direct
  // world.deleteEntity) cleans up the same way.
  ctx.registerComponentHooks(ComponentType.CHARACTER, {
    onDeleteEntity: (entityId, world) => {
      const char = world.getComponent(entityId, ComponentType.CHARACTER);
      if (!char) return;
      char.brain?.dispose?.();
      char.brain = undefined;
      char.controller?.dispose?.();
      if (characterEntityIds.get(char.id) === entityId) characterEntityIds.delete(char.id);
      locomotionStateListeners.delete(entityId);
      const onDelete = onDeleteCharacter[char.id];
      delete onDeleteCharacter[char.id];
      onDelete?.();
      // The entity still exists while its hooks run
      queueCharactersDebuggerUpdate();
    },
  });
};

/** {@link createCharacter}'s options. The body's kind (eg. `'HUMANOID'`) is usually its body
 * plan's `bodyKind`. */
export type CreateCharacterOpts = CharacterBodyKindField & {
  /** The character's id: the public handle ({@link getCharacterById}, {@link deleteCharacter}). */
  id: string;
  /** A display name (the debug tools show it). */
  name?: string;
  /** The (possibly compound) physics body: colliders and an optional shared rigid body. */
  physicsParams: { colliders: ColliderParams | ColliderParams[]; rigidBody?: RigidBodyParams };
  /** The visual root (eg. a mesh or a group made with createMeshEntity or createGroupEntity), or
   * its app id: its entity becomes the character. */
  visual: THREE.Object3D | string;
  /** The intent the controller reads (default: a new one). */
  intent?: CharacterIntent;
  /** The brain that writes the intent (see {@link setCharacterBrain}), made by the controller's
   * creator (it may suggest controller configuration first). Disposed with the character. */
  brain?: ActorBrain<CharacterIntent>;
};

/**
 * Creates a character: adds the physics body, a `CHARACTER` component ({@link CharacterObject})
 * and `TAG_IS_CHARACTER` to the visual's entity. Deleting that entity any way deletes the
 * character and disposes of its brain and controller. An existing character with the same id is
 * replaced. Controllers build on this (eg. createDynamicCharacter): a character created here alone
 * has no controller, so nothing moves it.
 * @param opts see {@link CreateCharacterOpts}
 * @returns the character ({@link CharacterObject})
 */
export const createCharacter = async (opts: CreateCharacterOpts) => {
  const { id, name, bodyKind, physicsParams, visual, intent = createIntent(), brain } = opts;

  if (deleteCharacter(id)) {
    lwarn(`createCharacter: replaced the existing character with id '${id}'.`);
  }

  const ecsWorld = getECSWorld();
  const visualAppId = typeof visual === 'string' ? visual : (visual.userData.id as string);
  const entityId: number = existsOrThrow(
    (typeof visual === 'string' ? undefined : visual.userData.entityId) ??
      (visualAppId !== undefined ? getEntityIdByAppId(visualAppId, ecsWorld) : undefined),
    `Could not find the entity of visual '${visualAppId}' in createCharacter.`
  );
  existsOrThrow(
    ecsWorld.getComponent(entityId, ComponentType.OBJECT3D),
    `The entity of visual '${visualAppId}' has no Object3D in createCharacter.`
  );
  const visualId = ecsWorld.getComponent(entityId, ComponentType.APP_ID)?.id ?? visualAppId;

  await createPhysicsEntity(
    { colliders: physicsParams.colliders, body: physicsParams.rigidBody, target: entityId },
    // FULL over a streaming cell's creation scope: characters have no tiers (p420 owns theirs)
    { world: ecsWorld, initialTier: 'FULL' }
  );

  const char: CharacterObject = {
    id,
    name,
    bodyKind,
    entityId,
    visualId,
    intent,
    controlMode: 'CONTROLLED',
    brain,
  };
  ecsWorld.addComponent(entityId, ComponentType.CHARACTER, char);
  ecsWorld.addComponent(entityId, ComponentType.TAG_IS_CHARACTER, true);
  characterEntityIds.set(id, entityId);

  updateCharactersDebuggerGUI();

  return char;
};

/** Deletes a character's entity: its physics body, mesh and bindings go with it (the CHARACTER
 * delete hook). Returns false when no character has this id. */
export const deleteCharacter = (id: string) => {
  const entityId = characterEntityIds.get(id);
  if (entityId === undefined) return false;
  getECSWorld().deleteEntity(entityId);
  return true;
};

/** Deletes all characters of the world (default: the default ECS world). */
export const deleteAllCharacters = (world: ECSWorld = getECSWorld()) => {
  const entityIds = [...world.getEntitiesWith(ComponentType.CHARACTER)];
  for (let i = 0; i < entityIds.length; i++) world.deleteEntity(entityIds[i]);
  onDeleteCharacter = {};
};

/** Calls `fn` when the character with this id is deleted (any way). One function per id: a new
 * one replaces the old. */
export const registerOnDeleteCharacter = (id: string, fn: () => void) =>
  (onDeleteCharacter[id] = fn);

/** Every character of the world (default: the default ECS world), as a new array. */
export const getCharacters = (world: ECSWorld = getECSWorld()): CharacterObject[] => {
  const storage = world.getStorage(ComponentType.CHARACTER);
  const characters: CharacterObject[] = [];
  for (const entityId of storage.keys()) characters.push(storage.get(entityId)!);
  return characters;
};

/** The character with this id, or undefined. */
export const getCharacterById = (id: string): CharacterObject | undefined => {
  const entityId = characterEntityIds.get(id);
  if (entityId === undefined) return undefined;
  return getECSWorld().getComponent(entityId, ComponentType.CHARACTER);
};

/**
 * Sets who moves a character's body ({@link CharacterControlMode}): `PHYSICS_ONLY` hands it to
 * physics alone (eg. a ragdoll), `CONTROLLED` gives it back to the controller, which first makes
 * the character get up. The controller applies the change on its next tick, so nothing outside
 * the tick touches the body. Returns false when no character has this id.
 */
export const setControlMode = (id: string, mode: CharacterControlMode) => {
  const char = getCharacterById(id);
  if (!char) return false;
  char.controlMode = mode;
  return true;
};

/**
 * Switches a character's brain, eg. for a cutscene, a possession or a disconnected player handed
 * to an AI: makes the new brain from its spec ({@link CharacterBrainSpec}, a kind registered with
 * `registerBrainKind`), disposes the old one and sets the new one's configuration defaults on the
 * controller (a debug edit of those keys is overwritten). The intent's persistent fields (`run`,
 * `crouch`, `faceYaw`) are left as they are. Takes effect from the next brain run (this sub-step's
 * when called from an `APP_PHYSICS_STEP` system of order above -5).
 * @param spec the new brain, or null for none (code drives the character)
 * @returns false when no character has this id
 * @example
 * ```ts
 * import { setCharacterBrain } from 'aekasha/character';
 *
 * setCharacterBrain('player', null); // a cutscene drives it through its intent
 * ```
 */
export const setCharacterBrain = (id: string, spec: CharacterBrainSpec | null): boolean => {
  const char = getCharacterById(id);
  if (!char) return false;
  // Before the old one goes: a factory that throws leaves the character as it was
  const next = spec ? createBrain(spec, id) : undefined;
  char.brain?.dispose?.();
  char.brain = next;
  if (next?.configDefaults) char.controller?.config?.applyDefaults?.(next.configDefaults);
  updateCharactersDebuggerGUI('WINDOW');
  return true;
};

/**
 * Calls `listener` once per change of a character's locomotion state ({@link LocomotionState}),
 * from its controller's tick. The listener goes with the character (a new character with the same
 * id needs a new one). Returns a function that removes it (a no-op when no character has this id).
 */
export const onLocomotionStateChange = (id: string, listener: LocomotionStateListener) => {
  const entityId = characterEntityIds.get(id);
  if (entityId === undefined) {
    lwarn(`onLocomotionStateChange: no character with id '${id}'.`);
    return () => {};
  }
  let listeners = locomotionStateListeners.get(entityId);
  if (!listeners) {
    listeners = [];
    locomotionStateListeners.set(entityId, listeners);
  }
  listeners.push(listener);
  return () => {
    const list = locomotionStateListeners.get(entityId);
    const index = list ? list.indexOf(listener) : -1;
    if (index !== -1) list!.splice(index, 1);
  };
};

/** For controllers: calls the character's locomotion state listeners. A throwing listener is
 * logged and doesn't stop the others (or the physics sub-step). */
export const emitLocomotionStateChange = (
  char: CharacterObject,
  next: LocomotionState,
  prev: LocomotionState
) => {
  const listeners = locomotionStateListeners.get(char.entityId);
  if (!listeners?.length) return;
  // A copy: a listener may remove itself. State changes are rare, so is this allocation.
  const snapshot = listeners.slice();
  for (let i = 0; i < snapshot.length; i++) {
    try {
      snapshot[i](next, prev, char);
    } catch (err) {
      lerror(`Locomotion state listener of character '${char.id}' threw:`, err);
    }
  }
};

// Debugger stuff for characters
// *****************************

type CharacterDebugModule = typeof import('./debug/_dbg__Character');
let debugGUI: DebugModuleRef<CharacterDebugModule> | null = null;

/** Loads the characters' debug tools (debug environment only; `InitEngine` calls it). */
export const registerCharacterTools = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__Character'), true);
};

/** Creates the Characters debugger tab (debug environment only; `InitEngine` calls it). */
export const createCharactersDebuggerGUI = () => {
  useDebug(debugGUI, true)?._createCharactersDebuggerGUI();
};

/**
 * For controllers: applies the character's saved debug config overrides (the Character state
 * window's tuned values; debug environment only, a no-op elsewhere). Call it once, right after
 * assigning `character.controller`, so its `config.onChange` recomputes what derives from them.
 * The controller's `config.initial` never contains them.
 */
export const applySavedCharacterConfig = (char: CharacterObject) => {
  useDebug(debugGUI)?._applySavedCharacterConfig(char);
};

/** Refreshes the Characters debugger tab's list and the open character window, or only one of
 * them (a no-op outside the debug environment). */
export const updateCharactersDebuggerGUI = (only?: 'LIST' | 'WINDOW') => {
  useDebug(debugGUI, true)?._updateCharactersDebuggerGUI(only);
};

let isCharactersDebuggerUpdateQueued = false;
/** One debugger update after the current task's deletions (eg. a whole scene's characters). */
const queueCharactersDebuggerUpdate = () => {
  if (!debugGUI || isCharactersDebuggerUpdateQueued) return;
  isCharactersDebuggerUpdateQueued = true;
  queueMicrotask(() => {
    isCharactersDebuggerUpdateQueued = false;
    updateCharactersDebuggerGUI();
  });
};
