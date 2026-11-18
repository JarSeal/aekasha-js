import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  createScatterSurfaceSample,
  readScatterSurface,
  sampleScatterSurface,
} from './ScatterSurface';

const WHERE = 'test';

/** A generated 16 m block of 9 × 9 vertices, with a skirt and vertex colours */
const createTerrain = () =>
  generateTerrain({
    width: 16,
    depth: 16,
    widthSegments: 8,
    depthSegments: 8,
    maxHeight: 3,
    seed: 5,
    skirt: 2,
    vertexColors: { layout: 'RGBA', rules: [{ layer: 1, height: { min: 0 } }] },
  });

/** The geometry's vertices in another order, as Blender's export writes them */
const shuffleVertices = (geometry: THREE.BufferGeometry) => {
  const source = geometry.toNonIndexed();
  const count = source.getAttribute('position').count;
  const order = Array.from({ length: count }, (_, i) => (i * 7919) % count);
  const shuffled = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const attribute = source.getAttribute(name);
    const array = new Float32Array(count * attribute.itemSize);
    order.forEach((from, to) => {
      for (let k = 0; k < attribute.itemSize; k++) {
        array[to * attribute.itemSize + k] = attribute.getComponent(from, k);
      }
    });
    shuffled.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
  }
  return shuffled;
};

describe('readScatterSurface', () => {
  it("reads a generated block's grid, its skirt left out, and samples its triangles as getHeightAt does", () => {
    const terrain = createTerrain();
    const surface = readScatterSurface(terrain.geometry, 16, WHERE);
    expect(surface.cols).toBe(9);
    expect(surface.rows).toBe(9);
    expect(Array.from(surface.heights)).toEqual(Array.from(terrain.heights));
    const sample = createScatterSurfaceSample();
    for (const [x, z] of [
      [0.3, -5.1],
      [-7.9, 7.2],
      [3.5, 2.6],
      [8, 8],
    ]) {
      sampleScatterSurface(surface, x, z, sample);
      expect(sample.height).toBeCloseTo(terrain.getHeightAt(x, z), 5);
      expect(Math.hypot(sample.normalX, sample.normalY, sample.normalZ)).toBeCloseTo(1, 5);
    }
    // A grid point's colour is its vertex's, the bytes read 0..1
    const colors = terrain.geometry.getAttribute('color');
    sampleScatterSurface(surface, -8, -8, sample);
    expect(sample.color[0]).toBeCloseTo(colors.getX(0), 5);
  });

  it('reads the same grid from any vertex order', () => {
    const terrain = createTerrain();
    const ordered = readScatterSurface(terrain.geometry, 16, WHERE);
    const shuffled = readScatterSurface(shuffleVertices(terrain.geometry), 16, WHERE);
    expect(shuffled.heights).toEqual(ordered.heights);
    expect(shuffled.normals).toEqual(ordered.normals);
    expect(shuffled.colors).toEqual(ordered.colors);
  });

  it('makes the normals from the heights when the geometry has none', () => {
    const geometry = createTerrain().geometry.clone();
    geometry.deleteAttribute('normal');
    const surface = readScatterSurface(geometry, 16, WHERE);
    const sample = sampleScatterSurface(surface, 1, 1, createScatterSurfaceSample());
    expect(Math.hypot(sample.normalX, sample.normalY, sample.normalZ)).toBeCloseTo(1, 5);
    expect(sample.normalY).toBeGreaterThan(0);
  });

  it("refuses a surface that isn't a regular grid", () => {
    const moved = createTerrain().geometry.clone();
    moved.getAttribute('position').setX(10, moved.getAttribute('position').getX(10) + 0.3);
    expect(() => readScatterSurface(moved, 16, WHERE)).toThrow(
      /test: the surface isn't a regular grid 16 m wide .*: the vertex \d+ at .* is off the 10 × 9 grid/
    );
    // A sphere's vertices aren't on any grid
    expect(() => readScatterSurface(new THREE.SphereGeometry(4), 8, WHERE)).toThrow(
      /isn't a regular grid/
    );
    // A missing grid point (a hole)
    const holed = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, -1, 0, 1, 0, 0, 0, 0, 0, -1], 3)
    );
    expect(() => readScatterSurface(holed, 2, WHERE)).toThrow(/has no vertex/);
  });
});
