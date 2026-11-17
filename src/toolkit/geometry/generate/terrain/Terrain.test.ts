import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { toHeightfieldColliderParams } from 'aekasha/physics';
import { generateTerrain, type TerrainOptions } from './Terrain';

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

// sha256 over the geometry's positions, normals and UVs (rounded to 1e-6, `+ 0` drops a -0) and
// its index, 16 hex
const hashGeometry = (geometry: THREE.BufferGeometry) => {
  const hash = createHash('sha256');
  for (const name of ['position', 'normal', 'uv']) {
    const array = geometry.getAttribute(name).array;
    hash.update(Array.from(array, (v) => (Math.round(v * 1e6) / 1e6 + 0).toString()).join(','));
  }
  hash.update(Array.from(geometry.getIndex()?.array ?? []).join(','));
  return hash.digest('hex').slice(0, 16);
};

/** A 64 m block of 32 cells with three octaves, the noise of seed 11 */
const BLOCK: TerrainOptions = {
  width: 64,
  depth: 64,
  widthSegments: 32,
  depthSegments: 32,
  maxHeight: 10,
  seed: 11,
  noiseOctaves: [
    { frequency: 1 / 40, amplitude: 1 },
    { frequency: 1 / 13, amplitude: 0.4 },
    { frequency: 1 / 5, amplitude: 0.1 },
  ],
};
const COLS = 33;

describe('generateTerrain v2 (p306 D4)', () => {
  // The output before v2 (recorded on d5469387): largeWorld's terrain (its scene baseline and the
  // scatter hashes stand on it) and a small grid with a modifier
  it('builds the same geometry as before with the default options', () => {
    const largeWorld = generateTerrain({
      width: 200,
      depth: 200,
      widthSegments: 150,
      depthSegments: 150,
      maxHeight: 7,
      seed: 5,
    });
    expect(hashGeometry(largeWorld.geometry)).toBe('c5df4317b9cce0f5');
    const modified = generateTerrain({
      ...OPTIONS,
      heightModifier: (x, z, h) => h + x * 0.1 - z * 0.05,
    });
    expect(hashGeometry(modified.geometry)).toBe('39bc714b935cef5b');
    expect(generateTerrain({ ...OPTIONS, center: [0, 0] }).heights).toEqual(
      generateTerrain(OPTIONS).heights
    );
  });

  it('samples the world at center, so neighbouring blocks share their edge', () => {
    const left = generateTerrain({ ...BLOCK, center: [0, 0] });
    const right = generateTerrain({ ...BLOCK, center: [64, 0] });
    const front = generateTerrain({ ...BLOCK, center: [0, 64] });
    expect(right.center).toEqual([64, 0]);
    expect(right.heights).not.toEqual(left.heights);
    for (let i = 0; i < COLS; i++) {
      // left's +x column is right's −x one; left's +z row is front's −z one
      expect(right.heights[i * COLS]).toBe(left.heights[i * COLS + COLS - 1]);
      expect(front.heights[i]).toBe(left.heights[(COLS - 1) * COLS + i]);
    }
    // heightModifier gets the world's (x, z)
    const seen: number[] = [];
    generateTerrain({
      ...OPTIONS,
      center: [100, -50],
      heightModifier: (x, z, h) => {
        seen.push(x, z);
        return h;
      },
    });
    expect(seen.slice(0, 2)).toEqual([90, -56]);
  });

  it('takes the heights from heightFn, and needs maxHeight without it', () => {
    const terrain = generateTerrain({
      width: 10,
      depth: 10,
      widthSegments: 2,
      depthSegments: 2,
      center: [5, 0],
      heightFn: (x, z) => x + 2 * z,
      heightModifier: (_x, _z, h) => h + 1,
    });
    expect(Array.from(terrain.heights)).toEqual([-9, -4, 1, 1, 6, 11, 11, 16, 21]);
    expect(() =>
      generateTerrain({ width: 10, depth: 10, widthSegments: 2, depthSegments: 2 })
    ).toThrow(/maxHeight/);
  });

  it("HEIGHT_FN normals: exact on a plane, and equal on neighbours' shared edge", () => {
    const plane = generateTerrain({
      width: 8,
      depth: 8,
      widthSegments: 4,
      depthSegments: 4,
      heightFn: (x, z) => 0.5 * x - 0.25 * z,
      normals: 'HEIGHT_FN',
    });
    const expected = new THREE.Vector3(-0.5, 1, 0.25).normalize();
    const normal = plane.geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) {
      // The edge vertices too: their outer samples are the plane's past the edge
      expect(normal.getX(i)).toBeCloseTo(expected.x, 6);
      expect(normal.getY(i)).toBeCloseTo(expected.y, 6);
      expect(normal.getZ(i)).toBeCloseTo(expected.z, 6);
    }

    const left = generateTerrain({ ...BLOCK, normals: 'HEIGHT_FN' });
    const right = generateTerrain({ ...BLOCK, normals: 'HEIGHT_FN', center: [64, 0] });
    const leftNormal = left.geometry.getAttribute('normal');
    const rightNormal = right.geometry.getAttribute('normal');
    let maxGap = 0;
    for (let row = 0; row < COLS; row++) {
      const l = row * COLS + COLS - 1;
      const r = row * COLS;
      expect(rightNormal.getX(r)).toBe(leftNormal.getX(l));
      expect(rightNormal.getZ(r)).toBe(leftNormal.getZ(l));
    }
    // GEOMETRY's normals break at the same edge (each block sees only its own triangles)
    const leftGeometry = generateTerrain(BLOCK).geometry.getAttribute('normal');
    const rightGeometry = generateTerrain({ ...BLOCK, center: [64, 0] }).geometry.getAttribute(
      'normal'
    );
    for (let row = 0; row < COLS; row++) {
      const gap = Math.abs(
        rightGeometry.getX(row * COLS) - leftGeometry.getX(row * COLS + COLS - 1)
      );
      maxGap = Math.max(maxGap, gap);
    }
    expect(maxGap).toBeGreaterThan(0.01);
  });

  it('horizon AO: 1 on a plane and a peak, darker in a pit, equal on a shared edge', () => {
    const grid = { width: 20, depth: 20, widthSegments: 20, depthSegments: 20 };
    const flat = generateTerrain({ ...grid, heightFn: (x) => x * 0.3, ao: { radius: 5 } });
    expect(flat.ao?.every((value) => Math.abs(value - 1) < 1e-6)).toBe(true);

    // A cone pit at the origin: its bottom sees the sky only above 45°
    const pit = generateTerrain({
      ...grid,
      heightFn: (x, z) => Math.hypot(x, z),
      ao: { radius: 5 },
    });
    const centre = 10 * 21 + 10;
    const pitAo = pit.ao as Float32Array;
    expect(pitAo[centre]).toBeCloseTo(1 - Math.SQRT1_2, 5);
    expect(pitAo[0]).toBeGreaterThan(pitAo[centre]);
    const half = generateTerrain({
      ...grid,
      heightFn: (x, z) => Math.hypot(x, z),
      ao: { radius: 5, strength: 0.5 },
    });
    expect((half.ao as Float32Array)[centre]).toBeCloseTo(1 - Math.SQRT1_2 / 2, 5);
    // The cone's peak, upside down
    const peak = generateTerrain({
      ...grid,
      heightFn: (x, z) => -Math.hypot(x, z),
      ao: { radius: 5 },
    });
    expect((peak.ao as Float32Array)[centre]).toBe(1);
    expect(generateTerrain({ ...grid, maxHeight: 1 }).ao).toBeUndefined();

    const left = generateTerrain({ ...BLOCK, ao: { radius: 12 } });
    const right = generateTerrain({ ...BLOCK, ao: { radius: 12 }, center: [64, 0] });
    for (let row = 0; row < COLS; row++) {
      expect((right.ao as Float32Array)[row * COLS]).toBe(
        (left.ao as Float32Array)[row * COLS + COLS - 1]
      );
    }
    expect(() => generateTerrain({ ...BLOCK, ao: { radius: 0 } })).toThrow(/radius/);
    expect(() => generateTerrain({ ...BLOCK, ao: { radius: 4, strength: 2 } })).toThrow(/strength/);
  });

  it('lays the rules and the AO into byte vertex colours', () => {
    // A 45° slope down towards +x on the left half, flat on the right
    const terrain = generateTerrain({
      width: 8,
      depth: 8,
      widthSegments: 8,
      depthSegments: 8,
      heightFn: (x) => (x < 0 ? -x : 0),
      normals: 'HEIGHT_FN',
      ao: { radius: 2 },
      vertexColors: {
        layout: 'RGB_AO',
        rules: [
          { layer: 1, slope: { min: 30, softness: 1 } },
          { layer: 3, height: { min: 2.5, softness: 0.01 } },
        ],
      },
    });
    const color = terrain.geometry.getAttribute('color') as THREE.BufferAttribute;
    expect(color.array).toBeInstanceOf(Uint8Array);
    expect([color.itemSize, color.normalized]).toEqual([4, true]);
    const at = (col: number, row: number) => {
      const i = row * 9 + col;
      return [0, 1, 2, 3].map((c) => color.array[i * 4 + c]);
    };
    // The slope (col 1: x -3, h 3 over the height's min): rocks covered by layer 3
    expect(at(1, 4).slice(0, 3)).toEqual([0, 0, 255]);
    // The slope under the height's min (col 3: x -1, h 1): rocks
    expect(at(3, 4).slice(0, 3)).toEqual([255, 0, 0]);
    // The flat (col 7): the base, no channel
    expect(at(7, 4).slice(0, 3)).toEqual([0, 0, 0]);
    // A the AO: under the slope's foot (col 5) darker than out on the flat's edge
    expect(at(5, 4)[3]).toBeLessThan(at(8, 4)[3]);
    expect(at(8, 4)[3]).toBe(Math.round((terrain.ao as Float32Array)[4 * 9 + 8] * 255));

    // RGBA: four layers' weights, no AO
    const flat = { width: 4, depth: 4, widthSegments: 1, depthSegments: 1, heightFn: () => 0 };
    const rgba = generateTerrain({
      ...flat,
      vertexColors: { layout: 'RGBA', rules: [{ layer: 4, height: { max: 1 } }] },
    });
    expect(Array.from(rgba.geometry.getAttribute('color').array.slice(0, 4))).toEqual([
      0, 0, 0, 255,
    ]);
    // RGB_AO without AO: A is 1
    const noAo = generateTerrain({ ...flat, vertexColors: { layout: 'RGB_AO' } });
    expect(Array.from(noAo.geometry.getAttribute('color').array.slice(0, 4))).toEqual([
      0, 0, 0, 255,
    ]);
    expect(() =>
      generateTerrain({
        ...BLOCK,
        vertexColors: { layout: 'RGB_AO', rules: [{ layer: 4, height: { max: 1 } }] },
      })
    ).toThrow(/layer is 4: RGB_AO weighs layers 0 to 3/);
  });

  it('collider: the HEIGHTFIELD params of its heights', () => {
    const terrain = generateTerrain({ ...BLOCK, depthSegments: 16, collider: true });
    expect(terrain.heightfield).toEqual(
      toHeightfieldColliderParams({
        heights: terrain.heights,
        rows: 17,
        cols: 33,
        width: 64,
        depth: 64,
      })
    );
    expect(generateTerrain(BLOCK).heightfield).toBeUndefined();
  });

  it('skirt: each edge vertex again, lower, its strip facing out; the grid as without', () => {
    const plain = generateTerrain({ ...OPTIONS, vertexColors: { layout: 'RGBA' } });
    const skirted = generateTerrain({ ...OPTIONS, vertexColors: { layout: 'RGBA' }, skirt: 2 });
    const grid = 6 * 4;
    const loop = 2 * (5 + 3);
    const position = skirted.geometry.getAttribute('position');
    expect(position.count).toBe(grid + loop);
    expect(skirted.heights).toEqual(plain.heights);
    expect(Array.from(position.array.slice(0, grid * 3))).toEqual(
      Array.from(plain.geometry.getAttribute('position').array)
    );
    expect(Array.from(skirted.geometry.getAttribute('normal').array.slice(0, grid * 3))).toEqual(
      Array.from(plain.geometry.getAttribute('normal').array)
    );
    expect(skirted.geometry.getAttribute('color').count).toBe(grid + loop);
    // The first skirt vertex is the −x, −z corner's, 2 lower
    expect(position.getY(grid)).toBeCloseTo(position.getY(0) - 2, 5);
    expect([position.getX(grid), position.getZ(grid)]).toEqual([
      position.getX(0),
      position.getZ(0),
    ]);

    // Each skirt triangle faces away from the block's centre
    const index = skirted.geometry.getIndex() as THREE.BufferAttribute;
    const plainTriangles = (plain.geometry.getIndex() as THREE.BufferAttribute).count;
    expect(index.count).toBe(plainTriangles + loop * 6);
    const triangle = new THREE.Triangle();
    const normal = new THREE.Vector3();
    const middle = new THREE.Vector3();
    for (let i = plainTriangles; i < index.count; i += 3) {
      triangle.setFromAttributeAndIndices(
        position,
        index.getX(i),
        index.getX(i + 1),
        index.getX(i + 2)
      );
      triangle.getNormal(normal);
      triangle.getMidpoint(middle);
      expect(normal.x * middle.x + normal.z * middle.z).toBeGreaterThan(0);
    }
    expect(() => generateTerrain({ ...OPTIONS, skirt: -1 })).toThrow(/skirt/);
  });
});
