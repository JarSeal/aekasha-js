import * as THREE from 'three/webgpu';
import { float, positionLocal, vec3 } from 'three/tsl';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import {
  ComponentType,
  IS_DEBUG_ENV,
  createGeometry,
  createMaterial,
  createMeshEntity,
  createSceneAppLooper,
  createSeededRandom,
  decGeometryRef,
  decMaterialRef,
  existsOrThrow,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getMaterial,
  getRootScene,
  incGeometryRef,
  incMaterialRef,
  lwarn,
  registerOnSceneExit,
  saveBufferGeometry,
  saveMaterial,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { generateOctahedralImpostor, type OctahedralImpostor } from 'aekasha/lod';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  getStreamingCellKey,
  registerStreamingCellContent,
  type StreamingCellContext,
} from 'aekasha/streaming';

// World streaming's test scene (docs/plans/_DONE_p353_macro-streaming-grid.md Phases 1-5): 16 × 16 cells
// of 64 m at rings 1 / 2 / 5 (the scene JSON's `streaming`), each four units of code content in
// three content ranges (Phase 5's layers):
// - a terrain block, `NEAR_AND_FAR` (its ground: kept from FAR in, so a far cell has no hole): its
//   own geometry and a coarse one for its LOD level far away, made on load, the cell's assets, so
//   they go when the cell unloads;
// - the rocks, `NEAR`, and their `FAR` stand-in: one InstancedMesh of the rock's octahedral impostor
//   (baked once at the scene's load), an instance where each rock is;
// - the crates, `NEAR` only.
// The scene JSON adds content the gather cuts into cells (Phase 3's): a beacon in every fourth
// cell (explicit LOD levels, so far groups), a 320 m wall (oversized, kept), and a six-piece ruin
// of a small kit (block, slab, post in two materials; docs/plans/p377_hlod-streaming-cell-proxies.md
// D7) in 16 cells (cx and cz each -7, -3, 1 or 5: few, as every scene's JSON is in the app's
// first download): merged `AUTO` in 32 m cells while near (the JSON's
// `mergeGroups`), and while far each piece its own far entry, a cell's ruin three far groups. The
// ruins' heights were baked into the JSON from this file's height field (`createHeightField(53)`):
// changing it leaves them floating or buried.
// The props share their geometry and materials, so a cell compiles no new shader; each unit gets
// them by id in its load, since an asset goes on its last ref. The heights come from one
// world-space noise, so the blocks meet at their edges. The main camera (the streaming focus)
// flies across the grid, or hovers on a cell boundary, or stays still: the scene's debug tab
// switches it. For priming tests (Phase 2), each cell's crates can have a material of their own
// shader structure.

export const STREAMING_GRID_SCENE_ID = 'streamingGrid';
const CAMERA_APP_ID = 'streamingGridCamera';

const CELL_SIZE = 64;
/** Cells from -GRID_HALF to GRID_HALF - 1 on each axis */
const GRID_HALF = 8;
const TERRAIN_SEGMENTS = 16;
/** The terrain block's coarse LOD level: 4 × 4 segments (its corners on the fine grid) */
const TERRAIN_FAR_SEGMENTS = 4;
/** The fine terrain below this screen size: a block (radius ~46 m) from about 300 m, so a FAR cell
 * (ring 3 out, 192 m+) draws the coarse block once it's a little further */
const TERRAIN_FAR_SCREEN_SIZE = 0.3;
const ROCK_IMPOSTOR_ID = 'streamingGridRockImpostor';
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

/** What the cells hold, which the scene's debug tab edits (read when a cell loads) */
export const streamingGridContent = {
  /** Each cell's crates get a material of a shader structure of their own (a cell-unique literal
   * in its TSL), so every cell streamed in brings a new shader to prime (p353 Phase 2) */
  uniqueCrateShaders: false,
};

const createHeightField = (seed: number) => {
  const simplex = new SimplexNoise({ random: createSeededRandom(seed) });
  return (x: number, z: number) =>
    12 * simplex.noise(x / 220, z / 220) + 3 * simplex.noise(x / 50, z / 50);
};

/** A cell's own seed, so its props are the same on every load */
const getCellSeed = (cx: number, cz: number) =>
  (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;

/** The props' and the terrain's shared materials and geometries, by id: a cache hit while they
 * exist (adding the calling cell as an owner). Each unit gets them in its own load, not only the
 * scene code: an asset is deleted on its last ref, so once no cell holds them they're gone, and the
 * next cell's load makes them again. */
const getSharedAssets = () => {
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

const getTerrainGeometryId = (cx: number, cz: number, far = false) =>
  `streamingGridTerrain${far ? 'Far' : ''}_${cx}_${cz}`;

/** A cell's terrain block, `segments` a side, registered under `id` in the cell's load (so the cell
 * owns it) */
const saveTerrainGeometry = (
  ctx: StreamingCellContext,
  getHeight: (x: number, z: number) => number,
  segments: number,
  id: string
) => {
  const ox = (ctx.cx + 0.5) * ctx.cellSize;
  const oz = (ctx.cz + 0.5) * ctx.cellSize;
  const terrain = generateTerrain({
    width: ctx.cellSize,
    depth: ctx.cellSize,
    widthSegments: segments,
    depthSegments: segments,
    maxHeight: 1,
    // The block's own noise is replaced by the world's, so neighbours share their edges
    heightModifier: (x, z) => getHeight(x + ox, z + oz),
  });
  return saveBufferGeometry(terrain.geometry, { id });
};

/** A cell's terrain block, its ground from FAR in: its own geometry and a coarse LOD level, both
 * the cell's assets (its kept layer's) */
const loadTerrain =
  (getHeight: (x: number, z: number) => number) => (ctx: StreamingCellContext) => {
    const { cx, cz, cellSize } = ctx;
    getSharedAssets();
    const geo = saveTerrainGeometry(ctx, getHeight, TERRAIN_SEGMENTS, getTerrainGeometryId(cx, cz));
    const farGeo = getTerrainGeometryId(cx, cz, true);
    saveTerrainGeometry(ctx, getHeight, TERRAIN_FAR_SEGMENTS, farGeo);
    return [
      createMeshEntity({
        geo,
        mat: (cx + cz) & 1 ? 'streamingGridGroundB' : 'streamingGridGroundA',
        position: { x: (cx + 0.5) * cellSize, y: 0, z: (cz + 0.5) * cellSize },
        receiveShadow: true,
        lod: {
          levels: [{ screenSize: TERRAIN_FAR_SCREEN_SIZE }, { screenSize: 0, geo: farGeo }],
        },
      }),
    ];
  };

/** A cell's own crate material, of a shader structure no other cell's has: registered in the
 * cell's load, so it's the cell's, and released with its crates (their last ref) */
const getCellCrateMaterial = (cx: number, cz: number) => {
  const id = `streamingGridCrate_${cx}_${cz}`;
  const existing = getMaterial(id);
  if (existing) return id;
  const material = new THREE.MeshStandardNodeMaterial({ color: 0xb07a3c, roughness: 0.8 });
  // A literal of its own in both shader stages (three caches the two by their code): a few µm
  const k = 1e-5 * ((cx + GRID_HALF) * 2 * GRID_HALF + cz + GRID_HALF + 1);
  material.positionNode = positionLocal.add(vec3(0, float(k), 0));
  material.opacityNode = float(1 - k);
  saveMaterial(material, id);
  return id;
};

type PropKind = 'Rock' | 'Crate';

/** Where a cell's props of `kind` are (the same on every load): position, turn about y, scale */
const getPropPlacements = (
  getHeight: (x: number, z: number) => number,
  kind: PropKind,
  count: number,
  ctx: StreamingCellContext
) => {
  const random = createSeededRandom(getCellSeed(ctx.cx, ctx.cz) + (kind === 'Rock' ? 1 : 2));
  return Array.from({ length: count }, () => {
    const x = (ctx.cx + 0.05 + random() * 0.9) * ctx.cellSize;
    const z = (ctx.cz + 0.05 + random() * 0.9) * ctx.cellSize;
    const scale = 0.6 + random();
    return { x, y: getHeight(x, z) + 0.5 * scale, z, turn: random() * Math.PI * 2, scale };
  });
};

/** A set of props scattered over a cell, on the world's heights */
const loadProps =
  (getHeight: (x: number, z: number) => number, kind: PropKind, count: number) =>
  (ctx: StreamingCellContext) => {
    getSharedAssets();
    const mat =
      kind === 'Crate' && streamingGridContent.uniqueCrateShaders
        ? getCellCrateMaterial(ctx.cx, ctx.cz)
        : `streamingGrid${kind}`;
    return getPropPlacements(getHeight, kind, count, ctx).map(({ x, y, z, turn, scale }) =>
      createMeshEntity({
        geo: `streamingGrid${kind}`,
        mat,
        position: { x, y, z },
        rotation: { x: 0, y: turn, z: 0 },
        scale: { x: scale, y: scale, z: scale },
        castShadow: true,
      })
    );
  };

/** The rock's octahedral impostor (p351), baked at the scene's load and held by the scene for
 * its life: only FAR cells draw it, and a bake during play would cost 40-115 ms. Hemi: the rocks
 * turn about y only and sit on the ground. */
const createRockImpostor = () => {
  getSharedAssets();
  const impostor = generateOctahedralImpostor(
    existsOrThrow(getGeometry('streamingGridRock'), 'Streaming grid: no rock geometry.'),
    existsOrThrow(getMaterial('streamingGridRock'), 'Streaming grid: no rock material.'),
    { id: ROCK_IMPOSTOR_ID, hemi: true, surfaceDepth: false }
  );
  incGeometryRef(impostor.id);
  incMaterialRef(impostor.material.userData.id as string);
  registerOnSceneExit(STREAMING_GRID_SCENE_ID, () => {
    decGeometryRef(impostor.id);
    decMaterialRef(impostor.material.userData.id as string);
  });
  return impostor;
};

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// #region streaming-far-rocks (shown in the Hub: hub/pages/features/streaming/)
/** A FAR cell's rocks: one InstancedMesh of the rock's impostor, an instance where each rock is (a
 * draw call per cell). It holds a ref on the impostor's geometry and material, which the mesh tag's
 * delete hook releases. */
const loadFarRocks =
  (getHeight: (x: number, z: number) => number, impostor: OctahedralImpostor) =>
  (ctx: StreamingCellContext) => {
    const placements = getPropPlacements(getHeight, 'Rock', ROCKS_PER_CELL, ctx);
    const mesh = new THREE.InstancedMesh(impostor.geometry, impostor.material, placements.length);
    placements.forEach(({ x, y, z, turn, scale }, i) => {
      _position.set(x, y, z);
      _quaternion.setFromAxisAngle(_up, turn);
      _scale.setScalar(scale);
      mesh.setMatrixAt(i, _matrix.compose(_position, _quaternion, _scale));
    });
    mesh.computeBoundingSphere();
    incGeometryRef(impostor.id);
    incMaterialRef(impostor.material.userData.id as string);
    const entityId = ctx.world.createEntity();
    mesh.userData.entityId = entityId;
    ctx.world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
    ctx.world.addComponent(entityId, ComponentType.TAG_IS_MESH, true);
    getRootScene()?.add(mesh);
    return [entityId];
  };
// #endregion streaming-far-rocks

// #region streaming-cells (shown in the Hub: hub/pages/features/streaming/)
const registerCells = (
  getHeight: (x: number, z: number) => number,
  rockImpostor: OctahedralImpostor
) => {
  for (let cz = -GRID_HALF; cz < GRID_HALF; cz++) {
    for (let cx = -GRID_HALF; cx < GRID_HALF; cx++) {
      const cellKey = getStreamingCellKey(cx, cz);
      const sceneId = STREAMING_GRID_SCENE_ID;
      // The ground from FAR in, so a far cell has no hole
      registerStreamingCellContent({
        sceneId,
        cellKey,
        loadedAt: 'NEAR_AND_FAR',
        load: loadTerrain(getHeight),
      });
      // The rocks near, their impostors far (NEAR is the default)
      registerStreamingCellContent({
        sceneId,
        cellKey,
        load: loadProps(getHeight, 'Rock', ROCKS_PER_CELL),
      });
      registerStreamingCellContent({
        sceneId,
        cellKey,
        loadedAt: 'FAR',
        load: loadFarRocks(getHeight, rockImpostor),
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
  getSharedAssets();
  const rockImpostor = createRockImpostor();
  // Registered on every load (a scene's registrations go when it's left); the cells around the
  // camera load after this function, inside the load
  registerCells(getHeight, rockImpostor);

  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) lwarn(`Streaming grid: no camera '${CAMERA_APP_ID}' to fly.`);
  else startFlight(world, cameraId);

  if (IS_DEBUG_ENV) {
    const { createStreamingGridTab } = await import('./_dbg__streamingGrid');
    createStreamingGridTab();
  }
};
