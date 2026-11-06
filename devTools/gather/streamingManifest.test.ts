import { describe, expect, it } from 'vitest';
import { packCellKey } from '../../src/_engine/utils/CellKey';
import type { GatherContext } from './context';
import type { SceneJSON } from './sceneAssets';
import { buildStreamingManifest, getPrimitiveGeometryRadius } from './streamingManifest';

// p353 Phase 3 D1-D5: the cell manifest on resolved scenes (what the scene pass hands it)

const createCtx = () => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const ctx = {
    isProduction: false,
    log: {
      warn: (message: string) => warnings.push(message),
      error: (message: string) => errors.push(message),
    },
  } as unknown as GatherContext;
  return { ctx, warnings, errors };
};

const key = (cx: number, cz: number) => String(packCellKey(cx, 0, cz));

const mesh = (appId: string, x: number, z: number, props: Record<string, unknown> = {}) => ({
  props: { appId, geo: 'box', mat: 'grey', position: { x, y: 0, z }, ...props },
});

const baseScene = (fields: Record<string, unknown> = {}) =>
  ({
    id: 'world',
    sceneFile: 'scenes/world/world.ts',
    streaming: { cellSize: 64 },
    geometries: [{ id: 'box', type: 'BOX', params: { width: 2, height: 2, depth: 2 } }],
    materials: [{ id: 'grey', type: 'BASIC', params: { color: '#888888' } }],
    ...fields,
  }) as unknown as SceneJSON;

const build = (scene: SceneJSON) => {
  const log = createCtx();
  return { ...log, out: buildStreamingManifest(log.ctx, 'world', scene) };
};

describe('getPrimitiveGeometryRadius', () => {
  it('measures the primitives’ bounding spheres, three’s defaults for params left out', () => {
    expect(getPrimitiveGeometryRadius({ type: 'BOX' })).toBeCloseTo(Math.sqrt(3) / 2);
    expect(getPrimitiveGeometryRadius({ type: 'SPHERE', params: { radius: 3 } })).toBe(3);
    expect(
      getPrimitiveGeometryRadius({ type: 'CYLINDER', params: { radiusTop: 3, height: 8 } })
    ).toBe(5);
    expect(getPrimitiveGeometryRadius({ type: 'CAPSULE', params: { radius: 1, height: 4 } })).toBe(
      3
    );
    expect(getPrimitiveGeometryRadius({ type: 'CONE', params: { radius: 3, height: 8 } })).toBe(5);
    expect(getPrimitiveGeometryRadius({ type: 'PLANE' })).toBeNull();
  });
});

describe('buildStreamingManifest', () => {
  it('leaves a scene without streaming as it is', () => {
    const scene = baseScene({ streaming: undefined, meshes: [mesh('a', 10, 10)] });
    expect(build(scene).out).toBe(scene);
  });

  it('puts meshes into their position’s cell, with bounds, and drops the build-time fields', () => {
    const scene = baseScene({
      streaming: { cellSize: 64, rings: { resident: 1 }, base: [], radii: {} },
      meshes: [mesh('a', 10, 20), mesh('b', -10, 20), mesh('c', 30, 50)],
    });
    const { out, warnings, errors } = build(scene);
    expect(out.streaming).toEqual({ cellSize: 64, rings: { resident: 1 } });
    expect(out.meshes).toBeUndefined();
    const manifest = out.__streaming;
    expect(manifest?.cellSize).toBe(64);
    expect(manifest?.meshes.map((m) => m.props.appId)).toEqual(['a', 'b', 'c']);
    expect(Object.keys(manifest?.cells ?? {})).toEqual([key(0, 0), key(-1, 0)].sort());
    const cell = manifest?.cells[key(0, 0)];
    expect(cell?.meshes).toEqual([0, 2]);
    // An unrotated box's own half sides (1 m)
    expect(cell?.bounds).toEqual([9, 19, 31, 51]);
    expect(manifest?.cells[key(-1, 0)]?.meshes).toEqual([1]);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('keeps the base: ids streaming.base names, and the lights without a position that matters', () => {
    const scene = baseScene({
      streaming: { cellSize: 64, base: ['tower', 'nothing'] },
      meshes: [mesh('tower', 10, 10), mesh('rock', 100, 10)],
      lights: [
        { lightProps: { type: 'AMBIENT', appId: 'amb' } },
        { lightProps: { type: 'DIRECTIONAL', appId: 'sun' } },
        { lightProps: { type: 'POINT', appId: 'lamp', position: { x: 70, y: 2, z: -5 } } },
        { lightProps: { type: 'SPOT', appId: 'spot', position: { x: 5, y: 2, z: 5 } } },
      ],
    });
    const { out, warnings } = build(scene);
    expect(out.meshes?.map((m) => (typeof m === 'string' ? m : m.props.appId))).toEqual(['tower']);
    expect(
      out.lights?.map((l) =>
        typeof l === 'string' ? l : (l.lightProps as { appId: string }).appId
      )
    ).toEqual(['amb', 'sun']);
    const manifest = out.__streaming;
    expect(manifest?.lights.map((l) => (l.lightProps as { appId: string }).appId)).toEqual([
      'lamp',
      'spot',
    ]);
    expect(manifest?.cells[key(1, -1)]?.lights).toEqual([0]);
    expect(manifest?.cells[key(0, 0)]?.lights).toEqual([1]);
    expect(manifest?.cells[key(1, 0)]?.meshes).toEqual([0]);
    // The base mesh uses the geometry and material: they stay
    expect(out.geometries).toHaveLength(1);
    expect(out.materials).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"nothing"');
  });

  it('moves the assets only cell content uses into the cells, each once', () => {
    const scene = baseScene({
      backgroundTexture: 'sky',
      textures: [
        { id: 'sky', fileName: 'sky.png' },
        { id: 'bark', fileName: 'bark.png', __vramBytes: { in: 4000, out: 1000 } },
        { id: 'moss', fileName: 'moss.png', __vramBytes: { in: 400, out: 100 } },
        { id: 'unused', fileName: 'unused.png' },
      ],
      geometries: [
        { id: 'box', type: 'BOX' },
        { id: 'trunk', type: 'CYLINDER' },
        { id: 'stone', type: 'SPHERE' },
      ],
      materials: [
        { id: 'grey', type: 'BASIC' },
        { id: 'barkMat', type: 'STANDARD', params: { map: 'bark' } },
        { id: 'mossMat', type: 'STANDARD', params: { map: 'moss' } },
        { id: 'unusedMat', type: 'STANDARD', params: { map: 'moss' } },
      ],
      importedAssets: [{ id: 'statue', fileName: 'statue.glb', __vramBytes: { in: 9, out: 7 } }],
      meshes: [
        mesh('baseBox', 0, 0, { geo: 'box', mat: 'grey' }),
        mesh('tree1', 100, 0, { geo: 'trunk', mat: 'barkMat' }),
        mesh('tree2', 200, 0, {
          geo: 'trunk',
          mat: 'barkMat',
          lod: { levels: [{ screenSize: 0.5 }, { screenSize: 0.1, geo: 'stone#lod1' }] },
        }),
        mesh('statue', 300, 0, { geo: 'statue/body', mat: 'mossMat' }),
      ],
      streaming: { cellSize: 64, base: ['baseBox'] },
    });
    const { out } = build(scene);
    // Base: what the base mesh and the background use, and what nothing references; a material
    // that stays base keeps its textures (unusedMat names moss)
    const ids = (list: unknown[] | undefined) => (list ?? []).map((e) => (e as { id: string }).id);
    expect(ids(out.textures)).toEqual(['sky', 'moss', 'unused']);
    expect(ids(out.geometries)).toEqual(['box']);
    expect(ids(out.materials)).toEqual(['grey', 'unusedMat']);
    expect(out.importedAssets).toBeUndefined();
    const manifest = out.__streaming;
    expect(ids(manifest?.assets.textures)).toEqual(['bark']);
    expect(ids(manifest?.assets.geometries)).toEqual(['trunk', 'stone']);
    expect(ids(manifest?.assets.materials)).toEqual(['barkMat', 'mossMat']);
    expect(ids(manifest?.assets.importedAssets)).toEqual(['statue']);

    const tree1 = manifest?.cells[key(1, 0)];
    expect(tree1).toMatchObject({ geometries: [0], materials: [0], textures: [0] });
    expect(tree1?.bytesEstimate).toBe(1000);
    // The LOD level's geometry comes with the cell
    expect(manifest?.cells[key(3, 0)]).toMatchObject({ geometries: [0, 1], textures: [0] });
    const statue = manifest?.cells[key(4, 0)];
    expect(statue).toMatchObject({ materials: [1], importedAssets: [0] });
    expect(statue?.textures).toBeUndefined();
    expect(statue?.bytesEstimate).toBe(7);
  });

  it('puts an oversized mesh into every cell it overlaps', () => {
    const scene = baseScene({
      geometries: [
        { id: 'wall', type: 'BOX', params: { width: 100, height: 2, depth: 4 } },
        { id: 'tower', type: 'BOX', params: { width: 60, height: 2, depth: 60 } },
      ],
      meshes: [
        mesh('wall', 64, 10, { geo: 'wall' }),
        mesh('turned', 64, 200, { geo: 'tower', rotation: { x: 0, y: 0.5, z: 0 } }),
        mesh('hall', 300, 300, { geo: 'statue/hall' }),
        mesh('statue', 200, 400, { geo: 'statue/body' }),
      ],
      streaming: { cellSize: 64, radii: { hall: 40, missing: 3 } },
    });
    const { out, warnings } = build(scene);
    const cells = out.__streaming?.cells ?? {};
    const meshesIn = (cx: number, cz: number) => cells[key(cx, cz)]?.meshes;
    // An unrotated box reaches along its sides: x 64 ± 50 spans cells 0 and 1, z 10 ± 2 one row
    expect(meshesIn(0, 0)).toEqual([0]);
    expect(meshesIn(1, 0)).toEqual([0]);
    expect(meshesIn(0, -1)).toBeUndefined();
    expect(cells[key(0, 0)]?.bounds).toEqual([14, 8, 114, 12]);
    // A rotated one by its bounding sphere: 64 ± 42.4 and 200 ± 42.4, cells 0-1 by 2-3
    const r = Math.hypot(60, 2, 60) / 2;
    for (const [cx, cz] of [
      [0, 2],
      [1, 2],
      [0, 3],
      [1, 3],
    ]) {
      expect(meshesIn(cx, cz)).toEqual([1]);
    }
    expect(cells[key(0, 2)]?.bounds).toEqual([64 - r, 200 - r, 64 + r, 200 + r]);
    // radii's 40 makes the import mesh oversized: 300 ± 40 → cells 4 and 5 on each axis
    for (const [cx, cz] of [
      [4, 4],
      [5, 4],
      [4, 5],
      [5, 5],
    ]) {
      expect(meshesIn(cx, cz)).toEqual([2]);
    }
    // An unmeasured geometry is a point
    expect(meshesIn(3, 6)).toEqual([3]);
    expect(cells[key(3, 6)]?.bounds).toEqual([200, 400, 200, 400]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"missing"');
  });

  it('fails an entry outside the cell keys’ range', () => {
    const scene = baseScene({ meshes: [mesh('far', 64 * 70_000, 0)] });
    const { errors } = build(scene);
    expect(errors).toHaveLength(1);
  });

  it('writes no manifest when nothing goes into a cell', () => {
    const scene = baseScene({
      lights: [{ lightProps: { type: 'AMBIENT' } }],
      streaming: { cellSize: 64, base: [] },
    });
    const { out } = build(scene);
    expect(out.__streaming).toBeUndefined();
    expect(out.streaming).toEqual({ cellSize: 64 });
    expect(out.lights).toHaveLength(1);
  });
});
