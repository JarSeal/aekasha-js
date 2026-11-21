import type * as THREE from 'three/webgpu';
import { getGeometry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import { getImportedAsset } from '../../kernel/assets/import/ImportRegistry';
import type { ImportedGeometryInfo } from '../../kernel/assets/import/ImportTypes';
import { getMaterialVariant } from '../../kernel/assets/Material';
import { deleteEntity } from '../../kernel/ecs/ECSHelpers';
import { createMeshEntity } from '../../kernel/mesh/Mesh';
import {
  getCurrentSceneId,
  getGeneratedSceneData,
  getLoadingSceneId,
} from '../../kernel/scene/Scene';
import { lwarn } from '../../utils/Logger';
import type { TerrainBlockDef } from './TerrainBlockSchema';
import { spawnDecalSet } from './DecalSets';
import {
  getTerrainGenerator,
  getTerrainGeneratorIds,
  type TerrainGeneratorResult,
} from './TerrainGenerators';
import { assertTerrainInstalled, terrainState } from './TerrainState';

/** `spawnTerrainBlock`'s options. */
export type SpawnTerrainBlockOpts = {
  /** The mesh entity's app id. Default: `terrainBlock/<id>`; give another to spawn a block twice. */
  appId?: string;
};

/** A spawned terrain block: its entities, owned by the scene that spawned it. */
export type TerrainBlock = {
  /** The block's id (its `*.terrainBlock.json`'s) */
  id: string;
  /** The mesh entity, at the block's grid place */
  meshEntityId: number;
  /** The collider's entity: the mesh entity, with a `FIXED` body. Undefined for a block with
   * `collider: { type: 'NONE' }`, or a geometry that gave no shape (logged). */
  physicsEntityId?: number;
  /** The block's scatters' entities (its `scatter`'s, spawned on it; empty without): each
   * scatter's cells, then its colliders' physics entities */
  scatterIds: number[];
  /** The block's decal sets' mesh entities (its `decals`', spawned at its grid place; empty
   * without) */
  decalIds: number[];
  /** Deletes the block's entities now, its scatters' cells and decals too (its scene's exit
   * deletes them anyway). Its generated geometry goes with its last mesh, a material variant with its last
   * user. Safe to call twice. */
  dispose: () => void;
};

/** The scene a spawn belongs to: the one loading (its code runs before it's current), else the
 * current one */
const getSpawnSceneId = () => getLoadingSceneId() || getCurrentSceneId();

/**
 * A terrain block's data, as the gatherer wrote it into a scene's data (its defaults filled in).
 * Read it, never write it.
 * @param id the block's id (its `*.terrainBlock.json`'s)
 * @param sceneId the scene whose data to read. Default: the scene loading, else the current one.
 * @returns the block, or undefined when the scene doesn't list it in its `terrainBlocks`
 * @example
 * ```ts
 * import { getTerrainBlock } from 'aekasha/terrain';
 *
 * const coast = getTerrainBlock('showcaseCoast');
 * if (coast) console.log(`The block is ${coast.grid.size} m wide.`);
 * ```
 */
export const getTerrainBlock = (id: string, sceneId?: string): TerrainBlockDef | undefined => {
  const scene = sceneId || getSpawnSceneId();
  return scene ? getGeneratedSceneData(scene)?.terrainBlocks?.find((b) => b.id === id) : undefined;
};

const isIdentityTransform = ({
  position: p,
  quaternion: q,
  scale: s,
}: ImportedGeometryInfo['transform']) =>
  !p.x && !p.y && !p.z && !q.x && !q.y && !q.z && s.x === 1 && s.y === 1 && s.z === 1;

/** An imported block's node: its registered geometry and manifest entry; throws naming the block */
const getImportedBlockGeometry = (
  block: TerrainBlockDef,
  { importedAsset, node }: { importedAsset: string; node?: string }
) => {
  const where = `spawnTerrainBlock: the terrain block "${block.id}"`;
  const manifest = getImportedAsset(importedAsset);
  if (!manifest) {
    throw new Error(
      `${where} names the import "${importedAsset}", which isn't loaded (a scene listing the block loads it).`
    );
  }
  const infos = node
    ? manifest.geometries.filter((info) => info.nodeName === node)
    : manifest.geometries;
  if (infos.length !== 1) {
    const nodes = manifest.geometries.map((info) => info.nodeName).join(', ');
    throw new Error(
      node
        ? `${where}: the import "${importedAsset}" has ${infos.length ? `${infos.length} primitives on` : 'no'} node "${node}", a block is one mesh (its nodes: ${nodes}).`
        : `${where}: the import "${importedAsset}" has ${infos.length} meshes (${nodes}): name the block's in its geometry.node.`
    );
  }
  const [info] = infos;
  const geometry = getGeometry(info.geometryId);
  if (!geometry) {
    throw new Error(`${where}: the import's geometry "${info.geometryId}" isn't registered.`);
  }
  // Quantized positions: another tool's are dequantized by their node's transform, which the
  // block replaces; the pipeline's, made floats again by the import, miss their neighbours' edge
  if (geometry.getAttribute('position')?.normalized || info.isDequantized) {
    throw new Error(
      `${where}: the import "${importedAsset}" has quantized positions (the asset pipeline's default meshopt encode), which don't meet a neighbouring block's edge exactly. Give its importedAsset JSON "optimize": { "profile": "terrainBlock" }.`
    );
  }
  if (!isIdentityTransform(info.transform)) {
    lwarn(
      `${where}: its node "${info.nodeName}" has a transform, which the block ignores (it's placed by its grid). Apply the transforms in Blender.`
    );
  }
  return { geometry, info };
};

/** A generated block's geometry; throws naming the block and the generator */
const generateBlockGeometryAsync = async (
  block: TerrainBlockDef,
  {
    generator: generatorId,
    params,
    seed,
  }: { generator: string; params: Record<string, unknown>; seed: number }
): Promise<TerrainGeneratorResult> => {
  const generator = getTerrainGenerator(generatorId);
  if (!generator) {
    const known = getTerrainGeneratorIds();
    throw new Error(
      `spawnTerrainBlock: the terrain block "${block.id}" names the generator "${generatorId}", which isn't registered (registered: ${known.length ? known.join(', ') : 'none'}). Register it with registerTerrainGenerator from an install.`
    );
  }
  return generator({ blockId: block.id, params, seed, grid: block.grid });
};

/** The block's material: its own when it has no inputs, else the variant of its inputs */
const getBlockMaterial = (block: TerrainBlockDef) =>
  block.materialInputs
    ? getMaterialVariant(block.material, { inputs: block.materialInputs })
    : block.material;

/**
 * Spawns a terrain block (p306 D2) that the scene lists in its `terrainBlocks`: its mesh at
 * `(grid.x · size, 0, grid.z · size)` from its imported node's geometry or its generator's, with
 * its material (a variant when it has `materialInputs`) and shadows, its collider on the mesh
 * entity (a `FIXED` body; `HEIGHTFIELD` or `TRIMESH`, read from the geometry or the generator's
 * heightfield), its scatters on it (`spawnScatter` from `aekasha/instancing`, their cells' app ids
 * starting `<appId>/scatter/<scatterId>`) and its decal sets at its grid place (`spawnDecalSet`,
 * their meshes' app ids starting `<appId>/decals/<decalSetId>`). Its entities belong to the
 * spawning scene and go with its exit. Call it from the scene's code: the scene's load holds
 * physics until the collider exists, so the block's simulation is deterministic.
 * @param id the block's id (its `*.terrainBlock.json`'s)
 * @param opts the mesh entity's app id
 * @returns the block's entities and its `dispose()`, or `null` when its scene left meanwhile
 * @throws when `terrain()` isn't installed, there's no scene, the scene doesn't list the block,
 * its import isn't loaded or has no such single node, its generator isn't registered, its
 * collider needs `physics()` or its scatters `instancing()`, which isn't installed, or a scatter's
 * spawn throws, or a decal set's import or material isn't loaded
 * @remarks Re-check your scene after the `await`: a load that leaves the scene while the block
 * spawns (a generator's, the collider's, a scatter's or a decal set's await) gets `null`, and what the spawn made
 * is deleted.
 * @example
 * ```ts
 * import { spawnTerrainBlock } from 'aekasha/terrain';
 *
 * // A scene file's scene function: its scene JSON lists "terrainBlocks": ["showcaseCoast"]
 * export const scene = async () => {
 *   const block = await spawnTerrainBlock('showcaseCoast');
 *   if (!block) return; // the scene was left while it spawned
 *   console.log(`The block's mesh is entity ${block.meshEntityId}.`);
 * };
 * ```
 */
export const spawnTerrainBlock = async (
  id: string,
  opts: SpawnTerrainBlockOpts = {}
): Promise<TerrainBlock | null> => {
  assertTerrainInstalled('spawnTerrainBlock');
  const sceneId = getSpawnSceneId();
  if (!sceneId) {
    throw new Error(`spawnTerrainBlock: no scene is loading or current to spawn "${id}" in.`);
  }
  const block = getTerrainBlock(id, sceneId);
  if (!block) {
    throw new Error(
      `spawnTerrainBlock: the scene "${sceneId}" doesn't list the terrain block "${id}" in its terrainBlocks.`
    );
  }
  const needsCollider = block.collider.type !== 'NONE';
  if (needsCollider && !terrainState.hasPhysics) {
    throw new Error(
      `spawnTerrainBlock: the terrain block "${id}" has a ${block.collider.type} collider, which needs physics() listed before terrain() in InitEngine's features (or give the block collider: { type: 'NONE' }).`
    );
  }
  if (block.scatter?.length && !terrainState.hasInstancing) {
    throw new Error(
      `spawnTerrainBlock: the terrain block "${id}" has scatters, which need instancing() listed before terrain() in InitEngine's features.`
    );
  }
  const visit = terrainState.sceneVisit;
  const isLeft = () => visit !== terrainState.sceneVisit;

  let geometry: THREE.BufferGeometry;
  let info: ImportedGeometryInfo | undefined;
  let heightfield: TerrainGeneratorResult['heightfield'];
  if ('importedAsset' in block.geometry) {
    ({ geometry, info } = getImportedBlockGeometry(block, block.geometry));
  } else {
    const generated = await generateBlockGeometryAsync(block, block.geometry);
    if (isLeft()) {
      generated.geometry.dispose();
      return null;
    }
    // Owned by the scene, disposed with its last mesh
    geometry = saveBufferGeometry(generated.geometry, {
      debugData: { name: `Terrain block ${id}` },
    });
    heightfield = generated.heightfield;
  }

  const { size, x, z } = block.grid;
  const blockPosition = { x: x * size, y: 0, z: z * size };
  const appId = opts.appId ?? `terrainBlock/${id}`;
  const meshEntityId = createMeshEntity({
    geo: geometry,
    mat: getBlockMaterial(block),
    castShadow: block.shadows.cast,
    receiveShadow: block.shadows.receive,
    position: blockPosition,
    appId,
  });
  /** The block's scatters and decal sets, deleted with it */
  const owned: { dispose: () => void }[] = [];
  const dispose = () => {
    for (const part of owned) part.dispose();
    deleteEntity(meshEntityId);
  };

  let physicsEntityId: number | undefined;
  if (needsCollider) {
    const { createTerrainBlockColliderAsync } = await import('./TerrainCollider');
    if (isLeft()) {
      dispose();
      return null;
    }
    physicsEntityId = await createTerrainBlockColliderAsync({
      block,
      geometry,
      info,
      heightfield,
      meshEntityId,
    });
    if (isLeft()) {
      dispose();
      return null;
    }
  }

  const scatterIds: number[] = [];
  if (block.scatter?.length) {
    const { spawnScatter } = await import('../instancing/Scatter');
    if (isLeft()) {
      dispose();
      return null;
    }
    // On the block: its centre, grid place (in each scatter's seed) and size, and its mesh
    const target = {
      position: blockPosition,
      grid: { x, z },
      size,
      entityId: meshEntityId,
    };
    for (const scatterId of block.scatter) {
      const scatter = await spawnScatter(scatterId, {
        target,
        appId: `${appId}/scatter/${scatterId}`,
      }).catch((err: unknown) => {
        // Not half a block: what it made goes, then the error
        dispose();
        throw err;
      });
      if (!scatter || isLeft()) {
        scatter?.dispose();
        dispose();
        return null;
      }
      owned.push(scatter);
      scatterIds.push(...scatter.entityIds, ...scatter.colliderIds);
    }
  }

  // Its decal sets, exported in the block's own space: at its grid place
  const decalIds: number[] = [];
  for (const decalSetId of block.decals ?? []) {
    const decalSet = await spawnDecalSet(decalSetId, {
      transform: { position: blockPosition },
      appId: `${appId}/decals/${decalSetId}`,
    }).catch((err: unknown) => {
      dispose();
      throw err;
    });
    if (!decalSet || isLeft()) {
      decalSet?.dispose();
      dispose();
      return null;
    }
    owned.push(decalSet);
    decalIds.push(...decalSet.meshEntityIds);
  }
  return { id, meshEntityId, physicsEntityId, scatterIds, decalIds, dispose };
};
