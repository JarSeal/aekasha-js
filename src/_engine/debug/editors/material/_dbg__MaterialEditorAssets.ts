// The material editor's project data (p806 D11, out of `_dbg__MaterialEditor.ts`): the project
// materials and textures as the generated data declares them, a copy's creation props, the
// textures a material needs and their load, and the selector's entries.
import * as THREE from 'three/webgpu';
import { getGeneratedAppData } from '../../../kernel/scene/Scene';
import type { MatProps } from '../../../kernel/assets/Material';
import { getTexture, loadTextureAsync, type TextureProps } from '../../../kernel/assets/Texture';
import { retagAssetOwner } from '../../../kernel/assets/AssetOwners';
import { getAppData } from '../../../kernel/scene/AppData';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import { textureMapKeys } from '../../../utils/Constants';
import { lerror, lwarn } from '../../../utils/Logger';
import type { MaterialSelectorEntry } from './_dbg__MaterialEditorSelector';
import { mergeNodeOverrides } from './_dbg__MaterialEditorParams';

type GeneratedData = {
  materials?: Record<string, MaterialAsset>;
  textures?: Record<string, TextureProps>;
  scenes: Record<
    string,
    { materials?: (string | MaterialAsset)[]; textures?: (string | TextureProps)[] }
  >;
};

const getGeneratedData = () => getGeneratedAppData() as unknown as GeneratedData;

/** The first scene entry with this id (a production-gathered build keeps only the scenes, with
 * their resolved assets). */
const findInScenes = <T extends { id?: string }>(
  kind: 'materials' | 'textures',
  id: string
): T | undefined => {
  for (const scene of Object.values(getGeneratedData().scenes)) {
    const found = (scene[kind] as (string | T)[] | undefined)?.find(
      (entry) => typeof entry !== 'string' && entry.id === id
    );
    if (found && typeof found !== 'string') return found;
  }
  return undefined;
};

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

/** A texture's declaration: the dev registry's, else any scene's entry. */
const findTextureDeclaration = (id: string) =>
  getGeneratedData().textures?.[id] ?? findInScenes<TextureProps>('textures', id);

/** The asset's creation props, without the gatherer's tooling fields. */
const getMaterialProps = (asset: MaterialAsset): MatProps => {
  const props: Record<string, unknown> = { ...asset, params: { ...asset.params } };
  delete props.$schema;
  delete props.__sourcePath;
  delete props.__saveData;
  return props as MatProps;
};

/** The copy's creation props: the asset's, with the editor's TSL input overrides merged over its
 * `nodes` (before creation: an input's uniform kind comes from its value, and a graph may read a
 * value at build time). The param overrides are set on the created copy instead
 * (`applyParamOverrides`), where only the params the copy has are taken. */
export const getCopyProps = (
  asset: MaterialAsset,
  nodeOverrides: Record<string, Record<string, unknown>>
) => {
  const props = getMaterialProps(asset) as MatProps & {
    nodes?: Record<string, Record<string, unknown>>;
  };
  if (props.nodes) props.nodes = mergeNodeOverrides(props.nodes, nodeOverrides);
  return props as MatProps;
};

/**
 * The texture ids a material asset uses: its `params` texture slots and its TSL node string
 * inputs (a string not starting with `#` is a texture id, as in createMaterial).
 * @returns (string[]) the texture ids, without duplicates
 */
export const getMaterialTextureIds = (asset: MaterialAsset) => {
  const ids = new Set<string>();
  const params = asset.params as Record<string, unknown> | undefined;
  if (params) {
    for (const key of textureMapKeys) {
      const value = params[key];
      if (typeof value === 'string') ids.add(value);
    }
  }
  if ('nodes' in asset && asset.nodes) {
    for (const inputs of Object.values(asset.nodes)) {
      for (const [key, value] of Object.entries(inputs)) {
        if (key !== 'staticDefines' && typeof value === 'string' && !value.startsWith('#')) {
          ids.add(value);
        }
      }
    }
  }
  return [...ids];
};

/** Why a material can't be loaded here, if it can't. */
export const getUnavailableReason = (asset: MaterialAsset) => {
  if (!('tslFile' in asset) || !asset.tslFile) return undefined;
  if (getAppData().tslMaterialFiles[asset.id]) return undefined;
  return 'its TSL graph is not in this build (a production-gathered build only has the graphs of the materials a scene uses; run yarn dev)';
};

/** The textures the editor loaded during this visit, which the exit retags to the current scene. */
const loadedTextureIds = new Set<string>();

/** Loads the material's textures that aren't loaded yet (like SceneLoader's
 * loadNextSceneAssets). A texture that fails is left out (createMaterial warns about it). */
export const loadMissingTextures = async (asset: MaterialAsset) => {
  const missing = getMaterialTextureIds(asset).filter((id) => !getTexture(id));
  for (const id of missing) loadedTextureIds.add(id);
  await Promise.all(
    missing.map(async (id) => {
      const declaration = findTextureDeclaration(id);
      if (!declaration) {
        lwarn(`Could not find texture "${id}" of material "${asset.id}", in the material editor.`);
        return;
      }
      try {
        await loadTextureAsync(declaration);
      } catch (err) {
        lerror(`Could not load texture "${id}" of material "${asset.id}".`, err);
      }
    })
  );
};

/** Hands the textures the editor loaded during this visit to the current scene (the view's exit). A
 * texture it loaded is owned by the scene that was current then: one loaded meanwhile (app code,
 * HMR) has released that scene's assets already, so the texture would never be released. The
 * current scene takes them, as a cache hit would. */
export const retagLoadedTextures = () => {
  for (const id of loadedTextureIds) {
    const texture = getTexture(id);
    if (texture) retagAssetOwner(texture);
  }
  loadedTextureIds.clear();
};

/** A CSS colour of the material's first colour: `params.color`, else the first `#` TSL input. */
const getSwatch = (asset: MaterialAsset) => {
  let value: unknown = (asset.params as Record<string, unknown> | undefined)?.color;
  if (value === undefined && 'nodes' in asset && asset.nodes) {
    for (const inputs of Object.values(asset.nodes)) {
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
