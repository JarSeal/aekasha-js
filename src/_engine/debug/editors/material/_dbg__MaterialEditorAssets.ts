// The material editor's project data (p806 D11, out of `_dbg__MaterialEditor.ts`): the project
// materials and textures as the generated data declares them, a copy's creation props, the
// textures a material needs and their load, and the selector's entries.
import * as THREE from 'three/webgpu';
import { getGeneratedAppData } from '../../../kernel/scene/Scene';
import type { MaterialVariantOverrides, MatProps } from '../../../kernel/assets/Material';
import { getTexture } from '../../../kernel/assets/Texture';
import { retagAssetOwner } from '../../../kernel/assets/AssetOwners';
import {
  ensureMaterialDependencies,
  getMaterialTextureIds as getTextureIdsOf,
} from '../../../kernel/assets/MaterialDependencies';
import { getAppData } from '../../../kernel/scene/AppData';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import type { MaterialSelectorEntry } from './_dbg__MaterialEditorSelector';
import {
  runMaterialEditorPreparerExits,
  runMaterialEditorPreparersAsync,
} from './_dbg__MaterialEditorPreparers';
import {
  fromNodeInputGroups,
  getAssetNodeInputs,
  mergeNodeOverrides,
  toNodeInputGroups,
  type MaterialTslInputs,
} from './_dbg__MaterialEditorParams';

type GeneratedData = {
  materials?: Record<string, MaterialAsset>;
  scenes: Record<string, { materials?: (string | MaterialAsset)[] }>;
};

const getGeneratedData = () => getGeneratedAppData() as unknown as GeneratedData;

let materialAssets: Record<string, MaterialAsset> | null = null;

/** The project materials by id: the dev registry, or in a production-gathered build (no
 * registry) the scenes' entries, with that scene's overrides applied. */
export const getMaterialAssets = () => {
  if (materialAssets) return materialAssets;
  const data = getGeneratedData();
  if (data.materials) {
    materialAssets = data.materials;
    return materialAssets;
  }
  materialAssets = {};
  for (const scene of Object.values(data.scenes)) {
    for (const entry of scene.materials || []) {
      if (typeof entry !== 'string' && entry.id && !materialAssets[entry.id]) {
        materialAssets[entry.id] = entry;
      }
    }
  }
  return materialAssets;
};

/** The asset's creation props, without the gatherer's tooling fields. */
const getMaterialProps = (asset: MaterialAsset): MatProps => {
  const props: Record<string, unknown> = { ...asset, params: { ...asset.params } };
  delete props.$schema;
  delete props.__sourcePath;
  delete props.__saveData;
  return props as MatProps;
};

/** The copy's creation props: the asset's, with the editor's TSL input overrides merged over its
 * `nodes` and `inputs` (before creation: an input's uniform kind comes from its value, and a graph
 * may read a value at build time). The param overrides are set on the created copy instead
 * (`applyParamOverrides`), where only the params the copy has are taken. */
export const getCopyProps = (asset: MaterialAsset, tslOverrides: MaterialTslInputs) => {
  const props = getMaterialProps(asset) as MatProps & MaterialTslInputs;
  const merged = mergeNodeOverrides(
    getAssetNodeInputs(asset),
    toNodeInputGroups(tslOverrides) ?? {}
  );
  if (merged) {
    const { nodes, inputs } = fromNodeInputGroups(merged);
    if (props.nodes) props.nodes = nodes;
    if (props.inputs) props.inputs = inputs;
  }
  return props as MatProps;
};

/**
 * The texture ids a material asset uses: its `params` texture slots and its TSL inputs' (`nodes`
 * and `inputs`), as `ensureMaterialDependencies` loads them (p302 D4, D6).
 * @returns (string[]) the texture ids, without duplicates
 */
export const getMaterialTextureIds = (asset: MaterialAsset) => getTextureIdsOf(asset);

/** Why a material can't be loaded here, if it can't. */
export const getUnavailableReason = (asset: MaterialAsset) => {
  if (!('tslFile' in asset) || !asset.tslFile) return undefined;
  if (getAppData().tslMaterialFiles[asset.id]) return undefined;
  return 'its TSL graph is not in this build (a production-gathered build only has the graphs of the materials a scene uses; run yarn dev)';
};

/** The textures the editor loaded during this visit, which the exit retags to the current scene. */
const loadedTextureIds = new Set<string>();

/** Loads the material's textures that aren't loaded yet (`ensureMaterialDependencies`, its
 * textures only: the editor loads the TSL file itself, to show its error), and runs the features'
 * preparers beside them (`_dbg__MaterialEditorPreparers.ts`: a texture set array's build). A
 * texture that fails is logged and left out (the material samples one white texel). */
export const loadMissingTextures = async (asset: MaterialAsset) => {
  for (const id of getMaterialTextureIds(asset)) if (!getTexture(id)) loadedTextureIds.add(id);
  const { params, nodes, inputs } = asset as MaterialAsset & MaterialVariantOverrides;
  await Promise.all([
    ensureMaterialDependencies({ params, nodes, inputs }),
    runMaterialEditorPreparersAsync(asset),
  ]);
};

/** Hands the textures the editor loaded during this visit to the current scene (the view's exit). A
 * texture it loaded is owned by the scene that was current then: one loaded meanwhile (app code,
 * HMR) has released that scene's assets already, so the texture would never be released. The
 * current scene takes them, as a cache hit would; so do the preparers' (their `onExit`). */
export const retagLoadedTextures = () => {
  for (const id of loadedTextureIds) {
    const texture = getTexture(id);
    if (texture) retagAssetOwner(texture);
  }
  loadedTextureIds.clear();
  runMaterialEditorPreparerExits();
};

/** A CSS colour of the material's first colour: `params.color`, else the first `#` TSL input. */
const getSwatch = (asset: MaterialAsset) => {
  let value: unknown = (asset.params as Record<string, unknown> | undefined)?.color;
  if (value === undefined) {
    for (const inputs of Object.values(getAssetNodeInputs(asset) ?? {})) {
      value = Object.values(inputs).find((v) => typeof v === 'string' && v.startsWith('#'));
      if (value !== undefined) break;
    }
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return `#${new THREE.Color(value).getHexString()}`;
  } catch {
    return null;
  }
};

export const getSelectorEntries = (): MaterialSelectorEntry[] =>
  Object.values(getMaterialAssets()).map((asset) => ({
    id: asset.id,
    name: asset.debugData?.name || asset.id,
    type: asset.type,
    isTsl: 'tslFile' in asset && Boolean(asset.tslFile),
    sourcePath: asset.__sourcePath,
    description: asset.debugData?.description,
    swatch: getSwatch(asset),
    unavailableReason: getUnavailableReason(asset),
  }));
