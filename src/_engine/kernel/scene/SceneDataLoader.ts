import type * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../utils/Logger';
import type { SceneData } from './Scene';
import type { ScenePrimitiveAssets } from './SceneLoader';
import { getEntityIdByAppId } from '../ecs/ECS';
import { getTexture, loadTextureAsync } from '../assets/Texture';
import { createMaterial, getMaterial, loadTslMaterialFileAsync } from '../assets/Material';
import { textureMapKeys } from '../../utils/Constants';
import { createGeometry, getGeometry, type MergedGeoProps } from '../assets/Geometry';
import { createLightEntity } from '../light/Light';
import { createCameraEntity, setActiveCamera } from '../camera/Camera';
import { createMeshEntity } from '../mesh/Mesh';
import type { ImportedAssetManifest } from '../assets/import/ImportTypes';
import { retagAssetOwner, runInAssetOwnerScope } from '../assets/AssetOwners';

// What a scene load builds from the scene's data (`SceneData`): its cameras, its assets and its
// JSON lights and meshes. The load itself, its order and its hooks are SceneLoader.ts'.

/** Creates a scene's cameras from its data. A scene needs at least one it creates; without an
 * active one, the first camera it names by id (a persistent one) becomes active. Throws without a
 * created camera (the load fails).
 * @internal
 */
export const createCameras = (sceneData: SceneData) => {
  const cameraProps = sceneData.cameras || [];
  let firstCamId: number | undefined;
  let activeCamFound = false;
  let oneCameraCreated = false;
  if (!cameraProps.length) {
    throw new Error(`Could not find any cameras for scene "${sceneData.id}" in createCameras.`);
  }
  for (let i = 0; i < cameraProps.length; i++) {
    const props = cameraProps[i];
    if (typeof props === 'string') {
      if (i === 0) firstCamId = getEntityIdByAppId(props);
      continue;
    }
    createCameraEntity(props.camProps, props.entityOpts);
    oneCameraCreated = true;
    if (props.camProps.active) activeCamFound = true;
  }
  if (!oneCameraCreated) {
    throw new Error(`No camera was created for scene "${sceneData.id}" in createCameras.`);
  }
  // Entity id 0 is an id too
  if (!activeCamFound && firstCamId !== undefined) {
    setActiveCamera(firstCamId);
  }
};

/**
 * The asset lists of a scene's data that {@link loadSceneAssetsAsync} loads: a scene's, or a part
 * of one (a streaming cell's assets, p353 Phase 3).
 * @internal
 */
export type SceneAssetLists = Pick<
  SceneData,
  'textures' | 'materials' | 'geometries' | 'importedAssets'
>;

/**
 * The lights and meshes of a scene's data that {@link createSceneObject3Ds} creates.
 * @internal
 */
export type SceneObject3DLists = Pick<SceneData, 'lights' | 'meshes'>;

/** Runs `fn` in an owner scope when `owner` is given, else as it is (the loading scene owns) */
type Owned = <T>(fn: () => T) => T;

const createOwned =
  (owner: string | undefined): Owned =>
  (fn) =>
    owner === undefined ? fn() : runInAssetOwnerScope(owner, fn);

/** Imports a scene's imported assets into `importedAssets`, and re-tags the ones it names by id.
 * The import registry (the glTF import path) loads here, only for a scene that names an import
 * (p613 D4): a scene, or an app, without one never loads it. */
const loadSceneImportsAsync = async (
  assets: SceneData['importedAssets'],
  importedAssets: ScenePrimitiveAssets['importedAssets'],
  owned: Owned
) => {
  if (!assets?.length) return;
  const registry = await import('../assets/import/ImportRegistry');
  const importPromises: Promise<ImportedAssetManifest | null>[] = [];
  for (const asset of assets) {
    if (typeof asset === 'string') {
      owned(() => registry.retagImportedAsset(asset));
      const manifest = registry.getImportedAsset(asset);
      if (manifest) importedAssets[asset] = manifest;
      continue;
    }
    // The import captures the owner scope at its call (registered after its awaits)
    importPromises.push(owned(() => registry.importAssetAsync(asset)));
  }
  for (const manifest of await Promise.all(importPromises)) {
    if (manifest) importedAssets[manifest.id] = manifest;
  }
};

type SceneMaterialDef = Exclude<NonNullable<SceneData['materials']>[number], string>;

/** A copy of a material's params with its texture ids resolved to the scene's textures (or the
 * registered ones). Never resolved in place: the generated scene data is cached, so a revisit
 * would see the previous visit's texture objects, which its release may have disposed. */
const resolveTextureParams = (
  params: SceneMaterialDef['params'],
  textures: ScenePrimitiveAssets['textures']
): SceneMaterialDef['params'] => {
  const resolved: Record<string, unknown> = { ...params };
  for (const texKey of textureMapKeys) {
    const texRef = resolved[texKey];
    if (typeof texRef !== 'string') continue;
    const texture = textures[texRef] || getTexture(texRef);
    if (!texture) {
      lwarn(`Could not find texture with id "${texRef}" in loadNextSceneAssets.`);
      continue;
    }
    resolved[texKey] = texture;
  }
  return resolved as SceneMaterialDef['params'];
};

/**
 * Loads a scene's assets from its data before its code runs (`loadSceneAssetsAsync` with the
 * loading scene as their owner).
 * @internal
 * @returns what the scene's code gets as `assets`
 */
export const loadNextSceneAssets = (sceneData: SceneData): Promise<ScenePrimitiveAssets> =>
  loadSceneAssetsAsync(sceneData);

/**
 * Loads asset lists of a scene's data: the textures, imported assets and TSL material files in
 * parallel, then the materials (with their texture ids resolved) and the geometries, the `MERGED`
 * ones last (their parts can be the others, or imported pieces). The ones
 * named by id are taken from the registries and re-tagged. Their owner is `ownerKey` when it's
 * given (a streaming cell's, `getCellOwnerKey`), for every registration, also those after the
 * loads' awaits; else the loading or current scene.
 * @internal
 * @returns the loaded assets by id
 */
export const loadSceneAssetsAsync = async (
  sceneData: SceneAssetLists,
  ownerKey?: string
): Promise<ScenePrimitiveAssets> => {
  const owned = createOwned(ownerKey);
  const textures: ScenePrimitiveAssets['textures'] = {};
  const materials: ScenePrimitiveAssets['materials'] = {};
  const geometries: ScenePrimitiveAssets['geometries'] = {};
  const importedAssets: ScenePrimitiveAssets['importedAssets'] = {};

  // Load textures, imported assets and the materials' TSL files (in parallel): materials can use
  // the textures and meshes the imported geometries (by id). Assets referenced by id are re-tagged
  // to this scene (AssetOwners), so leaving the scene that loaded them doesn't release them.
  const sceneTextures = sceneData.textures || [];
  const texturePromises: Promise<THREE.Texture>[] = [];
  const textureIds: string[] = [];
  for (let i = 0; i < sceneTextures.length; i++) {
    const tex = sceneTextures[i];
    if (typeof tex === 'string') {
      const texture = getTexture(tex);
      if (texture) owned(() => retagAssetOwner(texture));
      continue;
    }
    const texId = tex.id;
    if (!texId) continue;
    textureIds.push(texId);
    // The load captures the owner scope at its call
    texturePromises.push(owned(() => loadTextureAsync(tex)));
  }
  // The TSL files load on demand (p607 D11): createMaterial reads them synchronously
  const tslFilePromises: Promise<boolean>[] = [];
  for (const material of sceneData.materials || []) {
    if (typeof material === 'string' || !('tslFile' in material) || !material.tslFile) continue;
    tslFilePromises.push(loadTslMaterialFileAsync(material.tslMaterialId || material.id || ''));
  }
  const [loadedTextures] = await Promise.all([
    Promise.all(texturePromises),
    loadSceneImportsAsync(sceneData.importedAssets, importedAssets, owned),
    Promise.all(tslFilePromises),
  ]);
  for (let i = 0; i < loadedTextures.length; i++) {
    textures[textureIds[i]] = loadedTextures[i];
  }

  // Create materials
  const sceneMaterials = sceneData.materials || [];
  for (let i = 0; i < sceneMaterials.length; i++) {
    const material = sceneMaterials[i];
    if (typeof material === 'string') {
      const mat = getMaterial(material);
      if (mat) {
        owned(() => retagAssetOwner(mat));
        materials[material] = mat;
      }
      continue;
    }
    const params = resolveTextureParams(material.params, textures);
    const mat = owned(() => createMaterial({ ...material, params }));
    if (mat) materials[material.id || `material-${i}`] = mat;
  }

  // Create geometries: the MERGED ones last, since their parts can be the others
  const sceneGeometries = sceneData.geometries || [];
  const merged: { props: MergedGeoProps; key: string }[] = [];
  for (let i = 0; i < sceneGeometries.length; i++) {
    const geometry = sceneGeometries[i];
    if (typeof geometry === 'string') {
      const geo = getGeometry(geometry);
      if (geo) {
        owned(() => retagAssetOwner(geo));
        geometries[geometry] = geo;
      }
      continue;
    }
    if (geometry.type === 'MERGED') {
      merged.push({ props: geometry, key: geometry.id || `geometry-${i}` });
      continue;
    }
    const geo = owned(() => createGeometry({ ...geometry }));
    if (geo) geometries[geometry.id || `geometry-${i}`] = geo;
  }
  if (merged.length) await registerMergedGeometriesAsync(merged, geometries, owned);

  return { textures, materials, geometries, importedAssets };
};

/** Registers a scene's MERGED geometries from their parts (p371 D2), in the assets worker
 * (`AppConfig.assets.mergeWorkerTarget`, D4), all at once: a part is never another MERGED one.
 * The merge code loads here, on the first one: an app without one never loads it. Each merge
 * captures the owner scope at its call, so it registers in it after its await. A merge that
 * fails (a part not registered, a morphed or skinned one) is logged and left out, so a mesh using
 * it is skipped as for any missing geometry. The parts are only read: the merge takes no ref on
 * them, so they stay with whatever loaded them and are released with it. */
const registerMergedGeometriesAsync = async (
  merged: { props: MergedGeoProps; key: string }[],
  geometries: ScenePrimitiveAssets['geometries'],
  owned: Owned
) => {
  const { registerMergedGeoPropsAsync } = await import('../assets/GeometryMerge');
  await Promise.all(
    merged.map(({ props, key }) =>
      owned(() => registerMergedGeoPropsAsync(props)).then(
        (geometry) => {
          geometries[key] = geometry;
        },
        (err: unknown) => lerror(`Could not merge geometry "${key}" in loadNextSceneAssets.`, err)
      )
    )
  );
};

/**
 * Creates a scene's JSON lights and meshes, once its code has run and it's current.
 * @internal
 */
export const createNextSceneObject3Ds = (sceneData: SceneData) => {
  createSceneObject3Ds(sceneData);
};

/**
 * Creates the lights and meshes of a scene's data (a scene's, or a streaming cell's), lights
 * first, in the default world. A mesh whose geometry or material id isn't registered is skipped
 * with an error.
 * @internal
 * @returns the created entities' ids, in creation order
 */
export const createSceneObject3Ds = (sceneData: SceneObject3DLists): number[] => {
  const entityIds: number[] = [];
  // Create lights
  const lightProps = sceneData.lights || [];
  for (let i = 0; i < lightProps.length; i++) {
    const props = lightProps[i];
    if (typeof props === 'string') continue;
    entityIds.push(createLightEntity(props.lightProps, props.entityOpts));
  }

  // Create meshes
  const meshProps = sceneData.meshes || [];
  for (let i = 0; i < meshProps.length; i++) {
    const props = meshProps[i];
    if (typeof props === 'string') continue;
    // Resolve into locals, never write back: the generated scene data is cached, and a revisit
    // would otherwise reuse the previous visit's released (disposed) geometry/material objects
    let geo = props.props.geo;
    if (typeof geo === 'string') {
      const foundGeo = getGeometry(geo);
      if (!foundGeo) {
        lerror(
          `Could not find geometry with id "${geo}" for mesh "${props.props.appId || props.entityOpts?.appId}" in createNextSceneObject3Ds. Mesh not created.`
        );
        continue;
      }
      geo = foundGeo;
    }
    let mat = props.props.mat;
    if (typeof mat === 'string') {
      const foundMat = getMaterial(mat);
      if (!foundMat) {
        lerror(
          `Could not find material with id "${mat}" for "${props.props.appId || props.entityOpts?.appId}" mesh in createNextSceneObject3Ds. Mesh not created.`
        );
        continue;
      }
      mat = foundMat;
    }
    entityIds.push(createMeshEntity({ ...props.props, geo, mat }, props.entityOpts));
  }
  return entityIds;
};
