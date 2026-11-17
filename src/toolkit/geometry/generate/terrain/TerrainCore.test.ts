import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { createSeededRandom } from 'aekasha';
import { buildTerrainData, recordTerrainNoiseDraws, type TerrainCoreOptions } from './TerrainCore';

/** A 32 m block of 24 × 20 cells, rough enough that every triangle's normal differs */
const OPTIONS: TerrainCoreOptions = {
  width: 32,
  depth: 28,
  widthSegments: 24,
  depthSegments: 20,
  maxHeight: 6,
  noiseOctaves: [
    { frequency: 1 / 12, amplitude: 1 },
    { frequency: 1 / 3, amplitude: 0.3 },
  ],
  noiseDraws: recordTerrainNoiseDraws(createSeededRandom(7)),
};

/** The arrays as a three geometry, with three's own normals and bounds */
const toThreeGeometry = (positions: Float32Array, index: Uint16Array | Uint32Array) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

describe('buildTerrainData (p306 Phase 4)', () => {
  it("computes GEOMETRY normals bit for bit as three's computeVertexNormals", () => {
    const data = buildTerrainData(OPTIONS);
    const three = toThreeGeometry(data.positions, data.index);
    expect(data.normals).toEqual(three.getAttribute('normal').array);
  });

  it("gives three's bounding box and sphere, the skirt included", () => {
    const data = buildTerrainData({ ...OPTIONS, skirt: 2 });
    const three = toThreeGeometry(data.positions, data.index);
    expect(data.boxMin).toEqual(three.boundingBox!.min.toArray());
    expect(data.boxMax).toEqual(three.boundingBox!.max.toArray());
    expect(data.sphereCenter).toEqual(three.boundingSphere!.center.toArray());
    expect(data.sphereRadius).toBe(three.boundingSphere!.radius);
  });

  it("picks the index type as three's setIndex does", () => {
    // What three's setIndex makes of the same indices as a plain array
    const threeIndexType = (index: Uint16Array | Uint32Array) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(Array.from(index));
      return geometry.getIndex()!.array.constructor;
    };
    // 254 × 256 cells are 65 535 vertices (the last index 65 534), 255 × 255 cells 65 536, and
    // 254 × 254 cells 65 025, which a skirt's 1 016 take past
    const cases = [
      { cells: [254, 256], skirt: 0, type: Uint16Array },
      { cells: [255, 255], skirt: 0, type: Uint32Array },
      { cells: [254, 254], skirt: 0, type: Uint16Array },
      { cells: [254, 254], skirt: 1, type: Uint32Array },
    ];
    for (const { cells, skirt, type } of cases) {
      const data = buildTerrainData({
        ...OPTIONS,
        widthSegments: cells[0],
        depthSegments: cells[1],
        skirt,
      });
      expect(data.index).toBeInstanceOf(type);
      expect(data.index.constructor).toBe(threeIndexType(data.index));
    }
  });

  it('replays the seeded draws into the same noise', () => {
    const draws = recordTerrainNoiseDraws(createSeededRandom(3));
    expect(draws.length).toBe(256);
    const seeded = new SimplexNoise({ random: createSeededRandom(3) });
    const data = buildTerrainData({
      ...OPTIONS,
      noiseOctaves: [{ frequency: 0.1, amplitude: 1 }],
      noiseDraws: draws,
    });
    // Vertex (0, 0) is at (−16, −14), the noise's ±maxHeight
    expect(data.heights[0]).toBe(Math.fround(seeded.noise(-1.6, -1.4) * 6));
    expect(() => buildTerrainData({ ...OPTIONS, noiseDraws: draws.subarray(0, 100) })).toThrow(
      'drew more than its 100 recorded numbers'
    );
    expect(() => buildTerrainData({ ...OPTIONS, noiseDraws: undefined })).toThrow(
      'no recorded draws'
    );
  });

  it('runs on options that went through structuredClone (no closures)', () => {
    const options: TerrainCoreOptions = {
      ...OPTIONS,
      normals: 'HEIGHT_FN',
      ao: { radius: 4 },
      vertexColors: { layout: 'RGB_AO', rules: [{ layer: 1, slope: { min: 20 } }] },
      skirt: 1,
    };
    expect(buildTerrainData(structuredClone(options))).toEqual(buildTerrainData(options));
  });
});
