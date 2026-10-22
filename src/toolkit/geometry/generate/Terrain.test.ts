import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { generateTerrain } from './Terrain';

// The `it.fails` cases are known bugs, each failing on its assertion: p620 Phase 1 fixes them
// and turns them into `it`s (docs/plans/p620_review-toolkit-and-app-code.md, T2, T3).

describe('generateTerrain', () => {
  it.fails("getHeightAt is the mesh's height inside a cell", () => {
    const terrain = generateTerrain({
      width: 20,
      depth: 20,
      widthSegments: 4,
      depthSegments: 4,
      maxHeight: 5,
      seed: 3,
    });
    const mesh = new THREE.Mesh(terrain.geometry, new THREE.MeshBasicNodeMaterial());
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    let maxDiff = 0;
    // Points inside the cells, off their diagonals
    for (const [x, z] of [
      [-8.7, -6.1],
      [-1.3, 2.2],
      [3.9, 7.4],
      [6.2, -3.3],
    ]) {
      raycaster.set(new THREE.Vector3(x, 100, z), down);
      const [hit] = raycaster.intersectObject(mesh);
      maxDiff = Math.max(maxDiff, Math.abs(hit.point.y - terrain.getHeightAt(x, z)));
    }
    expect(maxDiff).toBeLessThan(1e-4);
  });

  it.fails('0 segments gives finite heights', () => {
    const terrain = generateTerrain({
      width: 20,
      depth: 20,
      widthSegments: 0,
      depthSegments: 0,
      maxHeight: 5,
    });
    const position = terrain.geometry.getAttribute('position');
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
  });

  it.fails('fractional segments index only vertices the mesh has', () => {
    const terrain = generateTerrain({
      width: 20,
      depth: 20,
      widthSegments: 2.5,
      depthSegments: 2.5,
      maxHeight: 5,
    });
    const vertexCount = terrain.geometry.getAttribute('position').count;
    const index = terrain.geometry.getIndex();
    const maxIndex = index ? Math.max(...Array.from(index.array)) : -1;
    expect(maxIndex).toBeLessThan(vertexCount);
  });
});
