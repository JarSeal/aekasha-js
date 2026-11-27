import { getGeometry } from '../../kernel/assets/Geometry';
import { getImportedAsset } from '../../kernel/assets/import/ImportRegistry';
import type {
  ImportedGeometryInfo,
  SpawnImportedParams,
} from '../../kernel/assets/import/ImportTypes';
import { spawnImportedAsset } from '../../kernel/assets/import/SpawnImported';
import { getMaterial } from '../../kernel/assets/Material';
import { deleteEntity } from '../../kernel/ecs/ECSHelpers';
import {
  getCurrentSceneId,
  getGeneratedSceneData,
  getLoadingSceneId,
} from '../../kernel/scene/Scene';
import { lwarn } from '../../utils/Logger';
import type { DecalSetDef } from './DecalSetSchema';
import { assertTerrainInstalled, terrainState } from './TerrainState';

/** `spawnDecalSet`'s options. */
export type SpawnDecalSetOpts = {
  /** The set's place: its meshes' root transform, under which each node's own is composed.
   * Default: the origin. A terrain block spawns its sets at its grid place. */
  transform?: SpawnImportedParams['transform'];
  /** The meshes' app id prefix (`<appId>/<node>`). Default: `decalSet/<id>`; give another to spawn
   * a set twice. */
  appId?: string;
};

/** A spawned decal set: its mesh entities, owned by the scene that spawned it. */
export type DecalSet = {
  /** The set's id (its `*.decalSet.json`'s) */
  id: string;
  /** A mesh entity per decal node, in the import's node order */
  meshEntityIds: number[];
  /** Deletes the set's meshes now (its scene's exit deletes them anyway). Safe to call twice. */
  dispose: () => void;
};

/** The scene a spawn belongs to: the one loading (its code runs before it's current), else the
 * current one */
const getSpawnSceneId = () => getLoadingSceneId() || getCurrentSceneId();

/**
 * A decal set's data, as the gatherer wrote it into a scene's data (its defaults filled in). Read
 * it, never write it.
 * @param id the set's id (its `*.decalSet.json`'s)
 * @param sceneId the scene whose data to read. Default: the scene loading, else the current one.
 * @returns the set, or undefined when the scene doesn't list it (in its `decalSets`, or through a
 * terrain block's `decals`)
 * @example
 * ```ts
 * import { getDecalSet } from 'aekasha/terrain';
 *
 * const tracks = getDecalSet('showcaseMud_decals');
 * if (tracks) console.log(`Drawn in ${tracks.material} at render order ${tracks.renderOrder}.`);
 * ```
 */
export const getDecalSet = (id: string, sceneId?: string): DecalSetDef | undefined => {
  const scene = sceneId || getSpawnSceneId();
  return scene ? getGeneratedSceneData(scene)?.decalSets?.find((s) => s.id === id) : undefined;
};

/** Whether a node of the set is a decal: not one with physics or GPU instances (warned, skipped);
 * a decal without `uv1` is warned of and drawn */
const isDecalNode = (where: string, info: ImportedGeometryInfo) => {
  if (info.customProps.isPhysObj || info.instances) {
    lwarn(
      `${where}: its node "${info.nodeName}" has ${info.instances ? 'GPU instances' : 'physics custom props'}, which a decal set doesn't spawn: skipped.`
    );
    return false;
  }
  if (!getGeometry(info.geometryId)?.getAttribute('uv1')) {
    lwarn(
      `${where}: its node "${info.nodeName}" has no second UV set (uv1, 0..1 over the decal), which the decal material's edge fade reads: with edgeFade UV1 it draws nothing.`
    );
  }
  return true;
};

// p309 D3
/**
 * Spawns a decal set that the scene lists: a mesh per node of its import (a decal, UV'd
 * into its atlas cell), drawn in the set's decal material at its render order, receiving shadows
 * by its `receiveShadow` and never casting them, without physics. A terrain block spawns the sets
 * its `decals` names; call this for a set of the scene's own. Its meshes belong to the spawning
 * scene and go with its exit.
 * @param id the set's id (its `*.decalSet.json`'s)
 * @param opts the set's place and its meshes' app id prefix
 * @returns the set's meshes and its `dispose()`, or `null` when its scene left meanwhile
 * @throws when `terrain()` isn't installed, there's no scene, the scene doesn't list the set, or
 * its import or material isn't loaded
 * @remarks A node with physics custom props or GPU instances isn't a decal: it's skipped with a
 * warning. A node without a second UV set (`uv1`) is warned of: the toolkit's decal materials'
 * edge fade reads it, and draws nothing without it.
 * @example
 * ```ts
 * import { spawnDecalSet } from 'aekasha/terrain';
 *
 * // A scene file's scene function: its scene JSON lists "decalSets": ["yardStains"]
 * export const scene = async () => {
 *   const stains = await spawnDecalSet('yardStains', {
 *     transform: { position: { x: 12, y: 0, z: -4 } },
 *   });
 *   if (!stains) return; // the scene was left while it spawned
 *   console.log(`${stains.meshEntityIds.length} decals.`);
 * };
 * ```
 */
export const spawnDecalSet = async (
  id: string,
  opts: SpawnDecalSetOpts = {}
): Promise<DecalSet | null> => {
  assertTerrainInstalled('spawnDecalSet');
  const sceneId = getSpawnSceneId();
  if (!sceneId) {
    throw new Error(`spawnDecalSet: no scene is loading or current to spawn "${id}" in.`);
  }
  const set = getDecalSet(id, sceneId);
  if (!set) {
    throw new Error(
      `spawnDecalSet: the scene "${sceneId}" doesn't list the decal set "${id}" in its decalSets (or a terrain block's decals).`
    );
  }
  const where = `spawnDecalSet: the decal set "${id}"`;
  const manifest = getImportedAsset(set.importedAsset);
  if (!manifest) {
    throw new Error(
      `${where} names the import "${set.importedAsset}", which isn't loaded (a scene listing the set loads it).`
    );
  }
  if (!getMaterial(set.material)) {
    throw new Error(
      `${where} names the material "${set.material}", which isn't loaded (a scene listing the set loads it).`
    );
  }
  const visit = terrainState.sceneVisit;
  const { meshEntityIds } = await spawnImportedAsset(manifest, {
    transform: opts.transform,
    material: set.material,
    castShadow: false,
    receiveShadow: set.receiveShadow,
    meshProps: manifest.geometries.map(() => ({ renderOrder: set.renderOrder })),
    filter: (info) => isDecalNode(where, info),
    entityOpts: { appId: opts.appId ?? `decalSet/${id}` },
  });
  const dispose = () => {
    for (const entityId of meshEntityIds) deleteEntity(entityId);
  };
  if (visit !== terrainState.sceneVisit) {
    dispose();
    return null;
  }
  return { id, meshEntityIds, dispose };
};
