/**
 * The scene pass: each registered scene with its own save entry, its scene file checked, its
 * lists resolved, and its feature manifest. A production build leaves the debug scenes out, and
 * their names, descriptions and notes.
 */
import path from 'path';
import type { StreamingManifest } from '../../src/_engine/schemas';
import type { GatherContext, GatheredScene, Registries } from './context';
import { getSceneFeatureIds } from './engineSchemas';
import { applySceneSaveEntry, getSaveEntry } from './saveEntries';
import { resolveSceneAssets, type SceneJSON } from './sceneAssets';
import type { ShipChecks } from './shipChecks';
import { getTopFolder, resolveCodeFile } from './sources';
import { buildStreamingManifest } from './streamingManifest';
import { getScatterFeatureIds } from './scatters';
import { getTerrainBlockFeatureIds } from './terrainBlocks';
import { getListedTextureSetTextureIds } from './textureSets';

/** A scene's inline cameras', lights', sky boxes' and fogs' ids, by list (development data only) */
export type InlineAssetIds = {
  cameras?: string[];
  lights?: string[];
  skyboxes?: string[];
  fogs?: string[];
};

/** A resolved scene, with the features its data needs (p607 D10) */
export type ResolvedScene = SceneJSON & {
  __inlineAssets?: InlineAssetIds;
  __features: string[];
  __streaming?: StreamingManifest;
};

/** The scene pass's result */
export type SceneOutput = {
  /** The shipped scenes by id, in the walk's order */
  scenes: Record<string, ResolvedScene>;
  /** Left out of a production build, and of every profile (p611 D7) */
  debugSceneIds: Set<string>;
};

/** An inline camera's or light's id: its props' app id, else its entity's */
const getInlineAppId = (
  props: { appId?: string } | undefined,
  entityOpts: { appId?: string } | undefined
) => props?.appId || entityOpts?.appId;

/**
 * The ids of the cameras, lights, sky boxes and fogs written inline in a scene JSON (objects, not ids),
 * which the debugger's save moves into files of their own (p355 §2.6): the development data's
 * `__inlineAssets`, so it can tell them from assets listed by id (both resolve to objects). A list
 * the scene's save entry replaces has none (its items aren't in the file's own list), and an
 * inline one without an id isn't named.
 */
const getInlineAssetIds = ({ id: sceneId, data }: GatheredScene): InlineAssetIds | undefined => {
  const entry = getSaveEntry(data, sceneId);
  const ownList = <T>(list: keyof InlineAssetIds, items: T[] | undefined) =>
    entry && list in entry ? [] : items ?? [];
  const ids: InlineAssetIds = {};
  const add = (list: keyof InlineAssetIds, listIds: (string | undefined)[]) => {
    const named = listIds.filter((id): id is string => !!id);
    if (named.length) ids[list] = named;
  };
  add(
    'cameras',
    ownList('cameras', data.cameras).map((cam) =>
      typeof cam === 'string' ? undefined : getInlineAppId(cam.camProps, cam.entityOpts)
    )
  );
  add(
    'lights',
    ownList('lights', data.lights).map((light) =>
      typeof light === 'string' ? undefined : getInlineAppId(light.lightProps, light.entityOpts)
    )
  );
  add(
    'skyboxes',
    ownList('skyboxes', data.skyboxes).map((sky) => (typeof sky === 'string' ? undefined : sky.id))
  );
  add(
    'fogs',
    ownList('fogs', data.fogs).map((fog) => (typeof fog === 'string' ? undefined : fog.id))
  );
  return Object.keys(ids).length ? ids : undefined;
};

/**
 * One scene resolved.
 * @returns null when it isn't shipped: a scene file problem (logged), or a production build's
 * debug scene
 */
const resolveScene = (
  ctx: GatherContext,
  reg: Registries,
  ship: ShipChecks,
  gathered: GatheredScene,
  debugSceneIds: Set<string>
): ResolvedScene | null => {
  const { id: sceneId, data, file } = gathered;
  // The scene's own latest save entry (G5); the output has no __saveData
  const { $schema, __saveData, ...scene } = applySceneSaveEntry(data, sceneId);
  scene.id = sceneId;
  // The debugger's saves write the scene's entries into its file (p355 §2.5); production drops it
  scene.__sourcePath = file.sourcePath;

  if (!scene.sceneFile) {
    ctx.log.error(
      `Error gathering scene data (${ctx.isProduction ? 'production' : 'development'}): missing 'sceneFile' property and/or value (required) for scene file ${file.fullPath}.`
    );
    return null;
  }
  const sceneFile = resolveCodeFile(path.join(ctx.srcDir, 'app'), scene.sceneFile);
  if (typeof sceneFile !== 'string') {
    ctx.log.error(
      `Error gathering scene data: the specified sceneFile "${scene.sceneFile}" does not exist on disk.\n  └─ Expected path: ${sceneFile.missing}`
    );
    return null;
  }

  if (scene.isDebugScene) debugSceneIds.add(sceneId);
  if (ctx.isProduction && scene.isDebugScene) return null;

  reg.loaders.scenes[sceneId] = `${getTopFolder(ctx.srcDir, file.fullPath)}/${scene.sceneFile}`;
  // The sets the scene lists for its code, before the scene pass writes their data in their place
  const baseTextureIds = getListedTextureSetTextureIds(reg, scene.textureSets ?? []);

  resolveSceneAssets({
    ctx,
    reg,
    ship,
    sceneId,
    scene,
    reportUnknownId: (kind, id) => {
      ctx.log.error(
        `Scene "${sceneId}" lists the ${kind} "${id}", which no asset JSON (or only an invalid one) has.`
      );
      return id;
    },
  });

  // The debugger's save tells an inline asset from a listed one by it (p355 §2.6); production has
  // no debugger
  const inlineAssets = ctx.isProduction ? undefined : getInlineAssetIds(gathered);
  if (ctx.isProduction) {
    scene.sceneFile = '';
    delete scene.name;
    delete scene.description;
    delete scene.comments;
    delete scene.todo;
    delete scene.__sourcePath;
  }
  // The scene manifest: the features its data needs, which InitEngine checks against its
  // `features` (always written: no list is data from before the manifest), from the whole scene;
  // then a streaming scene's content cut into its cells (p353 Phase 3)
  return buildStreamingManifest(
    ctx,
    sceneId,
    {
      ...scene,
      ...(inlineAssets ? { __inlineAssets: inlineAssets } : {}),
      // A terrain block's or a scatter item's collider needs physics(), whose one scene field is
      // the world bounds (p306 D2, p308 D2, p102 Phase 4), named once
      __features: [
        ...new Set([
          ...getSceneFeatureIds(scene),
          ...getTerrainBlockFeatureIds(scene),
          ...getScatterFeatureIds(scene),
        ]),
      ],
    },
    { baseTextureIds }
  );
};

/** Every registered scene resolved, in the walk's order */
export const resolveScenes = (
  ctx: GatherContext,
  reg: Registries,
  ship: ShipChecks
): SceneOutput => {
  const output: SceneOutput = { scenes: {}, debugSceneIds: new Set() };
  for (const gathered of reg.scenes) {
    const scene = resolveScene(ctx, reg, ship, gathered, output.debugSceneIds);
    if (scene) output.scenes[gathered.id] = scene;
  }
  return output;
};
