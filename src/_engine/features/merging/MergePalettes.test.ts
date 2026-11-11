import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { createGeometry } from '../../kernel/assets/Geometry';
import { MERGE_PALETTE_INDEX_ATTRIBUTE } from '../../kernel/assets/GeometryMergeCore';
import { createMaterial, getMaterial, saveMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene, setLoadingSceneId } from '../../kernel/scene/Scene';
import {
  addToMergeGroup,
  buildPendingMergeGroupsAsync,
  createMergeGroup,
  getMergeGroupOf,
  installMergeGroups,
} from './MergeGroups';
import type { MergeMaterialInfo } from './MergeMaterial';
import type { MeshMergeDef } from './MergeTypes';
import {
  findPaletteMaterial,
  getGroupPaletteIndex,
  getMergeMaterialInfo,
  getPaletteIndex,
} from './MergePalettes';
import { keepSceneMergeSettings } from './MergeSceneSettings';

const fns = vi.hoisted(() => ({ lwarn: vi.fn(), lerror: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
  lerror: fns.lerror,
}));

const PALETTE = 'palTestPalette';
const MEMBERS = ['palTestStone', 'palTestBrick', 'palTestMoss', 'palTestPlaster'];

// The default world and the root scene; the hooks are static, registered once for this file
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMeshes(ctx);
  installMergeGroups(ctx);
  // Persistent: a deleted mesh's last ref would release them. A box has 24 vertices.
  createGeometry({
    id: 'palTestBox',
    type: 'BOX',
    params: { width: 1, height: 1, depth: 1 },
    isPersistent: true,
  });
  for (const id of [...MEMBERS, 'palTestOther']) {
    createMaterial({ id, type: 'STANDARD', params: {}, isPersistent: true });
  }
  // The palette's merge material as the scene's `assetsLoaded` hook registers it: the groups read
  // only its `userData.mergeMaterial`
  const mergeMaterial = new THREE.MeshStandardNodeMaterial();
  const info: MergeMaterialInfo = {
    paletteId: PALETTE,
    materials: MEMBERS,
    tableId: `${PALETTE}.table`,
    arrays: {},
  };
  mergeMaterial.userData.mergeMaterial = info;
  saveMaterial(mergeMaterial, PALETTE, true);
});

afterEach(() => {
  setLoadingSceneId(null);
  world.clearWorld();
  fns.lwarn.mockClear();
  fns.lerror.mockClear();
});

let seq = 0;
const nextGroupId = () => `palGroup${seq++}`;

const createBox = (x: number, mat: string | THREE.Material = MEMBERS[0]) =>
  createMeshEntity({ geo: 'palTestBox', mat, position: { x, y: 1 } });

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Mesh | undefined;

const getWarnings = () => fns.lwarn.mock.calls.map((call) => String(call[0]));

describe('the look-ups', () => {
  test("find a palette's merge material, and a member's index", () => {
    const mergeMaterial = findPaletteMaterial(PALETTE)!;
    const info = getMergeMaterialInfo(mergeMaterial)!;
    expect(info.paletteId).toBe(PALETTE);
    expect(findPaletteMaterial('palTestStone')).toBeUndefined();
    expect(findPaletteMaterial('noSuchPalette')).toBeUndefined();

    expect(getPaletteIndex(info, getMaterial('palTestBrick')!)).toBe(1);
    expect(getPaletteIndex(info, getMaterial('palTestOther')!)).toBe(-1);
    // A clone carries the member's id, but isn't the registered instance
    expect(getPaletteIndex(info, getMaterial('palTestBrick')!.clone())).toBe(-1);
    expect(getPaletteIndex(info, new THREE.MeshStandardMaterial())).toBe(-1);
  });
});

describe('a palette group', () => {
  test('merges members of every palette material into one draw, each tagged with its index', async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId, palette: PALETTE });
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(group._material).toBe(getMaterial(PALETTE));

    // Out of palette order, and one material twice
    const members = [createBox(0, MEMBERS[2]), createBox(2, MEMBERS[0]), createBox(4, MEMBERS[2])];
    addToMergeGroup(groupId, members);
    expect(getWarnings()).toEqual([]);
    expect(
      members.map((id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!._paletteIndex)
    ).toEqual([2, 0, 2]);

    await buildPendingMergeGroupsAsync();
    const mesh = getMesh(groupEntityId)!;
    expect(mesh.material).toBe(getMaterial(PALETTE));
    expect(mesh.geometry.groups).toEqual([]);
    const index = mesh.geometry.getAttribute(
      MERGE_PALETTE_INDEX_ATTRIBUTE
    ) as THREE.BufferAttribute;
    expect(index.array).toBeInstanceOf(Uint8Array);
    expect(index.gpuType).toBe(THREE.IntType);
    // 24 vertices per box, in part order
    expect(Array.from(index.array as Uint8Array)).toEqual([
      ...Array<number>(24).fill(2),
      ...Array<number>(24).fill(0),
      ...Array<number>(24).fill(2),
    ]);
    for (const id of members) expect(getMesh(id)!.visible).toBe(false);
  });

  test('refuses another material, a clone of a member and a material array', async () => {
    const groupId = nextGroupId();
    createMergeGroup({ id: groupId, palette: PALETTE });
    const member = createBox(0, MEMBERS[1]);
    const other = createBox(2, 'palTestOther');
    const clone = createBox(4, getMaterial(MEMBERS[1])!.clone());
    const multi = createBox(6);
    getMesh(multi)!.material = [getMaterial(MEMBERS[0])!, getMaterial(MEMBERS[1])!];

    addToMergeGroup(groupId, [member, other, clone, multi]);
    expect(getWarnings()).toEqual([
      expect.stringContaining(`isn't one of the palette "${PALETTE}"'s`),
      expect.stringContaining(`isn't one of the palette "${PALETTE}"'s`),
      expect.stringContaining('split it into one mesh per material, which a palette can merge'),
    ]);
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(member)).toBe(groupId);
    for (const id of [other, clone, multi]) {
      expect(getMergeGroupOf(id)).toBeUndefined();
      expect(getMesh(id)!.visible).toBe(true);
    }
  });

  test("a group of one material doesn't tag its vertices", async () => {
    const groupId = nextGroupId();
    const groupEntityId = createMergeGroup({ id: groupId });
    const members = [createBox(0), createBox(2)];
    addToMergeGroup(groupId, members);
    // Another palette material is another material there
    addToMergeGroup(groupId, [createBox(4, MEMBERS[1])]);
    expect(getWarnings()).toEqual([expect.stringContaining("material isn't the group's")]);

    await buildPendingMergeGroupsAsync();
    expect(world.getComponent(members[0], ComponentType.MERGE_MEMBER)!._paletteIndex).toBe(
      undefined
    );
    const group = world.getComponent(groupEntityId, ComponentType.MERGE_GROUP)!;
    expect(getGroupPaletteIndex(group, getMaterial(MEMBERS[0])!)).toBeUndefined();
    expect(getMesh(groupEntityId)!.geometry.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE)).toBe(
      undefined
    );
  });

  test("throws for a palette the scene doesn't list, and with persistent", () => {
    expect(() => createMergeGroup({ id: nextGroupId(), palette: 'noSuchPalette' })).toThrow(
      /no merge material "noSuchPalette": the scene lists no such palette/
    );
    // A member material isn't a palette
    expect(() => createMergeGroup({ id: nextGroupId(), palette: MEMBERS[0] })).toThrow(
      /no merge material/
    );
    expect(() =>
      createMergeGroup({ id: nextGroupId(), palette: PALETTE, persistent: true })
    ).toThrow(/a palette group can't be persistent/);
  });
});

describe("a scene's group entry with a palette", () => {
  const loadSceneSettings = (sceneId: string, palette: string) => {
    keepSceneMergeSettings(sceneId, {
      id: sceneId,
      sceneFile: `${sceneId}.ts`,
      mergeGroups: [{ id: 'ruins', palette }],
    });
    setLoadingSceneId(sceneId);
  };

  test("makes the group on first use with it, from a mesh's merge", async () => {
    loadSceneSettings('palEntry', PALETTE);
    const members = [0, 2].map((x, i) =>
      createMeshEntity({ geo: 'palTestBox', mat: MEMBERS[i], position: { x }, merge: 'ruins' })
    );
    await buildPendingMergeGroupsAsync();
    expect(members.map((id) => getMergeGroupOf(id))).toEqual(['ruins', 'ruins']);
    const groupEntityId = world.getComponent(members[0], ComponentType.MERGE_MEMBER)!.groupEntityId;
    expect(getMesh(groupEntityId)!.material).toBe(getMaterial(PALETTE));
  });

  test('logs a palette that isn’t registered, and draws its meshes on their own', async () => {
    loadSceneSettings('palEntryMissing', 'noSuchPalette');
    const mesh = createMeshEntity({ geo: 'palTestBox', mat: MEMBERS[0], merge: 'ruins' });
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(mesh)).toBeUndefined();
    expect(getMesh(mesh)!.visible).toBe(true);
    expect(String(fns.lerror.mock.calls[0][0])).toContain(
      `Merge group "ruins": entities ${mesh} are drawn on their own.`
    );
  });
});

describe("AUTO's palettes", () => {
  /** Registers a scene whose AUTO entry has 10 m cells and these palettes, and loads it. */
  const loadScene = (sceneId: string, palettes?: string[]) => {
    keepSceneMergeSettings(sceneId, {
      id: sceneId,
      sceneFile: `${sceneId}.ts`,
      mergeGroups: [{ id: 'AUTO', cellSize: 10, ...(palettes && { palettes }) }],
    });
    setLoadingSceneId(sceneId);
  };

  const createAutoBox = (x: number, z: number, mat: string, merge: MeshMergeDef = 'AUTO') =>
    createMeshEntity({ geo: 'palTestBox', mat, position: { x, y: 1, z }, merge });

  /** Two boxes of each member material in each of 3 × 3 cells of 10 m */
  const createField = (merge?: MeshMergeDef) => {
    const ids: number[] = [];
    for (let cx = 0; cx < 3; cx++) {
      for (let cz = 0; cz < 3; cz++) {
        MEMBERS.forEach((mat, i) => {
          for (const offset of [1, 6]) {
            ids.push(createAutoBox(cx * 10 + offset, cz * 10 + i + 1, mat, merge));
          }
        });
      }
    }
    return ids;
  };

  const getGroupsData = () =>
    [...world.getStorage(ComponentType.MERGE_GROUP).entries()].map(([, group]) => group);

  test('a palette groups its materials per cell: 36 groups become 9', async () => {
    loadScene('palAutoNone');
    createField();
    await buildPendingMergeGroupsAsync();
    expect(getGroupsData()).toHaveLength(36);

    world.clearWorld();
    loadScene('palAuto', [PALETTE]);
    const members = createField();
    await buildPendingMergeGroupsAsync();
    const groups = getGroupsData();
    expect(groups).toHaveLength(9);
    for (const group of groups) {
      expect(group.settings.palette).toBe(PALETTE);
      expect(group._material).toBe(getMaterial(PALETTE));
      expect(group.members).toHaveLength(8);
    }
    expect(fns.lwarn).not.toHaveBeenCalled();
    // Each member tagged with its material's index
    const indices = members.map(
      (id) => world.getComponent(id, ComponentType.MERGE_MEMBER)!._paletteIndex
    );
    expect(indices.slice(0, 8)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  test("a mesh's own list replaces the scene's", async () => {
    loadScene('palAutoOwn', [PALETTE]);
    const own = [createAutoBox(1, 1, MEMBERS[0], { palettes: [] })];
    own.push(createAutoBox(2, 1, MEMBERS[1], { palettes: [] }));
    const scenes = [createAutoBox(3, 1, MEMBERS[0]), createAutoBox(4, 1, MEMBERS[1])];
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(own[0])).not.toBe(getMergeGroupOf(own[1]));
    expect(getMergeGroupOf(scenes[0])).toBe(getMergeGroupOf(scenes[1]));

    world.clearWorld();
    loadScene('palAutoOwnOnly');
    const listed = [0, 1].map((i) => createAutoBox(i, 1, MEMBERS[i], { palettes: [PALETTE] }));
    await buildPendingMergeGroupsAsync();
    expect(getMergeGroupOf(listed[0])).toBe(getMergeGroupOf(listed[1]));
  });

  test('another material, a persistent mesh and an unregistered palette take their own groups', async () => {
    loadScene('palAutoOthers', ['noSuchPalette', PALETTE]);
    const member = createAutoBox(1, 1, MEMBERS[0]);
    const other = createAutoBox(2, 1, 'palTestOther');
    const persistent = createAutoBox(3, 1, MEMBERS[1]);
    world.addComponent(persistent, ComponentType.PERSISTENT, true);
    createAutoBox(4, 1, MEMBERS[2]);
    await buildPendingMergeGroupsAsync();

    const groupOf = (id: number) =>
      world.getComponent(
        world.getComponent(id, ComponentType.MERGE_MEMBER)!.groupEntityId,
        ComponentType.MERGE_GROUP
      )!;
    expect(groupOf(member).settings.palette).toBe(PALETTE);
    expect(groupOf(member).members).toHaveLength(2);
    expect(groupOf(other).settings.palette).toBeUndefined();
    expect(groupOf(other)._material).toBe(getMaterial('palTestOther'));
    expect(groupOf(persistent).settings).toEqual({ persistent: true });
    expect(groupOf(persistent)._material).toBe(getMaterial(MEMBERS[1]));
    // The unregistered palette warned once for the scene, for the three meshes it was tried on
    expect(getWarnings()).toEqual([
      expect.stringContaining(
        'merge \'AUTO\' in the scene "palAutoOthers": no merge material "noSuchPalette"'
      ),
    ]);
  });

  test('an invalid palettes list is warned about and the mesh drawn on its own', async () => {
    const lists = [[''], 'ruins', [3]] as unknown as string[][];
    const meshes = lists.map((palettes, i) => createAutoBox(i, 1, MEMBERS[0], { palettes }));
    await buildPendingMergeGroupsAsync();
    expect(getWarnings()).toHaveLength(3);
    expect(getWarnings()[0]).toContain('palettes?');
    for (const id of meshes) expect(getMergeGroupOf(id)).toBeUndefined();
  });
});
