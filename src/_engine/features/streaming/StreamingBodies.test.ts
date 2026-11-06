import { afterEach, describe, expect, test } from 'vitest';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createStreamingBodies } from './StreamingBodies';

const WORLD_ID = 'streaming-bodies-test';

afterEach(() => {
  ECSWorld.deleteWorld(WORLD_ID);
});

describe('createStreamingBodies', () => {
  test('a dynamic body, whatever its tier, moves; anything else stays', () => {
    const world = new ECSWorld({ id: WORLD_ID, applyGlobalPlugins: false });
    const bodies = createStreamingBodies();
    const at = { x: NaN, z: NaN };
    const entityAt = (x: number, z: number) => {
      const id = world.createEntity();
      world.getPosition(id)!.set(x, 7, z);
      return id;
    };
    // The data isn't read: the component keys are what counts
    const body = {} as never;

    const dynamicId = entityAt(10, -20);
    world.addComponent(dynamicId, ComponentType.BODY_DYNAMIC_VISUAL, body);
    expect(bodies.locateMover(world, dynamicId, at)).toBe(true);
    expect(at).toEqual({ x: 10, z: -20 });

    const headlessId = entityAt(1, 2);
    world.addComponent(headlessId, ComponentType.BODY_DYNAMIC_HEADLESS, body);
    expect(bodies.locateMover(world, headlessId, at)).toBe(true);

    // A STATIC or DISABLED tier (in BODY_STATIC), or REMOVED (in no bucket)
    const tieredId = entityAt(3, 4);
    world.addComponent(tieredId, ComponentType.PHYSICS_SIM_TIER, body);
    expect(bodies.locateMover(world, tieredId, at)).toBe(true);
    expect(at).toEqual({ x: 3, z: 4 });

    const fixedId = entityAt(5, 6);
    world.addComponent(fixedId, ComponentType.BODY_STATIC, body);
    expect(bodies.locateMover(world, fixedId, at)).toBe(false);
    expect(bodies.locateMover(world, entityAt(0, 0), at)).toBe(false);

    world.deleteEntity(dynamicId);
    expect(bodies.locateMover(world, dynamicId, at)).toBe(false);
  });
});
