import * as THREE from 'three/webgpu';
import { getGeometry } from '../../kernel/assets/Geometry';
import { getMaterial } from '../../kernel/assets/Material';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getECSWorld } from '../../kernel/ecs/ECS';
import {
  getCurrentSceneId,
  getGeneratedSceneData,
  getLoadingSceneId,
} from '../../kernel/scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { hashStringFNV1a } from '../../utils/Hash';
import { lwarn } from '../../utils/Logger';
import { getRandomSeed } from '../../utils/RandomStreams';
import { createSeededRandom } from '../../utils/SeededRandom';
import {
  assertScattersInstalled,
  getScatterGenerator,
  getScatterGeneratorIds,
  scatterState,
  type ScatterGeneratorInput,
  type ScatterGeneratorResult,
  type ScatterTarget,
} from './ScatterGenerators';
import { SCATTER_COLLIDER_WARNING } from './ScatterLimits';
import type { ScatterDef, ScatterItemDef, ScatterPlacementDef } from './ScatterSchema';
import { createStaticInstances } from './StaticInstances';

// Scatters (p308 D2): a `*.scatter.json` from the spawning scene's
// data, its instances placed by its source (a registered generator, its placements, or an import's
// GPU instances and point clouds), grouped by item and drawn in cells by `createStaticInstances`.

const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** The scene a spawn belongs to: the one loading (its code runs before it's current), else the
 * current one */
const getSpawnSceneId = () => getLoadingSceneId() || getCurrentSceneId();

/**
 * A scatter's data, as the gatherer wrote it into a scene's data (its defaults filled in). Read it,
 * never write it.
 * @param id the scatter's id (its `*.scatter.json`'s)
 * @param sceneId the scene whose data to read. Default: the scene loading, else the current one.
 * @returns the scatter, or undefined when the scene doesn't have it (its `scatters`, or a terrain
 *   block's `scatter`, names it)
 * @example
 * ```ts
 * import { getScatter } from 'aekasha/instancing';
 *
 * const rocks = getScatter('showcaseCoast_rocks');
 * if (rocks) console.log(`${rocks.items.length} kinds of rock, in ${rocks.cellSize} m cells.`);
 * ```
 */
export const getScatter = (id: string, sceneId?: string): ScatterDef | undefined => {
  const scene = sceneId || getSpawnSceneId();
  return scene ? getGeneratedSceneData(scene)?.scatters?.find((s) => s.id === id) : undefined;
};

/**
 * A scatter's seed on a target: the source's seed mixed with the world seed (`getRandomSeed`), the
 * target's grid place and the scatter's id (FNV-1a), so every block gets its own placements, every
 * visit the same, whatever the load order.
 * @internal
 */
export const getScatterSeed = (scatterId: string, seed: number, grid: { x: number; z: number }) =>
  hashStringFNV1a(`${scatterId}|${grid.x}|${grid.z}|${seed}`, 0x811c9dc5 ^ getRandomSeed());

/** Picks each instance's item by the items' weights, where `items` says none (-1) */
const pickItems = (picked: Int16Array, items: readonly ScatterItemDef[], seed: number) => {
  let total = 0;
  for (const item of items) total += item.weight;
  const random = createSeededRandom(seed);
  for (let i = 0; i < picked.length; i++) {
    if (picked[i] >= 0) continue;
    let r = random() * total;
    let index = 0;
    while (index < items.length - 1 && r >= items[index].weight) {
      r -= items[index].weight;
      index++;
    }
    picked[i] = index;
  }
};

/** The hand-placed instances as world matrices, relative to `origin` */
const placementMatrices = (placements: readonly ScatterPlacementDef[], origin: THREE.Vector3) => {
  const matrices = new Float32Array(placements.length * MATRIX_SIZE);
  for (let i = 0; i < placements.length; i++) {
    const { position, yaw, quaternion, scale = 1 } = placements[i];
    _position.fromArray(position).add(origin);
    if (quaternion) _quaternion.fromArray(quaternion).normalize();
    else _quaternion.setFromAxisAngle(_up, yaw ?? 0);
    _matrix.compose(_position, _quaternion, _scale.setScalar(scale));
    _matrix.toArray(matrices, i * MATRIX_SIZE);
  }
  return matrices;
};

// i020
/**
 * Whether a geometry's positions are quantized: an import another tool quantized, whose scale is
 * in its node, which a scatter's cell doesn't draw (the asset pipeline's are made floats again
 * by the import).
 * @internal
 */
export const hasQuantizedPositions = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  return Boolean(position) && (!(position.array instanceof Float32Array) || position.normalized);
};

/**
 * The fix for an import's quantized geometry, named by the refusals.
 * @internal
 */
export const LOSSLESS_IMPORT_FIX =
  'Give its importedAsset JSON "optimize": { "mesh": { "quantize": false } }.';

/** Throws naming the scatter and the item when an item's geometry or material isn't registered,
 * or its geometry is quantized */
const checkItemAssets = (scatter: ScatterDef) => {
  scatter.items.forEach((item, index) => {
    const geometry = getGeometry(item.geometry);
    const missing = !geometry
      ? `geometry "${item.geometry}"`
      : !getMaterial(item.material)
        ? `material "${item.material}"`
        : undefined;
    const where = `spawnScatter: the scatter "${scatter.id}"'s item ${index}`;
    if (missing) {
      throw new Error(
        `${where} names the ${missing}, which isn't registered (a *.geometry.json or *.material.json loads with a scene listing the scatter; register any other before the spawn).`
      );
    }
    if (geometry && hasQuantizedPositions(geometry)) {
      throw new Error(
        `${where}'s geometry "${item.geometry}" has quantized positions (a file another tool quantized), whose scale is in its node, which a scatter doesn't draw. ${LOSSLESS_IMPORT_FIX}`
      );
    }
  });
};

/** A procedural source's instances; throws naming the scatter and the generator */
const generateAsync = async (
  scatter: ScatterDef,
  source: Extract<ScatterDef['source'], { type: 'PROCEDURAL' }>,
  input: Omit<ScatterGeneratorInput, 'params' | 'scatterId' | 'items'>
): Promise<ScatterGeneratorResult> => {
  const generator = getScatterGenerator(source.generator);
  if (!generator) {
    const known = getScatterGeneratorIds();
    throw new Error(
      `spawnScatter: the scatter "${scatter.id}" names the generator "${source.generator}", which isn't registered (registered: ${known.length ? known.join(', ') : 'none'}). Register it with registerScatterGenerator from an install.`
    );
  }
  const result = await generator({
    ...input,
    scatterId: scatter.id,
    params: source.params,
    items: scatter.items,
  });
  const count = result.matrices.length / MATRIX_SIZE;
  const where = `spawnScatter: the scatter "${scatter.id}"'s generator "${source.generator}"`;
  if (!Number.isInteger(count)) {
    throw new Error(`${where} returned ${result.matrices.length} floats, not 16 per matrix.`);
  }
  if (result.items && result.items.length !== count) {
    throw new Error(`${where} returned ${result.items.length} items for ${count} instances.`);
  }
  if (result.items?.some((item) => item >= scatter.items.length)) {
    throw new Error(`${where} returned an item past the scatter's ${scatter.items.length}.`);
  }
  if (result.colors && result.colors.length !== count * COLOR_SIZE) {
    throw new Error(`${where} returned ${result.colors.length} colour floats for ${count}.`);
  }
  return result;
};

/** The instances of one item, out of all of them */
const selectItem = (
  matrices: Float32Array,
  colors: Float32Array | undefined,
  items: Int16Array,
  item: number,
  count: number
) => {
  const itemMatrices = new Float32Array(count * MATRIX_SIZE);
  const itemColors = colors && new Float32Array(count * COLOR_SIZE);
  let j = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i] !== item) continue;
    itemMatrices.set(matrices.subarray(i * MATRIX_SIZE, (i + 1) * MATRIX_SIZE), j * MATRIX_SIZE);
    if (itemColors && colors) {
      itemColors.set(colors.subarray(i * COLOR_SIZE, (i + 1) * COLOR_SIZE), j * COLOR_SIZE);
    }
    j++;
  }
  return { itemMatrices, itemColors };
};

/**
 * The colliders of the items that have one (`ScatterColliders.ts`, loaded with the first): none
 * without such an item, or when the scene is left while its code loads; without `physics()` a
 * warning and none. Warns past `SCATTER_COLLIDER_WARNING`.
 */
const createCollidersAsync = async (
  scatter: ScatterDef,
  matrices: Float32Array,
  picked: Int16Array,
  world: ECSWorld,
  counts: Uint32Array
): Promise<number[] | null> => {
  let total = 0;
  scatter.items.forEach((item, index) => {
    if (item.collider !== 'NONE') total += counts[index];
  });
  if (!total) return null;
  if (!scatterState.hasPhysics) {
    lwarn(
      `spawnScatter: the scatter "${scatter.id}" has ${total} instances of items with a collider, which need physics() listed before instancing() in InitEngine's features: they have none.`
    );
    return null;
  }
  if (total > SCATTER_COLLIDER_WARNING) {
    lwarn(
      `spawnScatter: the scatter "${scatter.id}" makes ${total} colliders on its target, a FIXED body each (over ${SCATTER_COLLIDER_WARNING}): keep the colliders to the large pieces.`
    );
  }
  const visit = scatterState.sceneVisit;
  const { createScatterCollidersAsync } = await import('./ScatterColliders');
  // A scene left while the code loaded: no body into the next scene's world
  if (visit !== scatterState.sceneVisit) return null;
  return createScatterCollidersAsync(scatter.id, scatter.items, matrices, picked, world);
};

/** `spawnScatter`'s options. */
export type SpawnScatterOpts = {
  /** Where it spawns: what `PLACEMENTS` and an `IMPORTED` source's file root are relative to, what
   * a generator places on, and the grid place in its seed. Default: the origin, grid `(0, 0)`. */
  target?: ScatterTarget;
  /** The cells' app ids' start: a cell is `<appId>/<item>/<cellX>,<cellZ>`. Default:
   * `scatter/<id>`; give another to spawn a scatter twice over the same cells. */
  appId?: string;
  /** The world. Default: the default world. */
  world?: ECSWorld;
};

/** A spawned scatter: its cells and colliders, owned by the scene that spawned it. */
export type SpawnedScatter = {
  /** The scatter's id (its `*.scatter.json`'s) */
  id: string;
  /** The cells' entities, each item's in order */
  entityIds: number[];
  /** The colliders' physics entities (a `FIXED` body each, no visual), in instance order: one per
   * instance of an item with a `collider` (empty without, or without `physics()`) */
  colliderIds: number[];
  /** The instances in all its cells */
  count: number;
  /** Deletes the cells and the colliders now (the scene's exit deletes them anyway). Safe to call
   * twice. */
  dispose: () => void;
};

// p308 D2
/**
 * Spawns a scatter that the scene has (its `scatters` lists it, or a terrain block's
 * `scatter` names it): its instances placed by its source on `target`, each item's split into
 * cells of `cellSize` (`createStaticInstances`), each cell with the scatter's `lod`, and a `FIXED`
 * collider per instance of an item with a `collider` (with `physics()`; without it, a warning and
 * none). Its cells and colliders belong to the spawning scene and go with its exit. A terrain block
 * spawns its own. Call it from the scene's code: the load holds physics until the colliders exist.
 * @param id the scatter's id (its `*.scatter.json`'s)
 * @returns the scatter's cells and colliders and its `dispose()`, or `null` when its scene left
 * meanwhile
 * @throws when `instancing()` isn't installed, there's no scene, the scene doesn't have the
 * scatter, an item's geometry or material isn't registered or its geometry is quantized (a file
 * another tool quantized: give the import `"optimize": { "mesh": { "quantize": false } }`), its
 * generator isn't registered or returns instances that don't fit its items, its import has no
 * node it takes, a node of GPU instances no item draws or a point's `_ITEM` past the items, or a
 * collider can't be made (the cells made are deleted first)
 * @remarks An `IMPORTED` source's node of GPU instances is drawn by the item whose `geometry` is
 * the node's (`<importId>/<node>`), or a plain node's of the same glTF mesh (Blender's export
 * copies a mesh for each instancing node: name the rock's own node, `<importId>/RockA`), a point
 * cloud's point by its `_ITEM` (else the weights pick).
 * Re-check your scene after the `await`: a load that leaves the scene while a generator runs (or
 * the `IMPORTED` source's code or the colliders load) gets `null`, and what it made is deleted.
 * A collider item is for large pieces: past 200 colliders on a target the spawn warns.
 * @example
 * ```ts
 * import { spawnScatter } from 'aekasha/instancing';
 *
 * // A scene file's scene function: its scene JSON lists "scatters": ["beachPebbles"]
 * export const scene = async () => {
 *   const pebbles = await spawnScatter('beachPebbles', {
 *     target: { position: { x: 0, y: 0, z: 0 }, size: 64 },
 *   });
 *   if (!pebbles) return; // the scene was left while it spawned
 *   console.log(`${pebbles.count} pebbles in ${pebbles.entityIds.length} cells.`);
 * };
 * ```
 */
export const spawnScatter = async (
  id: string,
  opts: SpawnScatterOpts = {}
): Promise<SpawnedScatter | null> => {
  assertScattersInstalled('spawnScatter');
  const sceneId = getSpawnSceneId();
  if (!sceneId) {
    throw new Error(`spawnScatter: no scene is loading or current to spawn "${id}" in.`);
  }
  const scatter = getScatter(id, sceneId);
  if (!scatter) {
    throw new Error(
      `spawnScatter: the scene "${sceneId}" doesn't have the scatter "${id}" (list it in its scatters, or in a terrain block's scatter).`
    );
  }
  checkItemAssets(scatter);
  const world = opts.world || existsOrThrow(getECSWorld(), 'spawnScatter: no ECS world.');
  const position = opts.target?.position ?? { x: 0, y: 0, z: 0 };
  const grid = opts.target?.grid ?? { x: 0, z: 0 };
  const seed = getScatterSeed(id, scatter.source.seed, grid);
  const visit = scatterState.sceneVisit;

  let matrices: Float32Array;
  let colors: Float32Array | undefined;
  let picked: Int16Array;
  if (scatter.source.type === 'PROCEDURAL') {
    const result = await generateAsync(scatter, scatter.source, {
      seed,
      target: { ...opts.target, position, grid },
      world,
    });
    if (visit !== scatterState.sceneVisit) return null;
    ({ matrices, colors } = result);
    picked = result.items ? Int16Array.from(result.items) : new Int16Array(0);
  } else if (scatter.source.type === 'IMPORTED') {
    // Its code reads the import registry: loaded with the first such scatter
    const { getImportedScatterInstances } = await import('./ScatterImported');
    if (visit !== scatterState.sceneVisit) return null;
    ({ matrices, colors, picked } = getImportedScatterInstances(
      scatter,
      scatter.source,
      _origin.set(position.x, position.y, position.z)
    ));
  } else {
    const { placements } = scatter.source;
    matrices = placementMatrices(placements, _origin.set(position.x, position.y, position.z));
    picked = Int16Array.from(placements, (placement) => placement.item ?? -1);
  }
  const count = matrices.length / MATRIX_SIZE;
  if (picked.length !== count) picked = new Int16Array(count).fill(-1);
  pickItems(picked, scatter.items, seed);

  const counts = new Uint32Array(scatter.items.length);
  for (const item of picked) counts[item]++;
  const appId = opts.appId ?? `scatter/${id}`;
  const cells = scatter.items.flatMap((item, index) => {
    if (!counts[index]) return [];
    const { itemMatrices, itemColors } = selectItem(matrices, colors, picked, index, counts[index]);
    return [
      createStaticInstances({
        id: `${appId}/${index}`,
        geometry: item.geometry,
        material: item.material,
        instances: itemMatrices,
        colors: itemColors,
        cellSize: scatter.cellSize,
        castShadow: item.castShadow,
        receiveShadow: item.receiveShadow,
        lod: scatter.lod,
        world,
      }),
    ];
  });

  const colliderIds: number[] = [];
  const dispose = () => {
    for (const cell of cells) cell.dispose();
    for (const entityId of colliderIds.splice(0)) world.deleteEntity(entityId);
  };
  const colliders = await createCollidersAsync(scatter, matrices, picked, world, counts).catch(
    (err: unknown) => {
      // Not half a scatter: its cells go, then the error
      dispose();
      throw err;
    }
  );
  if (visit !== scatterState.sceneVisit) {
    for (const entityId of colliders ?? []) world.deleteEntity(entityId);
    dispose();
    return null;
  }
  if (colliders) colliderIds.push(...colliders);

  return {
    id,
    entityIds: cells.flatMap((cell) => cell.entityIds),
    colliderIds,
    count,
    dispose,
  };
};
