import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getLoaderStatusUpdater,
  IS_DEBUG_ENV,
  registerOnSceneExit,
  saveBufferGeometry,
} from 'aekasha';
import { setFog } from 'aekasha/fog';
import { generateTerrain, type TerrainRule } from 'aekasha/toolkit/geometry';

/**
 * The fog feature's verification scene (p106 Phase 5): a valley long enough for every fog mode to
 * show its distance, with hills tall enough for `HEIGHT` to fill the floor and leave the tops clear.
 *
 * - **The valley** runs east-west (x), 800 × 480 m, the camera at its east end looking west, the
 *   sky's afternoon sun low over its far end. One mesh made here by `generateTerrain`: its seeded
 *   noise reshaped by `heightModifier` into a meandering floor (2 m up, a metre of bumps), a lake
 *   basin, 20-55 m hills on both sides and a ridge closing the west end. The ground material's
 *   layers (grass, a sandy shore, rocky slopes, triplanar cliffs) are laid into its vertex colours
 *   by rules, with the horizon AO.
 * - **The lake** is a still plane at y = 0 over the basin, 140-360 m from the camera.
 * - **The posts** stand along the floor south of the lake every 25 m from 25 m to 700 m in front
 *   of the camera, every 100 m a red one twice as tall: how far the fog reaches, at a glance.
 *
 * - **The fogs** (the scene JSON's `fogs`), one per mode in the sky's horizon colour: `HEIGHT`
 *   (`fogShowcaseHeight`, the default: the floor fogged, the hilltops clear, glowing toward the
 *   sun), `LINEAR` (`fogShowcaseLinear`, 30 to 600 m) and `EXP2` (`fogShowcaseExp2`).
 *
 * No physics: nothing moves but the sky (standing still at 16:30 in its JSON), so the scene runner's
 * snapshot is the same on every run.
 *
 * The debug env adds the scene's tab (`_dbg__fogShowcase.ts`): the fog switch, the day (the fog's
 * colour following the sky) and a dense valley fog filled and lifted through `updateFog`.
 */

export const FOG_SHOWCASE_SCENE_ID = 'fogShowcase';
/** The scene's fogs by mode (its JSON's `fogs`) */
export const FOG_SHOWCASE_FOG_IDS = {
  LINEAR: 'fogShowcaseLinear',
  EXP2: 'fogShowcaseExp2',
  HEIGHT: 'fogShowcaseHeight',
} as const;
/** The sky's hour (`fogShowcaseSky.skybox.json`) */
export const FOG_SHOWCASE_START_HOUR = 16.5;

/** The camera's x (`fogShowcaseCamera.camera.json`): the posts' distances count from it */
const CAMERA_X = 372;
const TERRAIN = { width: 800, depth: 480, cellSize: 2.5, seed: 7 };
const VALLEY = {
  /** How far the floor's middle swings north and south, metres */
  meander: 18,
  /** The meander's wavelength over 2π, metres */
  meanderLength: 120,
  /** The floor's height and its bumps (the noise's ±1 scaled) */
  floorHeight: 2,
  floorBumps: 1.2,
  /** From the floor's middle: the hills start rising here and are whole there */
  hillStart: 50,
  hillFull: 190,
  /** The hills' height at the noise's top; at its bottom 30 % of it */
  hillHeight: 55,
  /** The ridge closing the west end rises from x = −start to x = −full */
  westRidgeStart: 260,
  westRidgeFull: 380,
};
/** The basin's middle (on the floor's middle line at `x`), its half lengths and its depth */
const LAKE = { x: 120, radiusX: 110, radiusZ: 28, depth: 4.5, level: 0, color: '#24505c' };
const POSTS = {
  spacing: 25,
  maxDistance: 700,
  /** Metres south of the floor's middle: clear of the lake */
  offsetZ: 34,
  /** Metres of a post's base in the ground, so a bump never shows it floating */
  sink: 0.4,
  post: { height: 3, radius: 0.18, color: '#e8e4dc' },
  marker: { every: 100, height: 6, radius: 0.25, color: '#b8432f' },
};
/** Seeded simplex octaves, summed to ±1 (`maxHeight` 1): the valley's shapes scale them */
const NOISE_OCTAVES = [
  { frequency: 0.006, amplitude: 1 },
  { frequency: 0.018, amplitude: 0.5 },
  { frequency: 0.05, amplitude: 0.2 },
  { frequency: 0.13, amplitude: 0.07 },
];
/** The ground material's layers 1-3 over its grass (`fogShowcaseGround.material.json`) */
const GROUND_RULES: TerrainRule[] = [
  // Sand on the lake's shore
  { layer: 1, height: { max: 0.9, softness: 0.5 }, slope: { max: 20, softness: 5 } },
  { layer: 2, slope: { min: 26, softness: 6 } },
  { layer: 3, slope: { min: 42 } },
];

const smoothstep = THREE.MathUtils.smoothstep;

/** The floor's middle line's z at `x` */
const getValleyZ = (x: number) => VALLEY.meander * Math.sin(x / VALLEY.meanderLength);
const LAKE_Z = getValleyZ(LAKE.x);

/** The valley's height at world (x, z) from the noise's `h` (±1) */
const shapeValley = (x: number, z: number, h: number) => {
  const across = Math.abs(z - getValleyZ(x));
  const hillWeight = Math.max(
    smoothstep(across, VALLEY.hillStart, VALLEY.hillFull),
    smoothstep(-x, VALLEY.westRidgeStart, VALLEY.westRidgeFull)
  );
  const lakeDistance = Math.hypot((x - LAKE.x) / LAKE.radiusX, (z - LAKE_Z) / LAKE.radiusZ);
  const basin = 1 - smoothstep(lakeDistance, 0.6, 1);
  const floor = VALLEY.floorHeight + VALLEY.floorBumps * h - LAKE.depth * basin;
  const hills = VALLEY.hillHeight * (0.65 + 0.35 * h);
  return THREE.MathUtils.lerp(floor, hills, hillWeight);
};

const createValley = () => {
  const terrain = generateTerrain({
    width: TERRAIN.width,
    depth: TERRAIN.depth,
    widthSegments: TERRAIN.width / TERRAIN.cellSize,
    depthSegments: TERRAIN.depth / TERRAIN.cellSize,
    maxHeight: 1,
    noiseOctaves: NOISE_OCTAVES,
    seed: TERRAIN.seed,
    heightModifier: shapeValley,
    normals: 'HEIGHT_FN',
    ao: { radius: 16, steps: 6 },
    vertexColors: { layout: 'RGB_AO', rules: GROUND_RULES },
  });
  createMeshEntity(
    {
      geo: saveBufferGeometry(terrain.geometry, { id: 'fogShowcaseValley' }),
      mat: 'fogShowcaseGround',
      receiveShadow: true,
    },
    { appId: 'fogShowcaseValley', debugData: { name: 'Fog showcase: valley' } }
  );
  return terrain;
};

const createLake = () =>
  createMeshEntity(
    {
      geo: saveBufferGeometry(
        new THREE.PlaneGeometry(LAKE.radiusX * 2 + 20, LAKE.radiusZ * 2 + 20).rotateX(-Math.PI / 2),
        { id: 'fogShowcaseLake' }
      ),
      mat: {
        id: 'fogShowcaseLake',
        type: 'STANDARD',
        params: { color: LAKE.color, roughness: 0.06, metalness: 0 },
      },
      position: { x: LAKE.x, y: LAKE.level, z: LAKE_Z },
    },
    { appId: 'fogShowcaseLake', debugData: { name: 'Fog showcase: lake' } }
  );

/** The posts, standing on the valley's mesh (`getHeightAt`) */
const createPosts = (getHeightAt: (x: number, z: number) => number) => {
  for (let distance = POSTS.spacing; distance <= POSTS.maxDistance; distance += POSTS.spacing) {
    const isMarker = distance % POSTS.marker.every === 0;
    const kind = isMarker ? 'Marker' : 'Post';
    const { height, radius, color } = isMarker ? POSTS.marker : POSTS.post;
    const x = CAMERA_X - distance;
    const z = getValleyZ(x) + POSTS.offsetZ;
    createMeshEntity(
      {
        geo: {
          id: `fogShowcase${kind}`,
          type: 'CYLINDER',
          params: { radiusTop: radius, radiusBottom: radius, height },
        },
        mat: {
          id: `fogShowcase${kind}`,
          type: 'STANDARD',
          params: { color, roughness: 0.6, metalness: 0 },
        },
        position: { x, y: getHeightAt(x, z) + height / 2 - POSTS.sink, z },
        castShadow: true,
        receiveShadow: true,
      },
      {
        appId: `fogShowcase${kind}${distance}`,
        debugData: { name: `Fog showcase: ${kind.toLowerCase()} at ${distance} m` },
      }
    );
  }
};

/**
 * `?fogShowcaseFog=linear|exp2|height|none` shows that fog in place of the scene's default (the
 * scene runner's variants, `devTools/verify/scenes.config.ts`); anything else is ignored
 */
const showFogFromUrl = () => {
  const wanted = new URLSearchParams(window.location.search).get('fogShowcaseFog')?.toUpperCase();
  if (wanted === 'NONE') setFog(null);
  else if (wanted && Object.prototype.hasOwnProperty.call(FOG_SHOWCASE_FOG_IDS, wanted)) {
    setFog(FOG_SHOWCASE_FOG_IDS[wanted as keyof typeof FOG_SHOWCASE_FOG_IDS]);
  }
};

export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  updateLoaderFn({ loadedCount: 0, totalCount: 1 });
  const valley = createValley();
  createLake();
  createPosts(valley.getHeightAt);
  showFogFromUrl();
  updateLoaderFn({ loadedCount: 1, totalCount: 1 });

  // Debug env only: a dynamic import, so the tab's code isn't in a production build
  if (IS_DEBUG_ENV) {
    const visit = { isCurrent: true, cleanup: () => {} };
    registerOnSceneExit(FOG_SHOWCASE_SCENE_ID, () => {
      visit.isCurrent = false;
      visit.cleanup();
    });
    const { createFogShowcaseTab } = await import('./_dbg__fogShowcase');
    if (visit.isCurrent) visit.cleanup = createFogShowcaseTab();
  }
};
