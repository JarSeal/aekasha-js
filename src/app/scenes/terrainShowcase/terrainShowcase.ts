import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getGeometry,
  IS_DEBUG_ENV,
  registerOnSceneExit,
  saveBufferGeometry,
  spawnImportedAsset,
} from 'aekasha';
import { spawnDecalSet, spawnTerrainBlock, type TerrainBlock } from 'aekasha/terrain';
import { saveLeafCardGeometry, saveRockGeometries } from 'aekasha/toolkit/geometry';
import { createShowcasePlayerAsync } from './showcasePlayer';

/**
 * The terrain epic's showcase (p310 §3): art-directed terrain blocks built in Blender with the
 * toolkit's terrain add-on (`devTools/blender/buildShowcaseBlocks.py`, the plan's §3.3-3.6), each
 * in its folder under `blocks/` and spawned from its `*.terrainBlock.json` with its collider,
 * scatter and decal set (the scene JSON lists the blocks; the gather loads what they name).
 *
 * - **The coast** (`showcaseCoast`, grid (0, 0)): dunes falling toward the sea (+z) and a cliff
 *   band along the north edge, painted in its vertex colours with the AO baked in; its material
 *   (`terrainCoast`) has the shoreline along the surface conditions' water level, which the scene
 *   JSON sets (0.5 m), and a still sea plane at that level marks it (water rendering isn't this
 *   scene's subject).
 * - **The alpine slope** (`showcaseAlpine`, grid (2, 0)): a ridge rising toward +x with a
 *   north-facing rock band and a flat south part with a frozen pond, painted in two splat maps
 *   and laid over by its material's rules (`terrainAlpine`: snow on the high north faces, cliffs
 *   on the steepest), boulders with colliders scattered in Blender (an imported scatter: its GPU
 *   instances), ice cracks on the pond.
 * - **The wetlands** (`showcaseWetlands`, grid (0, 2)): almost flat ground with a meandering
 *   channel, two hollows and a pad for the bunker, painted in its vertex colours with the AO
 *   baked in; its material (`terrainWetlands`) keeps the channel and the hollows wet in any
 *   weather by the block's painted `_WETNESS` (a regional wetness) and puddles the flat ground in
 *   the rain; leaf litter and pebbles scattered on it, tyre ruts through the ford, mud splatters.
 * - **The bunker** (`showcaseBunker`, in the wetlands' folder): a concrete bunker and a wall on the
 *   wetlands' pad, an import spawned here with its box colliders, in a structure material
 *   (`structureBunker`: triplanar, worn by its vertex colour, rain streaks), and its leak decals
 *   (`showcaseBunker_leaks`, a decal set of the scene's own) at the same transform.
 * - **The player** (`showcasePlayer.ts`): the gym's dynamic character on the coast's beach (WASD),
 *   the scene camera following it, its steps stamping footprints on the block under it.
 */

export const TERRAIN_SHOWCASE_SCENE_ID = 'terrainShowcase';
const SCENE_ID = TERRAIN_SHOWCASE_SCENE_ID;
const BLOCK_IDS = ['showcaseCoast', 'showcaseAlpine', 'showcaseWetlands', 'showcaseProcedural'];
/** The surface conditions' water level (the scene JSON's), where the sea plane lies */
const WATER_LEVEL = 0.5;
/**
 * The bunker's place: on the wetlands' pad (grid (0, 2), the pad's middle at its local (15, −15),
 * 0.58 m high: `buildShowcaseBlocks.py`), the bunker 3 m left of its middle and 1 m in front, so
 * the wall behind it stays on the pad
 */
const BUNKER_POSITION = { x: 12, y: 0.58, z: 114 };
/**
 * The sea: around the coast, its inlet and hollows under the water level included (the cliff's
 * plateau stands over it), short of the other blocks
 */
const SEA = { x: 0, z: 0, width: 160, depth: 160, color: '#1d4652', opacity: 0.75 };

/** This visit's cleanups: the scene has one exit function (`registerOnSceneExit`), which runs
 * them */
const exitCleanups: (() => void)[] = [];

/**
 * Adds a function the scene's exit runs (the player's and the tab's: `registerOnSceneExit` keeps
 * one function per scene, so they share the scene's)
 */
export const addShowcaseExitCleanup = (cleanup: () => void) => {
  exitCleanups.push(cleanup);
};

const createSea = () =>
  createMeshEntity(
    {
      geo:
        getGeometry('terrainShowcaseSea') ??
        saveBufferGeometry(new THREE.PlaneGeometry(SEA.width, SEA.depth).rotateX(-Math.PI / 2), {
          id: 'terrainShowcaseSea',
        }),
      mat: {
        id: 'terrainShowcaseSea',
        type: 'STANDARD',
        params: {
          color: SEA.color,
          roughness: 0.08,
          transparent: true,
          opacity: SEA.opacity,
          depthWrite: false,
        },
      },
      position: { x: SEA.x, y: WATER_LEVEL, z: SEA.z },
      castShadow: false,
      receiveShadow: false,
    },
    { appId: `${SCENE_ID}_sea`, debugData: { name: 'Showcase: sea' } }
  );

export const scene = async () => {
  exitCleanups.length = 0;
  const visit = { isCurrent: true };
  registerOnSceneExit(SCENE_ID, () => {
    visit.isCurrent = false;
    for (const cleanup of exitCleanups.splice(0)) cleanup();
  });
  // The coast's, the wetlands' and the procedural block's scatters draw the toolkit's procedural
  // rocks and leaf cards
  saveRockGeometries({ kinds: ['PEBBLE', 'ROCK', 'BOULDER'] });
  saveLeafCardGeometry();
  const blocks: TerrainBlock[] = [];
  for (const id of BLOCK_IDS) {
    const block = await spawnTerrainBlock(id);
    if (!block) return; // the scene was left meanwhile: nothing was kept
    blocks.push(block);
  }
  await spawnImportedAsset('showcaseBunker', {
    transform: { position: BUNKER_POSITION },
    material: 'structureBunker',
  });
  const leaks = await spawnDecalSet('showcaseBunker_leaks', {
    transform: { position: BUNKER_POSITION },
  });
  if (!leaks) return; // the scene was left meanwhile
  createSea();
  addShowcaseExitCleanup(await createShowcasePlayerAsync(SCENE_ID, blocks));

  // Debug env only: a dynamic import, so the tab's code isn't in a production build
  if (IS_DEBUG_ENV) {
    const { createTerrainShowcaseTab } = await import('./_dbg__terrainShowcase');
    if (visit.isCurrent) createTerrainShowcaseTab();
  }
};
