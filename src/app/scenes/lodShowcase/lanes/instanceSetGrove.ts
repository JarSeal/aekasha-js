import type * as THREE from 'three/webgpu';
import { createInstanceSetAsync } from 'aekasha/instancing';
import type { ShowcaseLane, ShowcaseLaneState } from '../layout';
import { createShowcaseTrees } from './treeGrove';

const DESCRIPTIONS = {
  GPU: 'The pool lane’s trees as an instance set, no entity per tree: culled and LOD-selected per tree by a compute pass, drawn by indirect draws (the GPU backend, WebGPU).',
  CPU: 'The pool lane’s trees as an instance set, no entity per tree: LOD-selected per tree by a loop over its arrays, a level mesh per level (the CPU backend: WebGL2, or forced from the LOD tab).',
} as const;

/** A geometry's triangles. */
const getTriangles = (geometry: THREE.BufferGeometry) =>
  Math.floor((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);

/**
 * The instance set and cross-quads lane: the pool lane's trees (`createShowcaseTrees`: the same
 * levels, LOD and placements) drawn by an instance set, so the two lanes side by side show the
 * same levels at the same distances. Its description names the backend the set runs on.
 */
export const instanceSetGroveLane: ShowcaseLane = {
  id: 'instanceSetGrove',
  title: 'Instance set and cross-quads',
  description: 'The pool lane’s trees as an instance set: no entity per tree.',
  create: async (ctx) => {
    const { levels, lod, def, radius, placements } = createShowcaseTrees(ctx);
    const state: ShowcaseLaneState = {
      getEntityIds: () => [],
      radius,
      switchDistances: ctx.getSwitchDistances(radius, def),
    };

    // #region instance-set-grove (shown in the Hub: features/lod, "Instance sets")
    const set = await createInstanceSetAsync({
      world: ctx.world,
      levels, // a LOD pool's: geometry, material(s), screenSize, castShadow
      lod, // { cullScreenSize: 0.04 }, shared by every instance
      maxInstances: placements.length,
      receiveShadow: true,
    });
    // null: the scene exited while the set's backend loaded
    if (!set) return state;
    ctx.rootScene.add(set.object); // under the root scene: world space
    set.addInstances(placements); // plain data, no entity per instance
    // #endregion instance-set-grove

    return {
      ...state,
      instanceSet: {
        set,
        centres: placements.map((placement) => placement.position),
        levelTriangles: levels.map((level) => getTriangles(level.geometry)),
      },
      description: DESCRIPTIONS[set.backend],
    };
  },
};
