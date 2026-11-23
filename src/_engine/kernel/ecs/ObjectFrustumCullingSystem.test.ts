import { describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from './ECS';
import { ComponentType } from './ECSCoreComponents';
import { getMeshWorldBoundingSphere } from './ObjectFrustumCullingSystem';

const addMesh = (world: ECSWorld, mesh: THREE.Mesh) => {
  const entityId = world.createEntity();
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.TAG_IS_MESH, true);
  return entityId;
};

describe('getMeshWorldBoundingSphere', () => {
  test("a plain mesh: its geometry's radius, scaled, at its world position", () => {
    const world = new ECSWorld({ id: 'ofc-plain', maxEntities: 8 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1));
    mesh.position.set(5, 0, 0);
    mesh.scale.set(1, 2, 1);
    const sphere = getMeshWorldBoundingSphere(addMesh(world, mesh), world)!;
    expect(sphere.center.toArray()).toEqual([5, 0, 0]);
    expect(sphere.radius).toBeCloseTo(2, 5);
  });

  test('an InstancedMesh: its sphere over every instance, in its world space (i090)', () => {
    const world = new ECSWorld({ id: 'ofc-instanced', maxEntities: 8 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-8, 0, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(8, 0, 0));
    mesh.position.set(100, 0, 0);
    mesh.scale.setScalar(2);
    // Not computed: the provider computes it
    expect(mesh.boundingSphere).toBeNull();

    const sphere = getMeshWorldBoundingSphere(addMesh(world, mesh), world)!;
    const local = mesh.boundingSphere!;
    expect(sphere.center.x).toBeCloseTo(100 + local.center.x * 2, 5);
    expect(sphere.radius).toBeCloseTo(local.radius * 2, 5);
    // Both end instances inside, which one instance's sphere at the origin wasn't
    expect(sphere.containsPoint(new THREE.Vector3(100 - 16, 0, 0))).toBe(true);
    expect(sphere.containsPoint(new THREE.Vector3(100 + 16, 0, 0))).toBe(true);
  });
});
