import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentType, ECSWorld, setRandomSeed } from 'aekasha';
import type { ECSSystem, MeshProps } from 'aekasha';
import type { TerrainBlock } from 'aekasha/terrain';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import { spawnMeshDecalAsync } from './MeshDecals';
import { createDecalPool, spawnDecal } from './RuntimeDecals';
import type { CreateDecalPoolOpts } from './RuntimeDecals';

// The kernel's and the features' calls the pool makes, recorded
const kernel = vi.hoisted(() => ({
  meshes: [] as { props: MeshProps; appId?: string; entityId: number }[],
  exits: new Map<string, () => void>(),
  materials: new Map<string, { transparent: boolean }>(),
  warn: vi.fn(),
}));
vi.mock('aekasha', async (importOriginal) => {
  const original = await importOriginal<typeof import('aekasha')>();
  return {
    ...original,
    lwarn: kernel.warn,
    getMaterial: (id: string) => kernel.materials.get(id),
    saveBufferGeometry: (geometry: THREE.BufferGeometry) => geometry,
    getAtlasCell: (atlas: string, cellId: string) =>
      atlas !== 'ground'
        ? undefined
        : {
            footprint: {
              uv: [0, 0.5, 0.25, 0.75],
              size: [512, 512],
              data: { physicalSize: [0.4, 0.4] },
            },
            track: {
              uv: [0, 0, 0.5, 0.125],
              size: [1024, 256],
              data: { physicalSize: [1.8, 0.45] },
            },
            bare: { uv: [0.5, 0.5, 0.75, 0.75], size: [512, 512] },
          }[cellId],
    createMeshEntity: (props: MeshProps, opts: { world: ECSWorld; appId?: string }) => {
      const entityId = opts.world.createEntity();
      const mesh = new THREE.Mesh(props.geo as THREE.BufferGeometry);
      opts.world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: 0 });
      kernel.meshes.push({ props, appId: opts.appId, entityId });
      return entityId;
    },
    registerOnAllSceneExits: (id: string, fn: () => void) => {
      kernel.exits.set(id, fn);
      return () => kernel.exits.delete(id);
    },
  };
});

const merging = vi.hoisted(() => ({
  createMergeGroup: vi.fn(),
  addToMergeGroup: vi.fn(),
  updateMergeMember: vi.fn(),
  dissolveMergeGroup: vi.fn(),
  // The pool reuses its options object: each call's copied
  colors: [] as { entityId: number; color?: unknown; opacity?: number }[],
  setMergeMemberColor: vi.fn(),
}));
vi.mock('aekasha/merging', () => ({
  ...merging,
  setMergeMemberColor: (entityId: number, opts: { color?: unknown; opacity?: number }) => {
    merging.colors.push({ entityId, ...opts });
    merging.setMergeMemberColor(entityId);
  },
}));

/** The block: 8 m at grid (1, −1), so its centre is (8, 0, −8) */
const BLOCK_DEF = { id: 'meadow', grid: { x: 1, z: -1, size: 8, resolution: 17 } };
vi.mock('aekasha/terrain', () => ({
  getTerrainBlock: (id: string) => (id === BLOCK_DEF.id ? BLOCK_DEF : undefined),
}));

const worldIds: string[] = [];
beforeEach(() => {
  kernel.meshes.length = 0;
  kernel.exits.clear();
  kernel.materials.clear();
  kernel.materials.set('decals_blend', { transparent: true });
  kernel.materials.set('decals_cutout', { transparent: false });
  kernel.warn.mockClear();
  for (const fn of Object.values(merging)) if (typeof fn === 'function') fn.mockClear();
  merging.colors.length = 0;
  setRandomSeed(309);
});
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

/** A world with the block's mesh, and the pool's system captured */
const createWorld = () => {
  const id = `runtimeDecals-${worldIds.length}`;
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
  const block = {
    id: 'meadow',
    meshEntityId,
    scatterIds: [],
    decalIds: [],
  } as unknown as TerrainBlock;
  const addSystem = vi.spyOn(world, 'addSystem');
  const removeSystem = vi.spyOn(world, 'removeSystem');
  const run = (dt: number) => (addSystem.mock.calls.at(-1)![2] as ECSSystem)(world, dt);
  return { world, block, run, removeSystem };
};

const createPool = (world: ECSWorld, opts: Partial<CreateDecalPoolOpts> = {}) =>
  createDecalPool({ id: 'prints', material: 'decals_blend', atlas: 'ground', world, ...opts });

/** The vertices a patch draws: its index's largest + 1 (its attributes span the place's arrays) */
const getDrawnVertexCount = (geometry: THREE.BufferGeometry) => {
  const index = geometry.index!;
  let largest = -1;
  for (let i = 0; i < index.count; i++) largest = Math.max(largest, index.getX(i));
  return largest + 1;
};

/** The opacity last written for an entity */
const getOpacity = (entityId: number) =>
  merging.colors.filter((write) => write.entityId === entityId).at(-1)?.opacity;

describe('createDecalPool', () => {
  it('makes a BATCHED merge group sized for its patches, JOIN only for a BLEND material', () => {
    const { world } = createWorld();
    createPool(world, { maxPatchVertices: 100 });
    expect(merging.createMergeGroup).toHaveBeenCalledWith(
      {
        id: 'prints',
        mode: 'BATCHED',
        castShadow: false,
        receiveShadow: true,
        geometryReserve: { vertices: 100, indices: 6 * 81 },
        transparentOrder: 'JOIN',
      },
      world
    );
    createPool(world, { id: 'cracks', material: 'decals_cutout' });
    expect(merging.createMergeGroup.mock.calls[1][0]).not.toHaveProperty('transparentOrder');
  });

  it('refuses a material not loaded and sizes out of range', () => {
    const { world } = createWorld();
    expect(() => createPool(world, { material: 'nope' })).toThrow(/"nope" isn't loaded/);
    expect(() => createPool(world, { maxDecals: 0 })).toThrow(/maxDecals is 0/);
    expect(() => createPool(world, { maxPatchVertices: 2 })).toThrow(/maxPatchVertices is 2/);
    expect(() => createPool(world, { maxDecals: 4, fifoFade: 5 })).toThrow(/fifoFade is 5/);
    expect(merging.createMergeGroup).not.toHaveBeenCalled();
  });
});

describe('spawnDecal', () => {
  it('joins a mesh entity at the origin to the group, its patch on the block in world space', () => {
    const { world, block } = createWorld();
    const pool = createPool(world);
    const entityId = spawnDecal(pool, {
      target: block,
      position: { x: 9, z: -7.5 },
      cell: 'footprint',
      rotation: 0,
    })!;
    expect(kernel.meshes).toHaveLength(1);
    const { props, appId } = kernel.meshes[0];
    expect(props).toMatchObject({
      mat: 'decals_blend',
      castShadow: false,
      receiveShadow: true,
      renderOrder: 10,
    });
    expect(props).not.toHaveProperty('position');
    expect(appId).toBe('decalPool/prints/0');
    expect(merging.addToMergeGroup).toHaveBeenCalledWith('prints', [entityId], world);
    expect(getOpacity(entityId)).toBe(1);
    expect(pool.getDecalCount()).toBe(1);

    const geometry = props.geo as THREE.BufferGeometry;
    for (const name of ['position', 'normal', 'uv', 'uv1'])
      expect(geometry.getAttribute(name)).toBeDefined();
    expect(geometry.index!.count).toBeGreaterThan(0);
    // Around (9, −7.5) in the world, inside the cell's rect in the atlas
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeGreaterThan(8.3);
    expect(box.max.x).toBeLessThan(9.7);
    expect(box.min.z).toBeGreaterThan(-8.2);
    expect(box.max.z).toBeLessThan(-6.8);
    const uv1 = geometry.getAttribute('uv1');
    const centre = { u: 0, n: 0 };
    for (let i = 0; i < getDrawnVertexCount(geometry); i++) {
      if (uv1.getX(i) < 0 || uv1.getX(i) > 1) continue;
      centre.u += geometry.getAttribute('uv').getX(i);
      centre.n++;
    }
    expect(centre.u / centre.n).toBeGreaterThan(0);
    expect(centre.u / centre.n).toBeLessThan(0.25);
  });

  it('returns null off the block, and refuses an unknown cell or one it has no size for', () => {
    const { world, block } = createWorld();
    const pool = createPool(world);
    expect(spawnDecal(pool, { target: block, position: { x: 13, z: -8 }, cell: 'footprint' })).toBe(
      null
    );
    expect(kernel.meshes).toHaveLength(0);
    const position = { x: 8, z: -8 };
    expect(() => spawnDecal(pool, { target: block, position, cell: 'paw' })).toThrow(
      /atlas "ground" has no cell "paw"/
    );
    expect(() => spawnDecal(pool, { target: block, position, cell: 'bare' })).toThrow(
      /"bare" has no physicalSize/
    );
    expect(spawnDecal(pool, { target: block, position, cell: 'bare', size: 0.5 })).not.toBeNull();
    expect(() =>
      spawnDecal(pool, { target: { ...block, id: 'other' }, position, cell: 'footprint' })
    ).toThrow(/doesn't list the terrain block "other"/);
  });

  it("sizes a decal by a width with the cell's aspect", () => {
    const { world, block } = createWorld();
    const pool = createPool(world);
    spawnDecal(pool, {
      target: block,
      position: { x: 8, z: -8 },
      cell: 'track',
      size: 3.6,
      rotation: 0,
    });
    const geometry = kernel.meshes[0].props.geo as THREE.BufferGeometry;
    const uv1 = geometry.getAttribute('uv1');
    const position = geometry.getAttribute('position');
    // u counts 3.6 m along x, v 0.9 m along −z
    expect((uv1.getX(1) - uv1.getX(0)) * 3.6).toBeCloseTo(position.getX(1) - position.getX(0), 3);
    // The window covers 3.6 × 0.9 m, within a grid cell (0.5 m) of it each side
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(3.6);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(4.6 + 0.01);
    expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(0.9);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(1.9 + 0.01);
  });

  it("takes the oldest decal's place when full, rewriting it in place, and fades the oldest by their place in line", () => {
    const { world, block } = createWorld();
    const pool = createPool(world, { maxDecals: 4, fifoFade: 2 });
    const spawn = (x: number) =>
      spawnDecal(pool, { target: block, position: { x, z: -8 }, cell: 'footprint', rotation: 0 })!;
    const ids = [6, 7, 8, 9].map(spawn);
    // Full: the oldest two go next, at a third and two thirds
    expect(getOpacity(ids[0])).toBeCloseTo(1 / 3, 6);
    expect(getOpacity(ids[1])).toBeCloseTo(2 / 3, 6);
    expect(getOpacity(ids[2])).toBe(1);
    const geometry = kernel.meshes[0].props.geo as THREE.BufferGeometry;
    const buffer = geometry.getAttribute('position').array.buffer;

    expect(spawn(10)).toBe(ids[0]);
    expect(kernel.meshes).toHaveLength(4);
    expect(merging.updateMergeMember).toHaveBeenCalledWith(ids[0], world);
    expect(getOpacity(ids[0])).toBe(1);
    expect(getOpacity(ids[1])).toBeCloseTo(1 / 3, 6);
    expect(getOpacity(ids[2])).toBeCloseTo(2 / 3, 6);
    // The same arrays, the patch now at x 10
    expect(geometry.getAttribute('position').array.buffer).toBe(buffer);
    expect(geometry.boundingBox!.min.x).toBeGreaterThan(9.4);
    expect(pool.getDecalCount()).toBe(4);

    // A respawn whose patch has other counts keeps its place's attributes: none made per spawn
    const second = kernel.meshes[1].props.geo as THREE.BufferGeometry;
    const names = ['position', 'normal', 'uv', 'uv1'];
    const attributes = names.map((name) => second.getAttribute(name));
    const index = second.index!;
    const indexCount = index.count;
    expect(
      spawnDecal(pool, {
        target: block,
        position: { x: 7, z: -8 },
        cell: 'footprint',
        rotation: Math.PI / 4,
        size: 1.3,
      })
    ).toBe(ids[1]);
    names.forEach((name, i) => expect(second.getAttribute(name)).toBe(attributes[i]));
    expect(second.index).toBe(index);
    expect(index.count).not.toBe(indexCount);
    expect(second.boundingSphere!.containsPoint(second.boundingBox!.max)).toBe(true);
    // Every vertex of the attribute within the patch's bounds: three bounds a batch's slot by
    // all of them, so a tail elsewhere (the origin, an older patch) would stretch the decal's
    const position = second.getAttribute('position');
    expect(getDrawnVertexCount(second)).toBeLessThan(position.count);
    const bounds = second.boundingBox!.clone().expandByScalar(1e-5);
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      expect(bounds.containsPoint(point.fromBufferAttribute(position, i))).toBe(true);
    }
  });

  it("fades a lifetime's end by time, hides the decal when it ends and gives its place to the next spawn", () => {
    const { world, block, run } = createWorld();
    const pool = createPool(world, { maxDecals: 4, fifoFade: 0 });
    const spawn = (lifetimeSec?: number) =>
      spawnDecal(pool, {
        target: block,
        position: { x: 8, z: -8 },
        cell: 'footprint',
        rotation: 0,
        lifetimeSec,
        fadeSec: 1,
      })!;
    const timed = spawn(2);
    const lasting = spawn();
    const writes = () => merging.setMergeMemberColor.mock.calls.length;
    let before = writes();
    run(0.5);
    expect(writes()).toBe(before);
    run(1);
    expect(getOpacity(timed)).toBeCloseTo(0.5, 5);
    // Only the fading decal is written
    expect(writes()).toBe(before + 1);
    run(0.6);
    expect(world.isDisabled(timed)).toBe(true);
    expect(world.isDisabled(lasting)).toBe(false);
    expect(pool.getDecalCount()).toBe(1);
    before = writes();
    run(5);
    expect(writes()).toBe(before);

    expect(spawn()).toBe(timed);
    expect(world.isDisabled(timed)).toBe(false);
    expect(kernel.meshes).toHaveLength(2);
    expect(getOpacity(timed)).toBe(1);
    expect(pool.getDecalCount()).toBe(2);
  });

  it('draws a cell from a list and a missing rotation from its random stream', () => {
    const stamp = () => {
      const { world, block } = createWorld();
      const pool = createPool(world, { id: `p${worldIds.length}` });
      const cells: string[] = [];
      for (let i = 0; i < 6; i++) {
        spawnDecal(pool, {
          target: block,
          position: { x: 8, z: -8 },
          cell: ['footprint', 'track'],
        });
        const geometry = kernel.meshes.at(-1)!.props.geo as THREE.BufferGeometry;
        cells.push(
          `${geometry.getAttribute('uv').getY(0).toFixed(4)}:${geometry.getAttribute('uv1').getX(0).toFixed(4)}`
        );
      }
      return cells;
    };
    setRandomSeed(1);
    const first = stamp();
    setRandomSeed(1);
    expect(stamp()).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("ends with its scene's exit, and dispose deletes its decals and group", () => {
    const { world, block, removeSystem } = createWorld();
    const pool = createPool(world);
    const position = { x: 8, z: -8 };
    const entityId = spawnDecal(pool, { target: block, position, cell: 'footprint' })!;
    kernel.exits.get('decalPool:prints')!();
    expect(pool.isDisposed()).toBe(true);
    expect(removeSystem).toHaveBeenCalledWith('decalPool:prints');
    expect(spawnDecal(pool, { target: block, position, cell: 'footprint' })).toBeNull();
    expect(kernel.warn).toHaveBeenCalledWith(expect.stringMatching(/"prints" is gone/));

    const other = createPool(world, { id: 'other' });
    const otherId = spawnDecal(other, { target: block, position, cell: 'footprint' })!;
    other.dispose();
    other.dispose();
    expect(world.isAlive(otherId)).toBe(false);
    expect(world.isAlive(entityId)).toBe(true);
    expect(merging.dissolveMergeGroup).toHaveBeenCalledTimes(1);
    expect(merging.dissolveMergeGroup).toHaveBeenCalledWith('other', world);
    expect(kernel.exits.has('decalPool:other')).toBe(false);
  });
});

describe('spawnMeshDecalAsync', () => {
  /** A 1 m box entity at (2, 0, 0) */
  const addBox = (world: ECSWorld, mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))) => {
    const entityId = world.createEntity();
    mesh.position.set(2, 0, 0);
    world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: 0 });
    return entityId;
  };
  const onFront = { position: { x: 2, y: 0, z: 0.5 }, normal: { x: 0, y: 0, z: 2 } };

  it("projects the cell onto the mesh's face, u along +x and v up, lifted along it", async () => {
    const { world } = createWorld();
    const pool = createPool(world);
    const boxId = addBox(world);
    const entityId = await spawnMeshDecalAsync(pool, {
      target: { entityId: boxId },
      ...onFront,
      cell: 'footprint',
      rotation: 0,
    });
    expect(entityId).not.toBeNull();
    expect(merging.addToMergeGroup).toHaveBeenCalledWith('prints', [entityId], world);
    const geometry = kernel.meshes[0].props.geo as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    const uv1 = geometry.getAttribute('uv1');
    const vertexCount = getDrawnVertexCount(geometry);
    expect(geometry.index!.count).toBe(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      expect(position.getZ(i)).toBeCloseTo(0.505, 5);
      expect(position.getX(i)).toBeGreaterThanOrEqual(1.8 - 1e-6);
      expect(position.getX(i)).toBeLessThanOrEqual(2.2 + 1e-6);
      // 0.4 m wide: u counts x from 1.8, v counts y from −0.2
      expect(uv1.getX(i)).toBeCloseTo((position.getX(i) - 1.8) / 0.4, 5);
      expect(uv1.getY(i)).toBeCloseTo((position.getY(i) + 0.2) / 0.4, 5);
      expect(geometry.getAttribute('normal').getZ(i)).toBeCloseTo(1, 6);
    }
  });

  it('returns null for a decal missing the mesh or a mesh gone, without taking a place', async () => {
    const { world } = createWorld();
    const pool = createPool(world);
    const boxId = addBox(world);
    const away = { ...onFront, position: { x: 9, y: 0, z: 0.5 } };
    expect(
      await spawnMeshDecalAsync(pool, { target: { entityId: boxId }, ...away, cell: 'footprint' })
    ).toBeNull();
    world.deleteEntity(boxId);
    expect(
      await spawnMeshDecalAsync(pool, {
        target: { entityId: boxId },
        ...onFront,
        cell: 'footprint',
      })
    ).toBeNull();
    expect(kernel.meshes).toHaveLength(0);
    expect(pool.getDecalCount()).toBe(0);
  });

  it("refuses a mesh that isn't a plain one", async () => {
    const { world } = createWorld();
    const pool = createPool(world);
    const instancedId = addBox(
      world,
      new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2)
    );
    await expect(
      spawnMeshDecalAsync(pool, {
        target: { entityId: instancedId },
        ...onFront,
        cell: 'footprint',
      })
    ).rejects.toThrow(/isn't a plain mesh/);
  });

  it("grows a place's arrays for a decal past maxPatchVertices", async () => {
    const { world } = createWorld();
    const pool = createPool(world, { maxPatchVertices: 4 });
    const boxId = addBox(world);
    // The whole face and the side faces' edges within the depth: past the 4 vertices
    await spawnMeshDecalAsync(pool, {
      target: { entityId: boxId },
      ...onFront,
      cell: 'footprint',
      size: [2, 2],
      depth: 0.2,
    });
    const geometry = kernel.meshes[0].props.geo as THREE.BufferGeometry;
    expect(geometry.getAttribute('position').count).toBeGreaterThan(4);
    expect(geometry.index!.count).toBe(geometry.getAttribute('position').count);
  });

  it('returns null when the pool goes during the load', async () => {
    const { world } = createWorld();
    const pool = createPool(world);
    const boxId = addBox(world);
    const spawned = spawnMeshDecalAsync(pool, {
      target: { entityId: boxId },
      ...onFront,
      cell: 'footprint',
    });
    pool.dispose();
    expect(await spawned).toBeNull();
    expect(kernel.meshes).toHaveLength(0);
  });
});
