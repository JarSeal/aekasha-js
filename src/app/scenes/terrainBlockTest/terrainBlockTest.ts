import {
  IS_DEBUG_ENV,
  createCameraEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  getMeshByAppId,
  lerror,
  registerOnSceneExit,
} from 'aekasha';
import { createPhysicsEntity, getPhysicsSimClock } from 'aekasha/physics';
import { spawnTerrainBlock, type TerrainBlock } from 'aekasha/terrain';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * p306 Phase 2's verification scene: three 100 m terrain blocks side by side, spawned from their
 * `*.terrainBlock.json`s (the scene JSON lists them; the gather loads their imports, materials and
 * input textures with the scene):
 *
 * - **Middle** (`terrainBlockTestSmooth`): the Gym's `terrainSmooth.glb` node as a JSON-only
 *   block, its `HEIGHTFIELD` read from the geometry by position, grass through its own
 *   `materialInputs` (a variant of `textureSetSurface`).
 * - **Right** (`terrainBlockTestNoise`): the toolkit's `noiseTerrain` (p306 Phase 3, registered by
 *   the app's install), with the generator's heightfield (`toHeightfieldColliderParams` from its
 *   row-major heights).
 * - **Left** (`terrainBlockTestTrimesh`): the same generator with a `TRIMESH` collider read from
 *   the geometry (the generator's heightfield unused), rocks through its inputs, casting no
 *   shadow.
 *
 * A 3 × 3 grid of boxes falls on each block. `window.__terrainBlockTest` holds the spawn results
 * and, after `SETTLE_STEPS` fixed steps, where each box is; a block without its collider, or a box
 * that didn't come to rest on its block (under the lowest terrain: fell through; still high:
 * caught on nothing; outside the block's square: slid off), logs an error, which fails the scene
 * runner (its `probeSteps` is past `SETTLE_STEPS`, `devTools/verify/scenes.config.ts`). The collider
 * wireframes are in the Physics API tab.
 *
 * The scene also lists `terrainBlockTestLarge` (a 256 m / 257² `rulesTerrain` block with AO), which
 * its tab spawns (p306 Phase 4's exit: the frames while it generates on the toolkit's terrain
 * worker, `_dbg__terrainBlockTest.ts`); the load doesn't.
 */

const SCENE_ID = 'terrainBlockTest';
const BLOCK_IDS = ['terrainBlockTestSmooth', 'terrainBlockTestNoise', 'terrainBlockTestTrimesh'];
const BOX_HALF = 1;
const BLOCK_SIZE = 100;
const BOX_SPACING = 15;
const DROP_HEIGHT = 35;
/** Fixed steps until the boxes rest (the fall takes about 160, the tumble down the slopes more),
 * short of the probe's 360 */
const SETTLE_STEPS = 340;
/** Below every block's lowest point (the TRIMESH block's noise reaches -18 m) */
const LOWEST_TERRAIN_Y = -20;

/** A box: the block it fell on (its grid x), and where it is (after `SETTLE_STEPS`) */
type BoxResult = { appId: string; blockX: number; x: number; y: number; z: number };
const state: {
  blocks: Pick<TerrainBlock, 'id' | 'meshEntityId' | 'physicsEntityId'>[];
  boxes: BoxResult[];
  isSettled: boolean;
} = { blocks: [], boxes: [], isSettled: false };

/** The 3 × 3 boxes over a block, each a dynamic body on its mesh */
const dropBoxesAsync = (blockX: number) => {
  const drops: Promise<number>[] = [];
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const x = blockX * BLOCK_SIZE + col * BOX_SPACING;
      const z = row * BOX_SPACING;
      const appId = `terrainBlockTestBox_${blockX}_${col}_${row}`;
      const meshId = createMeshEntity({
        geo: {
          type: 'BOX',
          params: { width: BOX_HALF * 2, height: BOX_HALF * 2, depth: BOX_HALF * 2 },
        },
        mat: 'terrainBlockTestBox',
        castShadow: true,
        receiveShadow: true,
        position: { x, y: DROP_HEIGHT, z },
        appId,
      });
      drops.push(
        createPhysicsEntity({
          colliders: { type: 'BOX', friction: 1.5 },
          body: { rigidType: 'DYNAMIC' },
          target: meshId,
        })
      );
      state.boxes.push({ appId, blockX, x, y: DROP_HEIGHT, z });
    }
  }
  return Promise.all(drops);
};

/** Whether a box rests on its block: above the lowest terrain, below its drop and inside the
 * block's square */
const isOnItsBlock = ({ blockX, x, y, z }: BoxResult) => {
  const half = BLOCK_SIZE / 2;
  return (
    y > LOWEST_TERRAIN_Y &&
    y < DROP_HEIGHT - BOX_HALF * 4 &&
    Math.abs(x - blockX * BLOCK_SIZE) < half &&
    Math.abs(z) < half
  );
};

/** After `SETTLE_STEPS` steps, where each box is; logs an error for one not on its block */
const checkSettledAsync = async (isCurrent: () => boolean) => {
  while (getPhysicsSimClock() < SETTLE_STEPS) {
    await nextFrames(1);
    if (!isCurrent()) return;
  }
  for (const box of state.boxes) {
    const position = getMeshByAppId(box.appId)?.position;
    Object.assign(box, position ? { x: position.x, y: position.y, z: position.z } : { y: NaN });
  }
  state.isSettled = true;
  const astray = state.boxes.filter((box) => !isOnItsBlock(box));
  if (astray.length) {
    const at = (box: BoxResult) =>
      `${box.appId} at (${box.x.toFixed(2)}, ${box.y.toFixed(2)}, ${box.z.toFixed(2)})`;
    lerror(
      `terrainBlockTest: ${astray.length} boxes didn't come to rest on their block: ${astray.map(at).join(', ')}.`
    );
  }
};

export const scene = async () => {
  (window as unknown as { __terrainBlockTest: typeof state }).__terrainBlockTest = state;
  state.blocks = [];
  state.boxes = [];
  state.isSettled = false;
  let isLoaded = true;
  registerOnSceneExit(SCENE_ID, () => {
    isLoaded = false;
  });
  const isCurrent = () => isLoaded;

  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 50,
      far: 1000,
      position: { x: 0, y: 140, z: 230 },
      lookAtPoint: { x: 0, y: 0, z: 0 },
      active: true,
    },
    { appId: 'terrainBlockTestCam', debugData: { name: 'Terrain blocks overview' } }
  );
  createLightEntity(
    { type: 'AMBIENT', color: '#dfe8ff', intensity: 0.6 },
    { appId: 'terrainBlockTestAmbient' }
  );
  createLightEntity(
    {
      type: 'DIRECTIONAL',
      color: '#fff2d9',
      intensity: 2.5,
      position: { x: -60, y: 90, z: 50 },
      targetPos: { x: 0, y: 0, z: 0 },
      castShadow: true,
      shadowPreset: 'HIGH',
      shadowCameraNearFar: [1, 300],
      shadowCameraFrustum: [-170, 170, 80, -80],
    },
    { appId: 'terrainBlockTestSun' }
  );
  createMaterial({ id: 'terrainBlockTestBox', type: 'STANDARD', params: { color: '#d9822b' } });
  if (IS_DEBUG_ENV) {
    const { createTerrainBlockTestTab } = await import('./_dbg__terrainBlockTest');
    if (!isCurrent()) return;
    createTerrainBlockTestTab(state);
  }

  for (const id of BLOCK_IDS) {
    const block = await spawnTerrainBlock(id);
    if (!block || !isCurrent()) return;
    state.blocks.push({
      id: block.id,
      meshEntityId: block.meshEntityId,
      physicsEntityId: block.physicsEntityId,
    });
  }
  const withoutCollider = state.blocks.filter((block) => block.physicsEntityId === undefined);
  if (withoutCollider.length) {
    lerror(
      `terrainBlockTest: no collider for ${withoutCollider.map((block) => block.id).join(', ')}.`
    );
  }
  await Promise.all([-1, 0, 1].map((blockX) => dropBoxesAsync(blockX)));
  if (!isCurrent()) return;
  void checkSettledAsync(isCurrent);
};
