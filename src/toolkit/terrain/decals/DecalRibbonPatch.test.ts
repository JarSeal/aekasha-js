import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { AtlasCellRect } from 'aekasha';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  createBlockSurfaceSample,
  readBlockSurface,
  sampleBlockSurface,
} from '../blocks/BlockSurface';
import type { BlockSurface } from '../blocks/BlockSurface';
import { createDecalPatchArrays } from './DecalPatch';
import type { DecalPatchArrays } from './DecalPatch';
import { writeRibbonPatch } from './DecalRibbonPatch';
import type { DecalRibbonCounts, DecalRibbonSpec } from './DecalRibbonPatch';

const CELL: AtlasCellRect = [0, 0, 0.5, 0.125];
const ORIGIN = { x: 16, z: -16 };

/** A flat 8 m block of 17 × 17 points (0.5 m apart) at the origin's place */
const readFlatBlock = () => {
  const positions: number[] = [];
  for (let row = 0; row <= 16; row++) {
    for (let col = 0; col <= 16; col++) positions.push(col / 2 - 4, 0, row / 2 - 4);
  }
  return readBlockSurface(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    ),
    8,
    'test'
  );
};

const createSpec = (spec: Partial<DecalRibbonSpec> = {}): DecalRibbonSpec => {
  const points = spec.points ?? [
    { x: ORIGIN.x - 2, z: ORIGIN.z },
    { x: ORIGIN.x + 2, z: ORIGIN.z },
  ];
  return {
    pointCount: points.length,
    width: 0.5,
    tileLength: 1,
    along: 0,
    cellRect: CELL,
    lift: 0,
    step: 0.25,
    fadeStart: true,
    fadeEnd: true,
    endFadeMeters: 0.5,
    edgeShareU: 0.1,
    origin: ORIGIN,
    ...spec,
    points,
  };
};

const write = (
  surface: BlockSurface,
  spec: DecalRibbonSpec,
  arrays = createDecalPatchArrays(400)
) => {
  const counts: DecalRibbonCounts = { vertexCount: 0, indexCount: 0, stride: 0, length: 0 };
  writeRibbonPatch(surface, spec, arrays, counts);
  return { counts, arrays };
};

const getPosition = (arrays: DecalPatchArrays, vertex: number) =>
  new THREE.Vector3().fromArray(arrays.positions, vertex * 3);

describe('writeRibbonPatch', () => {
  it('lays rows along the path and columns across it, doubling a row where a tile ends', () => {
    const { counts, arrays } = write(readFlatBlock(), createSpec());
    // 4 m at 0.25 m: 17 stations, the tiles' ends at 1, 2 and 3 m doubled; 0.5 m across: 3 columns
    expect(counts.length).toBe(4);
    expect(counts.stride).toBe(1);
    expect(counts.vertexCount).toBe(20 * 3);
    expect(counts.indexCount).toBe(16 * 2 * 6);
    // The rows at 1 m: one tile's end (u at the cell's right), the next one's start (its left)
    const atOne: number[] = [];
    for (let vertex = 0; vertex < counts.vertexCount; vertex += 3) {
      if (Math.abs(getPosition(arrays, vertex).x - (ORIGIN.x - 1)) < 1e-6) {
        atOne.push(arrays.uvs[vertex * 2]);
      }
    }
    expect(atOne).toEqual([CELL[2], CELL[0]]);
    // v across: 1 on the −z side (the decal frame's v on flat ground), in the cell's v
    expect(getPosition(arrays, 0).z).toBeCloseTo(ORIGIN.z + 0.25, 6);
    expect(arrays.decalUvs[1]).toBe(0);
    expect(getPosition(arrays, 2).z).toBeCloseTo(ORIGIN.z - 0.25, 6);
    expect(arrays.decalUvs[5]).toBe(1);
    expect(arrays.uvs[5]).toBeCloseTo(CELL[3], 6);
    // Every face up
    for (let i = 0; i < counts.indexCount; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => getPosition(arrays, arrays.indices[i + k]));
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a));
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it('holds a fade coordinate in u: 0 at a faded end, the share at endFadeMeters, 0.5 inside', () => {
    const { counts, arrays } = write(readFlatBlock(), createSpec({ fadeEnd: false }));
    const fadeAt = (x: number) => {
      for (let vertex = 0; vertex < counts.vertexCount; vertex++) {
        if (Math.abs(getPosition(arrays, vertex).x - x) < 1e-6) return arrays.decalUvs[vertex * 2];
      }
      throw new Error(`No row at ${x}.`);
    };
    expect(fadeAt(ORIGIN.x - 2)).toBe(0);
    expect(fadeAt(ORIGIN.x - 1.5)).toBeCloseTo(0.1, 6);
    expect(fadeAt(ORIGIN.x)).toBeCloseTo(0.4, 6);
    expect(fadeAt(ORIGIN.x + 1)).toBe(0.5);
    expect(fadeAt(ORIGIN.x + 2)).toBe(0.5);
    // No share: no fade
    const flat = write(readFlatBlock(), createSpec({ edgeShareU: 0 }));
    expect(flat.arrays.decalUvs[0]).toBe(0.5);
  });

  it("starts in a tile at along, and lies on a relief block's surface lifted along its normal", () => {
    const surface = readBlockSurface(
      generateTerrain({
        width: 8,
        depth: 8,
        widthSegments: 16,
        depthSegments: 16,
        maxHeight: 2,
        seed: 4,
      }).geometry,
      8,
      'test'
    );
    const spec = createSpec({
      along: 0.5,
      lift: 0.015,
      points: [
        { x: ORIGIN.x - 3, z: ORIGIN.z - 1 },
        { x: ORIGIN.x, z: ORIGIN.z + 0.4 },
        { x: ORIGIN.x + 2.5, z: ORIGIN.z + 2 },
      ],
    });
    const { counts, arrays } = write(surface, spec);
    expect(arrays.uvs[0]).toBeCloseTo(CELL[0] + 0.5 * (CELL[2] - CELL[0]), 6);
    const sample = createBlockSurfaceSample();
    for (let vertex = 0; vertex < counts.vertexCount; vertex++) {
      const p = getPosition(arrays, vertex);
      const n = new THREE.Vector3().fromArray(arrays.normals, vertex * 3);
      // The vertex is the sampled point lifted along its normal
      const base = p.clone().addScaledVector(n, -0.015);
      sampleBlockSurface(surface, base.x - ORIGIN.x, base.z - ORIGIN.z, sample);
      expect(base.y).toBeCloseTo(sample.height, 4);
    }
  });

  it('widens the row at a turn to keep the width, and turns an end to a given direction', () => {
    const corner = { x: ORIGIN.x, z: ORIGIN.z };
    const spec = createSpec({
      points: [{ x: ORIGIN.x - 2, z: ORIGIN.z }, corner, { x: ORIGIN.x, z: ORIGIN.z - 2 }],
    });
    const { counts, arrays } = write(readFlatBlock(), spec);
    let cornerWidth = 0;
    for (let vertex = 0; vertex < counts.vertexCount; vertex += 3) {
      const middle = getPosition(arrays, vertex + 1);
      if (middle.distanceTo(new THREE.Vector3(corner.x, 0, corner.z)) < 1e-6) {
        cornerWidth = getPosition(arrays, vertex).distanceTo(getPosition(arrays, vertex + 2));
      }
    }
    expect(cornerWidth).toBeCloseTo(0.5 * Math.SQRT2, 5);

    // Two ribbons joined at a point: the second starts at the first's last row
    const first = write(readFlatBlock(), spec);
    const lastRow = [0, 1, 2].map((k) =>
      getPosition(first.arrays, first.counts.vertexCount - 3 + k)
    );
    const second = write(
      readFlatBlock(),
      createSpec({
        points: [
          { x: ORIGIN.x, z: ORIGIN.z - 2 },
          { x: ORIGIN.x + 1.5, z: ORIGIN.z - 3 },
        ],
        startDirection: { x: 0, z: -1 },
        fadeStart: false,
      })
    );
    for (let k = 0; k < 3; k++) {
      expect(getPosition(second.arrays, k).distanceTo(lastRow[k])).toBeLessThan(1e-6);
    }
  });

  it("takes longer steps past its arrays' size, and writes nothing it can't fit or for no length", () => {
    const { counts } = write(
      readFlatBlock(),
      createSpec({ tileLength: 10 }),
      createDecalPatchArrays(24)
    );
    expect(counts.stride).toBeGreaterThan(1);
    expect(counts.vertexCount).toBeLessThanOrEqual(24);
    expect(counts.indexCount).toBeGreaterThan(0);
    // A tile end every 5 cm: more doubled rows than any step leaves room for
    const tooMany = write(
      readFlatBlock(),
      createSpec({ tileLength: 0.05 }),
      createDecalPatchArrays(24)
    );
    expect(tooMany.counts.vertexCount).toBe(0);
    const point = { x: ORIGIN.x, z: ORIGIN.z };
    const none = write(readFlatBlock(), createSpec({ points: [point, { ...point }] }));
    expect(none.counts).toMatchObject({ vertexCount: 0, indexCount: 0 });
    // A point repeated inside a path takes its neighbour's direction
    const repeated = write(
      readFlatBlock(),
      createSpec({
        points: [
          { x: ORIGIN.x - 1, z: ORIGIN.z },
          point,
          { ...point },
          { x: ORIGIN.x + 1, z: ORIGIN.z },
        ],
      })
    );
    expect(repeated.counts.length).toBeCloseTo(2, 6);
    expect(
      Array.from(repeated.arrays.positions.subarray(0, repeated.counts.vertexCount * 3)).some(
        Number.isNaN
      )
    ).toBe(false);
  });
});
