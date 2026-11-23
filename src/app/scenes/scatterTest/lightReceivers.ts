import * as THREE from 'three/webgpu';
import {
  ComponentType,
  createLightEntity,
  existsOrThrow,
  getECSWorld,
  getGeometry,
  getMaterial,
  getRootScene,
  lerror,
} from 'aekasha';
import { createInstancedMeshPool, spawnScatter } from 'aekasha/instancing';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * The light receivers part of `scatterTest`: static instance cells (i090) and pool instances in
 * the `DEFAULT` spatial domain (i100) are light receivers. `scatterTestLitRocks` is spawned on a
 * target with no mesh, front left beside the flat block and away from every other mesh (the
 * blocks' bounding spheres included), under a point light with object culling, so the rocks'
 * cells are its only receivers. Mirrored on the right, a pool of rocks joined to `DEFAULT` is under
 * a second such light: the pool's mesh isn't in the spatial index, so its instances are that
 * light's only receivers. A third object-culled point light, high above the pool, is over nothing.
 * The check logs an error, which fails the scene runner, unless the first two lights are on and
 * the third culled (the third shows light culling ran at all).
 */

const SCATTER_ID = 'scatterTestLitRocks';
/** Past both blocks' bounding spheres (about 46 m around their centres) by more than the lights'
 * range, and inside the start camera's view */
const LIT_POSITION = { x: -48, y: 0, z: -30 };
const POOL_POSITION = { x: 48, y: 0, z: -30 };
/** Over the pool, past its light's range from the rocks */
const EMPTY_POSITION = { x: 48, y: 20, z: -30 };
const LIGHT_HEIGHT = 2.5;
const LIGHT_DISTANCE = 6;
/** The pool's rocks: a 3 × 3 grid 1.5 m apart, the scatter's boulder at 0.45 (about 0.4 m) */
const POOL_GRID = 3;
const POOL_SPACING = 1.5;
const POOL_SCALE = 0.45;
/** Frames the check waits at most for light culling to cull the light over nothing: the main
 * loop runs only once the load is done */
const MAX_CHECK_FRAMES = 120;

/**
 * What the light receivers part found, in `window.__scatterTest.lightReceivers`.
 */
export type LightReceiversState = {
  /** The lit rocks' cells */
  cells: number;
  /** The pool's instances */
  poolInstances: number;
  /** Whether each light is object-culled; null before the check */
  litCulled: boolean | null;
  poolCulled: boolean | null;
  emptyCulled: boolean | null;
};

/** The state before the spawn */
export const createLightReceiversState = (): LightReceiversState => ({
  cells: 0,
  poolInstances: 0,
  litCulled: null,
  poolCulled: null,
  emptyCulled: null,
});

const createCulledPointLight = (appId: string, position: { x: number; y: number; z: number }) =>
  createLightEntity(
    {
      type: 'POINT',
      color: '#ffb36b',
      intensity: 30,
      distance: LIGHT_DISTANCE,
      position: { x: position.x, y: position.y + LIGHT_HEIGHT, z: position.z },
      objectCullingEnabled: true,
    },
    { appId }
  );

/** The pool of rocks in `DEFAULT`, its mesh in the root scene. Returns the instances' count. */
const spawnPoolRocks = () => {
  const placements = [];
  const half = ((POOL_GRID - 1) * POOL_SPACING) / 2;
  for (let i = 0; i < POOL_GRID * POOL_GRID; i++) {
    placements.push({
      position: new THREE.Vector3(
        POOL_POSITION.x - half + (i % POOL_GRID) * POOL_SPACING,
        POOL_POSITION.y,
        POOL_POSITION.z - half + Math.floor(i / POOL_GRID) * POOL_SPACING
      ),
      quaternion: new THREE.Quaternion(),
      scale: POOL_SCALE,
    });
  }
  const pool = createInstancedMeshPool({
    world: getECSWorld(),
    geometry: existsOrThrow(getGeometry('scatterTestBoulder'), 'No scatterTestBoulder geometry.'),
    material: existsOrThrow(getMaterial('scatterTestStone'), 'No scatterTestStone material.'),
    maxInstances: placements.length,
    spatialDomain: 'DEFAULT',
  });
  existsOrThrow(getRootScene(), 'No root scene.').add(pool.mesh);
  return pool.spawn(placements).length;
};

/**
 * Spawns the rocks and the two lights. Returns the check to run once the main loop runs (not
 * awaited by the load), or null when the scene was left meanwhile.
 */
export const spawnLightReceiversAsync = async (
  state: LightReceiversState,
  isCurrent: () => boolean
) => {
  const rocks = await spawnScatter(SCATTER_ID, { target: { position: LIT_POSITION, size: 8 } });
  if (!rocks || !isCurrent()) return null;
  state.cells = rocks.entityIds.length;
  state.poolInstances = spawnPoolRocks();
  const litId = createCulledPointLight('scatterTestLitLight', LIT_POSITION);
  const poolId = createCulledPointLight('scatterTestPoolLight', POOL_POSITION);
  const emptyId = createCulledPointLight('scatterTestEmptyLight', EMPTY_POSITION);

  return async () => {
    const world = getECSWorld();
    // Light culling tests every light in the frame it culls the one over nothing, so the lit one
    // is read once that one is culled
    for (let frame = 0; frame < MAX_CHECK_FRAMES; frame++) {
      if (world.hasComponent(emptyId, ComponentType.TAG_OBJECT_CULLED)) break;
      await nextFrames(1);
      if (!isCurrent()) return;
    }
    state.litCulled = world.hasComponent(litId, ComponentType.TAG_OBJECT_CULLED);
    state.poolCulled = world.hasComponent(poolId, ComponentType.TAG_OBJECT_CULLED);
    state.emptyCulled = world.hasComponent(emptyId, ComponentType.TAG_OBJECT_CULLED);
    const isCulledText = (isCulled: boolean | null) => (isCulled ? 'is' : 'is not');
    if (
      !state.cells ||
      !state.poolInstances ||
      state.litCulled ||
      state.poolCulled ||
      !state.emptyCulled
    ) {
      lerror(
        `scatterTest: the point light over ${state.cells} rock cells ${isCulledText(state.litCulled)} object-culled, the one over ${state.poolInstances} pool instances ${isCulledText(state.poolCulled)} and the one over nothing ${isCulledText(state.emptyCulled)}; the first two should be on, the third culled.`
      );
    }
  };
};
