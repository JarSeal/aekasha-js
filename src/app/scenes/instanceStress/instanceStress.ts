import * as THREE from 'three/webgpu';
import {
  createMaterial,
  createSceneAppLooper,
  createSeededRandom,
  getECSWorld,
  getEntityIdByAppId,
  getLightByAppId,
  getRootScene,
  isWebGPURenderer,
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
  type InstanceSet,
} from 'aekasha/instancing';
import type { LodDef } from 'aekasha/lod';
import { generateTreeGeometry } from 'aekasha/toolkit/geometry';
import { SunShadowFitComponentType } from 'aekasha/toolkit/ecs';
import { loadDebugModuleAsync } from 'aekasha/debug';

// GPU-driven culling's measuring and parity scene (docs/plans/p354_gpu-driven-culling.md D12): a
// square forest of LOD trees on a jittered grid, with the main camera circling inside it on a
// fixed path. Two paths draw the same trees with the same levels, materials and LOD settings:
// - CPU (the default): square tiles of one `createInstancedLodPool` each (so three's whole-mesh
//   culling still has something to cull, as static instance cells would give it). Every instance
//   is an entity that the pool sync walks and the LOD selection measures every frame, in view or
//   not (pool instances don't opt into the ECS frustum culling: three culls a level mesh only as
//   a whole).
// - GPU (`?stressPath=gpu`): one instance set (`createInstanceSetAsync`): no entity per tree,
//   culled and LOD-selected per instance by compute passes, a draw per level and material group.
//   On WebGL2 a set has no GPU backend (p354 Phase 4 adds its CPU one): the scene draws the pools.
// The scene's debug module (`_dbg__instanceStress.ts`) times both and reads the set back.

export const INSTANCE_STRESS_SCENE_ID = 'instanceStress';
const CAMERA_APP_ID = 'instanceStressCamera';
const SUN_APP_ID = 'instanceStressSun';

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

/** What draws the forest: instanced LOD pools (the CPU path) or the compute cull (WebGPU only) */
export type InstanceStressPath = 'CPU' | 'GPU';

/** The scene's settings: read at every load, so a change applies on the next load. Overridden by
 * `?stressInstances=`, `?stressTile=`, `?stressCamera=`, `?stressPath=` and `?stressShadow=` (the
 * measuring harness's). */
export const instanceStressSettings = {
  count: 20_000,
  /** Trees on a tile's side: a tile is one pool of up to `tileSide²` instances */
  tileSide: 128,
  camera: 'ORBIT' as InstanceStressCameraMode,
  path: 'CPU' as InstanceStressPath,
  /** The sun casts a VSM shadow (the app's shadow type), fitted to the view */
  shadow: false,
  /** The LOD cross-fades' seconds on both paths (`LodDef.fadeSeconds`); undefined: the global
   * setting (`getLodFadeSeconds`) */
  fadeSeconds: undefined as number | undefined,
  /** The orbit waits at its start until the measuring starts it (`instanceStressState.orbiting`),
   * so both paths see the same camera path from the same frame: the parity check's */
  orbitHold: false,
  /** The orbit's period, in seconds */
  orbitSeconds: 60,
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
  const fadeSeconds = params.get('stressFadeSeconds');
  if (fadeSeconds !== null && Number(fadeSeconds) >= 0) {
    instanceStressSettings.fadeSeconds = Number(fadeSeconds);
  }
  instanceStressSettings.orbitHold = params.get('stressOrbitHold') === 'true';
};

const createLevelGeometries = () =>
  LEVEL_SEGMENTS.map((radialSegments, i) =>
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
  return createLevelGeometries().map((geometry, i) => ({
    geometry,
    material: materials,
    screenSize: LEVEL_SCREEN_SIZES[i],
    // The coarsest level casts no shadow, as a far level usually wouldn't
    castShadow: i < LEVEL_SEGMENTS.length - 1,
  }));
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

/** The GPU path: one instance set of every tree (no cross-fades until p354 Phase 2, no shadow
 * until its Phase 3: only the main camera draws a set). Its owning entity goes with the scene. */
const createSetForestAsync = async (world: ECSWorld, byTile: TreePlacement[][]) => {
  const set = await createInstanceSetAsync({
    world,
    levels: createForestLevels(),
    maxInstances: Math.max(instanceStressState.count, 1),
    lod: createForestLod(),
    entityOpts: { appId: 'instanceStressForest' },
  });
  if (!set) return;
  getRootScene()?.add(set.object);
  set.addInstances(byTile.flat().map(toInstancePlacement));
  instanceStressState.set = set;
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
  // A ground to catch the shadows (one quad under the whole forest)
  const side = instanceStressState.extent + SPACING * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(side, side).rotateX(-Math.PI / 2),
    new THREE.MeshLambertNodeMaterial({ color: '#6f7d4f' })
  );
  ground.receiveShadow = true;
  ground.name = 'instanceStressGround';
  getRootScene()?.add(ground);
  registerOnSceneExit(INSTANCE_STRESS_SCENE_ID, () => {
    ground.removeFromParent();
    ground.geometry.dispose();
    ground.material.dispose();
  });
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
    place();
  }, INSTANCE_STRESS_SCENE_ID);
};

export const scene = async () => {
  const world = getECSWorld();
  readUrlOverrides();
  const byTile = createPlacements();
  instanceStressState.pools = [];
  instanceStressState.set = null;
  instanceStressState.orbiting = !instanceStressSettings.orbitHold;
  if (instanceStressSettings.shadow) {
    registerOnSceneEnter(INSTANCE_STRESS_SCENE_ID, () => startSunShadow(world));
  }
  let path = instanceStressSettings.path;
  if (path === 'GPU' && !isWebGPURenderer()) {
    lwarn(
      'Instance stress: an instance set has no WebGL2 backend yet (p354 Phase 4); drawing on the CPU path.'
    );
    path = 'CPU';
  }
  instanceStressState.path = path;
  if (path === 'GPU') await createSetForestAsync(world, byTile);
  else createPoolForest(world, byTile);

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
