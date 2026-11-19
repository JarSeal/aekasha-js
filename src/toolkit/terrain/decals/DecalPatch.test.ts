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
import {
  createDecalPatchArrays,
  getDecalFrame,
  getDecalPatchMaxIndices,
  writeDecalPatch,
  writeMeshDecalPatch,
  type DecalFrame,
  type DecalPatchArrays,
  type DecalPatchCounts,
  type DecalPatchSpec,
} from './DecalPatch';

const CELL: AtlasCellRect = [0.25, 0.5, 0.5, 0.75];
const ORIGIN = { x: 100, y: 2, z: -40 };

/** A 16 m block of 33 × 33 points (0.5 m apart) with relief */
const readReliefBlock = () =>
  readBlockSurface(
    generateTerrain({
      width: 16,
      depth: 16,
      widthSegments: 32,
      depthSegments: 32,
      maxHeight: 3,
      seed: 7,
    }).geometry,
    16,
    'test'
  );

/** A block of `segments` cells a side whose heights are `heightAt(x, z)`, positions only */
const readBlock = (size: number, segments: number, heightAt: (x: number, z: number) => number) => {
  const positions: number[] = [];
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const x = (col / segments - 0.5) * size;
      const z = (row / segments - 0.5) * size;
      positions.push(x, heightAt(x, z), z);
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return readBlockSurface(geometry, size, 'test');
};

const createSpec = (spec: Partial<DecalPatchSpec> = {}): DecalPatchSpec => ({
  x: 0.3,
  z: -1.1,
  rotation: 0,
  width: 2,
  height: 1,
  cellRect: CELL,
  lift: 0,
  origin: ORIGIN,
  ...spec,
});

const write = (surface: BlockSurface, spec: DecalPatchSpec, arrays: DecalPatchArrays) =>
  writeDecalPatch(surface, spec, arrays, { vertexCount: 0, indexCount: 0, stride: 0 });

/** A patch vertex's position less the origin (the block's space) */
const getLocal = (arrays: DecalPatchArrays, vertex: number) =>
  new THREE.Vector3(
    arrays.positions[vertex * 3] - ORIGIN.x,
    arrays.positions[vertex * 3 + 1] - ORIGIN.y,
    arrays.positions[vertex * 3 + 2] - ORIGIN.z
  );

/** Each triangle's three vertices in the block's space */
const getTriangles = (arrays: DecalPatchArrays, counts: DecalPatchCounts) => {
  const triangles: THREE.Vector3[][] = [];
  for (let i = 0; i < counts.indexCount; i += 3) {
    triangles.push([0, 1, 2].map((k) => getLocal(arrays, arrays.indices[i + k])));
  }
  return triangles;
};

describe('writeDecalPatch', () => {
  it("lies on the block's own triangles, facing up, its UVs 0..1 over the decal and in its cell", () => {
    const surface = readReliefBlock();
    const arrays = createDecalPatchArrays(169);
    const counts = write(surface, createSpec(), arrays);
    expect(counts.stride).toBe(1);
    expect(counts.indexCount).toBeGreaterThan(0);
    const sample = createBlockSurfaceSample();
    for (const triangle of getTriangles(arrays, counts)) {
      const normal = new THREE.Vector3()
        .subVectors(triangle[1], triangle[0])
        .cross(new THREE.Vector3().subVectors(triangle[2], triangle[0]));
      expect(normal.y).toBeGreaterThan(0);
      // Off the grid points: a patch on other triangles would part from the block on relief
      const centroid = new THREE.Vector3().add(triangle[0]).add(triangle[1]).add(triangle[2]);
      centroid.divideScalar(3);
      sampleBlockSurface(surface, centroid.x, centroid.z, sample);
      expect(centroid.y).toBeCloseTo(sample.height, 4);
    }
    for (let vertex = 0; vertex < counts.vertexCount; vertex++) {
      const u = arrays.decalUvs[vertex * 2];
      const v = arrays.decalUvs[vertex * 2 + 1];
      expect(arrays.uvs[vertex * 2]).toBeCloseTo(CELL[0] + u * (CELL[2] - CELL[0]), 6);
      expect(arrays.uvs[vertex * 2 + 1]).toBeCloseTo(CELL[1] + v * (CELL[3] - CELL[1]), 6);
    }
  });

  it("lifts along the block's normals, and places the patch at the origin", () => {
    const surface = readReliefBlock();
    const flat = createDecalPatchArrays(169);
    const lifted = createDecalPatchArrays(169);
    const counts = write(surface, createSpec(), flat);
    write(surface, createSpec({ lift: 0.01 }), lifted);
    for (let vertex = 0; vertex < counts.vertexCount; vertex++) {
      const n = new THREE.Vector3().fromArray(flat.normals, vertex * 3);
      expect(n.length()).toBeCloseTo(1, 5);
      const moved = new THREE.Vector3()
        .fromArray(lifted.positions, vertex * 3)
        .sub(new THREE.Vector3().fromArray(flat.positions, vertex * 3));
      expect(moved.distanceTo(n.multiplyScalar(0.01))).toBeLessThan(2e-5);
    }
    // A flat block's patch: its points' heights the origin's
    const ground = readBlock(8, 16, () => 0);
    const groundArrays = createDecalPatchArrays(169);
    const groundCounts = write(ground, createSpec(), groundArrays);
    for (let vertex = 0; vertex < groundCounts.vertexCount; vertex++) {
      expect(groundArrays.positions[vertex * 3 + 1]).toBe(ORIGIN.y);
    }
  });

  it('maps u along x and v toward −z on flat ground, turned counter-clockwise by the rotation', () => {
    const ground = readBlock(8, 16, () => 0);
    const arrays = createDecalPatchArrays(169);
    // The vertex at a point, by its place in the block's space
    const findUv = (x: number, z: number) => {
      for (let vertex = 0; vertex < arrays.positions.length / 3; vertex++) {
        const local = getLocal(arrays, vertex);
        if (Math.abs(local.x - x) < 1e-6 && Math.abs(local.z - z) < 1e-6) {
          return [arrays.decalUvs[vertex * 2], arrays.decalUvs[vertex * 2 + 1]];
        }
      }
      throw new Error(`No vertex at (${x}, ${z}).`);
    };
    write(ground, createSpec({ x: 0, z: 0, width: 2, height: 1 }), arrays);
    expect(findUv(0, 0)).toEqual([0.5, 0.5]);
    expect(findUv(1, 0)).toEqual([1, 0.5]);
    expect(findUv(0, -0.5)).toEqual([0.5, 1]);
    // A quarter turn seen from above: u along −z
    write(ground, createSpec({ x: 0, z: 0, width: 2, height: 2, rotation: Math.PI / 2 }), arrays);
    const [u, v] = findUv(0, -1);
    expect(u).toBeCloseTo(1, 6);
    expect(v).toBeCloseTo(0.5, 6);
  });

  it("projects along the decal's normal: on a slope u counts metres along it", () => {
    // A plane rising 0.5 m a metre along x; the default normal is the block's
    const slope = readBlock(8, 16, (x) => 0.5 * x);
    const arrays = createDecalPatchArrays(169);
    write(slope, createSpec({ x: 0, z: 0, width: 2, height: 2 }), arrays);
    const a = getLocal(arrays, 0);
    const b = getLocal(arrays, 1);
    const du = arrays.decalUvs[2] - arrays.decalUvs[0];
    expect(du * 2).toBeCloseTo(a.distanceTo(b), 5);
    // Straight down instead: u counts x (the points 0.5 m apart)
    write(
      slope,
      createSpec({ x: 0, z: 0, width: 2, height: 2, normal: { x: 0, y: 1, z: 0 } }),
      arrays
    );
    expect((arrays.decalUvs[2] - arrays.decalUvs[0]) * 2).toBeCloseTo(0.5, 5);
  });

  it('leaves out the cells wholly outside a turned rect, never one it covers', () => {
    const ground = readBlock(8, 32, () => 0);
    const arrays = createDecalPatchArrays(400);
    const square = write(ground, createSpec({ x: 0, z: 0, width: 3, height: 3 }), arrays);
    const turned = write(
      ground,
      createSpec({ x: 0, z: 0, width: 3, height: 3, rotation: Math.PI / 4 }),
      arrays
    );
    // The diamond's window is twice the square's area, its kept cells far fewer than the window's
    const windowCells = (Math.sqrt(turned.vertexCount) - 1) ** 2;
    expect(turned.indexCount / 6).toBeLessThan(windowCells * 0.7);
    expect(square.indexCount / 6).toBeLessThan(turned.indexCount / 6);
    // Every point of the rect lies over a kept triangle
    const triangles = getTriangles(arrays, turned).map(
      ([p, q, r]) => new THREE.Triangle(p.setY(0), q.setY(0), r.setY(0))
    );
    const cos = Math.cos(Math.PI / 4);
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const s = (i / 10 - 0.5) * 2.98;
        const t = (j / 10 - 0.5) * 2.98;
        const point = new THREE.Vector3(s * cos + t * cos, 0, -s * cos + t * cos);
        expect(triangles.some((triangle) => triangle.containsPoint(point))).toBe(true);
      }
    }
  });

  it("takes every n-th grid line past its arrays' size, its points still the block's", () => {
    const surface = readReliefBlock();
    const arrays = createDecalPatchArrays(25);
    const counts = write(surface, createSpec({ x: 0, z: 0, width: 6, height: 6 }), arrays);
    expect(counts.stride).toBeGreaterThan(1);
    expect(counts.vertexCount).toBeLessThanOrEqual(25);
    expect(counts.indexCount).toBeLessThanOrEqual(getDecalPatchMaxIndices(25));
    expect(counts.indexCount).toBeGreaterThan(0);
    const sample = createBlockSurfaceSample();
    for (let vertex = 0; vertex < counts.vertexCount; vertex++) {
      const local = getLocal(arrays, vertex);
      expect(local.y).toBeCloseTo(sampleBlockSurface(surface, local.x, local.z, sample).height, 5);
    }
  });

  it("stops at the block's edge, and writes nothing for a decal off the block", () => {
    const ground = readBlock(8, 16, () => 0);
    const arrays = createDecalPatchArrays(169);
    const edge = write(ground, createSpec({ x: 3.9, z: 0, width: 2, height: 2 }), arrays);
    expect(edge.indexCount).toBeGreaterThan(0);
    for (let vertex = 0; vertex < edge.vertexCount; vertex++) {
      expect(getLocal(arrays, vertex).x).toBeLessThanOrEqual(4);
    }
    const off = write(ground, createSpec({ x: 7, z: 0, width: 2, height: 2 }), arrays);
    expect(off).toEqual({ vertexCount: 0, indexCount: 0, stride: 1 });
  });

  it('refuses arrays of a size the indices or the window can’t take', () => {
    expect(() => createDecalPatchArrays(3)).toThrow(/maxVertices is 3/);
    expect(() => createDecalPatchArrays(70000)).toThrow(/from 4 to 65536/);
    expect(() => createDecalPatchArrays(12.5)).toThrow(/an integer/);
    expect(getDecalPatchMaxIndices(169)).toBe(6 * 144);
  });
});

describe('getDecalFrame', () => {
  const frame: DecalFrame = { ux: 0, uy: 0, uz: 0, vx: 0, vy: 0, vz: 0 };
  const get = (n: [number, number, number], rotation = 0) => {
    getDecalFrame(...n, rotation, frame);
    return {
      u: new THREE.Vector3(frame.ux, frame.uy, frame.uz),
      v: new THREE.Vector3(frame.vx, frame.vy, frame.vz),
    };
  };

  it('lays u along x and v up a wall facing +z, and turns +z for a normal along x', () => {
    const wall = get([0, 0, 1]);
    expect(wall.u.toArray().map((c) => c + 0)).toEqual([1, 0, 0]);
    expect(wall.v.toArray().map((c) => c + 0)).toEqual([0, 1, 0]);
    const side = get([1, 0, 0]);
    expect(side.u.toArray().map((c) => c + 0)).toEqual([0, 0, 1]);
  });

  it('is a right-handed unit frame around any normal and rotation', () => {
    for (const [n, rotation] of [
      [[0.3, 0.9, -0.2], 0.4],
      [[-0.7, 0.1, 0.7], 2.5],
      [[0, -1, 0], -1],
    ] as [[number, number, number], number][]) {
      const normal = new THREE.Vector3(...n).normalize();
      const { u, v } = get(normal.toArray(), rotation);
      expect(u.length()).toBeCloseTo(1, 6);
      expect(v.length()).toBeCloseTo(1, 6);
      expect(u.dot(normal)).toBeCloseTo(0, 6);
      expect(new THREE.Vector3().crossVectors(u, v).distanceTo(normal)).toBeLessThan(1e-6);
    }
  });
});

describe('writeMeshDecalPatch', () => {
  /** Two triangles of a projected decal, world space, UVs 0..1 */
  const createSource = (withNormals: boolean) => {
    const source = new THREE.BufferGeometry();
    source.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3)
    );
    source.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], 2)
    );
    if (withNormals) {
      source.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(new Array(6).fill([0, 0, 1]).flat(), 3)
      );
    }
    return source;
  };

  it('copies the triangles lifted along their normals, its UVs as uv1 and into the cell, in order', () => {
    const arrays = createDecalPatchArrays(16);
    const counts = writeMeshDecalPatch(createSource(true), CELL, 0.01, arrays, {
      vertexCount: 0,
      indexCount: 0,
      stride: 0,
    });
    expect(counts).toEqual({ vertexCount: 6, indexCount: 6, stride: 1 });
    expect(Array.from(arrays.indices.subarray(0, 6))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(arrays.positions[4 * 3]).toBe(1);
    expect(arrays.positions[4 * 3 + 2]).toBeCloseTo(0.01, 6);
    expect(Array.from(arrays.decalUvs.subarray(8, 10))).toEqual([1, 1]);
    expect(arrays.uvs[8]).toBeCloseTo(CELL[2], 6);
    expect(arrays.uvs[9]).toBeCloseTo(CELL[3], 6);
  });

  it('gives each face its own normal where the source has none, and refuses arrays too small', () => {
    const arrays = createDecalPatchArrays(16);
    const out = { vertexCount: 0, indexCount: 0, stride: 0 };
    writeMeshDecalPatch(createSource(false), CELL, 0, arrays, out);
    for (let vertex = 0; vertex < 6; vertex++) {
      expect(Array.from(arrays.normals.subarray(vertex * 3, vertex * 3 + 3), (c) => c + 0)).toEqual(
        [0, 0, 1]
      );
    }
    expect(() =>
      writeMeshDecalPatch(createSource(true), CELL, 0, createDecalPatchArrays(4), out)
    ).toThrow(/6 vertices don't fit arrays of 4/);
  });
});
