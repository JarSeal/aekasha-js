/**
 * The scene pass's lists: each id a scene lists is replaced by its asset's data with the scene's
 * save entry over it (a production build without its debug data). An id no asset JSON has fails
 * the gather (p619 G12); inline entries are kept as they are.
 */
import {
  applySkyBoxSaveEntry,
  getAtlasSlotTextureId,
  type ImpostorDef,
  type MaterialAsset,
} from '../../src/_engine/schemas';
import {
  getImpostorDefSlots,
  IMPOSTOR_EXPORT_FORMAT_VERSION,
} from '../../src/_engine/features/lod/impostors/ImpostorFormat';
import { mergeSkyBoxPreset } from '../../src/_engine/features/skybox/Presets';
import type { GatherContext, Registries } from './context';
import { EngineMeshAssetSchema, type EngineSceneAsset } from './engineSchemas';
import { getSaveEntry } from './saveEntries';
import type { ShipChecks } from './shipChecks';
import { getSourceFileSize, setGeneratedFields } from './sources';

/** A scene as the scene pass resolves it: its JSON with its own save entry */
export type SceneJSON = Omit<EngineSceneAsset, '$schema' | '__saveData'>;

/** One scene's resolution */
export type SceneRun = {
  ctx: GatherContext;
  reg: Registries;
  ship: ShipChecks;
  sceneId: string;
  scene: SceneJSON;
  /** Logs an id no asset JSON has, fails the gather, and keeps the id */
  reportUnknownId: (kind: string, id: string) => string;
};

// If the scene has no camera, a temp camera is created (every scene needs a camera)
const getAutoCamera = (isProduction: boolean) => ({
  camProps: { type: 'PERSPECTIVE' as const, fov: 90, active: true },
  ...(isProduction
    ? {}
    : {
        entityOpts: {
          debugData: { name: '_camera', description: 'Auto-generated camera for the scene' },
        },
      }),
});

const resolveCameras = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (Array.isArray(scene.cameras)) {
    scene.cameras = scene.cameras.map((camId) => {
      if (typeof camId !== 'string') return camId;
      const camera = reg.cameras[camId];
      if (!camera) return reportUnknownId('camera', camId);
      const entityOpts = camera.entityOpts;
      if (ctx.isProduction && entityOpts) delete entityOpts.debugData;
      return { camProps: { ...camera.camProps, ...getSaveEntry(camera, sceneId) }, entityOpts };
    });
  }
  if (!scene.cameras?.length) scene.cameras = [getAutoCamera(ctx.isProduction)];
};

const resolveLights = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.lights)) return;
  scene.lights = scene.lights.map((lightId) => {
    if (typeof lightId !== 'string') return lightId;
    const light = reg.lights[lightId];
    if (!light) return reportUnknownId('light', lightId);
    const entityOpts = light.entityOpts;
    if (ctx.isProduction && entityOpts) delete entityOpts.debugData;
    return { lightProps: { ...light.lightProps, ...getSaveEntry(light, sceneId) }, entityOpts };
  });
};

const resolveGeometries = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.geometries)) return;
  scene.geometries = scene.geometries.map((geoId) => {
    if (typeof geoId !== 'string') return geoId;
    const geo = reg.geometries[geoId];
    if (!geo) return reportUnknownId('geometry', geoId);
    const entry = getSaveEntry(geo, sceneId);
    if (ctx.isProduction) delete geo.geoProps.debugData;
    return {
      id: geoId,
      type: geo.geoProps.type,
      params: { ...geo.geoProps.params, ...entry?.params },
      ...(geo.geoProps.debugData
        ? { debugData: { ...geo.geoProps.debugData, ...entry?.debugData } }
        : {}),
    };
  });
};

// Impostors (p351 Phase 4): the definitions (a production build keeps only the scenes), and
// their atlases' slots go into the scene's textures, so the loader loads them like any texture.
// One not found is left out: its generator call bakes as without an export.
const resolveImpostors = ({ ctx, reg, sceneId, scene }: SceneRun) => {
  if (!Array.isArray(scene.impostors)) return;
  const impostorDefs: ImpostorDef[] = [];
  const impostorSlotIds: string[] = [];
  for (const impostorId of scene.impostors) {
    const impostor = reg.impostors[impostorId];
    if (!impostor) {
      ctx.log.warn(
        `Scene "${sceneId}" lists the impostor "${impostorId}", which has no *.impostor.json (or an invalid one): it bakes at load.`
      );
      continue;
    }
    // The runtime would refuse it and bake: its slots would load for nothing (warned in pass 1)
    if (impostor.formatVersion !== IMPOSTOR_EXPORT_FORMAT_VERSION) continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- build time only
    const { $schema, __sourcePath, ...def } = impostor;
    if (ctx.isProduction) delete def.debugData;
    impostorDefs.push({ ...def, id: impostorId });
    // The slots it reads (the atlas id would load every slot), all checked in pass 1
    for (const slot of getImpostorDefSlots(impostor)) {
      impostorSlotIds.push(getAtlasSlotTextureId(impostor.atlas, slot));
    }
  }
  // The generated data's shape: the definitions in place of the ids
  scene.impostors = impostorDefs as unknown as string[];
  if (impostorSlotIds.length) scene.textures = [...(scene.textures ?? []), ...impostorSlotIds];
};

/** A scene's texture list with each atlas id replaced by its slots' ids; a slot listed twice
 * (by the atlas id and its own) is kept once */
const expandAtlasIds = (reg: Registries, listed: NonNullable<SceneJSON['textures']>) => {
  const listedSlotIds = new Set<string>();
  return listed.flatMap((texId): typeof listed => {
    if (typeof texId !== 'string') return [texId];
    const slotIds = reg.atlasSlotIds[texId] ?? (reg.atlasSlots[texId] ? [texId] : null);
    if (!slotIds) return [texId];
    const unlisted = slotIds.filter((slotId) => !listedSlotIds.has(slotId));
    for (const slotId of unlisted) listedSlotIds.add(slotId);
    return unlisted;
  });
};

const resolveTextures = (run: SceneRun) => {
  const { ctx, reg, ship, sceneId, scene, reportUnknownId } = run;
  if (!Array.isArray(scene.textures)) return;
  scene.textures = expandAtlasIds(reg, scene.textures).map((texId) => {
    if (typeof texId !== 'string') return texId;
    const texture = reg.textures[texId];
    if (texture) {
      const jsonFile = texture.__sourcePath || '';
      const texData = { ...texture, ...getSaveEntry(texture, sceneId) };
      if (ctx.isProduction) delete texData.debugData;
      // A per-scene override can point at another file
      texData.__fileSize = getSourceFileSize(jsonFile, texData.fileName, texData.path);
      setGeneratedFields(ctx, texData, 'texture', jsonFile);
      ship.checkAsset(texData, 'texture', jsonFile, sceneId);
      delete texData.optimize; // Build time only (p300)
      delete texData.pack;
      delete texData.__sourcePath;
      delete texData.__saveData;
      return texData;
    }
    if (reg.textureArrays[texId]) {
      // Build time only: the runtime loads the encoded array (its generated fields, from the
      // registry entry: an array has no scene entries)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- build time only
      const { layers, size, optimize, __sourcePath, ...arrayData } = reg.textureArrays[texId];
      ship.checkArray(__sourcePath || '', sceneId);
      if (ctx.isProduction) delete arrayData.debugData;
      return arrayData;
    }
    if (reg.atlasSlots[texId]) {
      // Its generated fields and cell table come with it, like an array's
      const { __sourcePath, ...slotData } = reg.atlasSlots[texId];
      ship.checkAtlasSlot(__sourcePath || '', slotData.__atlas.slot, sceneId);
      if (ctx.isProduction) delete slotData.debugData;
      return slotData;
    }
    return reportUnknownId('texture', texId);
  });
};

type MaterialFields = { params?: object; nodes?: Record<string, object> };

/** A material's props with save entry props over them: `params` merged key by key, and each of
 * the material's own `nodes` (a TSL material's) too */
const mergeMaterialProps = <M extends MaterialFields>(base: M, entry: MaterialFields = {}): M => {
  const nodeKeys = base.nodes ? Object.keys(base.nodes) : [];
  const nodes = Object.fromEntries(
    nodeKeys.map((key) => [key, { ...base.nodes?.[key], ...entry.nodes?.[key] }])
  );
  return {
    ...base,
    ...entry,
    // Only a material with nodes (a TSL one) gets them, not an empty object (G6)
    ...(nodeKeys.length ? { nodes } : {}),
    ...('params' in base ? { params: { ...base.params, ...entry.params } } : {}),
  };
};

const resolveMaterials = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.materials)) return;
  scene.materials = scene.materials.map((matId) => {
    if (typeof matId !== 'string') return matId;
    const material = reg.materials[matId];
    if (!material) return reportUnknownId('material', matId);
    const matData = {
      ...mergeMaterialProps<MaterialFields>(material, getSaveEntry(material, sceneId)),
      id: matId,
      type: material.type,
    } as MaterialAsset;
    if (ctx.isProduction) delete matData.debugData;
    delete matData.__sourcePath;
    delete matData.__saveData;
    return matData;
  });
};

type GeoOrMat = { type?: string; params?: object };

/**
 * A mesh's `geo` or `mat` with its save entry's over it (p619 G13). Props over props of the
 * same type merge (`params` key by key, a material's `nodes` too); an id, or props of another
 * type, replace it whole.
 */
const mergeGeoOrMat = <V>(base: V, entry: V | undefined, isMaterial: boolean): V => {
  if (entry === undefined) return base;
  if (typeof base !== 'object' || typeof entry !== 'object' || !base || !entry) return entry;
  const [from, over] = [base as GeoOrMat, entry as GeoOrMat];
  if (over.type !== undefined && over.type !== from.type) return entry;
  if (isMaterial) return mergeMaterialProps(from, over) as V;
  return {
    ...from,
    ...over,
    ...('params' in from || 'params' in over ? { params: { ...from.params, ...over.params } } : {}),
  } as V;
};

const resolveMeshes = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.meshes)) return;
  scene.meshes = scene.meshes.map((meshId) => {
    if (typeof meshId !== 'string') return meshId;
    const mesh = reg.meshes[meshId];
    if (!mesh) return reportUnknownId('mesh', meshId);
    const entry = getSaveEntry(mesh, sceneId);
    if (ctx.isProduction && mesh.entityOpts?.debugData) delete mesh.entityOpts.debugData;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- build time only
    const { __sourcePath, __saveData, ...meshData } = {
      ...mesh,
      props: {
        ...mesh.props,
        ...entry,
        // Typed as the mesh's own: the result is validated below
        geo: mergeGeoOrMat(mesh.props.geo, entry?.geo as typeof mesh.props.geo, false),
        mat: mergeGeoOrMat(mesh.props.mat, entry?.mat as typeof mesh.props.mat, true),
      },
    };
    // An entry's partial props over an id, or a field it broke, fail as the mesh JSON would
    const validation = entry && EngineMeshAssetSchema.shape.props.safeParse(meshData.props);
    if (validation && !validation.success) {
      ctx.log.validationError(
        `Scene "${sceneId}": mesh "${meshId}" with its save entry (${mesh.__sourcePath})`,
        validation.error.issues
      );
    }
    return meshData;
  });
};

const resolveImportedAssets = (run: SceneRun) => {
  const { ctx, reg, ship, sceneId, scene, reportUnknownId } = run;
  if (!Array.isArray(scene.importedAssets)) return;
  scene.importedAssets = scene.importedAssets.map((importId) => {
    if (typeof importId !== 'string') return importId;
    const asset = reg.importedAssets[importId];
    if (!asset) return reportUnknownId('imported asset', importId);
    const jsonFile = asset.__sourcePath || '';
    const importData = { ...asset, ...getSaveEntry(asset, sceneId), id: importId };
    if (ctx.isProduction) delete importData.debugData;
    importData.__fileSize = getSourceFileSize(jsonFile, importData.fileName);
    setGeneratedFields(ctx, importData, 'importedAsset', jsonFile);
    ship.checkAsset(importData, 'importedAsset', jsonFile, sceneId);
    delete importData.optimize; // Build time only (p300)
    delete importData.__sourcePath;
    delete importData.__saveData;
    return importData;
  });
};

// The definition with this scene's latest save entry deep-merged over it (inline ones too)
const resolveSkyBoxes = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.skyboxes)) return;
  scene.skyboxes = scene.skyboxes.map((skyIdOrInline) => {
    const sky =
      typeof skyIdOrInline === 'string'
        ? reg.skyboxes[skyIdOrInline]
        : mergeSkyBoxPreset(skyIdOrInline);
    if (!sky) return reportUnknownId('sky box', skyIdOrInline as string);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- build time only
    const { $schema, __sourcePath, __saveData, ...def } = sky;
    const skyData = applySkyBoxSaveEntry(def, __saveData?.[sceneId]?.[0]);
    if (ctx.isProduction) delete skyData.debugData;
    return skyData;
  });
};

// The order is kept: it is the execution order
const resolvePostFx = ({ ctx, reg, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.postFx)) return;
  scene.postFx = scene.postFx.map((postFxId) => {
    if (typeof postFxId !== 'string') return postFxId;
    const postFx = reg.postFx[postFxId];
    if (!postFx) return reportUnknownId('PostFX pass', postFxId);
    const entry = getSaveEntry(postFx, sceneId);
    const postFxData = {
      ...postFx,
      ...entry,
      params: { ...postFx.params, ...entry?.params },
      id: postFxId,
    };
    if (ctx.isProduction) delete postFxData.debugData;
    delete postFxData.__sourcePath;
    delete postFxData.__saveData;
    return postFxData;
  });
};

/** Resolves every list of a scene, in the scene pass's order (impostors before textures: they
 * add their atlas slots) */
export const resolveSceneAssets = (run: SceneRun) => {
  resolveCameras(run);
  resolveLights(run);
  resolveGeometries(run);
  resolveImpostors(run);
  resolveTextures(run);
  resolveMaterials(run);
  resolveMeshes(run);
  resolveImportedAssets(run);
  resolveSkyBoxes(run);
  resolvePostFx(run);
};
