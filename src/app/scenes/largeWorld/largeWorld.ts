import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  getLoaderStatusUpdater,
  createMeshEntity,
  getMeshByAppId,
  createMaterial,
  createLightEntity,
  setLightEnabled,
  getGeometry,
  saveBufferGeometry,
  createCameraEntity,
  getActiveCameraId,
  setMainCamera,
  createActionMap,
  ComponentType,
  getECSWorld,
  getEntityIdByAppId,
  getRootScene,
  registerOnSceneEnter,
  registerOnSceneExit,
  existsOrThrow,
} from 'aekasha';
import type { ECSWorld, MeshProps } from 'aekasha';
import { FollowToolComponentType, HoverToolComponentType } from 'aekasha/toolkit/ecs';
import { onSkyBoxChange, getSkyLightIds } from 'aekasha/skybox';
import { generateCrossQuads } from 'aekasha/lod';
import {
  generateBushGeometry,
  generateTerrain,
  generateTreeGeometry,
  scatterOnSurface,
} from 'aekasha/toolkit/geometry';
import type { GeneratedTerrain } from 'aekasha/toolkit/geometry';
import { createInstancedLodPool } from 'aekasha/instancing';
import { registerSpatialDomain } from 'aekasha/spatial';
import {
  createLargeWorldRockMaterial,
  generateLargeWorldRockImpostor,
  saveLargeWorldRockGeometry,
} from '../../shared/largeWorldRock';

const LARGE_WORLD_SCENE_ID = 'largeWorld';

/** What every step builds on: the world, the root scene and the terrain's surface. */
interface WorldContext {
  world: ECSWorld;
  rootScene: THREE.Scene;
  terrain: GeneratedTerrain;
  terrainMesh: THREE.Mesh;
}

/** A mesh placed on the terrain by its x and z (y: its height there plus `lift`, or `y`). */
interface Placed {
  appId: string;
  geo: MeshProps['geo'];
  x: number;
  z: number;
}

/** The static props' materials, by name. */
type PropMaterial = 'rock' | 'platform' | 'wall';

/**
 * The static props. The `offFrustum` ones stand behind the overview camera (`largeWorldOverview`,
 * at z = 120 looking at the origin), out of its view, at a fixed `y`: they opt into the ECS
 * frustum culling (`ecsFrustumCullingEnabled`), whose result the ECS can query.
 */
const STATIC_PROPS: (Placed & { mat: PropMaterial; y?: number; offFrustum?: boolean })[] = [
  {
    appId: 'largeWorldRock1',
    geo: { type: 'SPHERE', params: { radius: 1.6, widthSegments: 6, heightSegments: 5 } },
    mat: 'rock',
    x: -30,
    z: -20,
  },
  {
    appId: 'largeWorldRock2',
    geo: { type: 'SPHERE', params: { radius: 2.2, widthSegments: 6, heightSegments: 5 } },
    mat: 'rock',
    x: 25,
    z: 15,
  },
  {
    appId: 'largeWorldPlatform1',
    geo: { type: 'BOX', params: { width: 6, height: 0.6, depth: 6 } },
    mat: 'platform',
    x: 12,
    z: 30,
  },
  {
    appId: 'largeWorldPlatform2',
    geo: { type: 'BOX', params: { width: 5, height: 0.6, depth: 5 } },
    mat: 'platform',
    x: -40,
    z: 35,
  },
  {
    appId: 'largeWorldWall1',
    geo: { type: 'BOX', params: { width: 8, height: 3, depth: 0.6 } },
    mat: 'wall',
    x: 0,
    z: -55,
  },
  {
    appId: 'largeWorldRockOffFrustum1',
    geo: { type: 'SPHERE', params: { radius: 1.8, widthSegments: 6, heightSegments: 5 } },
    mat: 'rock',
    x: 0,
    z: 150,
    y: 1.8,
    offFrustum: true,
  },
  {
    appId: 'largeWorldPlatformOffFrustum1',
    geo: { type: 'BOX', params: { width: 5, height: 0.6, depth: 5 } },
    mat: 'platform',
    x: 20,
    z: 160,
    y: 0.3,
    offFrustum: true,
  },
  {
    appId: 'largeWorldWallOffFrustum1',
    geo: { type: 'BOX', params: { width: 8, height: 3, depth: 0.6 } },
    mat: 'wall',
    x: -20,
    z: 145,
    y: 1.5,
    offFrustum: true,
  },
];

/** The red objects resting on the terrain ("dynamic" in their ids, but without bodies). */
const RESTING_OBJECTS: Placed[] = [
  {
    appId: 'largeWorldDynamicBox1',
    geo: { type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
    x: 8,
    z: -10,
  },
  {
    appId: 'largeWorldDynamicBox2',
    geo: { type: 'BOX', params: { width: 1.2, height: 1.2, depth: 1.2 } },
    x: -15,
    z: 5,
  },
  {
    appId: 'largeWorldDynamicSphere1',
    geo: { type: 'SPHERE', params: { radius: 0.6, widthSegments: 12, heightSegments: 10 } },
    x: 18,
    z: -30,
  },
  {
    appId: 'largeWorldDynamicSphere2',
    geo: { type: 'SPHERE', params: { radius: 0.8, widthSegments: 12, heightSegments: 10 } },
    x: -8,
    z: 20,
  },
  {
    appId: 'largeWorldDynamicBox3',
    geo: { type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
    x: 30,
    z: -5,
  },
];

const CRATE_STACK_POSITION = { x: 5, z: 8 };
const BARBELL_POSITION = { x: -20, z: -35 };
/** The follow camera's offset from the crate stack. */
const FOLLOW_OFFSET = new THREE.Vector3(4, 3, 6);

/**
 * A large procedural world without physics: a generated terrain, instanced trees, bushes and rocks
 * scattered on it with LOD levels down to impostors, static props, point-light lanterns, a few
 * resting objects, a bobbing crate stack with a camera following it (C switches to it), and the
 * day-night sky box's lights taking over from the scene's own. The overview camera, the sun, the
 * ambient light and the sky boxes come from `largeWorld.scene.json` (the camera before this file
 * runs, the lights and the sky box after it); the terrain has no JSON form, so it's built here.
 */
export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  updateLoaderFn({ loadedCount: 0, totalCount: 1 });

  const ctx = createTerrain();
  createTreePool(ctx);
  createBushPool(ctx);
  createRockPool(ctx);
  createStaticProps(ctx);
  createLanterns(ctx);
  const restingMaterial = createRestingObjects(ctx);
  const crateStackId = createCrateStack(ctx, restingMaterial);
  createBarbell(ctx, restingMaterial);
  createFollowCamera(ctx, crateStackId);
  createCameraToggle(ctx.world);
  syncSceneLightsWithSky(ctx.world);

  updateLoaderFn({ loadedCount: 1, totalCount: 1 });
};

/** A geometry registered under `id`, built only when the id isn't registered already. */
const saveGeometryOnce = (id: string, build: () => THREE.BufferGeometry) =>
  getGeometry(id) ?? saveBufferGeometry(build(), { id });

/**
 * Merges `parts` (three's geometries, never registered) into one geometry registered under `id`,
 * and disposes the parts.
 */
const saveMergedGeometry = (id: string, parts: THREE.BufferGeometry[]) => {
  const geometry = saveGeometryOnce(id, () => {
    const merged = existsOrThrow(mergeGeometries(parts, false), `Could not merge "${id}".`);
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  });
  for (const part of parts) part.dispose();
  return geometry;
};

/** The terrain: 200 × 200 m, its geometry registered so the scene's asset release disposes it. */
const createTerrain = (): WorldContext => {
  const world = getECSWorld();
  const rootScene = existsOrThrow(getRootScene(), 'The largeWorld scene needs the root scene.');
  const terrain = generateTerrain({
    width: 200,
    depth: 200,
    widthSegments: 150,
    depthSegments: 150,
    maxHeight: 7,
    seed: 5,
  });
  createMeshEntity(
    {
      geo: saveBufferGeometry(terrain.geometry, { id: 'largeWorldTerrainGeo' }),
      mat: createMaterial({
        id: 'largeWorldTerrainMat',
        type: 'PHONG',
        params: { color: '#4a7c3f', flatShading: false },
      }),
      castShadow: true,
      receiveShadow: true,
    },
    { appId: 'largeWorldTerrain', debugData: { name: 'Large world terrain' } }
  );
  const terrainMesh = existsOrThrow(
    getMeshByAppId('largeWorldTerrain'),
    'The large world terrain has no mesh.'
  );
  return { world, rootScene, terrain, terrainMesh };
};

/**
 * 1,500 trees scattered off the terrain mesh's surface into an instanced LOD pool: the tree, the
 * same generator at fewer segments, and cross-quads (three alpha-cut planes with the tree baked on
 * them, lit at runtime like the mesh). The cross-quads are built from their export
 * (`largeWorldTreeCross.impostor.json` next to this file, listed in the scene JSON), so nothing is
 * baked at load; re-export it from the LOD tab's Impostors after changing the tree.
 */
const createTreePool = ({ world, rootScene, terrainMesh }: WorldContext) => {
  const placements = scatterOnSurface({
    surface: terrainMesh,
    count: 1500,
    seed: 2,
    minSpacing: 2,
    scaleRange: [0.7, 1.3],
  });
  // Hand-made levels: the default tree (30 triangles) is too low-poly for a generated LOD chain to
  // simplify, but fewer segments keep its silhouette
  const geometry = saveGeometryOnce('largeWorldTreeGeo', () => generateTreeGeometry().geometry);
  const lod1Geometry = saveGeometryOnce(
    'largeWorldTreeLod1Geo',
    () => generateTreeGeometry({ radialSegments: 3 }).geometry
  );
  const material = [
    createMaterial({ id: 'largeWorldTreeTrunkMat', type: 'PHONG', params: { color: '#5b3a29' } }),
    createMaterial({
      id: 'largeWorldTreeFoliageMat',
      type: 'PHONG',
      params: { color: '#2f5d34', flatShading: true },
    }),
  ];
  // The trees have a spatial domain of their own, apart from DEFAULT's light culling members.
  // They never move, so it's rebuilt only when they're spawned or deleted, and it's this scene's:
  // leaving the scene unregisters it
  registerSpatialDomain(world, {
    id: 'FOLIAGE',
    cellSize: 16,
    maxMembers: placements.length,
    update: 'STATIC',
    sceneId: LARGE_WORLD_SCENE_ID,
  });
  const cross = generateCrossQuads(geometry, material, { id: 'largeWorldTreeCross' });
  // One InstancedMesh per level, each instance in the one its LOD selects. The thresholds are
  // screen sizes (bounding-sphere diameter / viewport height): from the overview camera a tree at
  // scale 1 crosses 0.04 at about 145 m and 0.032 at about 180 m
  const pool = createInstancedLodPool({
    world,
    levels: [
      { geometry, material, screenSize: 0.04 },
      { geometry: lod1Geometry, material, screenSize: 0.032 },
      { geometry: cross.geometry, material: cross.material, screenSize: 0 },
    ],
    maxInstances: placements.length,
    receiveShadow: true,
    spatialDomain: 'FOLIAGE',
  });
  rootScene.add(...pool.meshes);
  pool.spawn(world, placements);
};

/** 2,000 bushes in two levels (the second at fewer segments), hidden when a few pixels tall. */
const createBushPool = ({ world, rootScene, terrainMesh }: WorldContext) => {
  const placements = scatterOnSurface({
    surface: terrainMesh,
    count: 2000,
    seed: 3,
    minSpacing: 1,
    scaleRange: [0.6, 1.2],
  });
  // The bush's blobs are placed by its seed, not its segment count, so the levels match
  const geometry = saveGeometryOnce('largeWorldBushGeo', () => generateBushGeometry());
  const lod1Geometry = saveGeometryOnce('largeWorldBushLod1Geo', () =>
    generateBushGeometry({ segments: 3 })
  );
  const material = createMaterial({
    id: 'largeWorldBushMat',
    type: 'PHONG',
    params: { color: '#3c6e35', flatShading: true },
  });
  // From the overview camera a bush at scale 1 crosses 0.03 at about 75 m, and is hidden below
  // 0.012 (with the hysteresis, past about 200 m)
  const pool = createInstancedLodPool({
    world,
    levels: [
      { geometry, material, screenSize: 0.03 },
      { geometry: lod1Geometry, material, screenSize: 0 },
    ],
    lod: { cullScreenSize: 0.012 },
    maxInstances: placements.length,
    receiveShadow: true,
  });
  rootScene.add(...pool.meshes);
  pool.spawn(world, placements);
};

/**
 * 300 rocks: the shared large world rock (`src/app/shared/largeWorldRock.ts`), the same rock at a
 * lower icosphere detail, and its octahedral impostor, built from its export.
 */
const createRockPool = ({ world, rootScene, terrainMesh }: WorldContext) => {
  const placements = scatterOnSurface({
    surface: terrainMesh,
    count: 300,
    seed: 6,
    minSpacing: 4,
    scaleRange: [0.6, 1.6],
  });
  const geometry = saveLargeWorldRockGeometry('largeWorldRockGeo');
  // A third of its height in the ground (its bottom, min.y below its centre, that deep), so the
  // impostor's surface depth meets the terrain like the mesh does
  geometry.computeBoundingBox();
  const { min, max } = existsOrThrow(geometry.boundingBox, 'The rock has no bounding box.');
  const lift = -min.y - (max.y - min.y) / 3;
  for (const placement of placements) placement.position.y += lift * placement.scale;
  const lod1Geometry = saveLargeWorldRockGeometry('largeWorldRockLod1Geo', 1);
  const material = createLargeWorldRockMaterial('largeWorldRockPoolMat');
  const impostor = generateLargeWorldRockImpostor(geometry, material);
  // From the overview camera a rock at scale 1 (radius about 1.4) crosses 0.05 at about 50 m and
  // 0.025 at about 100 m
  const pool = createInstancedLodPool({
    world,
    levels: [
      { geometry, material, screenSize: 0.05 },
      { geometry: lod1Geometry, material, screenSize: 0.025 },
      { geometry: impostor.geometry, material: impostor.material, screenSize: 0 },
    ],
    maxInstances: placements.length,
    receiveShadow: true,
  });
  rootScene.add(...pool.meshes);
  pool.spawn(world, placements);
};

/** The static props of `STATIC_PROPS`, 0.3 m above the terrain unless they have a `y`. */
const createStaticProps = ({ world, terrain }: WorldContext) => {
  const materials: Record<PropMaterial, THREE.Material> = {
    rock: createMaterial({
      id: 'largeWorldRockMat',
      type: 'PHONG',
      params: { color: '#8a8a86', flatShading: true },
    }),
    platform: createMaterial({
      id: 'largeWorldPlatformMat',
      type: 'PHONG',
      params: { color: '#a89f91' },
    }),
    wall: createMaterial({ id: 'largeWorldWallMat', type: 'PHONG', params: { color: '#7d7364' } }),
  };
  for (const prop of STATIC_PROPS) {
    const y = prop.y ?? terrain.getHeightAt(prop.x, prop.z) + 0.3;
    createMeshEntity(
      {
        geo: prop.geo,
        mat: materials[prop.mat],
        castShadow: true,
        receiveShadow: true,
        position: { x: prop.x, y, z: prop.z },
      },
      {
        appId: prop.appId,
        debugData: { name: prop.appId },
        ecsFrustumCullingEnabled: prop.offFrustum,
      },
      world
    );
  }
};

/**
 * Ten lantern point lights among the foliage, each culled when its light reaches nothing in view
 * (`objectCullingEnabled`).
 */
const createLanterns = ({ world, terrainMesh }: WorldContext) => {
  const placements = scatterOnSurface({ surface: terrainMesh, count: 10, seed: 4, minSpacing: 12 });
  placements.forEach(({ position }, i) => {
    createLightEntity(
      {
        type: 'POINT',
        color: '#ffcc66',
        intensity: 4,
        distance: 8,
        objectCullingEnabled: true,
        position: { x: position.x, y: position.y + 1.2, z: position.z },
      },
      { appId: `largeWorldLantern${i}`, debugData: { name: `Large world lantern ${i}` } },
      world
    );
  });
};

/** `RESTING_OBJECTS` on the terrain. Returns their material, which the crates and barbell share. */
const createRestingObjects = ({ world, terrain }: WorldContext) => {
  const material = createMaterial({
    id: 'largeWorldDynamicMat',
    type: 'PHONG',
    params: { color: '#c94f4f' },
  });
  for (const obj of RESTING_OBJECTS) {
    createMeshEntity(
      {
        geo: obj.geo,
        mat: material,
        castShadow: true,
        receiveShadow: true,
        position: { x: obj.x, y: terrain.getHeightAt(obj.x, obj.z) + 0.6, z: obj.z },
      },
      { appId: obj.appId, debugData: { name: obj.appId } },
      world
    );
  }
  return material;
};

/**
 * Two crates, one on the other's edge, merged into one geometry, bobbing with the toolkit's
 * HoverEffect so the follow camera has something to follow. Returns its entity.
 */
const createCrateStack = ({ world, terrain }: WorldContext, material: THREE.Material) => {
  const top = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  top.translate(0.7, 1.4, 0);
  const geometry = saveMergedGeometry('largeWorldCrateStackGeo', [
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
    top,
  ]);
  const { x, z } = CRATE_STACK_POSITION;
  const baseY = terrain.getHeightAt(x, z) + 0.7;
  const entityId = createMeshEntity(
    {
      geo: geometry,
      mat: material,
      castShadow: true,
      receiveShadow: true,
      position: { x, y: baseY, z },
    },
    {
      appId: 'largeWorldDynamicCrateStack',
      debugData: { name: 'Large world dynamic crate stack' },
    },
    world
  );
  world.addComponent(entityId, HoverToolComponentType.HOVER, {
    speed: 1.2,
    amplitude: 0.4,
    baseY,
  });
  return entityId;
};

/** Two spheres on a handle, merged into one geometry. */
const createBarbell = ({ world, terrain }: WorldContext, material: THREE.Material) => {
  const sphereA = new THREE.SphereGeometry(0.5, 10, 8);
  sphereA.translate(-0.9, 0, 0);
  const sphereB = new THREE.SphereGeometry(0.5, 10, 8);
  sphereB.translate(0.9, 0, 0);
  const handle = new THREE.CylinderGeometry(0.15, 0.15, 1.8, 8);
  handle.rotateZ(Math.PI / 2);
  const { x, z } = BARBELL_POSITION;
  createMeshEntity(
    {
      geo: saveMergedGeometry('largeWorldBarbellGeo', [sphereA, sphereB, handle]),
      mat: material,
      castShadow: true,
      receiveShadow: true,
      position: { x, y: terrain.getHeightAt(x, z) + 0.5, z },
    },
    { appId: 'largeWorldDynamicBarbell', debugData: { name: 'Large world dynamic barbell' } },
    world
  );
};

/**
 * A second camera, inactive, that follows the crate stack with the toolkit's FollowTool (its
 * position, lerped, at `FOLLOW_OFFSET`).
 */
const createFollowCamera = ({ world }: WorldContext, crateStackId: number) => {
  const leader = existsOrThrow(
    world.getComponent(crateStackId, ComponentType.TRANSFORM),
    'The crate stack has no transform.'
  ).position;
  const cameraId = createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 60,
      near: 0.1,
      far: 500,
      active: false,
      position: {
        x: leader.x + FOLLOW_OFFSET.x,
        y: leader.y + FOLLOW_OFFSET.y,
        z: leader.z + FOLLOW_OFFSET.z,
      },
      lookAtPoint: { x: CRATE_STACK_POSITION.x, y: leader.y, z: CRATE_STACK_POSITION.z },
    },
    {
      appId: 'largeWorldDynamicCamera',
      debugData: {
        name: 'Large world dynamic camera',
        description: 'Follows largeWorldDynamicCrateStack via FollowTool. Toggle with the C key.',
      },
    },
    world
  );
  world.addComponent(cameraId, FollowToolComponentType.FOLLOW, {
    leaderId: crateStackId,
    offset: FOLLOW_OFFSET,
    targetOffset: new THREE.Vector3(0, 0, 0),
    speed: 3,
  });
};

/**
 * C switches between the overview and the follow camera: a scene action map (replaced on the next
 * visit by its id), with exact modifiers, so Ctrl+C isn't a switch.
 */
const createCameraToggle = (world: ECSWorld) => {
  const actions = createActionMap({
    id: 'largeWorld',
    sceneId: LARGE_WORLD_SCENE_ID,
    ignoreModifiers: false,
    actions: { toggleCamera: { type: 'BUTTON', name: 'Switch the overview and dynamic cameras' } },
    bindings: { toggleCamera: [{ device: 'KEYBOARD', keys: ['c'] }] },
  });
  actions.onPressed('toggleCamera', () => {
    const overviewId = getEntityIdByAppId('largeWorldOverview', world);
    const followId = getEntityIdByAppId('largeWorldDynamicCamera', world);
    if (overviewId === undefined || followId === undefined) return;
    setMainCamera(world, getActiveCameraId() === overviewId ? followId : overviewId);
  });
};

/**
 * The scene also lists the day-night sky box, which brings its own sun light, and whose
 * environment (and ambient light, when it has one) lights the shade. While a sky box with a sun
 * light is active, the scene's sun and ambient are off, so its night falls on everything. The
 * JSON lights are created after this file runs (and after the default sky box is activated), so
 * each sync looks them up, and the first runs on enter.
 */
const syncSceneLightsWithSky = (world: ECSWorld) => {
  const syncSceneLights = () => {
    const hasSkySun = getSkyLightIds().suns.some((id) => id !== null);
    for (const appId of ['largeWorldSun', 'largeWorldAmbient']) {
      const lightId = getEntityIdByAppId(appId, world);
      if (lightId !== undefined) setLightEnabled(lightId, !hasSkySun, world);
    }
  };
  registerOnSceneEnter(LARGE_WORLD_SCENE_ID, syncSceneLights);
  // The scene's one exit callback (a second registerOnSceneExit would replace it)
  registerOnSceneExit(LARGE_WORLD_SCENE_ID, onSkyBoxChange(syncSceneLights));
};
