import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { ECSStorageMode } from '../../kernel/ecs/ECSComponentStorage';
import type { FeatureContext } from '../../kernel/init/Features';
import { getSpatialDomain, registerSpatialDomain } from './SpatialDomains';
import { installSpatialIndex, joinSpatialDomain, rebuildSpatialDomain } from './SpatialIndexSystem';

beforeAll(() => {
  // The membership hooks and the radius providers; the tests rebuild the domains themselves
  installSpatialIndex({
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
    registerPlugin: () => {},
  } as Pick<FeatureContext, 'registerComponentHooks' | 'registerPlugin'> as FeatureContext);
});

const createMeshMember = (world: ECSWorld) => {
  const entityId = world.createEntity();
  // A unit box: its conservative radius is half its diagonal
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.TAG_IS_MESH, true);
  return entityId;
};

const moveAndScale = (world: ECSWorld, entityId: number, x: number, scale: number) => {
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
  transform.position.set(x, 0, 0);
  transform.scale.setScalar(scale);
  transform.setDirty();
  world.commitTransform(entityId, transform);
};

const queryAt = (world: ECSWorld, x: number) => {
  const out = new Uint32Array(8);
  const count = getSpatialDomain(world, 'D')!.queryInto({ x, y: 0, z: 0 }, 0.1, out);
  // Entity ids are int32s (the generation is in the high bits); `out` holds them as uint32
  return Array.from(out.subarray(0, count), (id) => id | 0);
};

describe.each<ECSStorageMode>(['MAP', 'TYPED_ARRAY'])('the refresh (%s storage)', (storageMode) => {
  test('reads every member position and scaled radius from its Transform', () => {
    const world = new ECSWorld({ id: `spatial-${storageMode}`, storageMode, maxEntities: 64 });
    registerSpatialDomain(world, { id: 'D', cellSize: 10, maxMembers: 8, update: 'MANUAL' });
    const first = createMeshMember(world);
    const second = createMeshMember(world);
    joinSpatialDomain(first, 'D', world);
    joinSpatialDomain(second, 'D', world);
    rebuildSpatialDomain(world, 'D');
    const grid = getSpatialDomain(world, 'D')!;
    const localRadius = grid.getRadius(second)!;
    expect(localRadius).toBeGreaterThan(0);

    moveAndScale(world, second, 100, 3);
    rebuildSpatialDomain(world, 'D');

    expect(queryAt(world, 100)).toEqual([second]);
    expect(queryAt(world, 0)).toEqual([first]);
    expect(grid.getRadius(second)).toBeCloseTo(localRadius * 3, 5);
    expect(grid.getRadius(first)).toBeCloseTo(localRadius, 5);
  });
});
