import {
  IS_DEBUG_ENV,
  createCameraEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  getMeshByAppId,
  lerror,
  registerOnSceneExit,
  saveBufferGeometry,
} from 'aekasha';
import { createPhysicsEntity, getPhysicsSimClock } from 'aekasha/physics';
import { spawnTerrainBlock, type TerrainBlock } from 'aekasha/terrain';
import { generateTerrainAsync, loadTerrainHeightmapAsync } from 'aekasha/toolkit/geometry';
import { nextFrames } from '../../shared/verifyHarness';
import {
  getHeightmapTexel,
  HEIGHTMAP_EXTENT,
  HEIGHTMAP_RANGE,
  HEIGHTMAP_SIZE,
} from './heightmapShape';

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
 * - **Front** (p306 Phase 4's heightmap import, built in this file): a 64 m block from the
 *   committed `terrainBlockTestHeightmap.r16` (`loadTerrainHeightmapAsync`, generated on the
 *   toolkit's terrain worker with its `HEIGHTFIELD`). Its map is asymmetric (`heightmapShape.ts`),
 *   and the load logs an error when the block's heights aren't the map's texels (a map read
 *   flipped, or its fetch's bytes not the file's).
 *
 * - **Front left** (p306 Phase 5's orientation block, `blenderBlock/`): the terrain add-on's export
 *   (`devTools/blender/exportOrientationBlock.py`), 32 m / 33, its `HEIGHTFIELD` from the GLB's
 *   custom props: a mound near the engine's +x, +z corner, the corner markers (snow on the red one
 *   at -x, -z, the top view's top left; mud on the green one at +x, -z) and the baked AO.
 *   `terrainBlockTestBlender` draws them from its `COLOR_0`, `terrainBlockTestBlenderSplatMap`
 *   beside it (the same GLB) from its painted splat map: the two must look alike.
 *   `blenderBlock/terrainBlockTestBlender.test.ts` pins the orientation in the files.
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
const BLOCK_IDS = [
  'terrainBlockTestSmooth',
  'terrainBlockTestNoise',
  'terrainBlockTestTrimesh',
  'terrainBlockTestBlender',
  'terrainBlockTestBlenderSplatMap',
];
const BOX_HALF = 1;
const BLOCK_SIZE = 100;
const BOX_SPACING = 15;
const DROP_HEIGHT = 35;
/** Fixed steps until the boxes rest (the fall takes about 160, the tumble down the slopes more),
 * short of the probe's 360 */
const SETTLE_STEPS = 340;
/** Below every block's lowest point (the TRIMESH block's noise reaches -18 m) */
const LOWEST_TERRAIN_Y = -20;
/** The heightmap block's centre, in front of the others */
const HEIGHTMAP_CENTER: [number, number] = [0, 100];
/** The orientation blocks (32 m at grid (-3, 3) and (-2, 3)): their centres and box spacing */
const ORIENTATION_SIZE = 32;
const ORIENTATION_CENTERS: [number, number][] = [
  [-3 * ORIENTATION_SIZE, 3 * ORIENTATION_SIZE],
  [-2 * ORIENTATION_SIZE, 3 * ORIENTATION_SIZE],
];
const ORIENTATION_BOX_SPACING = 8;
/** Low: from `DROP_HEIGHT` a box glancing off the mound's side bounces off a 32 m block */
const ORIENTATION_DROP_HEIGHT = 6;

/** A block's square, which its boxes must rest in */
type BlockSquare = { x: number; z: number; half: number };
/** A box: the block it fell on, and where it is (after `SETTLE_STEPS`) */
type BoxResult = { appId: string; block: BlockSquare; x: number; y: number; z: number };
const state: {
  blocks: Pick<TerrainBlock, 'id' | 'meshEntityId' | 'physicsEntityId'>[];
  /** The heightmap block's mesh and its heights' largest gap to the map's texels */
  heightmapBlock: { meshEntityId: number; maxGap: number } | null;
  boxes: BoxResult[];
  isSettled: boolean;
} = { blocks: [], heightmapBlock: null, boxes: [], isSettled: false };

/**
 * The 3 × 3 boxes over a block, `spacing` apart and `height` up, each a dynamic body on its mesh
 * (`name` in their app ids)
 */
const dropBoxesAsync = (
  block: BlockSquare,
  name: string | number,
  { spacing = BOX_SPACING, height = DROP_HEIGHT } = {}
) => {
  const drops: Promise<number>[] = [];
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const x = block.x + col * spacing;
      const z = block.z + row * spacing;
      const appId = `terrainBlockTestBox_${name}_${col}_${row}`;
      const meshId = createMeshEntity({
        geo: {
          type: 'BOX',
          params: { width: BOX_HALF * 2, height: BOX_HALF * 2, depth: BOX_HALF * 2 },
        },
        mat: 'terrainBlockTestBox',
        castShadow: true,
        receiveShadow: true,
        position: { x, y: height, z },
        appId,
      });
      drops.push(
        createPhysicsEntity({
          colliders: { type: 'BOX', friction: 1.5 },
          body: { rigidType: 'DYNAMIC' },
          target: meshId,
        })
      );
      state.boxes.push({ appId, block, x, y: height, z });
    }
  }
  return Promise.all(drops);
};

/** Whether a box rests on its block: above the lowest terrain, below its drop and inside the
 * block's square */
const isOnItsBlock = ({ block, x, y, z }: BoxResult) =>
  y > LOWEST_TERRAIN_Y &&
  y < DROP_HEIGHT - BOX_HALF * 4 &&
  Math.abs(x - block.x) < block.half &&
  Math.abs(z - block.z) < block.half;

/**
 * The heightmap block: the committed `.r16` loaded, generated on the terrain worker over the map's
 * extent, its heightfield on a fixed body. Logs an error where its heights aren't the map's texels.
 * @returns its mesh entity, or null when the scene was left meanwhile
 */
const spawnHeightmapBlockAsync = async (isCurrent: () => boolean) => {
  const [x, z] = HEIGHTMAP_CENTER;
  const heightmap = await loadTerrainHeightmapAsync({
    url: new URL('./terrainBlockTestHeightmap.r16', import.meta.url).href,
    format: 'R16',
    size: HEIGHTMAP_SIZE,
    heightRange: HEIGHTMAP_RANGE,
    extent: HEIGHTMAP_EXTENT,
    center: HEIGHTMAP_CENTER,
  });
  if (!isCurrent()) return null;
  const segments = HEIGHTMAP_SIZE - 1;
  const terrain = await generateTerrainAsync({
    width: HEIGHTMAP_EXTENT,
    depth: HEIGHTMAP_EXTENT,
    widthSegments: segments,
    depthSegments: segments,
    center: HEIGHTMAP_CENTER,
    heightmap,
    normals: 'HEIGHT_FN',
    collider: true,
  });
  if (!isCurrent()) return null;

  // A vertex per texel: each height is its texel's (within float32's rounding)
  const [min, max] = HEIGHTMAP_RANGE;
  let maxGap = 0;
  for (let row = 0; row < HEIGHTMAP_SIZE; row++) {
    for (let col = 0; col < HEIGHTMAP_SIZE; col++) {
      const expected = min + (getHeightmapTexel(col, row) / 65535) * (max - min);
      const gap = Math.abs(terrain.heights[row * HEIGHTMAP_SIZE + col] - expected);
      maxGap = Math.max(maxGap, gap);
    }
  }
  if (maxGap > 1e-3) {
    lerror(
      `terrainBlockTest: the heightmap block's heights are up to ${maxGap.toFixed(3)} m off its map's texels (read flipped?).`
    );
  }

  const meshEntityId = createMeshEntity({
    geo: saveBufferGeometry(terrain.geometry, { id: 'terrainBlockTestHeightmapGeo' }),
    mat: 'textureSetSurface',
    castShadow: true,
    receiveShadow: true,
    position: { x, y: 0, z },
    appId: 'terrainBlockTestHeightmapBlock',
  });
  if (!terrain.heightfield) {
    lerror('terrainBlockTest: the heightmap block has no heightfield.');
    return meshEntityId;
  }
  await createPhysicsEntity({
    colliders: [terrain.heightfield],
    body: { rigidType: 'FIXED' },
    target: meshEntityId,
  });
  state.heightmapBlock = { meshEntityId, maxGap };
  return meshEntityId;
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
  state.heightmapBlock = null;
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
  if (!(await spawnHeightmapBlockAsync(isCurrent)) || !isCurrent()) return;
  const blockSquare = (blockX: number) => ({ x: blockX * BLOCK_SIZE, z: 0, half: BLOCK_SIZE / 2 });
  await Promise.all([
    ...[-1, 0, 1].map((blockX) => dropBoxesAsync(blockSquare(blockX), blockX)),
    dropBoxesAsync(
      { x: HEIGHTMAP_CENTER[0], z: HEIGHTMAP_CENTER[1], half: HEIGHTMAP_EXTENT / 2 },
      'heightmap'
    ),
    ...ORIENTATION_CENTERS.map(([x, z], i) =>
      dropBoxesAsync({ x, z, half: ORIENTATION_SIZE / 2 }, `orientation${i}`, {
        spacing: ORIENTATION_BOX_SPACING,
        height: ORIENTATION_DROP_HEIGHT,
      })
    ),
  ]);
  if (!isCurrent()) return;
  void checkSettledAsync(isCurrent);
};
