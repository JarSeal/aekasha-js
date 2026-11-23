import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getECSWorld } from '../../kernel/ecs/ECS';
import type { CreateEntityOpts } from '../../kernel/ecs/ECSHelpers';
import type { ImportInstancesSpawn } from '../../kernel/assets/import/ImportExtensions';
import { addMeshEntity, resolveMeshAssets, type MeshProps } from '../../kernel/mesh/Mesh';
import { existsOrThrow } from '../../utils/Assert';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import type { MeshLodDef } from '../lod/LodTypes';
import type { InstancePlacement } from './InstancedMeshPoolTypes';

// Static instances (p308 D1): an `InstancedMesh` as one mesh entity
// whose instances never move, and a grid of such cells over many instances. No entity per instance
// and no per-frame sync: the matrices upload once. A cell is a plain mesh to the LOD
// (p348 §4.3): the whole cell swaps levels, measured by its
// bounds over every instance.

/** A matrix's floats in an instances array */
const MATRIX_SIZE = 16;
/** A colour's floats in a colours array */
const COLOR_SIZE = 3;

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

/** The instances as matrices: the array itself, or the placements composed into a new one */
const toMatrices = (instances: Float32Array | readonly InstancePlacement[], label: string) => {
  if (instances instanceof Float32Array) {
    if (instances.length % MATRIX_SIZE !== 0) {
      throw new Error(
        `${label}: the instances' array has ${instances.length} floats, not 16 per matrix.`
      );
    }
    return instances;
  }
  const matrices = new Float32Array(instances.length * MATRIX_SIZE);
  for (let i = 0; i < instances.length; i++) {
    const { position, quaternion, scale } = instances[i];
    _matrix.compose(position, quaternion, _scale.setScalar(scale));
    _matrix.toArray(matrices, i * MATRIX_SIZE);
  }
  return matrices;
};

/** Throws when `colors` isn't one colour per instance */
const checkColors = (colors: Float32Array | undefined, count: number, label: string) => {
  if (colors && colors.length !== count * COLOR_SIZE) {
    throw new Error(
      `${label}: ${colors.length} colour floats for ${count} instances (3 per instance).`
    );
  }
};

/** What {@link createInstancedMeshEntity} takes: a mesh entity's props, without `merge`. */
export type InstancedMeshEntityProps = Omit<MeshProps, 'merge'> & {
  /** The instances in the mesh's space: placements, or their matrices, 16 floats each (column
   * major, as three's `Matrix4.elements`). Copied. At least one. */
  instances: Float32Array | readonly InstancePlacement[];
  /** A colour per instance (`InstancedMesh.instanceColor`: linear RGB, 3 floats each), which
   * multiplies the material's colour. Copied. */
  colors?: Float32Array;
};

/**
 * Creates an entity of an `InstancedMesh` whose instances don't move, eg. a cell of static
 * instances: one entity for the whole mesh, none per instance. It's made as
 * `createMeshEntity` makes a mesh (the same steps: the refs on its registered geometry and
 * material, given back when the entity is deleted, the `OBJECT3D`, the root scene, the shadows,
 * the transform, `preWarm`), with its matrices written and its bounds computed over every
 * instance, so three culls the whole mesh by them. Its `lod` switches every instance at once.
 * Place it through its `Transform` (synced onto the mesh every frame), not `mesh.position`.
 * @param opts the entity's options and its world (default: the default world)
 * @returns the mesh's entity id
 * @throws without instances, for colours that aren't one per instance, and for a geometry or
 *   material id that isn't registered
 * @remarks The spatial index (`opts.spatialIndex`, on by default, so the cell is a light
 * receiver) and ECS frustum culling (`opts.ecsFrustumCullingEnabled`) measure the whole mesh by
 * its bounds. After changing the matrices (`mesh.setMatrixAt`), compute the mesh's bounds again,
 * call `refreshSpatialRadius` when it's in the index and `refreshLodBounds` when it has a LOD.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { createInstancedMeshEntity } from 'aekasha/instancing';
 *
 * const instances = [-2, 0, 2].map((x) => ({
 *   position: new THREE.Vector3(x, 0.5, 0),
 *   quaternion: new THREE.Quaternion(),
 *   scale: 1,
 * }));
 * createInstancedMeshEntity(
 *   { geo: 'crateGeo', mat: 'crateMaterial', instances, castShadow: true },
 *   { appId: 'crates' }
 * );
 * ```
 */
export const createInstancedMeshEntity = (
  props: InstancedMeshEntityProps,
  opts?: CreateEntityOpts
): number => {
  const label = `createInstancedMeshEntity ("${props.appId || opts?.appId || 'no appId'}")`;
  const matrices = toMatrices(props.instances, label);
  const count = matrices.length / MATRIX_SIZE;
  if (count === 0) throw new Error(`${label}: no instances.`);
  checkColors(props.colors, count, label);

  const { geo, mat } = resolveMeshAssets(props, opts?.appId, 'createInstancedMeshEntity');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.array.set(matrices);
  if (props.colors) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(props.colors.slice(), COLOR_SIZE);
  }
  // Over every instance (InstancedMesh's own): without them three culls by the geometry's, and
  // the spatial index and ECS frustum culling measure the mesh by them
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return addMeshEntity(mesh, props, opts);
};

/** What {@link createStaticInstances} takes. */
export interface CreateStaticInstancesOptions {
  /** Names the cells: each cell entity's app id is `<id>/<cellX>,<cellZ>`. Unique in the world. */
  id: string;
  /** Every instance's geometry: a geometry, the props `createGeometry` makes one from, or a
   * registered geometry's id. Each cell holds a registry ref on it while it lives. */
  geometry: MeshProps['geo'];
  /** Every instance's material, as `geometry`. */
  material: MeshProps['mat'];
  /** Per-mesh material overrides, as `createMeshEntity`'s. */
  matOverrides?: MeshProps['matOverrides'];
  /** The instances in world space: placements, or their matrices, 16 floats each (column major).
   * An instance's cell is the one its position falls in, on the XZ plane. */
  instances: Float32Array | readonly InstancePlacement[];
  /** A colour per instance (linear RGB, 3 floats each), which multiplies the material's colour. */
  colors?: Float32Array;
  /** A cell's side in metres. Default 16. */
  cellSize?: number;
  /** Default false. */
  castShadow?: boolean;
  /** Default false. */
  receiveShadow?: boolean;
  /** Every cell's levels of detail: a cell switches and hides as a whole, by its own bounds. */
  lod?: MeshLodDef;
  /** Compiles each cell's pipelines at creation, as `createMeshEntity`'s `preWarm`. */
  preWarm?: boolean;
  /** The cells' world. Default: the default world. */
  world?: ECSWorld;
  /** Each cell entity's options (their app ids are the cells'). */
  entityOpts?: CoreEntityOpts;
}

/** What {@link createStaticInstances} returns. */
export interface StaticInstances {
  /** The cells' entities, one per cell holding an instance. */
  entityIds: readonly number[];
  /** The instances in all the cells. */
  count: number;
  /** Deletes the cells still alive (the scene's exit deletes them too, unless persistent). */
  dispose: () => void;
}

/**
 * Draws many instances that never move, split into a grid of cells on the XZ plane: each cell is
 * one `InstancedMesh` entity (see {@link createInstancedMeshEntity}) with its own bounds, so three
 * culls whole cells out of view, and with `lod` each cell switches levels and hides by its own
 * screen size. No entity per instance and no per-frame cost: the matrices upload once. Each
 * cell's `Transform` is at its centre (y 0), its instances around it.
 * @returns the cells (none for no instances)
 * @throws for colours that aren't one per instance, a `cellSize` that isn't positive, and for a
 *   geometry or material id that isn't registered
 * @remarks For instances that move, or that gameplay addresses one by one, use an instanced mesh
 * pool; for static content past about 20-50k instances, an instance set
 * (`createInstanceSetAsync`) culls and selects levels per instance on the GPU.
 * @example
 * ```ts
 * import { createStaticInstances } from 'aekasha/instancing';
 *
 * const pebbles = createStaticInstances({
 *   id: 'beachPebbles',
 *   geometry: 'pebbleGeo',
 *   material: 'pebbleMaterial',
 *   instances: placements, // eg. the toolkit's scatterOnSurface
 *   lod: { levels: [{ screenSize: 0 }], cullScreenSize: 0.02 },
 * });
 * // …
 * pebbles.dispose();
 * ```
 */
export const createStaticInstances = (opts: CreateStaticInstancesOptions): StaticInstances => {
  const { id, cellSize = 16 } = opts;
  const label = `createStaticInstances ("${id}")`;
  const world = opts.world || existsOrThrow(getECSWorld(), `${label}: no ECS world.`);
  if (!(cellSize > 0)) throw new Error(`${label}: cellSize ${cellSize} isn't positive.`);
  const matrices = toMatrices(opts.instances, label);
  const count = matrices.length / MATRIX_SIZE;
  checkColors(opts.colors, count, label);

  const cells = new Map<string, { x: number; z: number; indices: number[] }>();
  for (let i = 0; i < count; i++) {
    const x = Math.floor(matrices[i * MATRIX_SIZE + 12] / cellSize);
    const z = Math.floor(matrices[i * MATRIX_SIZE + 14] / cellSize);
    const key = `${x},${z}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { x, z, indices: [] };
      cells.set(key, cell);
    }
    cell.indices.push(i);
  }

  const entityIds: number[] = [];
  if (count > 0) {
    // Once: props without an id would make a geometry or material per cell
    const { geo, mat } = resolveMeshAssets(
      { geo: opts.geometry, mat: opts.material, matOverrides: opts.matOverrides, appId: id },
      undefined,
      'createStaticInstances'
    );
    for (const [key, cell] of cells) {
      const originX = (cell.x + 0.5) * cellSize;
      const originZ = (cell.z + 0.5) * cellSize;
      const local = new Float32Array(cell.indices.length * MATRIX_SIZE);
      const allColors = opts.colors;
      const colors = allColors && new Float32Array(cell.indices.length * COLOR_SIZE);
      for (let j = 0; j < cell.indices.length; j++) {
        const i = cell.indices[j];
        local.set(matrices.subarray(i * MATRIX_SIZE, (i + 1) * MATRIX_SIZE), j * MATRIX_SIZE);
        local[j * MATRIX_SIZE + 12] -= originX;
        local[j * MATRIX_SIZE + 14] -= originZ;
        if (colors && allColors) {
          colors.set(allColors.subarray(i * COLOR_SIZE, (i + 1) * COLOR_SIZE), j * COLOR_SIZE);
        }
      }
      entityIds.push(
        createInstancedMeshEntity(
          {
            geo,
            mat,
            instances: local,
            colors,
            castShadow: opts.castShadow,
            receiveShadow: opts.receiveShadow,
            lod: opts.lod,
            preWarm: opts.preWarm,
            position: { x: originX, y: 0, z: originZ },
            appId: `${id}/${key}`,
          },
          { ...opts.entityOpts, world }
        )
      );
    }
  }

  return {
    entityIds,
    count,
    dispose: () => {
      for (const entityId of entityIds) {
        if (world.isAlive(entityId)) world.deleteEntity(entityId);
      }
    },
  };
};

/**
 * `instancing()`'s import extension member (`spawnInstances`): an imported node's GPU instances as
 * static instances in cells (`spawnImportedAsset`).
 * @internal
 */
export const spawnImportedInstances = (spawn: ImportInstancesSpawn): number[] =>
  createStaticInstances({
    id: spawn.id,
    geometry: spawn.geometry,
    material: spawn.material,
    instances: spawn.matrices,
    colors: spawn.colors,
    castShadow: spawn.castShadow,
    receiveShadow: spawn.receiveShadow,
    lod: spawn.lod,
    entityOpts: spawn.entityOpts,
  }).entityIds.slice();
