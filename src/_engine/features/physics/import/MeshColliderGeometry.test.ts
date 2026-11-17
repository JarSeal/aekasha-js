import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { ImportedGeometryInfo, Vector3Like } from '../../../kernel/assets/import/ImportTypes';
import type { ColliderParams } from '../types/PhysicsColliderTypes';
import { deriveColliderFromGeometry } from './MeshColliderGeometry';

/** An imported node's metadata: no rotation, no custom props unless given. */
const nodeInfo = (
  nodeName: string,
  {
    raw = {},
    scale = { x: 1, y: 1, z: 1 },
  }: { raw?: Record<string, unknown>; scale?: Vector3Like } = {}
) =>
  ({
    geometryId: `test/${nodeName}`,
    importId: 'test',
    nodeName,
    parentPath: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale,
    },
    customProps: { raw },
    isDracoCompressed: false,
  }) as unknown as ImportedGeometryInfo;

/** A terrain grid of `cols` × `rows` cells, lying in XZ, 10 × 10 m, its rows along +z. */
const grid = (cols: number, rows: number) =>
  new THREE.PlaneGeometry(10, 10, cols, rows).rotateX(-Math.PI / 2);

/** An uneven surface, different along x and z, so a swap, a flip or a transpose shows. */
const surface = (x: number, z: number) => 0.3 * x + 0.05 * z * z + (x > 2 && z < -2 ? 4 : 0);

/** `grid` with its heights from `surface`, moved by `offset` in x and z. */
const terrain = (cols: number, rows: number, offset = { x: 0, z: 0 }) => {
  const geometry = grid(cols, rows).translate(offset.x, 0, offset.z);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, surface(position.getX(i) - offset.x, position.getZ(i) - offset.z));
  }
  return geometry;
};

/** The collider's height at its grid point (row along z, column along x), in Rapier's layout. */
const heightAt = (params: ColliderParams | null, row: number, col: number) => {
  if (params?.type !== 'HEIGHTFIELD' || !params.heights || params.nrows === undefined) return NaN;
  return params.heights[row + col * (params.nrows + 1)];
};

/** Expects the collider to hold `surface` on a 10 × 10 m grid of `cols` × `rows` cells. */
const expectSurface = (params: ColliderParams | null, cols: number, rows: number) => {
  expect(params).toMatchObject({ nrows: rows, ncols: cols, scale: { x: 10, y: 1, z: 10 } });
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const expected = surface((col / cols) * 10 - 5, (row / rows) * 10 - 5);
      expect(heightAt(params, row, col), `row ${row}, column ${col}`).toBeCloseTo(expected, 5);
    }
  }
};

const heightfield = (geometry: THREE.BufferGeometry, opts?: Parameters<typeof nodeInfo>[1]) =>
  deriveColliderFromGeometry({ type: 'HEIGHTFIELD' }, { geometry, info: nodeInfo('hf', opts) });

/** Runs `run` with console.error and console.warn caught; returns what they were given. */
const withLogs = <T>(run: () => T) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const result = run();
  const logs = {
    error: error.mock.calls.flat().join(' '),
    warn: warn.mock.calls.flat().join(' '),
  };
  error.mockRestore();
  warn.mockRestore();
  return { result, ...logs };
};

describe('deriveColliderFromGeometry, HEIGHTFIELD (p306 D3)', () => {
  it('reads a square grid into a HEIGHTFIELD', () => {
    expectSurface(heightfield(terrain(4, 4)), 4, 4);
  });

  it('reads a grid that is not square, its cells counted along x and z', () => {
    expectSurface(heightfield(terrain(6, 3)), 6, 3);
  });

  it('reads the grid by position, whatever the vertex order', () => {
    // Blender's rows run along -z: the same grid mirrored in its vertex order
    const mirrored = terrain(5, 3);
    const position = mirrored.getAttribute('position');
    const index = mirrored.index!;
    const flipped = new THREE.BufferGeometry();
    const flippedPositions = new Float32Array(position.count * 3);
    const perRow = 6;
    for (let i = 0; i < position.count; i++) {
      const from = (3 - Math.floor(i / perRow)) * perRow + (i % perRow);
      flippedPositions.set([position.getX(from), position.getY(from), position.getZ(from)], i * 3);
    }
    flipped.setAttribute('position', new THREE.BufferAttribute(flippedPositions, 3));
    flipped.setIndex(
      Array.from(index.array as ArrayLike<number>).map(
        (v) => (3 - Math.floor(v / perRow)) * perRow + (v % perRow)
      )
    );
    expectSurface(heightfield(flipped), 5, 3);
    // Every corner duplicated (no index): the duplicates agree, so they're one grid point
    expectSurface(heightfield(terrain(5, 3).toNonIndexed()), 5, 3);
  });

  it('takes the counts given as custom props: nCols along x, nRows along z', () => {
    for (const given of [{ ncols: 6 }, { nrows: 3 }, { ncols: 6, nrows: 3 }]) {
      const params = deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD', ...given },
        { geometry: terrain(6, 3), info: nodeInfo('given') }
      );
      expectSurface(params, 6, 3);
    }
  });

  it('skips a grid the given counts do not fit', () => {
    const { result, error } = withLogs(() =>
      deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD', nrows: 4 },
        { geometry: grid(2, 2), info: nodeInfo('badRows') }
      )
    );
    expect(result).toBeNull();
    expect(error).toContain('no vertex at');
  });

  it('skips a grid with a vertex moved in x or z', () => {
    const geometry = terrain(4, 4);
    geometry.getAttribute('position').setX(7, geometry.getAttribute('position').getX(7) + 0.4);
    const { result, error } = withLogs(() => heightfield(geometry));
    expect(result).toBeNull();
    expect(error).toContain('moved in x or z');
  });

  it('skips a grid with two heights on one point', () => {
    // The first triangle's second corner, which the cell's other triangle has too
    const geometry = terrain(2, 2).toNonIndexed();
    geometry.getAttribute('position').setY(1, 50);
    const { result, error } = withLogs(() => heightfield(geometry));
    expect(result).toBeNull();
    expect(error).toContain('two heights');
  });

  it('moves a grid not centred on its origin back under its mesh', () => {
    const params = heightfield(terrain(4, 4, { x: 3, z: -2 }));
    expectSurface(params, 4, 4);
    expect(params?.translation).toEqual({ x: 3, y: 0, z: -2 });
    expect(heightfield(terrain(4, 4))).not.toHaveProperty('translation');
    // A translation the params gave is kept
    const given = deriveColliderFromGeometry(
      { type: 'HEIGHTFIELD', translation: { x: 0, y: 1, z: 0 } },
      { geometry: terrain(4, 4, { x: 3, z: -2 }), info: nodeInfo('given') }
    );
    expect(given?.translation).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("warns on a terrain block that isn't centred", () => {
    const { warn } = withLogs(() =>
      heightfield(terrain(4, 4, { x: 0.5, z: 0 }), { raw: { aekBlockSize: 10 } })
    );
    expect(warn).toContain("a terrain block's grid is centred on its origin");
    expect(withLogs(() => heightfield(terrain(4, 4, { x: 0.5, z: 0 }))).warn).toBe('');
  });

  it("applies the node's scale to the size and the heights", () => {
    const params = heightfield(terrain(4, 2), { scale: { x: 2, y: 3, z: 0.5 } });
    expect(params).toMatchObject({ nrows: 2, ncols: 4, scale: { x: 20, y: 1, z: 5 } });
    expect(heightAt(params, 2, 4)).toBeCloseTo(3 * surface(5, 5), 5);
  });

  it("warns when the mesh splits cells along the other diagonal than the collider's", () => {
    // three's plane splits each cell along the collider's diagonal: no warning
    expect(withLogs(() => heightfield(terrain(4, 4))).warn).toBe('');
    // Each quad split from (row, col) to (row + 1, col + 1) instead
    const geometry = terrain(4, 4);
    const index = geometry.index!.array as ArrayLike<number>;
    const other: number[] = [];
    for (let t = 0; t < index.length; t += 6) {
      // three's quad: a (row, col), b (row + 1, col), c (row + 1, col + 1), d (row, col + 1)
      const [a, b, , , c, d] = [
        index[t],
        index[t + 1],
        index[t + 2],
        index[t + 3],
        index[t + 4],
        index[t + 5],
      ];
      other.push(a, b, c, a, c, d);
    }
    geometry.setIndex(other);
    const { result, warn } = withLogs(() => heightfield(geometry));
    expect(result).not.toBeNull();
    expect(warn).toMatch(/\d+ of the HEIGHTFIELD's cells are split along the other diagonal/);
  });

  it('keeps heights the params gave', () => {
    const heights = new Float32Array(9);
    const params = deriveColliderFromGeometry(
      { type: 'HEIGHTFIELD', nrows: 2, ncols: 2, heights, scale: { x: 1, y: 1, z: 1 } },
      { geometry: grid(2, 2), info: nodeInfo('given') }
    );
    expect(params?.type === 'HEIGHTFIELD' && params.heights).toBe(heights);
  });
});

/** The primitive collider derived for `geometry`, with the node's custom props and scale. */
const derive = (
  params: ColliderParams,
  geometry: THREE.BufferGeometry,
  opts?: Parameters<typeof nodeInfo>[1]
) => deriveColliderFromGeometry(params, { geometry, info: nodeInfo('node', opts) });

/** Where an orientation takes Rapier's spine (+Y), rounded; +Y without one. */
const spineOf = (params: ColliderParams | null) => {
  const q = params?.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
  const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w)
  );
  return spine.toArray().map((v) => Math.round(v) + 0);
};

describe('deriveColliderFromGeometry, primitives (p614 D13)', () => {
  it('measures a BOX from the bounds × the node scale', () => {
    const params = derive({ type: 'BOX' }, new THREE.BoxGeometry(2, 4, 6), {
      scale: { x: 1, y: 2, z: 1 },
    });
    expect(params).toMatchObject({ hx: 1, hy: 4, hz: 3 });
    expect(params?.orientation).toBeUndefined();
  });

  it('measures a BALL from the bounding sphere × the largest scale', () => {
    const params = derive({ type: 'BALL' }, new THREE.SphereGeometry(1.5), {
      scale: { x: 1, y: 2, z: 1 },
    });
    expect(params?.type === 'BALL' && params.radius).toBeCloseTo(3);
  });

  it('measures a CAPSULE: halfHeight is its straight part (M1)', () => {
    // three's height is the straight part: 2, so 3 in all with the caps
    const params = derive({ type: 'CAPSULE' }, new THREE.CapsuleGeometry(0.5, 2));
    expect(params).toMatchObject({ radius: 0.5, halfHeight: 1 });
    expect(spineOf(params)).toEqual([0, 1, 0]);
  });

  it('measures a CONE and a CYLINDER: halfHeight is half the length (M1)', () => {
    expect(derive({ type: 'CONE' }, new THREE.ConeGeometry(1, 3))).toMatchObject({
      radius: 1,
      halfHeight: 1.5,
    });
    const scale = { x: 2, y: 2, z: 2 };
    expect(
      derive({ type: 'CYLINDER' }, new THREE.CylinderGeometry(1, 1, 4), { scale })
    ).toMatchObject({ radius: 2, halfHeight: 4 });
  });

  it('turns a shape onto its spineAxis, in either case (M2)', () => {
    // Lying along X: the length is read from X and the shape turned onto it
    const capsule = derive(
      { type: 'CAPSULE' },
      new THREE.CapsuleGeometry(0.5, 2).rotateZ(Math.PI / 2),
      { raw: { spineAxis: 'X' } }
    );
    expect(capsule).toMatchObject({ radius: 0.5 });
    expect(capsule?.type === 'CAPSULE' && capsule.halfHeight).toBeCloseTo(1);
    expect(spineOf(capsule)).toEqual([1, 0, 0]);
    // A cone's tip (+Y) goes with it: a cone pointing +Z
    const cone = derive({ type: 'CONE' }, new THREE.ConeGeometry(1, 3).rotateX(Math.PI / 2), {
      raw: { spineAxis: 'z' },
    });
    expect(cone?.type === 'CONE' && cone.halfHeight).toBeCloseTo(1.5);
    expect(spineOf(cone)).toEqual([0, 0, 1]);
    expect(
      derive({ type: 'CYLINDER' }, new THREE.CylinderGeometry(), { raw: { spineAxis: 'y' } })
    ).not.toHaveProperty('orientation');
  });

  it('warns on an unknown spineAxis and keeps the shape on Y', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const params = derive({ type: 'CYLINDER' }, new THREE.CylinderGeometry(), {
      raw: { spineAxis: 'w' },
    });
    expect(params).not.toHaveProperty('orientation');
    expect(warn.mock.calls.flat().join(' ')).toContain('"spineAxis" "w"');
    warn.mockRestore();
  });

  it('never overrides what the params set, nor writes to the geometry', () => {
    const geometry = new THREE.CylinderGeometry(1, 1, 4);
    const orientation = { x: 1, y: 0, z: 0, w: 0 };
    const params = derive({ type: 'CYLINDER', radius: 0.25, orientation }, geometry, {
      raw: { spineAxis: 'x' },
    });
    // The length is read along X (the cylinder is 2 wide there); the given fields stay
    expect(params).toMatchObject({ radius: 0.25, halfHeight: 1, orientation });
    expect(geometry.boundingBox).toBeNull();
    expect(geometry.boundingSphere).toBeNull();
    expect(geometry.userData).toEqual({});
  });

  it('leaves a mesh shape to its own derivation', () => {
    expect(derive({ type: 'CONVEXHULL' }, new THREE.BoxGeometry())).not.toHaveProperty('hx');
  });
});
