import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, ECSWorld, type ECSStorageMode } from 'aekasha';
import { HoverToolComponentType, registerHoverToolEffect } from './HoverEffect';

const DT = 1 / 60;
const worldIds: string[] = [];
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

// A world with the effect's system, captured from its registration
const createWorld = (storageMode: ECSStorageMode) => {
  const id = `hover-${storageMode}-${worldIds.length}`;
  worldIds.push(id);
  const world = new ECSWorld({ id, storageMode, maxEntities: 16 });
  const addSystem = vi.spyOn(world, 'addSystem');
  registerHoverToolEffect(world);
  const systemFn = addSystem.mock.calls[0][2];
  return { world, run: (frames: number) => [...Array(frames)].forEach(() => systemFn(world, DT)) };
};

describe.each<ECSStorageMode>(['MAP', 'TYPED_ARRAY'])('hoverToolSystem (%s storage)', (mode) => {
  it('bobs y around baseY by amplitude at speed, keeping x and z', () => {
    const { world, run } = createWorld(mode);
    const entityId = world.createEntity();
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
    transform.position.set(3, 0, -2);
    world.commitTransform(entityId, transform);
    const data = { speed: 2, amplitude: 0.5, baseY: 1, time: 0.25 };
    world.addComponent(entityId, HoverToolComponentType.HOVER, data);

    run(30);
    // The data's time is the phase: it starts at the given one and adds each frame's dt
    expect(data.time).toBeCloseTo(0.25 + 30 * DT, 12);
    const { position } = world.getComponent(entityId, ComponentType.TRANSFORM)!;
    expect(position.y).toBeCloseTo(1 + Math.sin(data.time * 2) * 0.5, 6);
    expect([position.x, position.z]).toEqual([3, -2]);
  });
});
