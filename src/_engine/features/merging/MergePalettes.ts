// Merge groups on a palette (docs/plans/p374_multi-material-merging.md D4, Phase 3): a group whose
// `palette` names a merge material palette draws its members, each of one of the palette's
// materials, with the palette's merge material (registered under the palette's id by the scene
// that lists it, MergeMaterialLoad.ts), each member's vertices tagged with its material's palette
// index. In the first download with the groups: the merge material's code isn't (a look-up of the
// registered material and its `userData` only).
import type * as THREE from 'three/webgpu';
import { getMaterial } from '../../kernel/assets/Material';
import type { MergeMaterialInfo } from './MergeMaterial';
import type { MergeGroupData } from './MergeTypes';

/**
 * The merge material info of a registered material, or undefined for any other material.
 * @internal
 */
export const getMergeMaterialInfo = (material: THREE.Material | null | undefined) =>
  material?.userData.mergeMaterial as MergeMaterialInfo | undefined;

/**
 * A palette's merge material: the material registered under the palette's id when it's that
 * palette's merge material (the loading or current scene lists the palette), else undefined.
 * @internal
 */
export const findPaletteMaterial = (paletteId: string) => {
  const material = getMaterial(paletteId) as THREE.Material | undefined;
  return getMergeMaterialInfo(material)?.paletteId === paletteId ? material : undefined;
};

/**
 * A material's palette index in a merge material's palette, or -1: it must be the registered
 * instance of one of the palette's member ids (a variant, `<id>#<hash>`, is another material; a
 * clone carrying a member's id would draw with the member's table entry, not its own values).
 * @internal
 */
export const getPaletteIndex = (info: MergeMaterialInfo, material: THREE.Material) => {
  const id = material.userData.id as string | undefined;
  if (id === undefined || getMaterial(id) !== material) return -1;
  return info.materials.indexOf(id);
};

/**
 * A material's palette index in a palette group (-1 when the palette doesn't have it), or
 * undefined for a group of one material.
 * @internal
 */
export const getGroupPaletteIndex = (group: MergeGroupData, material: THREE.Material) => {
  if (!group.settings.palette) return undefined;
  const info = getMergeMaterialInfo(group._material);
  return info ? getPaletteIndex(info, material) : -1;
};
