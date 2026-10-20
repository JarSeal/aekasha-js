import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getLodTargets } from '../../kernel/ecs/LodTargets';
import type { FeatureContext } from '../../kernel/init/Features';
import {
  createInstancedLodPool,
  createInstancedMeshPool,
  installInstancedMeshPools,
  instancedMeshPoolSyncSystem,
} from './InstancedMeshPool';

let world: ECSWorld;
beforeAll(() => {
  // The slot hooks and the LOD target; the tests call the sync system themselves
  installInstancedMeshPools({
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
    registerPlugin: () => {},
  } as Pick<FeatureContext, 'registerComponentHooks' | 'registerPlugin'> as FeatureContext);
  world = new ECSWorld();
});

const placeAt = (x: number) => ({
  position: new THREE.Vector3(x, 0, 0),
  quaternion: new THREE.Quaternion(),
  scale: 1,
});

const moveTo = (entityId: number, x: number) => {
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
  transform.position.set(x, 0, 0);
  transform.setDirty();
  world.commitTransform(entityId, transform);
};

const createLodPool = () =>
  createInstancedLodPool({
    world,
    levels: [
      {
        geometry: new THREE.BoxGeometry(),
        material: new THREE.MeshBasicNodeMaterial(),
        screenSize: 0.5,
      },
      {
        geometry: new THREE.BoxGeometry(),
        material: new THREE.MeshBasicNodeMaterial(),
        screenSize: 0.1,
      },
    ],
    maxInstances: 4,
  });

const xOf = (mesh: THREE.InstancedMesh, index: number) =>
  new THREE.Vector3().setFromMatrixPosition(mesh.getMatrixAt(index, new THREE.Matrix4())).x;

describe('createInstancedMeshPool', () => {
  test('despawn moves the last instance into the freed slot and patches its index', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 3,
    });
    const [first, second, third] = pool.spawn(world, [placeAt(1), placeAt(2), placeAt(3)]);

    expect(pool.despawn(world, first)).toBe(true);

    expect(pool.mesh.count).toBe(2);
    expect(world.getComponent(third, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(0);
    expect(world.getComponent(second, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(1);
    expect(xOf(pool.mesh, 0)).toBe(3);
    expect(xOf(pool.mesh, 1)).toBe(2);
    // Not an instance any more, and never one of another pool
    expect(pool.despawn(world, first)).toBe(false);
  });

  test('removing the slot component frees the slot too, and spawn reuses it', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [first, second] = pool.spawn(world, [placeAt(1), placeAt(2)]);

    world.removeComponent(second, ComponentType.INSTANCED_MESH_SLOT);
    expect(pool.mesh.count).toBe(1);
    const [third] = pool.spawn(world, [placeAt(5)]);

    expect(pool.mesh.count).toBe(2);
    expect(world.getComponent(third, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(1);
    expect(world.getComponent(first, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(0);
  });

  // p616 P2: the sync grows the bounds spawn computed, so three never frustum-culls the whole mesh
  // while a moved instance is on screen
  test('keeps an instance moved through its Transform inside the mesh bounds', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn(world, [placeAt(0)]);

    moveTo(entityId, 100);
    instancedMeshPoolSyncSystem(world);

    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
    expect(pool.mesh.boundingBox!.containsPoint(new THREE.Vector3(100.5, 0, 0))).toBe(true);
    // Grown, never shrunk: the spawn position is still inside
    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
  });

  test('leaves the bounds as they are while a moved instance stays inside them', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn(world, [placeAt(-10), placeAt(10)]);
    const sphere = pool.mesh.boundingSphere!.clone();
    const box = pool.mesh.boundingBox!.clone();

    moveTo(entityId, 0);
    instancedMeshPoolSyncSystem(world);

    expect(pool.mesh.boundingSphere!.equals(sphere)).toBe(true);
    expect(pool.mesh.boundingBox!.equals(box)).toBe(true);
  });
});

describe('createInstancedLodPool', () => {
  test('grows every level mesh to hold an instance moved through its Transform', () => {
    const pool = createLodPool();
    const [entityId] = pool.spawn(world, [placeAt(0)]);

    moveTo(entityId, 100);
    instancedMeshPoolSyncSystem(world);

    for (const mesh of pool.meshes) {
      expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
      expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(100.5, 0, 0))).toBe(true);
    }
  });

  test('grows the bounds for an instance that moved while it was LOD culled', () => {
    const pool = createLodPool();
    const [entityId] = pool.spawn(world, [placeAt(0)]);
    const target = getLodTargets().find(
      (entry) => entry.componentType === ComponentType.INSTANCED_MESH_SLOT
    )!.target;

    target.setCulled!(entityId, world, true, false);
    moveTo(entityId, -100);
    // The sync skips a culled instance
    instancedMeshPoolSyncSystem(world);
    target.setCulled!(entityId, world, false, false);

    expect(world.getComponent(entityId, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(0);
    for (const mesh of pool.meshes) {
      expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(-100, 0, 0))).toBe(true);
    }
  });
});
