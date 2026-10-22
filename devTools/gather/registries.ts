/**
 * Pass 1: every asset JSON read, validated and registered by id (textures, arrays, atlases and
 * impostors in `textures.ts`). The scene pass resolves the scenes' lists against the registries.
 */
import {
  CameraAssetSchema,
  GeoAssetSchema,
  ImportedAssetSchema,
  LightAssetSchema,
  MaterialAssetSchema,
  PostFxAssetSchema,
  SkyBoxAssetSchema,
  type SkyBoxAsset,
} from '../../src/_engine/schemas';
import {
  isLegacySkyBoxProps,
  LEGACY_SKYBOX_WARNING,
} from '../../src/_engine/features/skybox/LegacySkyBox';
import { mergeSkyBoxPreset } from '../../src/_engine/features/skybox/Presets';
import {
  claimIds,
  createRegistries,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { EngineMeshAssetSchema, EngineSceneAssetSchema } from './engineSchemas';
import { getIdFromFileName, withSkyBoxIdDefault } from './gatheredJson';
import { getSaveEntry } from './saveEntries';
import {
  checkAssetSources,
  getSourceFileSize,
  getTopFolder,
  resolveCodeFile,
  setGeneratedFields,
} from './sources';
import { readTextureAssets } from './textures';

/** Warns (doesn't fail) about a sky box in the legacy `{ type, params }` shape: the schema still
 * converts it, but it should be migrated to the layered one. Goes in engine 6.0.0 with the shape. */
const warnOnLegacySkyBox = (ctx: GatherContext, file: string, data: unknown) => {
  if (!isLegacySkyBoxProps(data)) return;
  const skyAndSunNote =
    data.type === 'SKYANDSUN'
      ? ' The SKYANDSUN type is now the atmosphere layer, so it becomes a COLOR base.'
      : '';
  ctx.log.warn(`Sky box "${data.id}" in ${file}: ${LEGACY_SKYBOX_WARNING}.${skyAndSunNote}`);
};

/** The material and PostFX ids the shipped scenes list: their TSL files get loaders (a
 * production build leaves the debug scenes out, and their files with them, p619 G6) */
type ShippedLists = { materials: Set<string>; postFx: Set<string> };

const readScenes = (ctx: GatherContext, reg: Registries, taken: TakenIds): ShippedLists => {
  const shipped: ShippedLists = { materials: new Set(), postFx: new Set() };
  const prepare = (parsed: unknown, file: string) => {
    const skyboxes = (parsed as { skyboxes?: unknown } | null)?.skyboxes;
    if (Array.isArray(skyboxes)) for (const sky of skyboxes) warnOnLegacySkyBox(ctx, file, sky);
    return parsed;
  };
  readAssetJsons(
    ctx,
    'scene',
    EngineSceneAssetSchema,
    (data, file) => {
      const id = data.id || getIdFromFileName(file.file, 'scene');
      if (!claimIds(ctx, taken.scenes, 'scene', file.file, id)) return;
      reg.scenes.push({ id, data, file });
      const scene = { ...data, ...getSaveEntry(data, id) };
      if (!scene.sceneFile || (ctx.isProduction && scene.isDebugScene)) return;
      for (const matId of scene.materials ?? []) {
        if (typeof matId === 'string') shipped.materials.add(matId);
      }
      for (const postFxId of scene.postFx ?? []) {
        if (typeof postFxId === 'string') shipped.postFx.add(postFxId);
      }
    },
    { prepare }
  );
  return shipped;
};

const readCameras = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'camera', CameraAssetSchema, (cameraJSON, { file, sourcePath }) => {
    const cameraId =
      cameraJSON.camProps?.appId ||
      cameraJSON.entityOpts?.appId ||
      getIdFromFileName(file, 'camera');
    if (!claimIds(ctx, taken.cameras, 'camera', file, cameraId)) return;
    cameraJSON.camProps.appId = cameraId;
    cameraJSON.__sourcePath = sourcePath;
    delete cameraJSON.$schema;
    reg.cameras[cameraId] = cameraJSON;
  });

const readLights = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'light', LightAssetSchema, (lightJSON, { file, sourcePath }) => {
    const lightId =
      lightJSON.lightProps?.appId ||
      lightJSON.entityOpts?.appId ||
      getIdFromFileName(file, 'light');
    if (!claimIds(ctx, taken.lights, 'light', file, lightId)) return;
    lightJSON.lightProps.appId = lightId;
    lightJSON.__sourcePath = sourcePath;
    delete lightJSON.$schema;
    reg.lights[lightId] = lightJSON;
  });

const readGeometries = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'geometry', GeoAssetSchema, (geoJSON, { file, sourcePath }) => {
    const geoId = geoJSON.geoProps.id || getIdFromFileName(file, 'geometry');
    if (!claimIds(ctx, taken.geometries, 'geometry', file, geoId)) return;
    geoJSON.geoProps.id = geoId;
    geoJSON.__sourcePath = sourcePath;
    delete geoJSON.$schema;
    reg.geometries[geoId] = geoJSON;
  });

/**
 * A TSL file's loader (p607 D11), as a path from `srcDir`: resolved from the JSON's first folder
 * under it. Logs a missing file.
 * @returns the path, or null when the file is missing
 */
const getTslLoader = (ctx: GatherContext, kind: string, fullPath: string, tslFile: string) => {
  const folder = getTopFolder(ctx.srcDir, fullPath);
  const resolved = resolveCodeFile(`${ctx.srcDir}/${folder}`, tslFile);
  if (typeof resolved !== 'string') {
    ctx.log.error(
      `Error gathering ${kind} data: specified tslFile "${tslFile}" does not exist on disk.\n  └─ Expected path: ${resolved.missing}`
    );
    return null;
  }
  return `${folder}/${tslFile}`;
};

const readMaterials = (
  ctx: GatherContext,
  reg: Registries,
  taken: TakenIds,
  shipped: ShippedLists
) =>
  readAssetJsons(
    ctx,
    'material',
    MaterialAssetSchema,
    (matJSON, { file, fullPath, sourcePath }) => {
      const matId = matJSON.id || getIdFromFileName(file, 'material');
      if (!claimIds(ctx, taken.materials, 'material', file, matId)) return;
      matJSON.id = matId;
      matJSON.__sourcePath = sourcePath;
      delete matJSON.$schema;
      reg.materials[matId] = matJSON;
      if (!('tslFile' in matJSON) || !matJSON.tslFile) return;
      if (ctx.isProduction && !shipped.materials.has(matId)) return;
      // Loaded on demand: the scene loader loads its materials' files, and createMaterial reads the
      // node functions (the JSON's `nodes` keys) from the module
      const loader = getTslLoader(ctx, 'material', fullPath, matJSON.tslFile);
      if (loader) reg.loaders.tslMaterials[matId] = loader;
    }
  );

const readMeshes = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'mesh', EngineMeshAssetSchema, (meshJSON, { file, sourcePath }) => {
    const meshId =
      meshJSON.props.appId || meshJSON.entityOpts?.appId || getIdFromFileName(file, 'mesh');
    if (!claimIds(ctx, taken.meshes, 'mesh', file, meshId)) return;
    meshJSON.props.appId = meshId;
    meshJSON.__sourcePath = sourcePath;
    delete meshJSON.$schema;
    reg.meshes[meshId] = meshJSON;
  });

const readImportedAssets = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(
    ctx,
    'importedAsset',
    ImportedAssetSchema,
    (importedAssetJSON, { file, fullPath, sourcePath }) => {
      if (!checkAssetSources(ctx, file, fullPath, importedAssetJSON)) return;
      const id = importedAssetJSON.id || getIdFromFileName(file, 'importedAsset');
      if (!claimIds(ctx, taken.importedAssets, 'imported asset', file, id)) return;
      importedAssetJSON.id = id;
      importedAssetJSON.__sourcePath = sourcePath;
      importedAssetJSON.__fileSize = getSourceFileSize(fullPath, importedAssetJSON.fileName);
      setGeneratedFields(ctx, importedAssetJSON, 'importedAsset', fullPath);
      delete importedAssetJSON.$schema;
      reg.importedAssets[id] = importedAssetJSON;
    }
  );

const readSkyBoxes = (ctx: GatherContext, reg: Registries, taken: TakenIds) => {
  // The id defaults to the file name (set before validating: the schema requires one)
  const prepare = (parsed: unknown, file: string) => {
    const withId = withSkyBoxIdDefault(file, parsed);
    warnOnLegacySkyBox(ctx, file, withId);
    return withId;
  };
  readAssetJsons(
    ctx,
    'skybox',
    SkyBoxAssetSchema,
    (data, { file, sourcePath }) => {
      // The runtime only sees plain definitions: the preset is merged in here
      const skyJSON: SkyBoxAsset = mergeSkyBoxPreset(data);
      if (!claimIds(ctx, taken.skyboxes, 'skybox', file, skyJSON.id)) return;
      skyJSON.__sourcePath = sourcePath;
      delete skyJSON.$schema;
      reg.skyboxes[skyJSON.id] = skyJSON;
    },
    { prepare }
  );
};

const readPostFx = (ctx: GatherContext, reg: Registries, taken: TakenIds, shipped: ShippedLists) =>
  readAssetJsons(ctx, 'postFx', PostFxAssetSchema, (postFxJSON, { file, fullPath, sourcePath }) => {
    const postFxId = postFxJSON.id || getIdFromFileName(file, 'postFx');
    if (!claimIds(ctx, taken.postFx, 'PostFX pass', file, postFxId)) return;
    postFxJSON.id = postFxId;
    postFxJSON.__sourcePath = sourcePath;
    delete postFxJSON.$schema;
    reg.postFx[postFxId] = postFxJSON;
    if (ctx.isProduction && !shipped.postFx.has(postFxId)) return;
    // Loaded on demand: the PostFX feature loads a scene's chain's files before it builds it
    const loader = getTslLoader(ctx, 'PostFX', fullPath, postFxJSON.tslFile);
    if (loader) reg.loaders.postFx[postFxId] = loader;
  });

/** Pass 1: every asset JSON registered, in the order each type reads the ones before it */
export const readRegistries = (ctx: GatherContext): Registries => {
  const { registries: reg, taken } = createRegistries();
  const shipped = readScenes(ctx, reg, taken);
  readCameras(ctx, reg, taken);
  readLights(ctx, reg, taken);
  readGeometries(ctx, reg, taken);
  readTextureAssets(ctx, reg, taken);
  readMaterials(ctx, reg, taken, shipped);
  readMeshes(ctx, reg, taken);
  readImportedAssets(ctx, reg, taken);
  readSkyBoxes(ctx, reg, taken);
  readPostFx(ctx, reg, taken, shipped);
  return reg;
};
