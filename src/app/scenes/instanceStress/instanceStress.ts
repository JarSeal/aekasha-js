import * as THREE from 'three/webgpu';
import {
  createMaterial,
  createSceneAppLooper,
  getCameraByAppId,
  createSeededRandom,
  getECSWorld,
  getEntityIdByAppId,
  getLightByAppId,
  getRootScene,
  lwarn,
  registerOnSceneEnter,
  registerOnSceneExit,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import {
  createInstancedLodPool,
  createInstanceSetAsync,
  type InstancedLodPool,
  type InstancedLodPoolLevel,
  type InstancePlacement,
  type InstanceRange,
  type InstanceSet,
} from 'aekasha/instancing';
import { generateCrossQuads, generateOctahedralImpostor, type LodDef } from 'aekasha/lod';
import { generateTreeGeometry } from 'aekasha/toolkit/geometry';
import { SunShadowFitComponentType } from 'aekasha/toolkit/ecs';
import { loadDebugModuleAsync } from 'aekasha/debug';
import { createViewport } from 'aekasha/viewports';
import { startStreamedForest, stopStreamedForest } from './instanceStressStreaming';

// GPU-driven culling's measuring and parity scene (docs/plans/_DONE_p354_gpu-driven-culling.md
// D12): a square forest of LOD trees on a jittered grid, with the main camera circling inside it on
// a fixed path. Two paths draw the same trees with the same levels, materials and LOD settings:
// - CPU (the default): square tiles of one `createInstancedLodPool` each (so three's whole-mesh
//   culling still has something to cull, as static instance cells would give it). Every instance
//   is an entity that the pool sync walks and the LOD selection measures every frame, in view or
//   not (pool instances don't opt into the ECS frustum culling: three culls a level mesh only as
//   a whole).
// - GPU (`?stressPath=gpu`): one instance set (`createInstanceSetAsync`): no entity per tree. On
//   WebGPU its GPU backend culls and LOD-selects per instance in compute passes, a draw per level
//   and material group; on WebGL2 (or with the LOD tab's "CPU backend" option) its CPU backend
//   selects the same way in a loop over typed arrays, an InstancedMesh per level (p354 Phase 4).
// The scene's debug module (`_dbg__instanceStress.ts`) times both and reads the set back.

export const INSTANCE_STRESS_SCENE_ID = 'instanceStress';
const CAMERA_APP_ID = 'instanceStressCamera';
const SUN_APP_ID = 'instanceStressSun';
const GROUND_NAME = 'instanceStressGround';

/** The tree: largeWorld's generator, a little larger */
const TREE = { trunkHeight: 1.4, foliageRadius: 1.2, foliageHeight: 3 };
/** Radial segments per mesh level: level 0 the finest */
const LEVEL_SEGMENTS = [12, 6, 3];
/** Level 0's and level 1's smallest screen sizes, and the cull. From fov 55 a tree (LOD radius
 * about 2.6 m) crosses 0.08 at about 60 m, 0.03 at about 165 m, and hides past about 830 m */
const LEVEL_SCREEN_SIZES = [0.08, 0.03, 0];
const CULL_SCREEN_SIZE = 0.006;
/** Metres between two trees on the grid, and how far a tree moves off its grid point, at most */
const SPACING = 6;
const JITTER = 2;
/** The sun shadow's fit to the view (`?stressShadow=true`): the covered distance and the
 * casters' extension toward the sun (physicsTiers' values) */
const SHADOW_MAX_DISTANCE = 160;
const SHADOW_CASTER_EXTENSION = 10;

/** The counts the debug tab offers (`?stressInstances=` takes any) */
export const INSTANCE_STRESS_COUNTS = [5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
const MAX_COUNT = 1_000_000;

/** What the camera does: circle inside the forest (so instances change level every frame), or
 * stay where it is (the steady state: nothing changes level) */
export type InstanceStressCameraMode = 'ORBIT' | 'STILL';

/** What draws the forest: instanced LOD pools (the CPU path) or an instance set (its backend the
 * renderer's: compute on WebGPU, the CPU on WebGL2) */
export type InstanceStressPath = 'CPU' | 'GPU';

/** What draws the last level: the tree's coarsest mesh, or an impostor baked from level 0 (p354
 * Phase 5 step 4: a set's levels ending in cross-quads, plain geometry, or in an octahedral
 * impostor, whose material places each instance itself) */
export type InstanceStressImpostor = 'NONE' | 'CROSS_QUADS' | 'OCTAHEDRAL';

/** A shadow-casting light over the still camera's view besides the sun (p354 Phase 3 step 4):
 * a spot light's shadow (one camera) or a point light's (six faces of one camera) */
export type InstanceStressLight = 'NONE' | 'SPOT' | 'POINT';

/** The scene's settings: read at every load, so a change applies on the next load. Overridden by
 * `?stressInstances=`, `?stressTile=`, `?stressCamera=`, `?stressPath=`, `?stressShadow=`,
 * `?stressLight=`, `?stressViewport=`, `?stressMove=`, `?stressStream=`, `?stressStreamFar=` and
 * `?stressOrbitSeconds=`, `?stressImpostor=` and `?stressPreWarm=` (the measuring harness's). */
export const instanceStressSettings = {
  count: 20_000,
  /** Trees on a tile's side: a tile is one pool of up to `tileSide²` instances */
  tileSide: 128,
  camera: 'ORBIT' as InstanceStressCameraMode,
  path: 'CPU' as InstanceStressPath,
  /** The sun casts a VSM shadow (the app's shadow type), fitted to the view */
  shadow: false,
  /** A spot or point light casting its shadow over the still camera's view */
  light: 'NONE' as InstanceStressLight,
  /** A picture-in-picture viewport of the forest from above (a second camera drawing it) */
  viewport: false,
  /** The share of the set's trees moved each frame (0 to 1; the set path only): a block of them,
   * round-robin through the forest, each turned and nudged with its own call
   * (`setInstanceMatrices`, p354 Phase 5 step 2) */
  move: 0,
  /** The set path's trees in world streaming's cells of this size (0: none; a power of two of at
   * least 32 m), each cell a range of the set added in its load and removed in its unload
   * (`instanceStressStreaming.ts`, p354 Phase 5 step 3) */
  stream: 0,
  /** The streamed cells' far ring; undefined: the set's cull distance's (no tree pops) */
  streamFar: undefined as number | undefined,
  /** The last level an impostor of level 0 (both paths), casting shadows */
  impostor: 'NONE' as InstanceStressImpostor,
  /** The set path's set is created with `preWarm` (p354 Phase 5 step 6): its draws compile once
   * it's added, ahead of its first frame */
  preWarm: false,
  /** The LOD cross-fades' seconds on both paths (`LodDef.fadeSeconds`); undefined: the global
   * setting (`getLodFadeSeconds`) */
  fadeSeconds: undefined as number | undefined,
  /** The orbit waits at its start until the measuring starts it (`instanceStressState.orbiting`),
   * so both paths see the same camera path from the same frame: the parity check's */
  orbitHold: false,
  /** The orbit's period, in seconds */
  orbitSeconds: 60,
};

/** This load's cleanups, run in order by its one exit function: `registerOnSceneExit` keeps one
 * function per scene, so a second call replaced the first (the ground's replaced the light's and
 * the probe's: the probe's systems outlived a reload, whose own were then skipped as duplicates) */
const exitTasks: (() => void)[] = [];

/** Runs `fn` when this load of the scene exits (the scene's parts and its debug module). */
export const onInstanceStressExit = (fn: () => void) => {
  exitTasks.push(fn);
};

/** This load's enter tasks, run in order by its one enter function: `registerOnSceneEnter` keeps
 * one function per scene too, so the sun's shadow, a light and the viewport replaced each other
 * (the last registered won), and one an earlier load registered ran on a load that set none. */
const enterTasks: (() => void)[] = [];

/** Runs `fn` when this load of the scene is entered (its JSON objects exist, its first cells
 * loaded). */
const onInstanceStressEnter = (fn: () => void) => {
  enterTasks.push(fn);
};

/** What the last load built, for the debug module's readouts */
export const instanceStressState = {
  pools: [] as InstancedLodPool[],
  /** The GPU path's instance set */
  set: null as InstanceSet | null,
  path: 'CPU' as InstanceStressPath,
  count: 0,
  /** The forest's side, in metres */
  extent: 0,
  /** The orbit runs (false while `orbitHold` holds it) */
  orbiting: true,
  /** The orbit's laps so far (whole turns) */
  lap: 0,
};

/** Applies the URL's overrides to the settings (the measuring harness sets them per page load). */
const readUrlOverrides = () => {
  const params = new URLSearchParams(window.location.search);
  const count = Number(params.get('stressInstances'));
  if (count > 0) instanceStressSettings.count = Math.min(Math.round(count), MAX_COUNT);
  const tile = Number(params.get('stressTile'));
  if (tile > 0) instanceStressSettings.tileSide = Math.round(tile);
  const camera = params.get('stressCamera');
  if (camera === 'ORBIT' || camera === 'STILL') instanceStressSettings.camera = camera;
  const path = params.get('stressPath')?.toUpperCase();
  if (path === 'CPU' || path === 'GPU') instanceStressSettings.path = path;
  const shadow = params.get('stressShadow');
  if (shadow === 'true' || shadow === 'false') instanceStressSettings.shadow = shadow === 'true';
  instanceStressSettings.viewport = params.get('stressViewport') === 'true';
  const move = Number(params.get('stressMove'));
  instanceStressSettings.move = move > 0 ? Math.min(move, 1) : 0;
  const stream = Number(params.get('stressStream'));
  instanceStressSettings.stream = stream >= 32 ? 2 ** Math.round(Math.log2(stream)) : 0;
  const streamFar = Number(params.get('stressStreamFar'));
  instanceStressSettings.streamFar = streamFar >= 1 ? Math.round(streamFar) : undefined;
  const impostor = params.get('stressImpostor')?.toUpperCase();
  instanceStressSettings.impostor =
    impostor === 'CROSSQUADS' ? 'CROSS_QUADS' : impostor === 'OCTAHEDRAL' ? 'OCTAHEDRAL' : 'NONE';
  const orbitSeconds = Number(params.get('stressOrbitSeconds'));
  if (orbitSeconds > 0) instanceStressSettings.orbitSeconds = orbitSeconds;
  const light = params.get('stressLight')?.toUpperCase();
  if (light === 'NONE' || light === 'SPOT' || light === 'POINT') {
    instanceStressSettings.light = light;
  }
  const fadeSeconds = params.get('stressFadeSeconds');
  if (fadeSeconds !== null && Number(fadeSeconds) >= 0) {
    instanceStressSettings.fadeSeconds = Number(fadeSeconds);
  }
  instanceStressSettings.orbitHold = params.get('stressOrbitHold') === 'true';
  instanceStressSettings.preWarm = params.get('stressPreWarm') === 'true';
};

/** The tree's mesh levels, the first `count` of them (an impostor replaces the last: building
 * its mesh anyway left a registered geometry no level held, which the next load found again) */
const createLevelGeometries = (count = LEVEL_SEGMENTS.length) =>
  LEVEL_SEGMENTS.slice(0, count).map((radialSegments, i) =>
    saveBufferGeometry(generateTreeGeometry({ ...TREE, radialSegments }).geometry, {
      id: `instanceStressTreeLod${i}`,
    })
  );

/** The tree's materials, by its geometry's groups: the trunk's and the foliage's (both paths) */
const createTreeMaterials = () => [
  createMaterial({ id: 'instanceStressTrunkMat', type: 'LAMBERT', params: { color: '#5b3a29' } }),
  createMaterial({ id: 'instanceStressFoliageMat', type: 'LAMBERT', params: { color: '#2f6a3a' } }),
];

/** A tree on the grid: its position, its turn about +y and its scale */
type TreePlacement = { position: THREE.Vector3; yaw: number; scale: number };

const UP = new THREE.Vector3(0, 1, 0);

/** Both paths' levels: the tree's three mesh levels, its trunk and foliage materials */
const createForestLevels = (): InstancedLodPoolLevel[] => {
  const materials = createTreeMaterials();
  const { impostor } = instanceStressSettings;
  const meshLevels = impostor === 'NONE' ? LEVEL_SEGMENTS.length : LEVEL_SEGMENTS.length - 1;
  const levels: InstancedLodPoolLevel[] = createLevelGeometries(meshLevels).map((geometry, i) => ({
    geometry,
    material: materials,
    screenSize: LEVEL_SCREEN_SIZES[i],
    // The coarsest level casts no shadow, as a far level usually wouldn't
    castShadow: i < LEVEL_SEGMENTS.length - 1,
  }));
  if (impostor === 'NONE') return levels;
  // Baked from level 0 at the load (a scene's assets: registered, so a reload reuses them), and
  // casting, so the shadow pass draws it too
  const source = levels[0].geometry;
  const baked =
    impostor === 'CROSS_QUADS'
      ? generateCrossQuads(source, materials, { id: 'instanceStressTreeCross' })
      : generateOctahedralImpostor(source, materials, {
          id: 'instanceStressTreeOctahedral',
          hemi: true,
        });
  levels.push({
    geometry: baked.geometry,
    material: baked.material,
    screenSize: LEVEL_SCREEN_SIZES[meshLevels],
    castShadow: true,
  });
  return levels;
};

/** Both paths' LOD settings */
const createForestLod = (): Omit<LodDef, 'levels'> => ({
  cullScreenSize: CULL_SCREEN_SIZE,
  fadeSeconds: instanceStressSettings.fadeSeconds,
});

const toInstancePlacement = ({ position, yaw, scale }: TreePlacement): InstancePlacement => ({
  position,
  quaternion: new THREE.Quaternion().setFromAxisAngle(UP, yaw),
  scale,
});

/** `count` trees on a square grid centred on the origin, the same on every load, grouped by tile
 * (row-major in each). */
const createPlacements = () => {
  const { count, tileSide } = instanceStressSettings;
  const side = Math.ceil(Math.sqrt(count));
  const tiles = Math.ceil(side / tileSide);
  const random = createSeededRandom(354);
  const half = (side * SPACING) / 2;
  const byTile: TreePlacement[][] = Array.from({ length: tiles * tiles }, () => []);
  for (let i = 0; i < count; i++) {
    const gx = i % side;
    const gz = Math.floor(i / side);
    const position = new THREE.Vector3(
      gx * SPACING - half + (random() * 2 - 1) * JITTER,
      0,
      gz * SPACING - half + (random() * 2 - 1) * JITTER
    );
    const yaw = random() * Math.PI * 2;
    const scale = 0.8 + random() * 0.4;
    byTile[Math.floor(gz / tileSide) * tiles + Math.floor(gx / tileSide)].push({
      position,
      yaw,
      scale,
    });
  }
  instanceStressState.count = count;
  instanceStressState.extent = side * SPACING;
  return byTile;
};

/** The CPU path: one instanced LOD pool per tile. */
const createPoolForest = (world: ECSWorld, byTile: TreePlacement[][]) => {
  const levels = createForestLevels();
  const lod = createForestLod();
  const rootScene = getRootScene();

  const pools: InstancedLodPool[] = [];
  for (const placements of byTile) {
    if (placements.length === 0) continue;
    const pool = createInstancedLodPool({
      world,
      levels,
      lod,
      maxInstances: placements.length,
      receiveShadow: true,
    });
    rootScene?.add(...pool.meshes);
    pool.spawn(placements.map(toInstancePlacement));
    pools.push(pool);
  }
  instanceStressState.pools = pools;
};

/** `?stressMove=`: moves `share` of the set's trees each frame, a block of them round-robin
 * through the forest, one `setInstanceMatrices` call each (their writes upload as one range a
 * frame): each turns about +y and sways up to half a metre along x from its place, by the scene's
 * time, so a tree's level can change with it. */
const startMovingTrees = (set: InstanceSet, range: InstanceRange, trees: TreePlacement[]) => {
  const perFrame = Math.max(1, Math.round(trees.length * instanceStressSettings.move));
  const matrix = new Float32Array(16);
  matrix[5] = 1;
  matrix[15] = 1;
  let cursor = 0;
  let time = 0;
  createSceneAppLooper((delta) => {
    time += delta;
    for (let n = 0; n < perFrame; n++) {
      const i = cursor;
      cursor = (cursor + 1) % trees.length;
      const { position, yaw, scale } = trees[i];
      const wave = Math.sin(time * 2 + i);
      // makeRotationY's columns, scaled
      const c = Math.cos(yaw + wave * 0.3) * scale;
      const sn = Math.sin(yaw + wave * 0.3) * scale;
      matrix[0] = c;
      matrix[2] = -sn;
      matrix[5] = scale;
      matrix[8] = sn;
      matrix[10] = c;
      matrix[12] = position.x + wave * 0.5;
      matrix[13] = position.y;
      matrix[14] = position.z;
      set.setInstanceMatrices(range, matrix, i);
    }
  }, INSTANCE_STRESS_SCENE_ID);
};

/** The GPU path: one instance set of every tree. Its owning entity goes with the scene. */
const createSetForestAsync = async (world: ECSWorld, byTile: TreePlacement[][]) => {
  const levels = createForestLevels();
  const set = await createInstanceSetAsync({
    world,
    levels,
    maxInstances: Math.max(instanceStressState.count, 1),
    lod: createForestLod(),
    preWarm: instanceStressSettings.preWarm,
    entityOpts: { appId: 'instanceStressForest' },
  });
  if (!set) return;
  getRootScene()?.add(set.object);
  const trees = byTile.flat();
  instanceStressState.set = set;
  if (instanceStressSettings.stream > 0) {
    // Its cells add and remove their ranges (the trees' cells around the main camera)
    startStreamedForest({
      sceneId: INSTANCE_STRESS_SCENE_ID,
      set,
      trees,
      cellSize: instanceStressSettings.stream,
      farRing: instanceStressSettings.streamFar,
      levelGeometries: levels.map((level) => level.geometry),
      cullScreenSize: CULL_SCREEN_SIZE,
      getCamera: () => getCameraByAppId(CAMERA_APP_ID, world),
      getLap: () => instanceStressState.lap,
      onEnter: onInstanceStressEnter,
    });
    if (instanceStressSettings.move > 0) {
      lwarn('Instance stress: ?stressMove= moves an unstreamed set only.');
    }
    return;
  }
  const range = set.addInstances(trees.map(toInstancePlacement));
  if (range && range.count > 0 && instanceStressSettings.move > 0) {
    startMovingTrees(set, range, trees);
  }
};

/** A ground to catch the shadows (one quad under the whole forest), once per load. */
const addShadowGround = () => {
  const rootScene = getRootScene();
  if (!rootScene || rootScene.getObjectByName(GROUND_NAME)) return;
  const side = instanceStressState.extent + SPACING * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(side, side).rotateX(-Math.PI / 2),
    new THREE.MeshLambertNodeMaterial({ color: '#6f7d4f' })
  );
  ground.receiveShadow = true;
  ground.name = GROUND_NAME;
  rootScene.add(ground);
  onInstanceStressExit(() => {
    ground.removeFromParent();
    ground.geometry.dispose();
    ground.material.dispose();
  });
};

/** `?stressLight=spot|point`: a light casting its shadow where the still camera looks (the orbit's
 * start: the camera at angle 0, looking at the circle's point 0.5 rad ahead). The spot light
 * shines down from 30 m above the halfway point; the point light sits 10 m up among the trees
 * there, so its shadows fall every way and several of its cube faces show in the view. */
const startLightShadow = (kind: InstanceStressLight) => {
  const rootScene = getRootScene();
  if (!rootScene || kind === 'NONE') return;
  const radius = instanceStressState.extent * 0.3;
  const ahead = new THREE.Vector3(Math.cos(0.5) * radius, 0, Math.sin(0.5) * radius);
  const halfway = new THREE.Vector3(radius, 0, 0).lerp(ahead, 0.5);
  let light: THREE.SpotLight | THREE.PointLight;
  if (kind === 'SPOT') {
    const spot = new THREE.SpotLight('#ffe7c4', 4000, 0, 0.7, 0.3, 2);
    spot.position.copy(halfway).setY(30);
    spot.target.position.copy(ahead);
    rootScene.add(spot.target);
    light = spot;
  } else {
    light = new THREE.PointLight('#ffe7c4', 900, 120, 2);
    light.position.copy(halfway.lerp(ahead, 0.3)).setY(10);
  }
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 120;
  light.name = `instanceStress${kind === 'SPOT' ? 'Spot' : 'Point'}Light`;
  rootScene.add(light);
  addShadowGround();
  onInstanceStressExit(() => {
    light.removeFromParent();
    if (light instanceof THREE.SpotLight) light.target.removeFromParent();
    light.dispose();
  });
};

/** `?stressViewport=true`: a picture-in-picture of the root scene in the bottom right, from 150 m
 * above where the still camera looks, looking down (p354 Phase 3 step 5: another camera drawing
 * the set, its own frustum of the main camera's levels). Deleted with the scene. */
const startOverviewViewport = () => {
  const rootScene = getRootScene();
  if (!rootScene) return;
  const radius = instanceStressState.extent * 0.3;
  const ahead = new THREE.Vector3(Math.cos(0.5) * radius, 0, Math.sin(0.5) * radius);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, 1000);
  camera.name = 'instanceStressOverview';
  camera.position.copy(ahead).setY(150);
  camera.up.set(1, 0, 0);
  camera.lookAt(ahead);
  camera.updateMatrixWorld();
  createViewport({
    id: 'instanceStressOverview',
    scene: rootScene,
    camera,
    anchor: 'BOTTOM_RIGHT',
    size: { width: '320px', height: '180px' },
    transparent: false,
    toneMapping: 'RENDERER',
    sceneId: INSTANCE_STRESS_SCENE_ID,
  });
};

/** `?stressShadow=true`: the sun casts its VSM shadow, fitted to the view (the toolkit's sun
 * shadow fit). Called on the scene's enter: the JSON lights are created after the scene code. */
const startSunShadow = (world: ECSWorld) => {
  const sun = getLightByAppId(SUN_APP_ID, world);
  const sunId = getEntityIdByAppId(SUN_APP_ID, world);
  if (!sun || sunId === undefined) {
    lwarn(`Instance stress: no sun '${SUN_APP_ID}' to cast the shadow.`);
    return;
  }
  sun.castShadow = true;
  addShadowGround();
  world.addComponent(sunId, SunShadowFitComponentType.SUN_SHADOW_FIT, {
    maxDistance: SHADOW_MAX_DISTANCE,
    casterExtension: SHADOW_CASTER_EXTENSION,
  });
};

/** Circles the main camera inside the forest, looking ahead along the circle and a little down:
 * the same path on every run (the test bridge's fixed frame delta makes it frame for frame). */
const startCamera = (world: ECSWorld, cameraId: number) => {
  const radius = instanceStressState.extent * 0.3;
  const height = 25;
  const eye = new THREE.PerspectiveCamera();
  const pose = { pos: { x: radius, y: height, z: 0 }, rot: new THREE.Quaternion() };
  let angle = 0;
  const place = () => {
    pose.pos.x = Math.cos(angle) * radius;
    pose.pos.z = Math.sin(angle) * radius;
    eye.position.set(pose.pos.x, height, pose.pos.z);
    // A point ahead on the circle, at tree height
    const ahead = angle + 0.5;
    eye.lookAt(Math.cos(ahead) * radius, 4, Math.sin(ahead) * radius);
    pose.rot.copy(eye.quaternion);
    world.setTransform(cameraId, pose);
  };
  place();
  createSceneAppLooper((delta) => {
    if (instanceStressSettings.camera === 'STILL' || !instanceStressState.orbiting) return;
    angle += (delta / instanceStressSettings.orbitSeconds) * Math.PI * 2;
    instanceStressState.lap = Math.floor(angle / (Math.PI * 2));
    place();
  }, INSTANCE_STRESS_SCENE_ID);
};

export const scene = async () => {
  const world = getECSWorld();
  exitTasks.length = 0;
  registerOnSceneExit(INSTANCE_STRESS_SCENE_ID, () => {
    for (const task of exitTasks.splice(0)) task();
  });
  enterTasks.length = 0;
  registerOnSceneEnter(INSTANCE_STRESS_SCENE_ID, () => {
    for (const task of enterTasks.splice(0)) task();
  });
  readUrlOverrides();
  const byTile = createPlacements();
  instanceStressState.pools = [];
  instanceStressState.set = null;
  instanceStressState.orbiting = !instanceStressSettings.orbitHold;
  instanceStressState.lap = 0;
  if (instanceStressSettings.path !== 'GPU' || instanceStressSettings.stream === 0) {
    stopStreamedForest(INSTANCE_STRESS_SCENE_ID);
  }
  if (instanceStressSettings.shadow) {
    onInstanceStressEnter(() => startSunShadow(world));
  }
  const light = instanceStressSettings.light;
  if (light !== 'NONE') {
    onInstanceStressEnter(() => startLightShadow(light));
  }
  if (instanceStressSettings.viewport) {
    onInstanceStressEnter(startOverviewViewport);
  }
  const path = instanceStressSettings.path;
  instanceStressState.path = path;
  if (path === 'GPU') await createSetForestAsync(world, byTile);
  else createPoolForest(world, byTile);
  if (path !== 'GPU' && instanceStressSettings.move > 0) {
    lwarn("Instance stress: ?stressMove= moves the set path's trees only (?stressPath=gpu).");
  }

  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) lwarn(`Instance stress: no camera '${CAMERA_APP_ID}' to move.`);
  else startCamera(world, cameraId);

  // In prod test mode too: the bench harness measures a minified build there
  // (devTools/bench/instanceStress.ts), which has no stats panels but the probe's own timing
  const probe = await loadDebugModuleAsync(
    () => import('./_dbg__instanceStress'),
    true,
    'Instance stress probe'
  );
  await probe?.current?.installInstanceStressProbe(world);
};
