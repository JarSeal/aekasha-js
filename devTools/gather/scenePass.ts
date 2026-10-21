/**
 * The scene pass: each registered scene with its own save entry, its scene file checked, its
 * lists resolved, and its feature manifest. A production build leaves the debug scenes out, and
 * their names, descriptions and notes.
 */
import path from 'path';
import type { GatherContext, GatheredScene, Registries } from './context';
import { getSceneFeatureIds } from './engineSchemas';
import { getSaveEntry } from './saveEntries';
import { resolveSceneAssets, type SceneJSON } from './sceneAssets';
import type { ShipChecks } from './shipChecks';
import { getTopFolder, resolveCodeFile } from './sources';

/** A resolved scene, with the features its data needs (p607 D10) */
export type ResolvedScene = SceneJSON & { __features: string[] };

/** The scene pass's result */
export type SceneOutput = {
  /** The shipped scenes by id, in the walk's order */
  scenes: Record<string, ResolvedScene>;
  /** Left out of a production build, and of every profile (p611 D7) */
  debugSceneIds: Set<string>;
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
  { id: sceneId, data, file }: GatheredScene,
  debugSceneIds: Set<string>
): ResolvedScene | null => {
  const { $schema, __saveData, ...sceneJSON } = data;
  // The scene's own latest save entry (G5); the output has no __saveData
  const scene: SceneJSON = { ...sceneJSON, ...getSaveEntry(data, sceneId) };
  scene.id = sceneId;

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

  if (ctx.isProduction) {
    scene.sceneFile = '';
    delete scene.name;
    delete scene.description;
    delete scene.comments;
    delete scene.todo;
    delete scene.__sourcePath;
  }
  // The scene manifest: the features its data needs, which InitEngine checks against its
  // `features` (always written: no list is data from before the manifest)
  return { ...scene, __features: getSceneFeatureIds(scene) };
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
