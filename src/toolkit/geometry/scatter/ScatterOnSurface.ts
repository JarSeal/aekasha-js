import * as THREE from 'three/webgpu';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { createMeshEntity, type MeshProps, getECSWorld, lwarn } from 'aekasha';
import type { CoreEntityOpts } from 'aekasha/schemas';
import { createSeededRandom } from 'aekasha';

/**
 * `MeshSurfaceSampler.setRandomGenerator` exists at runtime (three@0.183.2's
 * examples/jsm) but is missing from the `@types/three` declarations bundled here —
 * this narrows the cast to just the one extra method instead of reaching for `any`.
 */
interface SeedableMeshSurfaceSampler extends MeshSurfaceSampler {
  setRandomGenerator(randomFunction: () => number): this;
}

export interface ScatterPlacement {
  position: THREE.Vector3;
  /** World-space surface normal at the sampled point (mesh-local normal transformed by the surface's world matrix). */
  normal: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
}

export interface ScatterOptions {
  /**
   * The mesh whose surface to scatter across. This is the same primitive for "scatter
   * across a terrain" and "scatter on the surface of another object" (a rock, a roof, a
   * wall) — both are just a `THREE.Mesh` surface to sample, so one function covers both
   * cases the request asked for.
   */
  surface: THREE.Mesh;
  count: number;
  seed?: number;
  /**
   * Minimum spacing between accepted points, in world units. Enforced by rejection-sampling
   * against the accepted points nearby (a grid of `minSpacing` cells; up to `maxAttemptsPerPoint`
   * samples per point) — a cheap approximation of blue-noise/Poisson-disc spacing, not exact.
   * 0 (default) disables spacing entirely (pure random, may cluster/overlap).
   */
  minSpacing?: number;
  /** Max resample attempts per point when `minSpacing` is set, before giving up on that slot. */
  maxAttemptsPerPoint?: number;
  /** Uniform scale range; one random value is picked per placement. Defaults to no scale variance. */
  scaleRange?: [number, number];
  /**
   * Align the placement's up axis to the sampled surface normal (e.g. moss/debris on a
   * sloped rock) instead of always facing world-up (the common case for trees/foliage that
   * should stand upright even on sloped terrain). Defaults to false (world-up).
   */
  alignToNormal?: boolean;
  /** Randomize rotation around the up axis. Defaults to true. */
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
 * Scatters `count` points across a mesh's surface using area-weighted random sampling
 * (`MeshSurfaceSampler`, shipped with three's examples/jsm — no new dependency, same import
 * style already used for `mergeGeometries` elsewhere in this repo). Returns placement data
 * only; use `bakeScatterToInstancedMesh` (bulk, e.g. foliage) or `spawnScatterAsMeshEntities`
 * (individual ECS entities, e.g. a handful of static props) to actually place something.
 *
 * Physics is intentionally out of scope here (see docs/plans/p090_large-ecs-test-world-scene.md
 * §1.3) — this only computes where things go, not what collides with them. A caller can use
 * each placement's `position`/`normal` to add a collider (`createPhysicsEntity`) without this
 * function needing to change.
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
      // If every attempt fails, this slot is simply skipped — a first-pass scatterer may
      // return fewer than `count` placements under tight `minSpacing`, which is an
      // acceptable outcome to refine later rather than a bug to fix now.
    }
  }

  return placements;
};

/**
 * Bakes placements into an existing `InstancedMesh`'s matrices, starting at `startIndex`: the
 * world-space placements become instance matrices in the mesh's own space (its world matrix
 * undone), as many as its capacity holds (the rest are dropped with a warning). Sets the mesh's
 * `count` to the returned index, so instances past the baked ones aren't drawn. Does not create
 * any ECS entities: for per-instance ECS state, use the instancing feature's
 * `createInstancedMeshPool` (`aekasha/instancing`) instead.
 * Returns the next free index.
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

export interface SpawnScatterMeshOptions {
  geo: MeshProps['geo'];
  mat: MeshProps['mat'];
  castShadow?: boolean;
  receiveShadow?: boolean;
  entityOpts?: CoreEntityOpts;
}

/**
 * Spawns one individual mesh entity per placement via `createMeshEntity`, at its position,
 * rotation and scale — simple and individually ECS-addressable, but does not scale to thousands
 * of instances; prefer `bakeScatterToInstancedMesh` for large foliage/tree counts. Good fit for a
 * handful of scattered static props.
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
