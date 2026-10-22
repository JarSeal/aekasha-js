import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { generateTerrain } from './Terrain';

const OPTIONS = { width: 20, depth: 12, widthSegments: 5, depthSegments: 3, maxHeight: 4, seed: 7 };

describe('generateTerrain', () => {
  it('is the same terrain for the same seed, another for another', () => {
    const heights = generateTerrain(OPTIONS).heights;
    expect(generateTerrain(OPTIONS).heights).toEqual(heights);
    expect(generateTerrain({ ...OPTIONS, seed: 8 }).heights).not.toEqual(heights);
  });

  it('getHeightAt is heights[] at the vertices, row-major, and the mesh agrees', () => {
    const terrain = generateTerrain(OPTIONS);
    const position = terrain.geometry.getAttribute('position');
    const cols = OPTIONS.widthSegments + 1;
    expect(position.count).toBe(cols * (OPTIONS.depthSegments + 1));
    for (let i = 0; i < position.count; i++) {
      const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
      expect(y).toBe(terrain.heights[i]);
      // Row i / cols runs along z, column i % cols along x
      expect(x).toBeCloseTo((i % cols) * 4 - 10, 5);
      expect(z).toBeCloseTo(Math.floor(i / cols) * 4 - 6, 5);
      expect(terrain.getHeightAt(x, z)).toBeCloseTo(y, 5);
    }
  });

  it('clamps getHeightAt to the edge outside the terrain', () => {
    const terrain = generateTerrain(OPTIONS);
    expect(terrain.getHeightAt(50, -50)).toBe(terrain.getHeightAt(10, -6));
    expect(terrain.getHeightAt(-50, 2.3)).toBe(terrain.getHeightAt(-10, 2.3));
  });

  it('reshapes the heights with heightModifier before the mesh is built', () => {
    const terrain = generateTerrain({ ...OPTIONS, heightModifier: (x) => (x < 0 ? 0 : 1) });
    expect(terrain.getHeightAt(-10, 0)).toBe(0);
    expect(terrain.getHeightAt(10, 0)).toBe(1);
    expect(terrain.geometry.getAttribute('position').getY(0)).toBe(0);
  });

  it('builds with whole segment counts of 1 or more, and returns them', () => {
    const terrain = generateTerrain({ ...OPTIONS, widthSegments: 2.6, depthSegments: 0 });
    expect([terrain.widthSegments, terrain.depthSegments]).toEqual([3, 1]);
    expect(terrain.heights.length).toBe(4 * 2);
  });

  it("getHeightAt is the mesh's height inside a cell", () => {
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

  it('0 segments gives finite heights', () => {
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

  it('fractional segments index only vertices the mesh has', () => {
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
