import { ComponentType, ECSSystemStage } from 'aekasha';
import type { ECSWorld } from 'aekasha';

// --- src/toolkit/ecs/systems/HoverEffect.ts ---

/** Internal Key (Values) */
export enum HoverToolComponentType {
  HOVER = 'TOOL_HOVER',
}

/** Internal Data Shape (Types) */
export interface HoverToolData {
  speed: number;
  amplitude: number;
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

/** The Registration Helper */
export const registerHoverToolEffect = (world: ECSWorld) => {
  world.addSystem(ECSSystemStage.APP_LOGIC, 'hoverToolSystem', hoverToolSystem);
  return world;
};
