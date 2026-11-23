import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The physics create: resolves with its target, or first runs `during` (what happens while a
// WORKER_THREAD create is in flight); keeps the options it was given
const physics = vi.hoisted(() => ({
  during: null as null | (() => void),
  opts: undefined as unknown,
}));
vi.mock(import('../physics/PhysicsEntity'), async (importOriginal) => ({
  ...(await importOriginal()),
  createPhysicsEntity: (async (props: { target: number }, opts: unknown) => {
    physics.opts = opts;
    await Promise.resolve();
    physics.during?.();
    return props.target;
  }) as never,
}));

import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createCharacter, getCharacterById } from './Character';
import { createDynamicCharacter } from './controllers/dynamic/DynamicCharacter';
import { registerBrainKind, unregisterBrainKind } from './ActorKinds';
import type { CharacterBrainSpec } from './ActorTypes';

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld({ applyGlobalPlugins: false });
});

afterEach(() => {
  physics.during = null;
  world.clearWorld();
});

const createVisual = (appId: string) => {
  const entityId = world.createEntity({ appId });
  const object = new THREE.Group();
  object.userData = { id: appId, entityId };
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: object, _lastVersion: -1 });
  return { entityId, object };
};

const charOpts = (id: string, visual: THREE.Object3D) => ({
  id,
  visual,
  bodyKind: 'HUMANOID',
  physicsParams: { colliders: { type: 'BALL', radius: 0.5 } } as never,
});

// docs/issues/_DONE_i040_ecs-components-on-deleted-entities.md
describe('a visual deleted while its body is created', () => {
  it('creates the character when the visual stays', async () => {
    const { entityId, object } = createVisual('stays');
    const char = await createCharacter(charOpts('stays', object));
    expect(world.getComponent(entityId, ComponentType.CHARACTER)).toBe(char);
    expect(getCharacterById('stays')).toBe(char);
  });

  it('rejects, naming the visual, with no character made', async () => {
    const { entityId, object } = createVisual('doomed');
    physics.during = () => world.deleteEntity(entityId);

    await expect(createCharacter(charOpts('doomed', object))).rejects.toThrow(
      /visual 'doomed' was deleted while its body was created/
    );
    expect(world.hasComponent(entityId, ComponentType.CHARACTER)).toBe(false);
    expect(getCharacterById('doomed')).toBeUndefined();
  });

  it('createDynamicCharacter disposes the brain it made', async () => {
    const dispose = vi.fn();
    registerBrainKind(
      'TEST_I040' as never,
      (() => ({ kind: 'TEST_I040', think: () => {}, dispose })) as never
    );
    const { entityId, object } = createVisual('doomedDynamic');
    physics.during = () => world.deleteEntity(entityId);

    await expect(
      createDynamicCharacter({
        id: 'doomedDynamic',
        visual: object,
        brain: { kind: 'TEST_I040' } as unknown as CharacterBrainSpec,
      })
    ).rejects.toThrow(/was deleted while its body was created/);
    expect(dispose).toHaveBeenCalledTimes(1);
    unregisterBrainKind('TEST_I040');
  });
});

describe("a character's own world bounds (p102)", () => {
  const onExit = () => {};

  it('go with its body: createCharacter and createDynamicCharacter pass them on', async () => {
    const { object } = createVisual('bounded');
    await createCharacter({ ...charOpts('bounded', object), worldBounds: { ignore: true } });
    expect(physics.opts).toMatchObject({ initialTier: 'FULL', worldBounds: { ignore: true } });

    const { entityId, object: dynamicObject } = createVisual('boundedDynamic');
    physics.during = () => world.deleteEntity(entityId);
    await expect(
      createDynamicCharacter({
        id: 'boundedDynamic',
        visual: dynamicObject,
        worldBounds: { action: 'CALLBACK', onExit },
      })
    ).rejects.toThrow();
    expect(physics.opts).toMatchObject({ worldBounds: { action: 'CALLBACK', onExit } });
  });

  it("are left out without the option: the scene's apply", async () => {
    const { object } = createVisual('unbounded');
    await createCharacter(charOpts('unbounded', object));
    expect(physics.opts).not.toHaveProperty('worldBounds');
  });
});
