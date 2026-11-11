import type * as THREE from 'three/webgpu';
import { lwarn } from '../../utils/Logger';
import { retagAssetOwner } from '../../kernel/assets/AssetOwners';
import { deleteMaterial, getMaterial, saveMaterial } from '../../kernel/assets/Material';
import { deleteTexture, getTexture, saveTexture } from '../../kernel/assets/Texture';
import { createMergeMaterial, type MergeMaterialInfo } from './MergeMaterial';
import { getMergeMaterialInfo } from './MergePalettes';
import type { MergeMaterialSlot, SceneMergeMaterial } from './MergeMaterialSchema';

// A scene's merge materials registered (docs/plans/p374_multi-material-merging.md Phase 2): in
// the lazy chunk with the material code, loaded by `MergeMaterialLoad.ts`' scene hook.

/**
 * A palette's table texture's registry id: `<paletteId>.table`, next to its slot arrays'
 * `<paletteId>.<slot>`.
 * @internal
 */
export const getMergeMaterialTableId = (paletteId: string) => `${paletteId}.table`;

const isArrayTexture = (texture: THREE.Texture) =>
  !!(
    (texture as THREE.DataArrayTexture).isDataArrayTexture ||
    (texture as THREE.CompressedArrayTexture).isCompressedArrayTexture
  );

/** Each slot's loaded array, and the slot textures that aren't one */
const findSlotArrays = (palette: SceneMergeMaterial) => {
  const arrays: Partial<Record<MergeMaterialSlot, THREE.Texture>> = {};
  const missing: string[] = [];
  for (const [slot, info] of Object.entries(palette.__slots)) {
    const array = getTexture(info.texture);
    if (array && isArrayTexture(array)) arrays[slot as MergeMaterialSlot] = array;
    else missing.push(info.texture);
  }
  return { arrays, missing };
};

/** Whether a registered merge material samples these arrays (else a reload replaced one) */
const isSameArrays = (
  info: MergeMaterialInfo,
  arrays: Partial<Record<MergeMaterialSlot, THREE.Texture>>
) => {
  const slots = new Set([...Object.keys(info.arrays), ...Object.keys(arrays)]);
  for (const slot of slots) {
    if (info.arrays[slot as MergeMaterialSlot] !== arrays[slot as MergeMaterialSlot]) return false;
  }
  return true;
};

/** Each slot's loaded array; a slot texture that isn't one warns, or throws with `throwOnError` */
const getSlotArrays = (palette: SceneMergeMaterial) => {
  const { arrays, missing } = findSlotArrays(palette);
  if (missing.length) {
    const message = `Merge material "${palette.id}": ${missing.map((id) => `"${id}"`).join(', ')} isn't a loaded texture array, so every member samples its neutral value there (the scene lists the palette, so its arrays load with its textures: see the load's errors).`;
    if (palette.throwOnError) throw new Error(message);
    lwarn(message);
  }
  return arrays;
};

/**
 * A merge material made from palette data over its loaded slot arrays, neither it nor its table
 * registered. See `createMergeMaterialAsync`.
 * @internal
 * @throws when a slot's array didn't load and the palette has `throwOnError`
 */
export const createMergeMaterialFromData = (palette: SceneMergeMaterial, tableId: string) =>
  createMergeMaterial(palette, getSlotArrays(palette), tableId);

/**
 * One palette's merge material: the registered one re-tagged to the loading scene when it
 * samples the loaded arrays, else a new one, registered under the palette's id with its table
 * (`<paletteId>.table`), owned by the loading scene. See `createSceneMergeMaterialsAsync`.
 * @internal
 * @throws when a material that isn't the palette's merge material has the palette's id, or a
 * slot's array didn't load and the palette has `throwOnError`
 */
export const registerMergeMaterial = (palette: SceneMergeMaterial) => {
  const arrays = getSlotArrays(palette);

  const tableId = getMergeMaterialTableId(palette.id);
  const existing = getMaterial(palette.id);
  const existingInfo = getMergeMaterialInfo(existing);
  if (existing && !existingInfo) {
    throw new Error(
      `Merge material "${palette.id}": a material that isn't its merge material is registered under the palette's id (a palette's id is in the materials' id space).`
    );
  }
  if (existing && existingInfo && isSameArrays(existingInfo, arrays)) {
    retagAssetOwner(existing);
    const table = getTexture(tableId);
    if (table) retagAssetOwner(table);
    return;
  }
  if (existing) {
    // Its arrays were loaded again (the previous scene's were released, or replaced)
    deleteMaterial(palette.id);
    deleteTexture(tableId);
  }
  const { material, table } = createMergeMaterial(palette, arrays, tableId);
  saveTexture(table, tableId);
  saveMaterial(material, palette.id);
};
