import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  getAssetOwners,
  retagAssetOwner,
  setAssetOwnerScene,
} from '../../kernel/assets/AssetOwners';
import { deleteMaterial, getMaterial, saveMaterial } from '../../kernel/assets/Material';
import { releaseSceneOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { deleteTexture, getTexture, saveTexture } from '../../kernel/assets/Texture';
import { createRootScene, type SceneData } from '../../kernel/scene/Scene';
import type { SceneMergeMaterial } from './MergeMaterialSchema';
import { createSceneMergeMaterialsAsync } from './MergeMaterialLoad';
import { getMergeMaterialInfo, getMergeMaterialTableId } from './MergeMaterialRegister';

const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

const entry = {
  color: 0xffffff,
  opacity: 1,
  emissive: 0,
  emissiveIntensity: 1,
  roughness: 1,
  metalness: 0,
  normalScale: [1, 1] as [number, number],
  aoMapIntensity: 1,
};

const palette = (id: string, fields: Partial<SceneMergeMaterial> = {}): SceneMergeMaterial => ({
  id,
  materials: ['a', 'b'],
  __slots: { map: { texture: `${id}.map`, has: [true, true] } },
  __entries: [entry, entry],
  ...fields,
});

const sceneData = (id: string, palettes: SceneMergeMaterial[]) =>
  ({ id, sceneFile: '', mergeMaterials: palettes }) as SceneData;

/** A loaded slot array, as the scene's textures register it */
const loadArray = (id: string) => {
  const array = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2);
  return saveTexture(array, id);
};

/** A scene's load: the owner, the arrays (a loaded one re-tagged, as the texture loader's cache
 * hit does), then the hook */
const loadSceneAsync = async (sceneId: string, palettes: SceneMergeMaterial[]) => {
  setAssetOwnerScene(sceneId);
  for (const p of palettes) {
    for (const info of Object.values(p.__slots)) {
      const loaded = getTexture(info.texture);
      if (loaded) retagAssetOwner(loaded);
      else loadArray(info.texture);
    }
  }
  await createSceneMergeMaterialsAsync(sceneData(sceneId, palettes));
};

beforeAll(() => {
  createRootScene();
});

beforeEach(() => {
  fns.lwarn.mockClear();
});

describe("a scene's merge materials (p374 Phase 2)", () => {
  test('registers the merge material under the palette id, and its table, owned by the scene', async () => {
    await loadSceneAsync('mmA', [palette('mmStones')]);
    const material = getMaterial('mmStones');
    expect(material).toBeInstanceOf(THREE.MeshStandardNodeMaterial);
    expect(getMergeMaterialInfo(material)).toMatchObject({
      paletteId: 'mmStones',
      materials: ['a', 'b'],
      tableId: 'mmStones.table',
      arrays: { map: getTexture('mmStones.map') },
    });
    const table = getTexture(getMergeMaterialTableId('mmStones'));
    expect(table).toBeInstanceOf(THREE.DataTexture);
    expect(getAssetOwners(material!)).toEqual(['mmA']);
    expect(getAssetOwners(table!)).toEqual(['mmA']);
    expect(getMergeMaterialInfo(new THREE.MeshBasicMaterial())).toBeUndefined();
  });

  test("the next scene listing it shares it; the previous scene's release keeps it", async () => {
    await loadSceneAsync('mmB1', [palette('mmShared')]);
    const material = getMaterial('mmShared')!;
    const table = getTexture('mmShared.table')!;
    await loadSceneAsync('mmB2', [palette('mmShared')]);
    expect(getMaterial('mmShared')).toBe(material);
    expect(getAssetOwners(material)).toEqual(['mmB1', 'mmB2']);
    releaseSceneOwnedAssets('mmB1');
    expect(getMaterial('mmShared')).toBe(material);
    expect(getTexture('mmShared.table')).toBe(table);
    expect(getTexture('mmShared.map')).toBeTruthy();
    // Its own scene's release frees the material, its table and its arrays
    const released = releaseSceneOwnedAssets('mmB2');
    expect(released.materials).toContain('mmShared');
    expect(released.textures).toEqual(expect.arrayContaining(['mmShared.table', 'mmShared.map']));
    expect(getTexture('mmShared.table')).toBeUndefined();
  });

  test('makes a new one when its arrays were loaded again', async () => {
    await loadSceneAsync('mmC1', [palette('mmReloaded')]);
    const first = getMaterial('mmReloaded');
    deleteTexture('mmReloaded.map');
    await loadSceneAsync('mmC2', [palette('mmReloaded')]);
    const second = getMaterial('mmReloaded');
    expect(second).not.toBe(first);
    expect(getMergeMaterialInfo(second)?.arrays.map).toBe(getTexture('mmReloaded.map'));
  });

  test('warns about a slot whose array is missing, and fails with throwOnError', async () => {
    const missing = palette('mmMissing', {
      __slots: {
        map: { texture: 'mmMissing.map', has: [true, true] },
        orm: { texture: 'mmMissing.orm', has: [true, false] },
      },
    });
    setAssetOwnerScene('mmD');
    loadArray('mmMissing.map');
    // A stand-in that isn't an array counts as missing
    saveTexture(new THREE.DataTexture(new Uint8Array(4), 1, 1), 'mmMissing.orm');
    await createSceneMergeMaterialsAsync(sceneData('mmD', [missing]));
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringMatching(/"mmMissing.orm" isn't a loaded/));
    expect(getMergeMaterialInfo(getMaterial('mmMissing'))?.arrays).toEqual({
      map: getTexture('mmMissing.map'),
    });

    deleteMaterial('mmMissing');
    await expect(
      createSceneMergeMaterialsAsync(sceneData('mmD', [{ ...missing, throwOnError: true }]))
    ).rejects.toThrow(/"mmMissing.orm" isn't a loaded texture array/);
  });

  test("fails when another material has the palette's id", async () => {
    setAssetOwnerScene('mmE');
    saveMaterial(new THREE.MeshBasicMaterial(), 'mmTaken');
    loadArray('mmTaken.map');
    await expect(
      createSceneMergeMaterialsAsync(sceneData('mmE', [palette('mmTaken')]))
    ).rejects.toThrow(/isn't its merge material is registered under the palette's id/);
  });

  test('does nothing for a scene that lists no palette', async () => {
    await expect(
      createSceneMergeMaterialsAsync({ id: 'mmF', sceneFile: '' } as SceneData)
    ).resolves.toBeUndefined();
  });
});
