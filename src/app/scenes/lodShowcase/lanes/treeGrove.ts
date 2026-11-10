import * as THREE from 'three/webgpu';
import { saveBufferGeometry, createMaterial, createSeededRandom, getGeometry } from 'aekasha';
import { createInstancedLodPool } from 'aekasha/instancing';
import type { InstancePlacement } from 'aekasha/instancing';
import { generateCrossQuads } from 'aekasha/lod';
import type { LodDef } from 'aekasha/lod';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import { generateTreeGeometry } from 'aekasha/toolkit/geometry';
import type { ShowcaseLane, ShowcaseLaneContext } from '../layout';

/** The cross-quads' export (next to the scene's JSON), listed in its `impostors`. */
const CROSS_ID = 'lodShowcaseTreeCross';
const TREE_GEO_ID = 'lodShowcaseTreeGeo';
const TREE_LOD1_GEO_ID = 'lodShowcaseTreeLod1Geo';
const TREE = { trunkHeight: 1.4, foliageRadius: 1.2, foliageHeight: 3 };
/** Trees per level band. */
const PER_BAND = 3;
/** How far a tree stands off the lane's line, at most. */
const JITTER_X = 1.5;

/**
 * The grove's trees on the lane `ctx` lays out: largeWorld's trees (its generators, larger and with
 * more segments) at 8 and 4 radial segments, then three alpha-cut planes with the tree baked on
 * them, loaded from their export, hidden past the last band. The pool's lane and the instance
 * set's (`instanceSetGrove.ts`) both draw them: the same levels, LOD and placements (one seed), so
 * the two lanes differ only in what draws them. The geometries, materials and cross-quads are
 * registered by the first lane and reused by the second.
 */
export const createShowcaseTrees = (ctx: ShowcaseLaneContext) => {
  const geometry =
    getGeometry(TREE_GEO_ID) ??
    saveBufferGeometry(generateTreeGeometry({ ...TREE, radialSegments: 8 }).geometry, {
      id: TREE_GEO_ID,
    });
  const lod1Geometry =
    getGeometry(TREE_LOD1_GEO_ID) ??
    saveBufferGeometry(generateTreeGeometry({ ...TREE, radialSegments: 4 }).geometry, {
      id: TREE_LOD1_GEO_ID,
    });
  const materials = [
    createMaterial({
      id: 'lodShowcaseTreeTrunkMat',
      type: 'PHONG',
      params: { color: '#5b3a29' },
    }),
    createMaterial({
      id: 'lodShowcaseTreeFoliageMat',
      type: 'PHONG',
      params: { color: '#2f6a3a', flatShading: true },
    }),
  ];
  // Built from its export, so nothing is baked at load (a second call returns the first one's);
  // re-export it from the LOD tab's Impostors after changing the tree
  const cross = generateCrossQuads(geometry, materials, { id: CROSS_ID });

  // From the start camera (fov 50) a tree (LOD radius 4.26) crosses 0.15 at 61 m, 0.075 at 122 m
  // and hides below 0.04, from 228 m (254 m on the way out)
  const lod: Omit<LodDef, 'levels'> = { cullScreenSize: 0.04 };
  const levels = [
    { geometry, material: materials, screenSize: 0.15 },
    { geometry: lod1Geometry, material: materials, screenSize: 0.075 },
    { geometry: cross.geometry, material: cross.material, screenSize: 0 },
  ];
  const def: LodDef = { ...lod, levels: levels.map(({ screenSize }) => ({ screenSize })) };
  const radius = getConservativeGeometryRadius(geometry);

  const random = createSeededRandom(7);
  const placements: InstancePlacement[] = ctx.getSlots(radius, def, PER_BAND).map((slot) => {
    // The tree's origin is its base, which the selection measures from
    const { x, z } = ctx.placeAt(slot.distance, 0);
    return {
      position: new THREE.Vector3(x + (random() * 2 - 1) * JITTER_X, 0, z),
      quaternion: new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        random() * Math.PI * 2
      ),
      scale: 1,
    };
  });

  return { levels, lod, def, radius, placements };
};

/**
 * The pool and cross-quads lane: the grove's trees (`createShowcaseTrees`) in an instanced LOD
 * pool, an entity per tree. Past the last band the trees fade out.
 */
export const treeGroveLane: ShowcaseLane = {
  id: 'treeGrove',
  title: 'Pool and cross-quads',
  description:
    'An instanced LOD pool of trees: two mesh levels, exported cross-quads, then a cull fade.',
  create: async (ctx) => {
    const { levels, lod, def, radius, placements } = createShowcaseTrees(ctx);

    const pool = createInstancedLodPool({
      world: ctx.world,
      levels,
      lod,
      maxInstances: placements.length,
      receiveShadow: true,
    });
    ctx.rootScene.add(...pool.meshes);
    const entityIds = pool.spawn(placements);

    return {
      getEntityIds: () => entityIds,
      radius,
      switchDistances: ctx.getSwitchDistances(radius, def),
    };
  },
};
