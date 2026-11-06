import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import {
  IS_DEBUG_ENV,
  createGeometry,
  createMaterial,
  createMeshEntity,
  createSceneAppLooper,
  createSeededRandom,
  getECSWorld,
  getEntityIdByAppId,
  lwarn,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  getStreamingCellKey,
  registerStreamingCellContent,
  type StreamingCellContext,
} from 'aekasha/streaming';

// World streaming's test scene (docs/plans/p353_macro-streaming-grid.md Phases 1-2): 16 × 16 cells
// of 64 m (the scene JSON's `streaming`), each three units of code content: a terrain block (its own
// geometry, made on load, the cell's asset, so it goes when the cell unloads) and two sets of
// scattered props (shared geometry and materials, so a cell compiles no new shader). The heights come from one world-space noise, so
// the blocks meet at their edges. The main camera (the streaming focus) flies across the grid, or
// hovers on a cell boundary, or stays still: the scene's debug tab switches it.

export const STREAMING_GRID_SCENE_ID = 'streamingGrid';
const CAMERA_APP_ID = 'streamingGridCamera';

const CELL_SIZE = 64;
/** Cells from -GRID_HALF to GRID_HALF - 1 on each axis */
const GRID_HALF = 8;
const TERRAIN_SEGMENTS = 16;
const ROCKS_PER_CELL = 10;
const CRATES_PER_CELL = 6;

/** The flight's altitude and how far past the grid's ends it turns */
const FLIGHT_HEIGHT = 60;
const FLIGHT_REACH = GRID_HALF * CELL_SIZE + 48;
/** The row the flight follows: the middle of row 0 */
const FLIGHT_Z = CELL_SIZE / 2;
/** The boundary the hover crosses (between cells 1 and 2), how far each way, and its period */
const HOVER_X = 2 * CELL_SIZE;
const HOVER_AMPLITUDE = 6;
const HOVER_PERIOD = 2;

/** What the camera does: fly across the grid and back, hover on a cell boundary, or stay */
export type StreamingGridFlightMode = 'FLY' | 'HOVER' | 'STILL';

/** The flight's settings, which the scene's debug tab edits */
export const streamingGridFlight = {
  mode: 'FLY' as StreamingGridFlightMode,
  /** Metres per second */
  speed: 30,
};

const createHeightField = (seed: number) => {
  const simplex = new SimplexNoise({ random: createSeededRandom(seed) });
  return (x: number, z: number) =>
    12 * simplex.noise(x / 220, z / 220) + 3 * simplex.noise(x / 50, z / 50);
};

/** A cell's own seed, so its props are the same on every load */
const getCellSeed = (cx: number, cz: number) =>
  (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;

const createSharedAssets = () => {
  createMaterial({
    id: 'streamingGridGroundA',
    type: 'STANDARD',
    params: { color: 0x5d7a45, roughness: 1 },
  });
  createMaterial({
    id: 'streamingGridGroundB',
    type: 'STANDARD',
    params: { color: 0x6c8a52, roughness: 1 },
  });
  createMaterial({
    id: 'streamingGridRock',
    type: 'STANDARD',
    params: { color: 0x8a877e, roughness: 0.9 },
  });
  createMaterial({
    id: 'streamingGridCrate',
    type: 'STANDARD',
    params: { color: 0xb07a3c, roughness: 0.8 },
  });
  createGeometry({
    id: 'streamingGridRock',
    type: 'SPHERE',
    params: { radius: 1.2, widthSegments: 7, heightSegments: 5 },
  });
  createGeometry({
    id: 'streamingGridCrate',
    type: 'BOX',
    params: { width: 1.6, height: 1.6, depth: 1.6 },
  });
};

const getTerrainGeometryId = (cx: number, cz: number) => `streamingGridTerrain_${cx}_${cz}`;

/** A cell's terrain block: its own geometry, registered in the cell's load, so the cell owns it */
const loadTerrain =
  (getHeight: (x: number, z: number) => number) => (ctx: StreamingCellContext) => {
    const { cx, cz, cellSize } = ctx;
    const ox = (cx + 0.5) * cellSize;
    const oz = (cz + 0.5) * cellSize;
    const terrain = generateTerrain({
      width: cellSize,
      depth: cellSize,
      widthSegments: TERRAIN_SEGMENTS,
      depthSegments: TERRAIN_SEGMENTS,
      maxHeight: 1,
      // The block's own noise is replaced by the world's, so neighbours share their edges
      heightModifier: (x, z) => getHeight(x + ox, z + oz),
    });
    const geoId = saveBufferGeometry(terrain.geometry, { id: getTerrainGeometryId(cx, cz) });
    return [
      createMeshEntity({
        geo: geoId,
        mat: (cx + cz) & 1 ? 'streamingGridGroundB' : 'streamingGridGroundA',
        position: { x: ox, y: 0, z: oz },
        receiveShadow: true,
      }),
    ];
  };

/** A set of props scattered over a cell, on the world's heights */
const loadProps =
  (getHeight: (x: number, z: number) => number, kind: 'Rock' | 'Crate', count: number) =>
  (ctx: StreamingCellContext) => {
    const random = createSeededRandom(getCellSeed(ctx.cx, ctx.cz) + (kind === 'Rock' ? 1 : 2));
    const ids: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = (ctx.cx + 0.05 + random() * 0.9) * ctx.cellSize;
      const z = (ctx.cz + 0.05 + random() * 0.9) * ctx.cellSize;
      const scale = 0.6 + random();
      ids.push(
        createMeshEntity({
          geo: `streamingGrid${kind}`,
          mat: `streamingGrid${kind}`,
          position: { x, y: getHeight(x, z) + 0.5 * scale, z },
          rotation: { x: 0, y: random() * Math.PI * 2, z: 0 },
          scale: { x: scale, y: scale, z: scale },
          castShadow: true,
        })
      );
    }
    return ids;
  };

// #region streaming-cells (shown in the Hub: hub/pages/features/streaming/)
const registerCells = (getHeight: (x: number, z: number) => number) => {
  for (let cz = -GRID_HALF; cz < GRID_HALF; cz++) {
    for (let cx = -GRID_HALF; cx < GRID_HALF; cx++) {
      const cellKey = getStreamingCellKey(cx, cz);
      const sceneId = STREAMING_GRID_SCENE_ID;
      registerStreamingCellContent({ sceneId, cellKey, load: loadTerrain(getHeight) });
      registerStreamingCellContent({
        sceneId,
        cellKey,
        load: loadProps(getHeight, 'Rock', ROCKS_PER_CELL),
      });
      registerStreamingCellContent({
        sceneId,
        cellKey,
        load: loadProps(getHeight, 'Crate', CRATES_PER_CELL),
      });
    }
  }
};
// #endregion streaming-cells

/** Looks along +x or -x, pitched down: the flight's two rotations (a camera looks down its -z,
 * which a camera's `lookAt` turns to the target; a plain Object3D's would turn +z to it) */
const createHeading = (dir: 1 | -1) => {
  const eye = new THREE.PerspectiveCamera();
  eye.lookAt(dir * 100, -40, 0);
  return eye.quaternion.clone();
};

/** Moves the main camera every frame: across the grid and back, or on a boundary */
const startFlight = (world: ECSWorld, cameraId: number) => {
  const headings = { 1: createHeading(1), [-1]: createHeading(-1) };
  const pose = { pos: { x: -FLIGHT_REACH, y: FLIGHT_HEIGHT, z: FLIGHT_Z }, rot: headings[1] };
  let dir: 1 | -1 = 1;
  let time = 0;
  createSceneAppLooper((delta) => {
    const { mode, speed } = streamingGridFlight;
    if (mode === 'STILL') return;
    if (mode === 'HOVER') {
      time += delta;
      pose.pos.x = HOVER_X + HOVER_AMPLITUDE * Math.sin((time / HOVER_PERIOD) * Math.PI * 2);
    } else {
      pose.pos.x += dir * speed * delta;
      if (Math.abs(pose.pos.x) >= FLIGHT_REACH) {
        pose.pos.x = Math.sign(pose.pos.x) * FLIGHT_REACH;
        dir = dir === 1 ? -1 : 1;
      }
    }
    pose.rot = headings[dir];
    world.setTransform(cameraId, pose);
  }, STREAMING_GRID_SCENE_ID);
};

export const scene = async () => {
  const world = getECSWorld();
  const getHeight = createHeightField(53);
  createSharedAssets();
  // Registered on every load (a scene's registrations go when it's left); the cells around the
  // camera load after this function, inside the load
  registerCells(getHeight);

  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) lwarn(`Streaming grid: no camera '${CAMERA_APP_ID}' to fly.`);
  else startFlight(world, cameraId);

  if (IS_DEBUG_ENV) {
    const { createStreamingGridTab } = await import('./_dbg__streamingGrid');
    createStreamingGridTab();
  }
};
