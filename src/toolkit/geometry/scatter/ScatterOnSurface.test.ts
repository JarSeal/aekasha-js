import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { generateTerrain } from '../generate/Terrain';
import {
  bakeScatterToInstancedMesh,
  scatterOnSurface,
  spawnScatterAsMeshEntities,
  type ScatterPlacement,
} from './ScatterOnSurface';

// createMeshEntity is a stand-in recording its props (the real one needs the root scene)
const stubs = vi.hoisted(() => ({ meshProps: [] as Record<string, unknown>[] }));
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  createMeshEntity: (props: Record<string, unknown>) => {
    stubs.meshProps.push(props);
    return stubs.meshProps.length;
  },
  getECSWorld: () => ({}),
}));

const placementAt = (x: number, scale = 1): ScatterPlacement => ({
  position: new THREE.Vector3(x, 0, 0),
  normal: new THREE.Vector3(0, 1, 0),
  quaternion: new THREE.Quaternion(),
  scale,
});

// largeWorld's terrain (largeWorld.ts), as a plain mesh at the origin
const terrain = generateTerrain({
  width: 200,
  depth: 200,
  widthSegments: 150,
  depthSegments: 150,
  maxHeight: 7,
  seed: 5,
});
const surface = new THREE.Mesh(terrain.geometry);

// sha256 over each placement's position, normal, quaternion and scale, 16 hex. Rounded to 1e-9
// (`+ 0` drops a -0): the raw bits differed in the last place between machines on the same Node
// (an arm64 Mac against the machine that recorded them, p621 Phase 1), as V8's sin / cos can by
// build, and "where they are" doesn't need the last bit
const hashPlacements = (placements: ScatterPlacement[]) => {
  const hash = createHash('sha256');
  const round = (v: number) => Math.round(v * 1e9) + 0;
  for (const p of placements) {
    hash.update(
      new Float64Array(
        [...p.position.toArray(), ...p.normal.toArray(), ...p.quaternion.toArray(), p.scale].map(
          round
        )
      )
    );
  }
  return hash.digest('hex').slice(0, 16);
};

describe('scatterOnSurface', () => {
  // largeWorld's four calls (p620 Phase 0's placements; p621 Phase 1's rounded hashes): its trees, bushes, rocks and lanterns stay
  // where they are
  it.each([
    [
      'trees',
      { count: 1500, seed: 2, minSpacing: 2, scaleRange: [0.7, 1.3] },
      1500,
      'c33d602af1d18c78',
    ],
    [
      'bushes',
      { count: 2000, seed: 3, minSpacing: 1, scaleRange: [0.6, 1.2] },
      2000,
      'd8efcdd5618412ee',
    ],
    [
      'rocks',
      { count: 300, seed: 6, minSpacing: 4, scaleRange: [0.6, 1.6] },
      300,
      'cecc8dbb10264d66',
    ],
    ['lanterns', { count: 10, seed: 4, minSpacing: 12 }, 10, '02802b3175749609'],
  ] as const)("places largeWorld's %s as before", (_, opts, length, hash) => {
    const placements = scatterOnSurface({
      surface,
      ...opts,
      scaleRange: 'scaleRange' in opts ? [...opts.scaleRange] : undefined,
    });
    expect(placements.length).toBe(length);
    expect(hashPlacements(placements)).toBe(hash);
  });

  it('keeps minSpacing between every two placements, and may place fewer than count', () => {
    const placements = scatterOnSurface({ surface, count: 400, seed: 1, minSpacing: 12 });
    expect(placements.length).toBeLessThan(400);
    let closest = Infinity;
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        closest = Math.min(closest, placements[i].position.distanceTo(placements[j].position));
      }
    }
    expect(closest).toBeGreaterThanOrEqual(12);
  });

  it('gives unit normals and quaternions, scales in range, upright unless alignToNormal', () => {
    const up = new THREE.Vector3(0, 1, 0);
    for (const alignToNormal of [false, true]) {
      const placements = scatterOnSurface({
        surface,
        count: 50,
        seed: 3,
        scaleRange: [0.5, 2],
        alignToNormal,
      });
      for (const { normal, quaternion, scale } of placements) {
        expect(normal.length()).toBeCloseTo(1, 6);
        expect(quaternion.length()).toBeCloseTo(1, 6);
        expect(scale).toBeGreaterThanOrEqual(0.5);
        expect(scale).toBeLessThanOrEqual(2);
        const placedUp = up.clone().applyQuaternion(quaternion);
        expect(placedUp.distanceTo(alignToNormal ? normal : up)).toBeLessThan(1e-6);
      }
    }
  });

  it('returns world-space placements on a moved surface', () => {
    const moved = new THREE.Mesh(terrain.geometry);
    moved.position.set(1000, 0, 0);
    const placements = scatterOnSurface({ surface: moved, count: 20, seed: 8 });
    const atOrigin = scatterOnSurface({ surface, count: 20, seed: 8 });
    for (let i = 0; i < placements.length; i++) {
      expect(placements[i].position.x - atOrigin[i].position.x).toBeCloseTo(1000, 6);
    }
  });
});

describe('spawnScatterAsMeshEntities', () => {
  it("spawns with the placement's scale in the mesh props", () => {
    spawnScatterAsMeshEntities([placementAt(0, 2)], { geo: 'box', mat: 'mat' });
    // The engine's first sync copies TRANSFORM (made from these props) to the Object3D
    expect(stubs.meshProps[0].scale).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe('bakeScatterToInstancedMesh', () => {
  it("bakes no more placements than the mesh's capacity", () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2);
    const next = bakeScatterToInstancedMesh(mesh, [placementAt(0), placementAt(1), placementAt(2)]);
    expect(next).toBe(2);
    // From an index, as many as fit after it
    expect(bakeScatterToInstancedMesh(mesh, [placementAt(0), placementAt(1)], 1)).toBe(2);
  });

  it('draws only the baked instances', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 5);
    const next = bakeScatterToInstancedMesh(mesh, [placementAt(0), placementAt(1), placementAt(2)]);
    expect(mesh.count).toBe(next);
  });

  it('places a world-space placement under a moved mesh', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 1);
    mesh.position.set(5, 0, 0);
    mesh.updateMatrixWorld();
    bakeScatterToInstancedMesh(mesh, [placementAt(10)]);
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(0, instance);
    const world = new THREE.Vector3().setFromMatrixPosition(instance.premultiply(mesh.matrixWorld));
    expect(world.x).toBeCloseTo(10);
  });

  it('composes position, rotation and scale into the instance matrix, from startIndex', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 4);
    const placement = placementAt(3, 2);
    placement.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    expect(bakeScatterToInstancedMesh(mesh, [placement], 2)).toBe(3);
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(2, instance);
    const expected = new THREE.Matrix4().compose(
      placement.position,
      placement.quaternion,
      new THREE.Vector3(2, 2, 2)
    );
    // Instance matrices are Float32
    instance.elements.forEach((value, i) => expect(value).toBeCloseTo(expected.elements[i], 6));
  });
});
