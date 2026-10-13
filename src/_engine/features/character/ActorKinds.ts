import type * as THREE from 'three/webgpu';
import type {
  ActorBrain,
  CharacterBrainFactory,
  CharacterBrainKinds,
  CharacterBrainSpec,
  CharacterControllerFactory,
  CharacterControllerKinds,
  CharacterControllerSpec,
} from './ActorTypes';
import type { CharacterIntent, CharacterObject } from './CharacterTypes';
import { getECSWorld, getEntityIdByAppId } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { lwarn } from '../../utils/Logger';

/** A spec as the registries read it: any kind, its params untyped. */
type AnySpec = { kind: string; params?: unknown };

// The brain and controller kinds by name (p603 C1): the systems hold the instances, and only what
// rebuilds one from data (a save, a network message, createCharacterOfKind) needs the name.

const brainKinds = new Map<string, CharacterBrainFactory<never>>();
const controllerKinds = new Map<string, CharacterControllerFactory<never>>();

/**
 * Registers a character brain kind: the factory that makes a brain from its params. Call it from
 * a feature's install (the engine's player brains are `character()`'s), so it exists before any
 * scene makes a character. A kind registered again replaces the old factory (the brains it made
 * keep running).
 * @template K the kind, a key of {@link CharacterBrainKinds} (add yours there first)
 * @param kind the name a {@link CharacterBrainSpec} gives
 * @param create makes the brain for a character
 * @example
 * ```ts
 * import { registerBrainKind } from 'aekasha/character';
 *
 * declare module 'aekasha/character' {
 *   interface CharacterBrainKinds {
 *     HOPPER: { everySteps?: number };
 *   }
 * }
 *
 * registerBrainKind('HOPPER', (params) => ({
 *   kind: 'HOPPER',
 *   think: (intent, step) => {
 *     intent.moveForward += 1; // A move lasts one step: write it every step
 *     if (step % (params.everySteps ?? 60) === 0) intent.jump = true;
 *   },
 * }));
 * ```
 */
export const registerBrainKind = <K extends keyof CharacterBrainKinds & string>(
  kind: K,
  create: CharacterBrainFactory<CharacterBrainKinds[K]>
): void => {
  if (brainKinds.has(kind)) lwarn(`registerBrainKind: replaced the brain kind '${kind}'.`);
  brainKinds.set(kind, create as CharacterBrainFactory<never>);
};

/** Removes a brain kind ({@link registerBrainKind}); the brains it made keep running. Returns false
 * when it wasn't registered. */
export const unregisterBrainKind = (kind: string): boolean => brainKinds.delete(kind);

/** The registered brain kinds, in registration order. */
export const getBrainKinds = (): string[] => [...brainKinds.keys()];

/**
 * Makes a brain from its spec with its kind's factory. Throws on a kind nobody registered.
 * @internal
 */
export const createBrain = (
  spec: CharacterBrainSpec,
  characterId: string
): ActorBrain<CharacterIntent> => {
  const { kind, params } = spec as AnySpec;
  const create = brainKinds.get(kind) as CharacterBrainFactory<unknown> | undefined;
  if (!create) {
    throw new Error(
      `Unknown brain kind '${kind}' (character '${characterId}'). Registered: ` +
        `${getBrainKinds().join(', ') || 'none'}. Register it with registerBrainKind.`
    );
  }
  return create(params ?? {}, characterId);
};

/**
 * Registers a character controller kind: the factory that makes a character, its controller and
 * its body from the kind's params ({@link createCharacterOfKind}). Call it from a feature's install
 * (`DYNAMIC_CHARACTER` is `character()`'s). A kind registered again replaces the old factory.
 * @template K the kind, a key of {@link CharacterControllerKinds} (add yours there first)
 * @param kind the name a {@link CharacterControllerSpec} gives
 * @param create makes the character
 */
export const registerControllerKind = <K extends keyof CharacterControllerKinds & string>(
  kind: K,
  create: CharacterControllerFactory<CharacterControllerKinds[K]>
): void => {
  if (controllerKinds.has(kind)) {
    lwarn(`registerControllerKind: replaced the controller kind '${kind}'.`);
  }
  controllerKinds.set(kind, create as CharacterControllerFactory<never>);
};

/** Removes a controller kind ({@link registerControllerKind}); its characters stay. Returns false
 * when it wasn't registered. */
export const unregisterControllerKind = (kind: string): boolean => controllerKinds.delete(kind);

/** The registered controller kinds, in registration order. */
export const getControllerKinds = (): string[] => [...controllerKinds.keys()];

/** {@link createCharacterOfKind}'s options: plain data apart from an `Object3D` visual. */
export type CreateCharacterOfKindOpts = {
  /** The character's id. An existing character with it is replaced. */
  id: string;
  /** A display name (the debug tools show it). */
  name?: string;
  /** The visual root the body moves, or its app id (its entity becomes the character). */
  visual: THREE.Object3D | string;
  /** The controller's kind and params. */
  controller: CharacterControllerSpec;
  /** The brain's kind and params (none: code drives the character through its intent). */
  brain?: CharacterBrainSpec;
};

/**
 * Makes a character from data: its controller kind's factory ({@link registerControllerKind})
 * makes the character, the controller and the body, with the brain the spec names. What rebuilds a
 * character from a save or a network message. Throws on an unknown kind or visual.
 * @returns the character once it exists
 * @example
 * ```ts
 * import { createCharacterOfKind } from 'aekasha/character';
 *
 * const character = await createCharacterOfKind({
 *   id: 'player',
 *   visual: 'playerMesh',
 *   controller: { kind: 'DYNAMIC_CHARACTER', params: { charData: { _height: 1.6 } } },
 *   brain: {
 *     kind: 'WORLD_FIXED',
 *     params: {
 *       bindings: {
 *         move: [{ device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] }],
 *         jump: [{ device: 'KEYBOARD', keys: [' '] }],
 *       },
 *     },
 *   },
 * });
 * ```
 */
export const createCharacterOfKind = async (
  opts: CreateCharacterOfKindOpts
): Promise<CharacterObject> => {
  const { id, name, visual, brain } = opts;
  const controller = opts.controller as AnySpec;
  const create = controllerKinds.get(controller.kind) as
    | CharacterControllerFactory<unknown>
    | undefined;
  if (!create) {
    throw new Error(
      `Unknown controller kind '${controller.kind}' (character '${id}'). Registered: ` +
        `${getControllerKinds().join(', ') || 'none'}. Register it with registerControllerKind.`
    );
  }
  let object3D: THREE.Object3D | undefined;
  if (typeof visual === 'string') {
    const world = getECSWorld();
    const entityId = getEntityIdByAppId(visual, world);
    object3D =
      entityId === undefined
        ? undefined
        : (world.getComponent(entityId, ComponentType.OBJECT3D)?.value as
            | THREE.Object3D
            | undefined);
    if (!object3D) {
      throw new Error(`createCharacterOfKind: no Object3D with the app id '${visual}' ('${id}').`);
    }
  } else {
    object3D = visual;
  }
  return create({
    id,
    name,
    visual: object3D,
    params: controller.params ?? {},
    brain,
  });
};
