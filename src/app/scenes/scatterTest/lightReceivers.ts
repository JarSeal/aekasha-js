import { ComponentType, createLightEntity, getECSWorld, lerror } from 'aekasha';
import { spawnScatter } from 'aekasha/instancing';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * i090's part of `scatterTest`: static instance cells are light receivers. `scatterTestLitRocks`
 * is spawned on a target with no mesh, front left beside the flat block and away from every other
 * mesh (the blocks' bounding spheres included), under a point light with object culling, so the
 * rocks' cells are its only receivers; a second object-culled point light, mirrored on the right,
 * is over nothing. The check logs an error, which fails the scene runner, unless the first light
 * is on and the second culled (the second shows light culling ran at all).
 */

const SCATTER_ID = 'scatterTestLitRocks';
/** Past both blocks' bounding spheres (about 46 m around their centres) by more than the lights'
 * range, and inside the start camera's view */
const LIT_POSITION = { x: -48, y: 0, z: -30 };
const EMPTY_POSITION = { x: 48, y: 0, z: -30 };
const LIGHT_HEIGHT = 2.5;
const LIGHT_DISTANCE = 6;
/** Frames the check waits at most for light culling to cull the light over nothing: the main
 * loop runs only once the load is done */
const MAX_CHECK_FRAMES = 120;

/**
 * What the light receivers part found, in `window.__scatterTest.lightReceivers`.
 */
export type LightReceiversState = {
  /** The lit rocks' cells */
  cells: number;
  /** Whether each light is object-culled; null before the check */
  litCulled: boolean | null;
  emptyCulled: boolean | null;
};

/** The state before the spawn */
export const createLightReceiversState = (): LightReceiversState => ({
  cells: 0,
  litCulled: null,
  emptyCulled: null,
});

const createCulledPointLight = (appId: string, position: { x: number; z: number }) =>
  createLightEntity(
    {
      type: 'POINT',
      color: '#ffb36b',
      intensity: 30,
      distance: LIGHT_DISTANCE,
      position: { x: position.x, y: LIGHT_HEIGHT, z: position.z },
      objectCullingEnabled: true,
    },
    { appId }
  );

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
  const litId = createCulledPointLight('scatterTestLitLight', LIT_POSITION);
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
    state.emptyCulled = world.hasComponent(emptyId, ComponentType.TAG_OBJECT_CULLED);
    if (!state.cells || state.litCulled || !state.emptyCulled) {
      lerror(
        `scatterTest: the point light over ${state.cells} rock cells is ${state.litCulled ? '' : 'not '}object-culled and the one over nothing ${state.emptyCulled ? 'is' : 'is not'}; the first should be on, the second culled.`
      );
    }
  };
};
