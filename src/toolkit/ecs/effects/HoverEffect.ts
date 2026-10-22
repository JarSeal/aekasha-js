import { ComponentType, ECSSystemStage } from 'aekasha';
import type { ECSWorld } from 'aekasha';

/**
 * The hover effect's component key: add {@link HoverToolData} under
 * `HoverToolComponentType.HOVER` to an entity to make it bob up and down.
 */
export enum HoverToolComponentType {
  /** An entity that bobs up and down ({@link HoverToolData}). */
  HOVER = 'TOOL_HOVER',
}

/**
 * A hovering entity's motion: its `TRANSFORM` height follows a sine around `baseY`, written every
 * frame (its x and z are left alone).
 */
export interface HoverToolData {
  /** The sine's angular speed in radians per second (2π: one bob a second). */
  speed: number;
  /** The height the entity rises and sinks by around `baseY`, in world units. */
  amplitude: number;
  /** The height the entity bobs around, in world units: it replaces the entity's own y. */
  baseY: number;
  /**
   * The phase in seconds (default 0), which the effect advances by each frame's time: different
   * values keep entities with the same `speed` from bobbing in step.
   */
  time?: number;
}

declare module 'aekasha' {
  interface ComponentDataMap {
    [HoverToolComponentType.HOVER]: HoverToolData;
  }
}

// Moves each hovering entity to its height for this frame
const hoverToolSystem = (world: ECSWorld, dt: number) => {
  const storage = world.getStorage(HoverToolComponentType.HOVER);
  if (!storage) return;
  const transformStore = world.getTypedTransformStore();

  for (const [entityId, data] of storage) {
    const time = (data.time ?? 0) + dt;
    data.time = time;
    const y = data.baseY + Math.sin(time * data.speed) * data.amplitude;

    if (transformStore) {
      const slot = transformStore.getSlot(entityId);
      if (slot === -1) continue;
      transformStore.setPosition(slot, transformStore.posX[slot], y, transformStore.posZ[slot]);
      continue;
    }

    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (!transform) continue;
    transform.position.y = y;
    transform.setDirty();
  }
};

/**
 * Registers the hover effect's system on `world`, at `APP_LOGIC` (default order 0): from then on
 * every entity with a {@link HoverToolComponentType} `HOVER` component bobs. A second call on the
 * same world is a no-op.
 * @returns `world`
 * @example
 * ```ts
 * // Registered for every world, in the app's feature (src/AppECSPlugins.ts)
 * export const appFeature: EngineFeature = {
 *   id: 'app',
 *   install: (ctx) => ctx.registerPlugin(registerHoverToolEffect),
 * };
 *
 * // In scene code: the entity bobs 0.2 above and below y = 1, once every 2 s
 * getECSWorld().addComponent(entityId, HoverToolComponentType.HOVER, {
 *   speed: Math.PI,
 *   amplitude: 0.2,
 *   baseY: 1,
 * });
 * ```
 */
export const registerHoverToolEffect = (world: ECSWorld) => {
  world.addSystem(ECSSystemStage.APP_LOGIC, 'hoverToolSystem', hoverToolSystem);
  return world;
};
