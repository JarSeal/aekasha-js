// The world bounds' ECS side (p102): each scene's bounds (or the app's default) applied to its
// world, an entity's own bounds (the WORLD_BOUNDS component) sent for its body, and the bodies the
// backend took out of the simulation for leaving them handed to their entities. The backend's
// side is backends/rapier/RapierWorldBounds.ts, the delivery PhysicsMessaging.ts'
// flushPhysicsEvents.

import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { type ECSWorld, getECSWorld, getStableAppId } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { setPhysicsBodyWorldBounds } from './PhysicsBodies';
import { type PhysicsBodyOwner, getPhysicsBodyOwner, getPhysicsEntityBody } from './PhysicsEntity';
import { copyWorldBounds, setOutOfBoundsHandler, toWireBodyWorldBounds } from './PhysicsMessaging';
import { facade } from './PhysicsState';
import { setPhysicsWorldBounds } from './PhysicsWorld';
import type {
  EntityWorldBounds,
  OutOfBoundsRecord,
  WorldBoundsDef,
} from './types/PhysicsWorldBoundsTypes';

/** Each scene's own bounds (setSceneWorldBounds), null for none: kept across visits, as sky
 * boxes are. A scene without an entry gets `AppConfig.physics.worldBounds`. */
const sceneDefs = new Map<string, WorldBoundsDef | null>();

/** The entities a handler call deletes, after its loop. Reused, so a call allocates no array. */
const exitedOwners: PhysicsBodyOwner[] = [];

/** The scene whose world is the current one: the loading scene's from its `beforeAssets` on. */
const getWorldSceneId = () => getLoadingSceneId() ?? getCurrentSceneId();

/**
 * Sets (or replaces) a scene's world bounds: from its world's next step on, a dynamic physics
 * body whose translation leaves the box is taken out of the simulation on the fixed step it left
 * on, and its entity deleted (`action: 'DELETE'`, the default). Every side of the box is optional;
 * a missing one is open. `null` turns the bounds off for the scene, `AppConfig.physics.worldBounds`
 * included. Without `sceneId`, the scene loading now, else the current one. Kept for the scene's
 * later visits; applied at once when the scene's world is the current one.
 * @param def the box and the action, or null for no bounds
 * @param sceneId the scene (default: the loading scene, else the current one)
 * @remarks Call it in a scene's code (or before the scene loads, or from an `APP_PHYSICS_STEP`
 * system): its bounds then apply on the same step on every visit, in both worker targets. From a
 * per-frame stage, the step they start on depends on the frame timing. Only dynamic bodies are
 * checked, by their translation (not their colliders); a sleeping body can't leave.
 * @example
 * ```ts
 * import { setSceneWorldBounds } from 'aekasha/physics';
 *
 * // In a scene's code: a body falling 50 m below the level is deleted with its entity
 * setSceneWorldBounds({ min: { y: -50 } });
 * ```
 */
export const setSceneWorldBounds = (def: WorldBoundsDef | null, sceneId?: string) => {
  const targetSceneId = sceneId || getWorldSceneId();
  if (!targetSceneId) {
    const msg =
      'setSceneWorldBounds: no scene to set the world bounds of (no loading or current scene).';
    lerror(msg);
    throw new Error(msg);
  }
  const stored = def && copyWorldBounds(def);
  sceneDefs.set(targetSceneId, stored);
  if (targetSceneId === getWorldSceneId()) setPhysicsWorldBounds(stored);
};

/**
 * Applies the loading scene's world bounds to its new world: its own (setSceneWorldBounds), else
 * `AppConfig.physics.worldBounds`, else none. Physics' scene hooks call it right after the world's
 * reset (`beforeAssets`), before any of the scene's bodies exists.
 * @internal
 */
export const applySceneWorldBounds = () => {
  const sceneId = getLoadingSceneId();
  const def =
    sceneId !== null && sceneDefs.has(sceneId)
      ? sceneDefs.get(sceneId)!
      : facade.state.worldBounds ?? null;
  setPhysicsWorldBounds(def);
};

const logExit = (owner: PhysicsBodyOwner, record: OutOfBoundsRecord) => {
  const { world, entityId } = owner;
  const name =
    getStableAppId(entityId, world) ??
    (world.getComponent(entityId, ComponentType.OBJECT3D)?.value.name || `entity ${entityId}`);
  const pos = `${record.x.toFixed(2)}, ${record.y.toFixed(2)}, ${record.z.toFixed(2)}`;
  lwarn(
    `Physics world bounds: "${name}" left them at (${pos}) on step ${record.step}, deleted. Often a collider smaller than its mesh, or a body spawned inside another.`
  );
};

/**
 * The out-of-bounds handler (setOutOfBoundsHandler): deletes each exited body's entity, after
 * going through every record. A body without a physics entity (made through the bare Physics API,
 * or its entity already deleted: a scene exit) is skipped and stays out of the simulation.
 * @internal
 */
export const handleOutOfBounds = (records: readonly OutOfBoundsRecord[]) => {
  for (let i = 0; i < records.length; i++) {
    const owner = getPhysicsBodyOwner(records[i].bodyId);
    if (!owner || !owner.world.isAlive(owner.entityId)) continue;
    if (IS_DEBUG_ENV) logExit(owner, records[i]);
    exitedOwners.push(owner);
  }
  for (let i = 0; i < exitedOwners.length; i++) {
    const { world, entityId } = exitedOwners[i];
    if (world.isAlive(entityId)) world.deleteEntity(entityId);
  }
  exitedOwners.length = 0;
};

/**
 * Sets (or replaces) a physics entity's own world bounds, or removes them with null: they replace
 * the scene's bounds for its body (they aren't intersected with them; a missing side is open), or
 * exempt it with `ignore: true`. They apply from the body's next check on (before the next fixed
 * step), asleep or not. Set on an entity without a body yet (eg. a mesh entity before its
 * `createPhysicsEntity`), they go with its body's create. They go with the entity.
 * @param entityId the physics entity (or one that gets its body later)
 * @param bounds the box or `ignore`, or null to follow the scene's bounds again
 * @param ecsWorld the entity's world (the default one when left out)
 * @remarks Set them in scene-load code, in an `APP_PHYSICS_STEP` system or with
 * `createPhysicsEntity`'s `worldBounds` option (sent with the body, so they apply from its very
 * first check, in both worker targets). From a per-frame stage on `WORKER_THREAD`, the step they
 * start on depends on the frame timing. Only dynamic bodies are checked. A deleted entity is a
 * quiet no-op (a debug-env warning).
 * @example
 * ```ts
 * import { setEntityWorldBounds } from 'aekasha/physics';
 *
 * declare const playerId: number;
 * // The player's own respawn logic catches its falls: the scene's kill height leaves it alone
 * setEntityWorldBounds(playerId, { ignore: true });
 * ```
 */
export const setEntityWorldBounds = (
  entityId: number,
  bounds: EntityWorldBounds | null,
  ecsWorld?: ECSWorld
) => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in setEntityWorldBounds.');
  if (!world.isAlive(entityId)) {
    if (IS_DEBUG_ENV) lwarn(`setEntityWorldBounds: entity ${entityId} doesn't exist. Ignored.`);
    return;
  }
  if (bounds === null) world.removeComponent(entityId, ComponentType.WORLD_BOUNDS);
  else world.addComponent(entityId, ComponentType.WORLD_BOUNDS, copyWorldBounds(bounds));
};

/** Sends an entity's own world bounds (or null) for its body, when it has one it owns: before its
 * createPhysicsEntity resolves it has none, and the create sends what the entity has then. */
const sendEntityWorldBounds = (
  world: ECSWorld,
  entityId: number,
  bounds: EntityWorldBounds | null
) => {
  const body = getPhysicsEntityBody(world, entityId);
  if (!body) return;
  const owner = getPhysicsBodyOwner(body.id);
  if (owner?.world !== world || owner.entityId !== entityId) return;
  setPhysicsBodyWorldBounds(body.id, bounds && toWireBodyWorldBounds(bounds));
};

/**
 * Physics' install: the entities' own world bounds reach their bodies (the WORLD_BOUNDS hooks; an
 * entity's delete needs nothing, its body's delete forgets them), and the world bounds' exits go to
 * the physics entities.
 * @internal
 */
export const installPhysicsWorldBounds = (ctx: FeatureContext) => {
  ctx.registerComponentHooks(ComponentType.WORLD_BOUNDS, {
    onAddComponent: (entityId, world) =>
      sendEntityWorldBounds(
        world,
        entityId,
        world.getComponent(entityId, ComponentType.WORLD_BOUNDS) ?? null
      ),
    onRemoveComponent: (entityId, world) => sendEntityWorldBounds(world, entityId, null),
  });
  setOutOfBoundsHandler(handleOutOfBounds);
};
