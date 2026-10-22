import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  bakeScatterToInstancedMesh,
  spawnScatterAsMeshEntities,
  type ScatterPlacement,
} from './ScatterOnSurface';

// The `it.fails` cases are known bugs, each failing on its assertion: p620 Phase 1 fixes them
// and turns them into `it`s (docs/plans/p620_review-toolkit-and-app-code.md, T1, T4).

// createMeshEntity is a stand-in recording its props (the real one needs the root scene)
const stubs = vi.hoisted(() => ({ meshProps: [] as Record<string, unknown>[] }));
vi.mock('aekasha', async (importOriginal) => {
  const THREE = await import('three/webgpu');
  return {
    ...(await importOriginal<typeof import('aekasha')>()),
    createMeshEntity: (props: Record<string, unknown>) => {
      stubs.meshProps.push(props);
      return stubs.meshProps.length;
    },
    getECSWorld: () => ({ getComponent: () => ({ value: new THREE.Object3D() }) }),
  };
});

const placementAt = (x: number, scale = 1): ScatterPlacement => ({
  position: new THREE.Vector3(x, 0, 0),
  normal: new THREE.Vector3(0, 1, 0),
  quaternion: new THREE.Quaternion(),
  scale,
});

describe('spawnScatterAsMeshEntities', () => {
  it.fails("spawns with the placement's scale in the mesh props", () => {
    spawnScatterAsMeshEntities([placementAt(0, 2)], { geo: 'box', mat: 'mat' });
    // The engine's first sync copies TRANSFORM (made from these props) to the Object3D
    expect(stubs.meshProps[0].scale).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe('bakeScatterToInstancedMesh', () => {
  it.fails("bakes no more placements than the mesh's capacity", () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2);
    const next = bakeScatterToInstancedMesh(mesh, [placementAt(0), placementAt(1), placementAt(2)]);
    expect(next).toBeLessThanOrEqual(2);
  });

  it.fails('draws only the baked instances', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 5);
    const next = bakeScatterToInstancedMesh(mesh, [placementAt(0), placementAt(1), placementAt(2)]);
    expect(mesh.count).toBe(next);
  });

  it.fails('places a world-space placement under a moved mesh', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 1);
    mesh.position.set(5, 0, 0);
    mesh.updateMatrixWorld();
    bakeScatterToInstancedMesh(mesh, [placementAt(10)]);
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(0, instance);
    const world = new THREE.Vector3().setFromMatrixPosition(instance.premultiply(mesh.matrixWorld));
    expect(world.x).toBeCloseTo(10);
  });
});
