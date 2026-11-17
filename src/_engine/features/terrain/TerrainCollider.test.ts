import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { ImportedGeometryInfo } from '../../kernel/assets/import/ImportTypes';
import { parseCustomProps } from '../../kernel/assets/import/CustomProps';
import type { TerrainBlockDef } from './TerrainBlockSchema';
import { createTerrainBlockColliderAsync } from './TerrainCollider';

// The physics entity is a stand-in: the shape it gets is what's tested
const fns = vi.hoisted(() => ({ createPhysicsEntity: vi.fn(async () => 3) }));
vi.mock(import('../physics/PhysicsEntity'), () => ({
  createPhysicsEntity: fns.createPhysicsEntity as never,
}));

/** A block's grid: 2 × 2 m, 3 vertices per side, centred, one corner raised */
const gridGeometry = () => {
  const geometry = new THREE.PlaneGeometry(2, 2, 2, 2);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  // The vertex at (x 1, z 1): PlaneGeometry's last
  position.setY(position.count - 1, 0.5);
  return geometry;
};

const block = (fields: Partial<TerrainBlockDef> = {}): TerrainBlockDef => ({
  id: 'coast',
  geometry: { generator: 'noise', params: {}, seed: 0 },
  material: 'terrainMat',
  grid: { x: 0, z: 0, size: 2, resolution: 3 },
  collider: { type: 'HEIGHTFIELD', friction: 1.2 },
  shadows: { cast: true, receive: true },
  ...fields,
});

/** What createPhysicsEntity got */
const created = () =>
  (fns.createPhysicsEntity.mock.calls[0] as unknown[])[0] as {
    colliders: Record<string, unknown> & { heights?: ArrayLike<number> };
    body: unknown;
    target: number;
  };

beforeEach(() => vi.clearAllMocks());

describe('createTerrainBlockColliderAsync', () => {
  test('reads a HEIGHTFIELD from a generated grid, a FIXED body on the mesh entity', async () => {
    const id = await createTerrainBlockColliderAsync({
      block: block(),
      geometry: gridGeometry(),
      meshEntityId: 9,
    });
    expect(id).toBe(3);
    const { colliders, body, target } = created();
    expect(colliders).toMatchObject({ type: 'HEIGHTFIELD', nrows: 2, ncols: 2, friction: 1.2 });
    // The raised corner (row 2 along +z, column 2 along +x) at r + c · (nrows + 1)
    expect(colliders.heights?.[2 + 2 * 3]).toBeCloseTo(0.5);
    expect(Array.from(colliders.heights ?? []).filter((h) => Math.abs(h) > 1e-6)).toHaveLength(1);
    expect(body).toEqual({ rigidType: 'FIXED' });
    expect(target).toBe(9);
  });

  test('takes a generator’s heightfield as it is', async () => {
    const heightfield = {
      type: 'HEIGHTFIELD' as const,
      nrows: 1,
      ncols: 1,
      heights: new Float32Array([0, 1, 2, 3]),
      scale: { x: 2, y: 1, z: 2 },
    };
    await createTerrainBlockColliderAsync({
      block: block({ collider: { type: 'HEIGHTFIELD' } }),
      geometry: gridGeometry(),
      heightfield,
      meshEntityId: 9,
    });
    expect(created().colliders).toEqual(heightfield);
  });

  test('reads a TRIMESH, and an imported node’s geometry without its transform', async () => {
    const info = {
      geometryId: 'ground/Block',
      importId: 'ground',
      nodeName: 'Block',
      parentPath: [],
      transform: {
        position: { x: 5, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 3, y: 3, z: 3 },
      },
      customProps: parseCustomProps({}),
      isDracoCompressed: false,
    } satisfies ImportedGeometryInfo;
    const geometry = gridGeometry();
    await createTerrainBlockColliderAsync({
      block: block({ geometry: { importedAsset: 'ground' }, collider: { type: 'TRIMESH' } }),
      geometry,
      info,
      meshEntityId: 9,
    });
    const { colliders } = created();
    expect(colliders.type).toBe('TRIMESH');
    // The node's scale isn't applied: the block's mesh draws the geometry as it is
    const vertices = colliders.vertices as Float32Array;
    expect(Math.max(...vertices)).toBeCloseTo(1);
    expect(colliders).not.toHaveProperty('friction');
  });

  test('makes no collider when the geometry isn’t a grid of the block’s resolution', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await createTerrainBlockColliderAsync({
      block: block({ grid: { x: 0, z: 0, size: 2, resolution: 5 } }),
      geometry: gridGeometry(),
      meshEntityId: 9,
    });
    expect(id).toBeUndefined();
    expect(fns.createPhysicsEntity).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(' ')).toMatch(/terrainBlock:coast/);
    error.mockRestore();
  });
});
