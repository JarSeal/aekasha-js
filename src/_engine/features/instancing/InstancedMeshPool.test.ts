import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getLodTargets } from '../../kernel/ecs/LodTargets';
import { getMeshWorldBoundingSphere } from '../../kernel/ecs/ObjectFrustumCullingSystem';
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

const moveTo = (entityId: number, x: number, inWorld = world) => {
  const transform = inWorld.getComponent(entityId, ComponentType.TRANSFORM)!;
  transform.position.set(x, 0, 0);
  transform.setDirty();
  inWorld.commitTransform(entityId, transform);
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

const getInstanceLodTarget = () =>
  getLodTargets().find((entry) => entry.componentType === ComponentType.INSTANCED_MESH_SLOT)!
    .target;

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
    const [first, second, third] = pool.spawn([placeAt(1), placeAt(2), placeAt(3)]);

    expect(pool.despawn(first)).toBe(true);

    expect(pool.mesh.count).toBe(2);
    expect(world.getComponent(third, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(0);
    expect(world.getComponent(second, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(1);
    expect(xOf(pool.mesh, 0)).toBe(3);
    expect(xOf(pool.mesh, 1)).toBe(2);
    // Not an instance any more, and never one of another pool
    expect(pool.despawn(first)).toBe(false);
  });

  test('removing the slot component frees the slot too, and spawn reuses it', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [first, second] = pool.spawn([placeAt(1), placeAt(2)]);

    world.removeComponent(second, ComponentType.INSTANCED_MESH_SLOT);
    expect(pool.mesh.count).toBe(1);
    const [third] = pool.spawn([placeAt(5)]);

    expect(pool.mesh.count).toBe(2);
    expect(world.getComponent(third, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(1);
    expect(world.getComponent(first, ComponentType.INSTANCED_MESH_SLOT)!.index).toBe(0);
  });

  // docs/issues/_DONE_i060_entity-persistent-flag-not-applied.md
  test('a persistent pool and its persistent instances outlive a scene switch', () => {
    const sceneWorld = new ECSWorld({ id: 'persistentPools' });
    const pool = createInstancedMeshPool({
      world: sceneWorld,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 3,
      entityOpts: { persistent: true },
    });
    const [kept] = pool.spawn([placeAt(1)], { persistent: true });
    const [dropped] = pool.spawn([placeAt(2)]);

    sceneWorld.clearNonPersistent();
    expect(sceneWorld.isAlive(pool.meshEntityId)).toBe(true);
    expect(sceneWorld.isAlive(kept)).toBe(true);
    expect(sceneWorld.isAlive(dropped)).toBe(false);
    // The dropped instance's slot is free again
    expect(pool.mesh.count).toBe(1);

    const lodPool = createInstancedLodPool({
      world: sceneWorld,
      levels: [
        {
          geometry: new THREE.BoxGeometry(),
          material: new THREE.MeshBasicNodeMaterial(),
          screenSize: 0.5,
        },
      ],
      maxInstances: 1,
      entityOpts: { persistent: true },
    });
    sceneWorld.clearNonPersistent();
    for (const id of lodPool.meshEntityIds) expect(sceneWorld.isAlive(id)).toBe(true);
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
    const [entityId] = pool.spawn([placeAt(0)]);

    moveTo(entityId, 100);
    instancedMeshPoolSyncSystem(world);

    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
    expect(pool.mesh.boundingBox!.containsPoint(new THREE.Vector3(100.5, 0, 0))).toBe(true);
    // Grown, never shrunk: the spawn position is still inside
    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
  });

  // p616 P1: the instance matrix is uploaded only in a frame that wrote it
  test('uploads nothing while no instance moved', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn([placeAt(0)]);
    instancedMeshPoolSyncSystem(world);
    const version = pool.mesh.instanceMatrix.version;

    instancedMeshPoolSyncSystem(world);
    expect(pool.mesh.instanceMatrix.version).toBe(version);

    moveTo(entityId, 3);
    instancedMeshPoolSyncSystem(world);
    expect(pool.mesh.instanceMatrix.version).toBeGreaterThan(version);
    expect(xOf(pool.mesh, 0)).toBe(3);
  });

  test('leaves the bounds as they are while a moved instance stays inside them', () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn([placeAt(-10), placeAt(10)]);
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
    const [entityId] = pool.spawn([placeAt(0)]);

    moveTo(entityId, 100);
    instancedMeshPoolSyncSystem(world);

    for (const mesh of pool.meshes) {
      expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
      expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(100.5, 0, 0))).toBe(true);
    }
  });

  test('grows the bounds for an instance that moved while it was LOD culled', () => {
    const pool = createLodPool();
    const [entityId] = pool.spawn([placeAt(0)]);
    const target = getInstanceLodTarget();

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

// p616 P7: in TYPED_ARRAY mode a Transform's version is only its dirty flag, which nothing cleared
// for a pool instance (no OBJECT3D), so the sync skipped every move after spawn
describe('TYPED_ARRAY storage', () => {
  let typedWorld: ECSWorld;
  beforeAll(() => {
    typedWorld = new ECSWorld({ id: 'typedPools', storageMode: 'TYPED_ARRAY', maxEntities: 64 });
  });

  const createTypedPool = () =>
    createInstancedMeshPool({
      world: typedWorld,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });

  test('bakes every move of an instance, and grows the bounds for it', () => {
    const pool = createTypedPool();
    const [entityId] = pool.spawn([placeAt(1)]);
    instancedMeshPoolSyncSystem(typedWorld);

    moveTo(entityId, 50, typedWorld);
    instancedMeshPoolSyncSystem(typedWorld);
    expect(xOf(pool.mesh, 0)).toBe(50);

    moveTo(entityId, 100, typedWorld);
    instancedMeshPoolSyncSystem(typedWorld);
    expect(xOf(pool.mesh, 0)).toBe(100);
    expect(pool.mesh.boundingSphere!.containsPoint(new THREE.Vector3(100, 0, 0))).toBe(true);
  });

  test('uploads nothing after spawn while no instance moved', () => {
    const pool = createTypedPool();
    pool.spawn([placeAt(1), placeAt(2)]);
    const version = pool.mesh.instanceMatrix.version;

    instancedMeshPoolSyncSystem(typedWorld);

    expect(pool.mesh.instanceMatrix.version).toBe(version);
  });
});

// i100: an instance has no OBJECT3D, so light culling's receiver test measured none of them
describe('the light receiver bounds', () => {
  test("an instance's sphere is its drawn copy's, in the pool mesh's world space", () => {
    const pool = createInstancedMeshPool({
      world,
      geometry: new THREE.BoxGeometry(),
      material: new THREE.MeshBasicNodeMaterial(),
      maxInstances: 2,
    });
    const [entityId] = pool.spawn([placeAt(10)]);
    pool.mesh.position.set(0, 5, 0);

    moveTo(entityId, 20);
    instancedMeshPoolSyncSystem(world);

    const sphere = getMeshWorldBoundingSphere(entityId, world)!;
    expect(sphere.center.toArray()).toEqual([20, 5, 0]);
    expect(sphere.radius).toBeCloseTo(Math.sqrt(3) / 2, 5);
  });

  test('a LOD-culled instance has none, one fading out to culled still has its copy', () => {
    const pool = createLodPool();
    const [faded, culled] = pool.spawn([placeAt(1), placeAt(-1)]);
    const target = getInstanceLodTarget();

    target.setCulled!(culled, world, true, false);
    target.setCulled!(faded, world, true, true);

    expect(getMeshWorldBoundingSphere(culled, world)).toBeUndefined();
    expect(getMeshWorldBoundingSphere(faded, world)!.center.x).toBeCloseTo(1, 5);
  });

  test("an instance of an instanced LOD pool is measured by every level's sphere", () => {
    const pool = createInstancedLodPool({
      world,
      levels: [
        {
          geometry: new THREE.BoxGeometry(),
          material: new THREE.MeshBasicNodeMaterial(),
          screenSize: 0.5,
        },
        {
          geometry: new THREE.BoxGeometry(4, 4, 4),
          material: new THREE.MeshBasicNodeMaterial(),
          screenSize: 0.1,
        },
      ],
      maxInstances: 2,
    });
    const [entityId] = pool.spawn([placeAt(0)]);

    // In level 0's mesh, the larger level 1's sphere
    expect(world.getComponent(entityId, ComponentType.INSTANCED_MESH_SLOT)!.mesh).toBe(
      pool.meshes[0]
    );
    expect(getMeshWorldBoundingSphere(entityId, world)!.radius).toBeCloseTo(2 * Math.sqrt(3), 5);
  });
});
