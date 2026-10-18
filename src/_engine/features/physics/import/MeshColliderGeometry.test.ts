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

/** A terrain grid of `cols` × `rows` cells, lying in XZ. */
const grid = (cols: number, rows: number) =>
  new THREE.PlaneGeometry(10, 10, cols, rows).rotateX(-Math.PI / 2);

describe('deriveColliderFromGeometry', () => {
  it('reads a square grid into a HEIGHTFIELD', () => {
    const params = deriveColliderFromGeometry(
      { type: 'HEIGHTFIELD' },
      { geometry: grid(2, 2), info: nodeInfo('square') }
    );
    expect(params).toMatchObject({ type: 'HEIGHTFIELD', nrows: 2, ncols: 2 });
    expect(params?.type === 'HEIGHTFIELD' && params.heights?.length).toBe(9);
  });

  it('skips a HEIGHTFIELD whose vertex count makes no square grid (M3)', () => {
    // 3 × 2 vertices: no whole square root, and params without heights would throw in the backend
    expect(
      deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD' },
        { geometry: grid(2, 1), info: nodeInfo('notSquare') }
      )
    ).toBeNull();
  });

  it('skips a HEIGHTFIELD whose given rows leave no whole number of columns (M3)', () => {
    expect(
      deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD', nrows: 4 },
        { geometry: grid(2, 2), info: nodeInfo('badRows') }
      )
    ).toBeNull();
  });

  it('reads a grid of given rows or given columns into a HEIGHTFIELD', () => {
    // 2 × 1 cells, 3 × 2 vertices: either count gives the other
    for (const given of [{ nrows: 2 }, { ncols: 1 }]) {
      const params = deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD', ...given },
        { geometry: grid(2, 1), info: nodeInfo('oblong') }
      );
      expect(params).toMatchObject({ nrows: 2, ncols: 1 });
      expect(params?.type === 'HEIGHTFIELD' && params.heights?.length).toBe(6);
    }
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
