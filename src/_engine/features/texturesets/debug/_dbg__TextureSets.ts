// The texture sets' debug tools (p303): the material editor's preparer for a `{ textureSetArray }`
// input. A set array is built by the load of the scene that lists or names it, so outside that
// scene (and before any build, when its resolver isn't registered yet) the editor's copy of such
// a material couldn't be created. The preparer builds the arrays the material names first.
import type * as THREE from 'three/webgpu';
import { retagAssetOwner } from '../../../kernel/assets/AssetOwners';
import { getGeneratedAppData, type SceneData } from '../../../kernel/scene/Scene';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import { registerMaterialEditorPreparer } from '../../../debug/editors/material/_dbg__MaterialEditorPreparers';
import {
  buildTextureSetArray,
  getTextureSetArray,
  getTextureSetArrayId,
} from '../TextureSetArrays';
import { isTextureSetArrayInputRef, type TextureSetArrayInputRef } from '../TextureSetRefs';
import type { TextureSetPacking } from '../../../schemas/TextureSetSchema';

/** What a build takes: an input's list, or a scene's `textureSetArrays` entry for an id. */
type ArrayBuild = { id?: string; sets: string[]; packing: TextureSetPacking; swappable?: boolean };

/** The `{ textureSetArray }` values of a material asset's `inputs` and its sockets' (`nodes`). */
export const getTextureSetArrayInputs = (asset: MaterialAsset): TextureSetArrayInputRef[] => {
  const { inputs, nodes } = asset as {
    inputs?: Record<string, unknown>;
    nodes?: Record<string, Record<string, unknown> | undefined>;
  };
  const groups = [inputs, ...Object.values(nodes ?? {})];
  return groups.flatMap((group) => Object.values(group ?? {}).filter(isTextureSetArrayInputRef));
};

/** A scene's `textureSetArrays` entry with the id, from the generated data. */
const findSceneArrayEntry = (id: string) => {
  for (const scene of Object.values(getGeneratedAppData().scenes) as SceneData[]) {
    const entry = scene.textureSetArrays?.find((candidate) => candidate.id === id);
    if (entry) return entry;
  }
  return undefined;
};

/**
 * The build an input asks for: a list's own sets and packing, or an id's scene entry. Undefined
 * for an id no scene lists (the resolver's error says so).
 */
export const getArrayBuild = (ref: TextureSetArrayInputRef): ArrayBuild | undefined => {
  if (Array.isArray(ref.textureSetArray)) {
    return { sets: ref.textureSetArray, packing: (ref as { packing: TextureSetPacking }).packing };
  }
  const entry = findSceneArrayEntry(ref.textureSetArray);
  if (!entry) return undefined;
  const { id, sets, packing, swappable } = entry;
  return { id, sets, packing, swappable };
};

/** The set arrays the editor built during this visit, which the exit hands to the current scene. */
const builtArrayIds = new Set<string>();

/** Builds the set arrays the asset's inputs name that aren't built (all at once). */
const prepareAsync = async (asset: MaterialAsset) => {
  const builds = getTextureSetArrayInputs(asset)
    .map(getArrayBuild)
    .filter((build): build is ArrayBuild => build !== undefined);
  await Promise.all(
    builds.map(async (build) => {
      // Built already (the scene's own, or an earlier pick's): nothing to make or hand over
      const id = build.id ?? getTextureSetArrayId(build.packing, build.sets);
      if (getTextureSetArray(id)) return;
      const built = await buildTextureSetArray(build);
      builtArrayIds.add(built.id);
    })
  );
};

/** Hands the set arrays the editor built to the current scene (a scene switched to meanwhile
 * released the previous one's, so they'd never be released). */
const onExit = () => {
  for (const id of builtArrayIds) {
    const entry = getTextureSetArray(id);
    if (!entry) continue;
    for (const array of Object.values(entry.arrays) as THREE.Texture[]) retagAssetOwner(array);
  }
  builtArrayIds.clear();
};

/**
 * Registers the texture sets' material editor preparer (the `textureSets()` feature's `onDebug`).
 * @internal
 */
export const _registerTextureSetsDebug = () => {
  registerMaterialEditorPreparer({ id: 'textureSetArrays', prepareAsync, onExit });
};
