import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, ECSWorld, setRandomSeed } from 'aekasha';
import type { MeshProps } from 'aekasha';
import type { TerrainBlock } from 'aekasha/terrain';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import { createDecalTrail, spawnRibbonDecal } from './DecalRibbons';
import { createDecalPool } from './RuntimeDecals';
import type { CreateDecalPoolOpts } from './RuntimeDecals';

// The kernel's and the features' calls the pool makes (as RuntimeDecals.test.ts' stand-ins)
const kernel = vi.hoisted(() => ({
  meshes: [] as { props: MeshProps; entityId: number }[],
  warn: vi.fn(),
}));
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  lwarn: kernel.warn,
  // A material whose edge fade along u is 0.2
  getMaterial: () => ({
    transparent: true,
    userData: { uniforms: { ['decal_edgeFade']: { value: { x: 0.2, y: 0.1 } } } },
  }),
  saveBufferGeometry: (geometry: THREE.BufferGeometry) => geometry,
  getAtlasCell: (_atlas: string, cellId: string) =>
    ({
      track: { uv: [0, 0, 0.5, 0.125], size: [1024, 256], data: { physicalSize: [1.8, 0.45] } },
      bare: { uv: [0.5, 0.5, 0.75, 0.75], size: [512, 512] },
    })[cellId],
  createMeshEntity: (props: MeshProps, opts: { world: ECSWorld }) => {
    const entityId = opts.world.createEntity();
    const mesh = new THREE.Mesh(props.geo as THREE.BufferGeometry);
    opts.world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: 0 });
    kernel.meshes.push({ props, entityId });
    return entityId;
  },
  registerOnAllSceneExits: () => () => {},
}));
vi.mock('aekasha/merging', () => ({
  createMergeGroup: vi.fn(),
  addToMergeGroup: vi.fn(),
  updateMergeMember: vi.fn(),
  dissolveMergeGroup: vi.fn(),
  setMergeMemberColor: vi.fn(),
}));

/** The block: 8 m at grid (1, −1), its centre (8, 0, −8), its grid 0.5 m */
const BLOCK_DEF = { id: 'meadow', grid: { x: 1, z: -1, size: 8, resolution: 17 } };
vi.mock('aekasha/terrain', () => ({
  getTerrainBlock: (id: string) => (id === BLOCK_DEF.id ? BLOCK_DEF : undefined),
}));

const worldIds: string[] = [];
beforeEach(() => {
  kernel.meshes.length = 0;
  kernel.warn.mockClear();
  setRandomSeed(309);
});
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

const createPool = (opts: Partial<CreateDecalPoolOpts> = {}) => {
  const id = `decalRibbons-${worldIds.length}`;
  worldIds.push(id);
  const world = new ECSWorld({ id, maxEntities: 64 });
  const meshEntityId = world.createEntity();
  const terrain = generateTerrain({
    width: 8,
    depth: 8,
    widthSegments: 16,
    depthSegments: 16,
    maxHeight: 1,
    seed: 3,
  });
  world.addComponent(meshEntityId, ComponentType.OBJECT3D, {
    value: new THREE.Mesh(terrain.geometry),
    _lastVersion: 0,
  });
  const block = { id: 'meadow', meshEntityId } as unknown as TerrainBlock;
  const pool = createDecalPool({ id: 'tracks', material: 'm', atlas: 'ground', world, ...opts });
  return { pool, block };
};

const getGeometry = (index: number) => kernel.meshes[index].props.geo as THREE.BufferGeometry;

/** The vertices a ribbon draws: its index's largest + 1 (its attributes span the place's arrays) */
const getDrawnVertexCount = (geometry: THREE.BufferGeometry) => {
  const index = geometry.index!;
  let largest = -1;
  for (let i = 0; i < index.count; i++) largest = Math.max(largest, index.getX(i));
  return largest + 1;
};

/** A geometry's vertices (world space) whose x is `x` */
const getRowAt = (geometry: THREE.BufferGeometry, x: number) => {
  const position = geometry.getAttribute('position');
  const row: number[] = [];
  for (let i = 0; i < getDrawnVertexCount(geometry); i++) {
    if (Math.abs(position.getX(i) - x) < 1e-4) row.push(i);
  }
  return row;
};

describe('spawnRibbonDecal', () => {
  it("lays the cell along the path at its physical size, its ends faded by the material's share", () => {
    const { pool, block } = createPool();
    const entityId = spawnRibbonDecal(pool, {
      target: block,
      points: [
        { x: 5, z: -8 },
        { x: 11, z: -8 },
      ],
      cell: 'track',
    });
    expect(entityId).not.toBeNull();
    const geometry = getGeometry(0);
    const position = geometry.getAttribute('position');
    const uv1 = geometry.getAttribute('uv1');
    // 0.45 m across (the cell's v), centred on the path
    const [first] = getRowAt(geometry, 5);
    const start = getRowAt(geometry, 5);
    expect(Math.abs(position.getZ(start[0]) - position.getZ(start.at(-1)!))).toBeCloseTo(0.45, 5);
    expect(uv1.getX(first)).toBe(0);
    // 0.5 m in: the share, 0.2
    expect(uv1.getX(getRowAt(geometry, 5.5)[0])).toBeCloseTo(0.2, 5);
    expect(uv1.getX(getRowAt(geometry, 8)[0])).toBe(0.5);
    // A tile is 1.8 m: at 1.8 m in, the tile's end and the next one's start
    const seam = getRowAt(geometry, 6.8);
    const u = geometry.getAttribute('uv');
    expect(new Set(seam.map((i) => u.getX(i)))).toEqual(new Set([0, 0.5]));
  });

  it('cuts the path at its first point off the block, and returns null without two points on it', () => {
    const { pool, block } = createPool();
    spawnRibbonDecal(pool, {
      target: block,
      points: [
        { x: 5, z: -8 },
        { x: 11, z: -8 },
        { x: 13, z: -8 },
        { x: 11, z: -6 },
      ],
      cell: 'track',
    });
    const box = getGeometry(0).boundingBox!;
    expect(box.max.x).toBeLessThan(11.01);
    expect(box.max.z).toBeLessThan(-7.7);
    const off = [
      { x: 13, z: -8 },
      { x: 11, z: -8 },
    ];
    expect(spawnRibbonDecal(pool, { target: block, points: off, cell: 'track' })).toBeNull();
    const still = [
      { x: 6, z: -8 },
      { x: 6, z: -8 },
    ];
    expect(spawnRibbonDecal(pool, { target: block, points: still, cell: 'track' })).toBeNull();
    expect(kernel.meshes).toHaveLength(1);
  });

  it('needs a width and a tile length, from the options or the cell', () => {
    const { pool, block } = createPool();
    const points = [
      { x: 5, z: -8 },
      { x: 7, z: -8 },
    ];
    expect(() => spawnRibbonDecal(pool, { target: block, points, cell: 'bare' })).toThrow(
      /"bare" has no width/
    );
    expect(() => spawnRibbonDecal(pool, { target: block, points, cell: 'bare', width: 1 })).toThrow(
      /"bare" has no tile length/
    );
    expect(
      spawnRibbonDecal(pool, { target: block, points, cell: 'bare', width: 1, tileLength: 1 })
    ).not.toBeNull();
  });

  it("gives back a place for a ribbon too long for the pool's patches", () => {
    const { pool, block } = createPool({ maxPatchVertices: 24 });
    const points = [
      { x: 5, z: -8 },
      { x: 9, z: -8 },
    ];
    expect(
      spawnRibbonDecal(pool, { target: block, points, cell: 'track', tileLength: 0.05 })
    ).toBeNull();
    expect(kernel.warn).toHaveBeenCalledWith(expect.stringMatching(/doesn't fit the pool/));
    expect(pool.getDecalCount()).toBe(0);
    expect(kernel.meshes).toHaveLength(0);
  });
});

describe('createDecalTrail', () => {
  /** Walks the trail along z = −8 from x `from` to `to` in 0.25 m steps; the entities stamped */
  const walk = (trail: ReturnType<typeof createDecalTrail>, from: number, to: number) => {
    const stamped: number[] = [];
    for (let x = from; x <= to + 1e-9; x += 0.25) {
      const entityId = trail.addPoint(x, -8);
      if (entityId !== null) stamped.push(entityId);
    }
    return stamped;
  };

  it('stamps a segment every segmentLength, each joined to the last with its tiles running on', () => {
    const { pool, block } = createPool();
    const trail = createDecalTrail(pool, { target: block, cell: 'track' });
    expect(walk(trail, 5, 9.5)).toHaveLength(2);
    const [first, second] = [getGeometry(0), getGeometry(1)];
    // The joint at x 7: the same row in both
    const position = (geometry: THREE.BufferGeometry, i: number) =>
      new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), i);
    const firstRow = getRowAt(first, 7);
    const secondRow = getRowAt(second, 7);
    expect(secondRow).toHaveLength(firstRow.length);
    firstRow.forEach((i, k) => {
      expect(position(first, i).distanceTo(position(second, secondRow[k]))).toBeLessThan(1e-6);
    });
    // The first segment's start faded, its end not; the second's start not
    expect(first.getAttribute('uv1').getX(getRowAt(first, 5)[0])).toBe(0);
    expect(first.getAttribute('uv1').getX(firstRow[0])).toBe(0.5);
    expect(second.getAttribute('uv1').getX(secondRow[0])).toBe(0.5);
    // The second starts 2 m into the track: 0.2 m into its second tile of 1.8 m
    expect(second.getAttribute('uv').getX(secondRow[0])).toBeCloseTo((0.2 / 1.8) * 0.5, 5);

    // The rest, its end faded
    const last = trail.end();
    expect(last).not.toBeNull();
    const rest = getGeometry(2);
    expect(rest.getAttribute('uv1').getX(getRowAt(rest, 9.5)[0])).toBe(0);
    expect(trail.end()).toBeNull();
  });

  it('ends the track at a point off the block, and skips points closer than minSpacing', () => {
    const { pool, block } = createPool();
    const trail = createDecalTrail(pool, { target: block, cell: 'track', minSpacing: 0.2 });
    expect(trail.addPoint(5, -8)).toBeNull();
    expect(trail.addPoint(5.1, -8)).toBeNull();
    expect(trail.addPoint(6, -8)).toBeNull();
    expect(trail.addPoint(13, -8)).not.toBeNull();
    // From 5 to 6 only: the point at 5.1 skipped
    const geometry = getGeometry(0);
    expect(getRowAt(geometry, 5.1)).toHaveLength(0);
    expect(geometry.boundingBox!.max.x).toBeLessThan(6.01);
  });

  it('stamps nothing, quietly, once its pool is gone', () => {
    const { pool, block } = createPool();
    const trail = createDecalTrail(pool, { target: block, cell: 'track' });
    trail.addPoint(5, -8);
    pool.dispose();
    kernel.warn.mockClear();
    expect(walk(trail, 5.25, 9)).toHaveLength(0);
    expect(trail.end()).toBeNull();
    expect(kernel.warn).not.toHaveBeenCalled();
  });
});
