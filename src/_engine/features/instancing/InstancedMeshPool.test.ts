import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createInstancedMeshPool, instancedMeshPoolSyncSystem } from './InstancedMeshPool';

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
});

const placeAt = (x: number) => ({
  position: new THREE.Vector3(x, 0, 0),
  quaternion: new THREE.Quaternion(),
  scale: 1,
});

describe('createInstancedMeshPool', () => {
  // p616 P2: the bounds are computed at spawn only, so three frustum-culls the whole mesh once a
  // moved instance has left them
  test.fails('keeps an instance moved through its Transform inside the mesh bounds', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn(world, [placeAt(0)]);

    const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
    transform.position.set(100, 0, 0);
    transform.setDirty();
    world.commitTransform(entityId, transform);
    instancedMeshPoolSyncSystem(world);

    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
  });
});
