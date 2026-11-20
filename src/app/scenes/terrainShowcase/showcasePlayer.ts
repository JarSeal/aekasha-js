import { ECSSystemStage, existsOrThrow, getCameraByAppId, getECSWorld } from 'aekasha';
import { createDynamicCharacter } from 'aekasha/character';
import type { DynamicCharacter } from 'aekasha/character';
import { getTerrainBlock } from 'aekasha/terrain';
import type { TerrainBlock } from 'aekasha/terrain';
import {
  createFollowObjectCameraRig,
  deleteFollowObjectCameraRig,
  type FollowObjectCameraParams,
} from 'aekasha/toolkit/ecs';
import { createDecalPool, spawnDecal } from 'aekasha/toolkit/terrain';
import { createCharacterVisualAsync } from '../../shared/characterVisual';

// The showcase's player (p310 Phase 2): the gym's dynamic character with its TANK brain (WASD,
// Space to jump, Shift to run, Ctrl to crouch; a gamepad's left stick), on the coast's beach, the
// scene's camera following it, so the blocks' heightfield colliders are walked as a game would.
// Its steps stamp footprints (runtime decals, p309) on the block under it, tinted to its ground.
// The decals are visual: their system runs in APP_LOGIC on the frame's positions, and no
// simulation reads them.

const SYSTEM_ID = 'terrainShowcaseFootprints';
const CHARACTER_ID = 'showcasePlayer';
const CHARACTER_CONFIG = { height: 1.6, radius: 0.5 };
/** Where the player starts: on the coast's beach, west of its inlet, dropped from a little above */
const START = { x: -14, y: 3.5, z: 6 };
/** The follow camera's world-space offset from the character's centre: behind it from the south */
const CAMERA_OFFSET = { x: 0, y: 4.5, z: 9 };
/** The blocks' edge length (the showcase's are all 64 m) */
const BLOCK_SIZE = 64;
/** Metres between a foot's print and the other's, and a print's centre off the path */
const STRIDE = 0.7;
const FOOT_OFFSET = 0.13;
/** Each block's print tint: a decal's albedo replaces the ground's (the coast's sand is bright,
 * the wetlands' mud dark: `docs/techniques/terrain-decals.md`'s pitfalls) */
const PRINT_TINTS: Record<string, string> = {
  showcaseCoast: '#d2ad7c',
  showcaseWetlands: '#666666',
};
const PRINT_LIFETIME_SEC = 60;

const getGridKey = (gridX: number, gridZ: number) => `${gridX},${gridZ}`;

/** The follow camera's params while the player exists (the visit's), for its pause */
let followCameraParams: FollowObjectCameraParams | null = null;

/**
 * Takes the follow camera off the scene camera (a measurement's fixed pose)
 * @returns the function that puts it back (the same visit's only; a no-op without the player)
 */
export const pauseShowcaseFollowCamera = () => {
  const params = followCameraParams;
  if (!params) return () => undefined;
  deleteFollowObjectCameraRig(params.id);
  return () => {
    if (followCameraParams === params) createFollowObjectCameraRig(params);
  };
};

/**
 * Creates the player on the coast's beach, the follow camera on the scene camera
 * (`terrainShowcaseCamera`), and the footprints' pool and system over `blocks` (the scene's spawn
 * results). The camera rig goes with the scene (its `sceneId`), the pool and its decals with the
 * scene's exit; the returned function removes the footprints' system (the scene's exit calls it).
 */
export const createShowcasePlayerAsync = async (sceneId: string, blocks: TerrainBlock[]) => {
  const visual = await createCharacterVisualAsync({
    key: CHARACTER_ID,
    height: CHARACTER_CONFIG.height,
    radius: CHARACTER_CONFIG.radius,
    beakColor: '#333',
  });
  const player = await createDynamicCharacter({
    id: CHARACTER_ID,
    visual,
    config: CHARACTER_CONFIG,
    brain: {
      kind: 'TANK',
      params: {
        bindings: {
          turn: [
            { device: 'KEYBOARD', negative: ['d'], positive: ['a'] },
            { device: 'GAMEPAD', axis: 'LEFT_X', invert: true },
          ],
          forward: [
            { device: 'KEYBOARD', negative: ['s'], positive: ['w'] },
            { device: 'GAMEPAD', axis: 'LEFT_Y' },
          ],
          jump: [
            { device: 'KEYBOARD', keys: [' '] },
            { device: 'GAMEPAD', button: 'SOUTH' },
          ],
          run: [
            { device: 'KEYBOARD', keys: ['Shift'] },
            { device: 'GAMEPAD', button: 'LEFT_STICK' },
          ],
          crouch: [
            { device: 'KEYBOARD', keys: ['Control'] },
            { device: 'GAMEPAD', button: 'EAST' },
          ],
        },
      },
    },
  });
  // A scene-load write: the load's physics hold covers it (p101)
  getECSWorld().getRigidBody(player.character.entityId)?.setTranslation(START, true);
  const params: FollowObjectCameraParams = {
    id: 'terrainShowcaseFollowCam',
    sceneId,
    camera: existsOrThrow(
      getCameraByAppId('terrainShowcaseCamera'),
      '[terrainShowcase] No camera "terrainShowcaseCamera".'
    ),
    targetMesh: visual,
    offset: CAMERA_OFFSET,
    smoothingTime: 0.2,
  };
  createFollowObjectCameraRig(params);
  followCameraParams = params;
  const stopFootprints = startFootprints(player, blocks);
  return () => {
    followCameraParams = null;
    stopFootprints();
  };
};

/**
 * Stamps a footprint every `STRIDE` the character walks on the ground (left, then right, across
 * its heading) onto the block under it, from APP_LOGIC; allocates nothing per frame
 */
const startFootprints = (player: DynamicCharacter, blocks: TerrainBlock[]) => {
  const byGrid = new Map<string, TerrainBlock>();
  for (const block of blocks) {
    const grid = getTerrainBlock(block.id)?.grid;
    if (grid) byGrid.set(getGridKey(grid.x, grid.z), block);
  }
  const pool = createDecalPool({
    id: SYSTEM_ID,
    material: 'decalsGround_blend',
    atlas: 'decalsGround',
    maxDecals: 128,
  });
  const { state } = player.controller;
  const position = { x: 0, z: 0 };
  let lastX = state.position.x;
  let lastZ = state.position.z;
  let walked = 0;
  let footIndex = 0;
  const world = getECSWorld();
  world.addSystem(ECSSystemStage.APP_LOGIC, SYSTEM_ID, () => {
    const dx = state.position.x - lastX;
    const dz = state.position.z - lastZ;
    lastX = state.position.x;
    lastZ = state.position.z;
    const step = Math.hypot(dx, dz);
    // A teleport or a fall isn't a walk
    if (!state.isGrounded || step > 1 || pool.isDisposed()) return;
    walked += step;
    if (walked < STRIDE || step < 1e-4) return;
    walked -= STRIDE;
    const block = byGrid.get(
      getGridKey(Math.round(lastX / BLOCK_SIZE), Math.round(lastZ / BLOCK_SIZE))
    );
    if (!block) return;
    footIndex++;
    const headX = dx / step;
    const headZ = dz / step;
    // Left foot (−1) then right (+1): left of the heading seen from above is (dz, −dx)
    const side = footIndex % 2 === 0 ? -1 : 1;
    position.x = lastX - side * FOOT_OFFSET * headZ;
    position.z = lastZ + side * FOOT_OFFSET * headX;
    spawnDecal(pool, {
      target: block,
      position,
      // v (the cell's top: the toe) along the heading
      rotation: Math.atan2(-headX, -headZ),
      cell: 'footprintBoot',
      color: PRINT_TINTS[block.id],
      lifetimeSec: PRINT_LIFETIME_SEC,
    });
  });
  return () => world.removeSystem(SYSTEM_ID);
};
