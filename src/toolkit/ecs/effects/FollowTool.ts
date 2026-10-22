import * as THREE from 'three/webgpu';
import { ECSSystemStage, ComponentType } from 'aekasha';
import type { ECSWorld } from 'aekasha';

/**
 * The follow effect's component key: add {@link FollowToolData} under
 * `FollowToolComponentType.FOLLOW` to an entity to make it follow another one.
 */
export enum FollowToolComponentType {
  /** An entity that follows a leader entity ({@link FollowToolData}). */
  FOLLOW = 'TOOL_FOLLOW',
}

/**
 * A follower's leader and how it follows: every frame the follower's `TRANSFORM` position moves
 * toward the leader's plus `offset`. A follower with a `TARGET_LINK` (a directional or spot
 * light's target) moves its target toward the leader's plus `targetOffset` too, so a light keeps
 * shining on the leader from the same angle. Any entity can follow: a light, a camera, a mesh.
 * @remarks It reads the leader's `TRANSFORM` as this frame's `APP_LOGIC` sees it, so a leader
 * moved later in the frame is followed a frame late.
 */
export interface FollowToolData {
  /**
   * The entity to follow; a leader without a `TRANSFORM` (eg. deleted) leaves the follower where
   * it is.
   */
  leaderId: number;
  /** The follower's position relative to the leader, in world units. */
  offset: THREE.Vector3;
  /**
   * The follower's target link's position relative to the leader (read only with a
   * `TARGET_LINK`).
   */
  targetOffset: THREE.Vector3;
  /**
   * How fast the follower closes the gap, per second: each frame it moves `1 - e^(-speed·dt)` of
   * the way, the same at any frame rate. Higher is snappier; 0 (or less) snaps at once.
   */
  speed: number;
}

declare module 'aekasha' {
  interface ComponentDataMap {
    [FollowToolComponentType.FOLLOW]: FollowToolData;
  }
}

// Scratchpad vector to prevent garbage collection stutters
const _targetPos = new THREE.Vector3();

// Moves each follower (and its target link's entity) toward its leader's position plus offset
const followToolSystem = (world: ECSWorld, dt: number) => {
  const storage = world.getStorage(FollowToolComponentType.FOLLOW);
  if (!storage) return;
  const transformStore = world.getTypedTransformStore();

  for (const [entityId, data] of storage) {
    // Framerate independent alpha calculation
    // If speed is 0, we treat it as an instant snap (alpha 1)
    const alpha = data.speed <= 0 ? 1 : 1 - Math.exp(-data.speed * dt);

    if (transformStore) {
      // 1. Get the Leader's position
      const leaderSlot = transformStore.getSlot(data.leaderId);
      if (leaderSlot === -1) continue;
      const leaderX = transformStore.posX[leaderSlot];
      const leaderY = transformStore.posY[leaderSlot];
      const leaderZ = transformStore.posZ[leaderSlot];

      // 2. Update the Light Source Entity
      const lightSlot = transformStore.getSlot(entityId);
      if (lightSlot !== -1) {
        const targetX = leaderX + data.offset.x;
        const targetY = leaderY + data.offset.y;
        const targetZ = leaderZ + data.offset.z;

        if (alpha >= 1) {
          transformStore.setPosition(lightSlot, targetX, targetY, targetZ);
        } else {
          transformStore.setPosition(
            lightSlot,
            THREE.MathUtils.lerp(transformStore.posX[lightSlot], targetX, alpha),
            THREE.MathUtils.lerp(transformStore.posY[lightSlot], targetY, alpha),
            THREE.MathUtils.lerp(transformStore.posZ[lightSlot], targetZ, alpha)
          );
        }
      }

      // 3. Update the Light Target Entity (Only if it exists)
      const targetLink = world.getComponent(entityId, ComponentType.TARGET_LINK);
      if (targetLink) {
        const targetSlot = transformStore.getSlot(targetLink.targetId);
        if (targetSlot !== -1) {
          const targetX = leaderX + data.targetOffset.x;
          const targetY = leaderY + data.targetOffset.y;
          const targetZ = leaderZ + data.targetOffset.z;

          if (alpha >= 1) {
            transformStore.setPosition(targetSlot, targetX, targetY, targetZ);
          } else {
            transformStore.setPosition(
              targetSlot,
              THREE.MathUtils.lerp(transformStore.posX[targetSlot], targetX, alpha),
              THREE.MathUtils.lerp(transformStore.posY[targetSlot], targetY, alpha),
              THREE.MathUtils.lerp(transformStore.posZ[targetSlot], targetZ, alpha)
            );
          }
        }
      }
      continue;
    }

    // --- MAP mode: live Map references, existing behavior unchanged ---

    // 1. Get the Leader's position
    const leaderTransform = world.getComponent(data.leaderId, ComponentType.TRANSFORM);
    if (!leaderTransform) continue;

    // 2. Update the Light Source Entity
    const lightTransform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (lightTransform) {
      _targetPos.copy(leaderTransform.position).add(data.offset);

      if (alpha >= 1) {
        lightTransform.position.copy(_targetPos);
      } else {
        lightTransform.position.lerp(_targetPos, alpha);
      }

      lightTransform.setDirty();
    }

    // 3. Update the Light Target Entity (Only if it exists)
    const targetLink = world.getComponent(entityId, ComponentType.TARGET_LINK);
    if (targetLink) {
      const targetTransform = world.getComponent(targetLink.targetId, ComponentType.TRANSFORM);
      if (targetTransform) {
        _targetPos.copy(leaderTransform.position).add(data.targetOffset);

        if (alpha >= 1) {
          targetTransform.position.copy(_targetPos);
        } else {
          targetTransform.position.lerp(_targetPos, alpha);
        }

        targetTransform.setDirty();
      }
    }
  }
};

/**
 * Registers the follow effect's system on `world`, at `APP_LOGIC` (default order 0, before the
 * render sync copies the positions to the objects): from then on every entity with a
 * {@link FollowToolComponentType} `FOLLOW` component follows its leader. A second call on the same
 * world is a no-op.
 * @returns `world`
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 *
 * // Registered for every world, in the app's feature (src/AppECSPlugins.ts)
 * export const appFeature: EngineFeature = {
 *   id: 'app',
 *   install: (ctx) => ctx.registerPlugin(registerFollowToolEffect),
 * };
 *
 * // In scene code: a sun (a directional light's entity) that keeps shining on the player from
 * // the same angle, its target on the player
 * getECSWorld().addComponent(sunEntityId, FollowToolComponentType.FOLLOW, {
 *   leaderId: playerEntityId,
 *   offset: new THREE.Vector3(20, 40, 10),
 *   targetOffset: new THREE.Vector3(0, 0, 0),
 *   speed: 0,
 * });
 * ```
 */
export const registerFollowToolEffect = (world: ECSWorld) => {
  world.addSystem(ECSSystemStage.APP_LOGIC, 'followToolSystem', followToolSystem);
  return world;
};
