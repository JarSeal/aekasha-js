// The world bounds' ECS side (p102): each scene's bounds (or the app's default) applied to its
// world, and the bodies the backend took out of the simulation for leaving them handed to their
// entities. The backend's side is backends/rapier/RapierWorldBounds.ts, the delivery
// PhysicsMessaging.ts' flushPhysicsEvents.

import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getStableAppId } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import { lerror, lwarn } from '../../utils/Logger';
import { type PhysicsBodyOwner, getPhysicsBodyOwner } from './PhysicsEntity';
import { setOutOfBoundsHandler } from './PhysicsMessaging';
import { facade } from './PhysicsState';
import { setPhysicsWorldBounds } from './PhysicsWorld';
import type { OutOfBoundsRecord, WorldBoundsDef } from './types/PhysicsWorldBoundsTypes';

/** Each scene's own bounds (setSceneWorldBounds), null for none: kept across visits, as sky
 * boxes are. A scene without an entry gets `AppConfig.physics.worldBounds`. */
const sceneDefs = new Map<string, WorldBoundsDef | null>();

/** The entities a handler call deletes, after its loop. Reused, so a call allocates no array. */
const exitedOwners: PhysicsBodyOwner[] = [];

const copyDef = (def: WorldBoundsDef): WorldBoundsDef => ({
  ...def,
  ...(def.min ? { min: { ...def.min } } : {}),
  ...(def.max ? { max: { ...def.max } } : {}),
});

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
  const stored = def && copyDef(def);
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
 * Physics' install: the world bounds' exits go to the physics entities.
 * @internal
 */
export const installPhysicsWorldBounds = () => {
  setOutOfBoundsHandler(handleOutOfBounds);
};
