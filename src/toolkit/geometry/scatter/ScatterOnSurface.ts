import * as THREE from 'three/webgpu';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { createMeshEntity, type MeshProps, getECSWorld, lwarn } from 'aekasha';
import type { CoreEntityOpts } from 'aekasha/schemas';
import { createSeededRandom } from 'aekasha';

// three's MeshSurfaceSampler has setRandomGenerator, which @types/three (0.186) doesn't declare:
// the cast adds that one method
interface SeedableMeshSurfaceSampler extends MeshSurfaceSampler {
  setRandomGenerator(randomFunction: () => number): this;
}

/**
 * One placement {@link scatterOnSurface} found: where a thing goes, and how it's turned and
 * sized.
 */
export interface ScatterPlacement {
  /** The point on the surface, in world space. */
  position: THREE.Vector3;
  /** The surface's unit normal at the point, in world space. */
  normal: THREE.Vector3;
  /**
   * The world rotation: up along the normal with `alignToNormal`, else world up, then a turn
   * about it with `randomYRotation`.
   */
  quaternion: THREE.Quaternion;
  /** The uniform scale, from `scaleRange`. */
  scale: number;
}

/** {@link scatterOnSurface}'s options: the surface, how many points, and how they're spread. */
export interface ScatterOptions {
  /**
   * The mesh whose surface to scatter across, a terrain or any other object (a rock, a roof),
   * read with its world matrix.
   */
  surface: THREE.Mesh;
  /** How many points to place; fewer come back when `minSpacing` can't fit them all. */
  count: number;
  /** Deterministic seed, an integer (default 1): the same seed and surface give the same points. */
  seed?: number;
  /**
   * The least distance between two points, in world units (default 0: none, so points may
   * cluster). A point that lands too close is drawn again, up to `maxAttemptsPerPoint` times,
   * then skipped: a cheap approximation of Poisson-disc spacing.
   */
  minSpacing?: number;
  /** The draws per point with `minSpacing`, before the point is skipped (default 30). */
  maxAttemptsPerPoint?: number;
  /** The uniform scale's range, one value drawn per placement (default [1, 1]). */
  scaleRange?: [min: number, max: number];
  /**
   * Turn each placement's up axis to the surface normal (moss or debris on a sloped rock) instead
   * of world up (default false: trees standing upright on a slope).
   */
  alignToNormal?: boolean;
  /** Turn each placement by a random angle about its up axis (default true). */
  randomYRotation?: boolean;
}

const _worldPosition = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _yRotation = new THREE.Quaternion();
const _normalMatrix = new THREE.Matrix3();

/**
 * The accepted positions in grid cells about `minSpacing` wide, so a candidate is checked against
 * the 27 cells around its own only. Each position closer than `minSpacing` is in one of them, so
 * the answer is the scan of every position's.
 */
const createSpacingGrid = (minSpacing: number) => {
  // A hair wider than minSpacing: two cell indices of positions closer than it then never differ
  // by 2, whatever the division rounds
  const cellSize = minSpacing * (1 + 1e-6);
  const minSpacingSq = minSpacing * minSpacing;
  // Keyed by a hash of the cell's indices: cells that share a key share a list, which only costs
  // a few distance checks more
  const cells = new Map<number, THREE.Vector3[]>();
  const cellKey = (ix: number, iy: number, iz: number) =>
    Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);

  const isTooClose = (position: THREE.Vector3) => {
    const ix = Math.floor(position.x / cellSize);
    const iy = Math.floor(position.y / cellSize);
    const iz = Math.floor(position.z / cellSize);
    for (let x = ix - 1; x <= ix + 1; x++) {
      for (let y = iy - 1; y <= iy + 1; y++) {
        for (let z = iz - 1; z <= iz + 1; z++) {
          const cell = cells.get(cellKey(x, y, z));
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            if (cell[i].distanceToSquared(position) < minSpacingSq) return true;
          }
        }
      }
    }
    return false;
  };

  const add = (position: THREE.Vector3) => {
    const key = cellKey(
      Math.floor(position.x / cellSize),
      Math.floor(position.y / cellSize),
      Math.floor(position.z / cellSize)
    );
    const cell = cells.get(key);
    if (cell) cell.push(position);
    else cells.set(key, [position]);
  };

  return { isTooClose, add };
};

/**
 * Scatters up to `count` seeded points across a mesh's surface, area-weighted (three's
 * `MeshSurfaceSampler`), and returns them as placements in world space: data only. Place things
 * with them: an instanced pool (`createInstancedMeshPool`, `aekasha/instancing`) for many,
 * {@link bakeScatterToInstancedMesh} into a plain `InstancedMesh`, or
 * {@link spawnScatterAsMeshEntities} for a handful of entities. Colliders are the caller's
 * (`createPhysicsEntity` at a placement's `position`).
 * @remarks With `minSpacing` it may return fewer than `count` placements: a point that finds no
 * free spot in its draws is skipped. Each placement allocates its vectors and quaternion: meant
 * for a scene's load, not per frame.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 *
 * // 500 bushes on a terrain mesh, at least 2 m apart, baked into a plain InstancedMesh (yours to
 * // dispose; an instanced pool makes each one an entity and goes with its scene)
 * const placements = scatterOnSurface({
 *   surface: terrainMesh,
 *   count: 500,
 *   seed: 9,
 *   minSpacing: 2,
 *   scaleRange: [0.7, 1.3],
 * });
 * const bushes = new THREE.InstancedMesh(generateBushGeometry(), bushMaterial, 500);
 * bakeScatterToInstancedMesh(bushes, placements);
 * getRootScene()?.add(bushes);
 * ```
 */
export const scatterOnSurface = (opts: ScatterOptions): ScatterPlacement[] => {
  const {
    surface,
    count,
    seed = 1,
    minSpacing = 0,
    maxAttemptsPerPoint = 30,
    scaleRange = [1, 1],
    alignToNormal = false,
    randomYRotation = true,
  } = opts;

  const random = createSeededRandom(seed);
  const sampler = new MeshSurfaceSampler(surface) as SeedableMeshSurfaceSampler;
  sampler.setRandomGenerator(random);
  sampler.build();

  surface.updateWorldMatrix(true, false);
  _normalMatrix.getNormalMatrix(surface.matrixWorld);

  const placements: ScatterPlacement[] = [];
  const spacingGrid = minSpacing > 0 ? createSpacingGrid(minSpacing) : null;
  const attemptsPerPoint = minSpacing > 0 ? maxAttemptsPerPoint : 1;

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < attemptsPerPoint; attempt++) {
      sampler.sample(_worldPosition, _worldNormal);
      _worldPosition.applyMatrix4(surface.matrixWorld);
      _worldNormal.applyMatrix3(_normalMatrix).normalize();

      if (spacingGrid?.isTooClose(_worldPosition)) continue;

      const upAxis = alignToNormal ? _worldNormal : _up;
      const quaternion = new THREE.Quaternion().setFromUnitVectors(_up, upAxis);
      if (randomYRotation) {
        _yRotation.setFromAxisAngle(_up, random() * Math.PI * 2);
        quaternion.multiply(_yRotation);
      }

      const scale = THREE.MathUtils.lerp(scaleRange[0], scaleRange[1], random());

      const position = _worldPosition.clone();
      placements.push({ position, normal: _worldNormal.clone(), quaternion, scale });
      spacingGrid?.add(position);
      break;
      // When every draw lands too close, the point is skipped (see the doc's remark)
    }
  }

  return placements;
};

/**
 * Bakes placements into an existing `InstancedMesh`'s matrices, starting at `startIndex`: the
 * world-space placements become instance matrices in the mesh's own space (its world matrix
 * undone), as many as its capacity holds (the rest are dropped with a warning). Sets the mesh's
 * `count` to the returned index, so instances past the baked ones aren't drawn. Creates no
 * entities: for per-instance ECS state, use the instancing feature's `createInstancedMeshPool`
 * (`aekasha/instancing`) instead.
 * @returns the next free index (`startIndex` plus the placements baked)
 * @remarks The mesh's world matrix is read once, now: a mesh moved later moves its instances
 * with it.
 */
export const bakeScatterToInstancedMesh = (
  mesh: THREE.InstancedMesh,
  placements: ScatterPlacement[],
  startIndex = 0
): number => {
  const matrix = new THREE.Matrix4();
  const scaleVector = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false);
  const worldToMesh = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const capacity = mesh.instanceMatrix.count;
  const bakedCount = Math.max(0, Math.min(placements.length, capacity - startIndex));
  if (bakedCount < placements.length) {
    lwarn(
      `[bakeScatterToInstancedMesh] ${placements.length - bakedCount} of ${placements.length} placements dropped: the mesh holds ${capacity} instances, from index ${startIndex}.`
    );
  }

  let index = startIndex;
  for (let i = 0; i < bakedCount; i++) {
    const placement = placements[i];
    scaleVector.setScalar(placement.scale);
    matrix.compose(placement.position, placement.quaternion, scaleVector).premultiply(worldToMesh);
    mesh.setMatrixAt(index, matrix);
    index++;
  }

  mesh.count = index;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return index;
};

/** {@link spawnScatterAsMeshEntities}' options: each entity's mesh props and entity options. */
export interface SpawnScatterMeshOptions {
  /** Each mesh's geometry: a geometry, a registered geometry's id, or props. */
  geo: MeshProps['geo'];
  /** Each mesh's material: a material, a registered material's id, or props. */
  mat: MeshProps['mat'];
  /** Whether the meshes cast shadows. */
  castShadow?: boolean;
  /** Whether the meshes receive shadows. */
  receiveShadow?: boolean;
  /** Each entity's options, the same for all of them (so no fixed `appId`). */
  entityOpts?: CoreEntityOpts;
}

/**
 * Creates one mesh entity per placement in the default world (`createMeshEntity`), at its
 * position, rotation and scale: each an entity of its own, for a handful of static props. For
 * hundreds or thousands, use an instanced pool or {@link bakeScatterToInstancedMesh}.
 * @returns the entities' ids, in the placements' order
 */
export const spawnScatterAsMeshEntities = (
  placements: ScatterPlacement[],
  opts: SpawnScatterMeshOptions
): number[] => {
  const world = getECSWorld();
  const entityIds: number[] = [];

  for (const placement of placements) {
    const entityId = createMeshEntity(
      {
        geo: opts.geo,
        mat: opts.mat,
        castShadow: opts.castShadow,
        receiveShadow: opts.receiveShadow,
        position: { x: placement.position.x, y: placement.position.y, z: placement.position.z },
        quaternion: placement.quaternion,
        scale: { x: placement.scale, y: placement.scale, z: placement.scale },
      },
      opts.entityOpts,
      world
    );
    entityIds.push(entityId);
  }

  return entityIds;
};
