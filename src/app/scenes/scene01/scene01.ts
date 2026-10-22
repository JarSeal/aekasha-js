import * as THREE from 'three/webgpu';
import {
  createSceneAppLooper,
  createGeometry,
  createMaterial,
  loadTextureAsync,
  importAssetAsync,
  spawnImportedAsset,
  createMeshEntity,
  getMeshByAppId,
  createGroupEntity,
  addToGroupEntity,
  getLoaderStatusUpdater,
  existsOrThrow,
} from 'aekasha';
import type { SkyBoxDef } from 'aekasha/skybox';
import { createSkyBox } from 'aekasha/skybox';
import { createPhysicsEntity, getPhysicsSimClock, getPhysicsState } from 'aekasha/physics';

const TEXTURES_PATH = '/debugger/assets/testTextures';

/** The scene's sky box: a cube texture. */
const DESERT_DUNES_SKY_BOX: SkyBoxDef = {
  id: 'desert-dunes',
  base: {
    type: 'CUBE_TEXTURE',
    fileNames: [
      '/cubemap02_positive_x.png',
      '/cubemap02_negative_x.png',
      '/cubemap02_negative_y.png',
      '/cubemap02_positive_y.png',
      '/cubemap02_positive_z.png',
      '/cubemap02_negative_z.png',
    ],
    path: TEXTURES_PATH,
    textureId: 'cubeTextureId',
    flipY: true,
  },
};

/** Three equirectangular sky boxes to switch to in the debug drawer's sky box tab. */
const OTHER_SKY_BOXES: SkyBoxDef[] = [
  {
    id: 'emptyBlueSkyEquiRect',
    base: {
      type: 'EQUIRECTANGULAR',
      file: `${TEXTURES_PATH}/skyboxes/sunset_stylized/sky_empty_2k.png`,
      textureId: 'equiRectEmptyId',
      colorSpace: THREE.SRGBColorSpace,
      rotate: Math.PI,
    },
  },
  {
    id: 'stylizedSunsetEquiRect',
    base: {
      type: 'EQUIRECTANGULAR',
      file: `${TEXTURES_PATH}/skyboxes/sunset_stylized/sky_41_4k.png`,
      textureId: 'equiRectSunsetStylizedId',
      colorSpace: THREE.SRGBColorSpace,
      rotate: Math.PI,
    },
  },
  {
    id: 'partly-cloudy',
    base: {
      type: 'EQUIRECTANGULAR',
      file: `${TEXTURES_PATH}/kloofendal_48d_partly_cloudy_puresky_4k.hdr`,
      textureId: 'equiRectId',
      colorSpace: THREE.LinearSRGBColorSpace,
      rotate: Math.PI,
    },
  },
];

/** The metal rust maps by texture id, loaded together (the box's and the ball's materials). */
const METAL_RUST_MAPS = {
  box1Texture: `${TEXTURES_PATH}/Poliigon_MetalRust_7642_BaseColor.jpg`,
  metalRustAo: `${TEXTURES_PATH}/Poliigon_MetalRust_7642_AmbientOcclusion.jpg`,
  metalRustMetallic: `${TEXTURES_PATH}/Poliigon_MetalRust_7642_Metallic.jpg`,
};

/** The load's steps for the scene loader: each sky box, each map and the imported model. */
const LOAD_STEP_COUNT = 1 + OTHER_SKY_BOXES.length + Object.keys(METAL_RUST_MAPS).length + 1;

const GROUND_SIZE = 10;
const GROUND_HEIGHT = 0.2;
const GROUND_POSITION = { x: 0, y: -2, z: 0 };

/** The meshes that cast and receive shadows (the sun's shadow frustum covers the ground). */
const SHADOWS = { castShadow: true, receiveShadow: true };

/**
 * The basic physics demo: a FIXED ground, a bouncing box, a falling ball and cylinder, a GLB
 * with a TRIMESH collider, a sensor collider without a mesh, a group, and a rotating wireframe
 * sphere. Its camera and lights come from its JSON; four sky boxes, one shown.
 */
export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  let loadedCount = 0;
  const countLoadStep = () =>
    updateLoaderFn({ loadedCount: ++loadedCount, totalCount: LOAD_STEP_COUNT });

  await createSkyBoxesAsync(countLoadStep);
  await loadMetalRustMapsAsync(countLoadStep);

  createEnvCheckSpheres();
  await createGroundAsync();
  await createFallingObjectsAsync();
  createGroupExample();
  await spawnImportedBoxAsync();
  countLoadStep();

  const sphere = createSpinningSphere();
  await createSensorAsync(sphere.material);
};

/**
 * The sky boxes: `isDefault: false` registers the others without showing them, so the scene
 * starts with the desert dunes whatever the order.
 */
const createSkyBoxesAsync = async (countLoadStep: () => void) => {
  await createSkyBox(DESERT_DUNES_SKY_BOX);
  countLoadStep();
  for (const skyBox of OTHER_SKY_BOXES) {
    await createSkyBox({ ...skyBox, isDefault: false });
    countLoadStep();
  }
};

/** A batch load: the maps load in parallel, each counted on the scene loader as it lands. */
const loadMetalRustMapsAsync = (countLoadStep: () => void) =>
  Promise.all(
    Object.entries(METAL_RUST_MAPS).map(async ([id, fileName]) => {
      const texture = await loadTextureAsync({ id, fileName });
      countLoadStep();
      return texture;
    })
  );

/**
 * Smooth to rough metal spheres in front of the ground: the sky box's environment in their
 * reflections (the Lambert and Phong materials of the rest don't sample it).
 */
const createEnvCheckSpheres = () => {
  [0, 0.25, 0.5, 1].forEach((roughness, i) => {
    createMeshEntity(
      {
        geo: { type: 'SPHERE', params: { radius: 0.4, widthSegments: 32, heightSegments: 32 } },
        mat: createMaterial({
          id: `envCheckSphere${i}Material`,
          type: 'STANDARD',
          params: { color: 0xffffff, metalness: 1, roughness },
        }),
        position: { x: -3 + i, y: -1.4, z: 4 },
      },
      { appId: `envCheckSphere${i}` }
    );
  });
};

/** A FIXED ground box, its collider's half extents given (a box isn't read from the mesh). */
const createGroundAsync = async () => {
  const groundEntityId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'ground',
        type: 'BOX',
        params: { width: GROUND_SIZE, height: GROUND_HEIGHT, depth: GROUND_SIZE },
      }),
      mat: createMaterial({ id: 'ground', type: 'LAMBERT', params: { color: 0x556334 } }),
      position: GROUND_POSITION,
      ...SHADOWS,
    },
    { appId: 'groundMesh' }
  );
  await createPhysicsEntity(
    {
      type: 'BOX',
      hx: GROUND_SIZE / 2,
      hy: GROUND_HEIGHT / 2,
      hz: GROUND_SIZE / 2,
      friction: 0,
    },
    { rigidType: 'FIXED', translation: GROUND_POSITION },
    groundEntityId
  );
};

/** A spinning box that bounces, a metal ball and a tumbling cylinder, all DYNAMIC. */
const createFallingObjectsAsync = async () => {
  const boxEntityId = createMeshEntity(
    {
      geo: createGeometry({ id: 'box1', type: 'BOX' }),
      mat: createMaterial({ id: 'box1Material', type: 'PHONG', params: { map: 'box1Texture' } }),
      position: { x: 2, y: 0, z: 0 },
      ...SHADOWS,
    },
    { appId: 'boxMesh1' }
  );
  await createPhysicsEntity(
    { type: 'BOX', hx: 0.5, hy: 0.5, hz: 0.5, restitution: 0.5, friction: 0 },
    { rigidType: 'DYNAMIC', translation: { x: 2, y: 0, z: 0 }, angvel: { x: 1, y: -2, z: 20 } },
    boxEntityId
  );

  // The three maps of the batch load: the metallic map picks the rusty parts out of the metal
  const ballEntityId = createMeshEntity(
    {
      geo: { type: 'SPHERE', params: { radius: 1, widthSegments: 32, heightSegments: 32 } },
      mat: createMaterial({
        id: 'metalRustMaterial',
        type: 'STANDARD',
        params: {
          map: 'box1Texture',
          aoMap: 'metalRustAo',
          metalnessMap: 'metalRustMetallic',
          metalness: 1,
          roughness: 0.6,
        },
      }),
      ...SHADOWS,
    },
    { appId: 'physicsBall01' }
  );
  // The radius given: a collider isn't inferred from the mesh's sphere params
  await createPhysicsEntity(
    { type: 'BALL', radius: 1 },
    { rigidType: 'DYNAMIC', translation: { x: 2, y: 3, z: -2 } },
    ballEntityId
  );

  const cylinderEntityId = createMeshEntity(
    {
      geo: {
        type: 'CYLINDER',
        params: {
          radiusTop: 0.5,
          radiusBottom: 0.5,
          height: 0.25,
          heightSegments: 2,
          radialSegments: 32,
        },
      },
      mat: createMaterial({
        id: 'cylinder01Material',
        type: 'PHONG',
        params: { map: 'box1Texture' },
      }),
      ...SHADOWS,
    },
    { appId: 'physicsCyl01' }
  );
  // Given too: the half height is half the mesh's height, the radius its bottom radius
  await createPhysicsEntity(
    { type: 'CYLINDER', halfHeight: 0.125, radius: 0.5 },
    { rigidType: 'DYNAMIC', translation: { x: -2, y: 3, z: -2 }, angvel: { x: 23, y: 1, z: 5 } },
    cylinderEntityId
  );
};

/** A group entity holding two small boxes, made without adding them to the scene first. */
const createGroupExample = () => {
  const groupEntityId = createGroupEntity({ appId: 'myGroup', position: { x: 0, y: 1.4, z: 0 } });
  const groupBoxes = [
    { appId: 'groupBox1', color: '#f0cc00', x: -0.2 },
    { appId: 'groupBox2', color: '#ff00c0', x: 0.2 },
  ].map(({ appId, color, x }) => {
    createMeshEntity(
      {
        geo: createGeometry<THREE.BoxGeometry>({
          type: 'BOX',
          params: { width: 0.2, height: 0.2, depth: 0.2 },
        }),
        mat: createMaterial({ type: 'BASIC', params: { color } }),
        position: { x, y: 0, z: 0 },
      },
      { appId, doNotAddToScene: true }
    );
    return existsOrThrow(getMeshByAppId(appId), `The group box "${appId}" has no mesh.`);
  });
  addToGroupEntity(groupEntityId, groupBoxes);
};

/**
 * `box01.glb` with a TRIMESH collider from its own geometry and continuous collision detection.
 * The collider values are the Physics API's defaults this box has always had (the importer's
 * custom prop defaults are 0.2).
 */
const spawnImportedBoxAsync = async () => {
  const importedBox = existsOrThrow(
    await importAssetAsync({
      fileName: '/debugger/assets/testModels/box01.glb',
      throwOnError: true,
    }),
    'Could not import box01.glb.'
  );
  const { physicsEntityIds } = await spawnImportedAsset(importedBox, {
    transform: { position: { x: 3, y: 3, z: 2 } },
    material: createMaterial({
      id: 'importedBox01Material',
      type: 'PHONG',
      params: { map: 'box1Texture' },
    }),
    ...SHADOWS,
    physicsParams: {
      isPhysObj: true,
      keepMesh: true,
      rigidBody: { rigidType: 'DYNAMIC', angvel: { x: 3, y: 1, z: 5 }, ccdEnabled: true },
      collider: { type: 'TRIMESH', density: 1, friction: 0.5, restitution: 0 },
    },
    entityOpts: { appId: 'importedMesh1' },
  });
  if (!physicsEntityIds.length) throw new Error('Could not spawn the imported box01.');
};

/**
 * A red wireframe sphere at the origin, without a body. It spins with the physics world's
 * simulated time (2 rad/s), not with counted frames: a load spends a varying number of frames
 * with physics held, and the scene runner's snapshot needs the same angle on every load.
 */
const createSpinningSphere = () => {
  createMeshEntity(
    {
      geo: createGeometry({ id: 'sphere1', type: 'SPHERE' }),
      mat: createMaterial({
        id: 'sphere1Material',
        type: 'LAMBERT',
        params: { color: 0xff0000, wireframe: true },
      }),
    },
    { appId: 'sphereMesh1' }
  );
  const sphere = existsOrThrow(getMeshByAppId('sphereMesh1'), 'The spinning sphere has no mesh.');
  createSceneAppLooper(() => {
    const angle = -2 * getPhysicsSimClock() * getPhysicsState().timestepRatio;
    sphere.rotation.y = angle;
    sphere.rotation.z = angle;
  });
  return sphere;
};

/**
 * A sensor collider without a mesh (its own entity, so an explicit appId keeps its debug settings
 * across loads): a 20 × 20 slab just above the ground that turns the wireframe sphere green while
 * a body is in it. The bodies resting on the ground stay in it; one that falls off the edge
 * leaves it.
 */
const createSensorAsync = async (sphereMaterial: THREE.Material | THREE.Material[]) => {
  const color = sphereMaterial instanceof THREE.MeshLambertMaterial ? sphereMaterial.color : null;
  let bodiesInside = 0;
  await createPhysicsEntity(
    {
      type: 'BOX',
      hx: 10,
      hy: 0.2,
      hz: 10,
      isSensor: true,
      translation: { x: 0, y: -1.5, z: 0 },
      collisionEventFn: (_collider1, _collider2, started) => {
        bodiesInside += started ? 1 : -1;
        color?.setHex(bodiesInside > 0 ? 0x00ff00 : 0xff0000);
      },
    },
    undefined,
    undefined,
    { appId: 'sensorTest' }
  );
};
