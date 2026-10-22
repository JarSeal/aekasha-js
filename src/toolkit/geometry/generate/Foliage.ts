import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createGeometry, deleteGeometry } from 'aekasha';
import { createSeededRandom } from 'aekasha';

/** {@link generateTreeGeometry}'s options, in world units; every one has a default. */
export interface TreeGeometryOptions {
  /** The trunk's radius at the top (default 0.15); the bottom is 1.3 times as wide. */
  trunkRadius?: number;
  /** The trunk's height (default 1.5), from y = 0 up. */
  trunkHeight?: number;
  /** The cone canopy's radius at its base (default 0.9). */
  foliageRadius?: number;
  /** The canopy's height (default 2); it overlaps the trunk's top by 0.15. */
  foliageHeight?: number;
  /** The trunk's and the canopy's sides (default 5): kept low for a very low-poly look. */
  radialSegments?: number;
}

/** {@link generateTreeGeometry}'s result: the tree's geometry and its two material groups. */
export interface GeneratedTreeGeometry {
  /** The merged trunk and canopy, standing on y = 0, not registered. */
  geometry: THREE.BufferGeometry;
  /**
   * The geometry's material group indices: give its mesh (or `InstancedMesh`) a two-material
   * array, the trunk's material at `trunk` and the canopy's at `foliage`.
   */
  materialGroups: { trunk: number; foliage: number };
}

/**
 * Builds a very low-poly tree: a cylinder trunk topped with a cone canopy, merged into one
 * geometry with two material groups (trunk, canopy). The geometry isn't registered: save it with
 * `saveBufferGeometry`, or hand it to an instanced pool, which owns it.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 *
 * // A forest: one instanced mesh (aekasha/instancing) with a tree at each placement
 * const tree = generateTreeGeometry({ trunkHeight: 2, radialSegments: 6 });
 * const material: THREE.Material[] = [];
 * material[tree.materialGroups.trunk] = createMaterial({
 *   id: 'trunkMat',
 *   type: 'LAMBERT',
 *   params: { color: '#6b4a2b' },
 * });
 * material[tree.materialGroups.foliage] = createMaterial({
 *   id: 'leafMat',
 *   type: 'LAMBERT',
 *   params: { color: '#3f7a3a' },
 * });
 * const world = getECSWorld();
 * const pool = createInstancedMeshPool({
 *   world,
 *   geometry: saveBufferGeometry(tree.geometry, { id: 'treeGeo' }),
 *   material,
 *   maxInstances: placements.length,
 * });
 * getRootScene()?.add(pool.mesh);
 * pool.spawn(world, placements);
 * ```
 */
export const generateTreeGeometry = (opts: TreeGeometryOptions = {}): GeneratedTreeGeometry => {
  const {
    trunkRadius = 0.15,
    trunkHeight = 1.5,
    foliageRadius = 0.9,
    foliageHeight = 2,
    radialSegments = 5,
  } = opts;

  const trunkGeo = createGeometry({
    type: 'CYLINDER',
    params: {
      radiusTop: trunkRadius,
      radiusBottom: trunkRadius * 1.3,
      height: trunkHeight,
      radialSegments,
    },
  });
  trunkGeo.translate(0, trunkHeight / 2, 0);

  const foliageGeo = createGeometry({
    type: 'CONE',
    params: { radius: foliageRadius, height: foliageHeight, radialSegments },
  });
  // Overlap the cone slightly into the trunk so there's no visible gap at the seam.
  foliageGeo.translate(0, trunkHeight + foliageHeight / 2 - 0.15, 0);

  const geometry = mergeGeometries([trunkGeo, foliageGeo], true)!;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  deleteGeometry([trunkGeo.userData.id, foliageGeo.userData.id]);

  return { geometry, materialGroups: { trunk: 0, foliage: 1 } };
};

/** {@link generateBushGeometry}'s options, in world units; every one has a default. */
export interface BushGeometryOptions {
  /** How many low-poly spheres make the bush (default 3); 0 gives an empty geometry. */
  clusterCount?: number;
  /** The spheres' radius (default 0.5), and how far they spread around the origin. */
  baseRadius?: number;
  /** How much a sphere's radius varies, in total around `baseRadius` (default 0.2). */
  radiusVariance?: number;
  /** Each sphere's width and height segments (default 5): kept low for a very low-poly look. */
  segments?: number;
  /** Deterministic seed, an integer (default 1): the same seed gives the same bush. */
  seed?: number;
}

/**
 * Builds a very low-poly bush: a few seeded spheres merged into one geometry around the origin,
 * each raised by about 0.6 of its radius (sunk a little into the ground), for one material. The geometry isn't registered: save it with
 * `saveBufferGeometry`, or hand it to an instanced pool, which owns it.
 * @example
 * ```ts
 * // Three bushes of the same shape
 * const bushGeo = saveBufferGeometry(generateBushGeometry({ clusterCount: 4, seed: 2 }), {
 *   id: 'bushGeo',
 * });
 * for (const x of [-3, 0, 3]) {
 *   createMeshEntity({ geo: bushGeo, mat: 'leafMat', position: { x, y: 0, z: 0 } });
 * }
 * ```
 */
export const generateBushGeometry = (opts: BushGeometryOptions = {}): THREE.BufferGeometry => {
  const { clusterCount = 3, baseRadius = 0.5, radiusVariance = 0.2, segments = 5, seed = 1 } = opts;

  const random = createSeededRandom(seed);
  const blobGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < clusterCount; i++) {
    const radius = baseRadius + (random() - 0.5) * radiusVariance;
    const blobGeo = createGeometry({
      type: 'SPHERE',
      params: { radius, widthSegments: segments, heightSegments: segments },
    });
    blobGeo.translate(
      (random() - 0.5) * baseRadius,
      radius * 0.6 + (random() - 0.5) * 0.1,
      (random() - 0.5) * baseRadius
    );
    blobGeos.push(blobGeo);
  }
  // No clusters: an empty geometry (mergeGeometries needs one to merge)
  if (!blobGeos.length) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    empty.computeBoundingSphere();
    empty.computeBoundingBox();
    return empty;
  }

  const geometry = mergeGeometries(blobGeos, false)!;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  deleteGeometry(blobGeos.map((geo) => geo.userData.id));

  return geometry;
};
