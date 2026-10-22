import * as THREE from 'three/webgpu';
import {
  createGeometry,
  getMaterial,
  getMaterialVariant,
  createMeshEntity,
  getMeshByAppId,
  getLoaderStatusUpdater,
  importAssetAsync,
  spawnImportedAsset,
  ComponentType,
  getQuatFromAngle,
  getECSWorld,
  getEntityIdByAppId,
  registerOnSceneExit,
  getCameraByAppId,
  getLightByAppId,
  getLightTargetId,
  ECSSystemStage,
  existsOrThrow,
} from 'aekasha';
import type {
  ImportedAssetManifest,
  SpawnImportedParams,
  Transform,
  ECSWorld,
  Vector3Like,
} from 'aekasha';
import { createSkyBox } from 'aekasha/skybox';
import { createDynamicCharacter } from 'aekasha/character';
import {
  createMovingPlatform,
  createFollowObjectCameraRig,
  deleteFollowObjectCameraRig,
} from 'aekasha/toolkit/ecs';
import type { MovingPlatformPoint } from 'aekasha/toolkit/ecs';
import { createPhysicsEntity } from 'aekasha/physics';
import { createCharacterVisualAsync } from '../../shared/characterVisual';
import { createGymStairsAndWallAsync } from './gymStairsAndWall';
import { initPhysicsStressTest } from './PhysicsStressTest';

/**
 * The third-person gym: an obstacle course for the dynamic character controller. Built in this
 * order (the order the bodies are created in, which the scene runner's hashes depend on): the sky
 * boxes, the ground, the built stairs and wall, a spinning box, the characters, the props, six
 * moving platforms, then the imported course models (stairs of every collider kind, terrains,
 * obstacles). The camera and the lights come from thirdPersonGymScene.scene.json.
 */
export const SCENE_THIRD_PERSON_GYM_META = {
  id: 'thirdPersonGymScene',
};

/** Sky (environment map) light strength: at full strength the blue sky tints every face turned
 * away from the sun blue on the PBR (triplanar) materials. */
const GYM_ENVIRONMENT_INTENSITY = 0.3;

const TEST_MODELS = '/debugger/assets/testModels';

/** Off to probe the props alone in the worker targets (`?physicsProbe=N`): the characters are
 * deterministic on MAIN_THREAD only (p428), and the dummy walks into the test props. */
const ARE_CHARACTERS_ENABLED = true;

/** The ground: a 200 m box whose top (y = -1.9) everything else in the gym stands on. */
const GROUND = { size: 200, height: 0.2, position: { x: 0, y: -2, z: 0 } };

/** The gym's materials: the toolkit's triplanar grid and checkerboard (listed in the scene JSON)
 * and their variants. */
interface GymMaterials {
  /** Static meshes. */
  grid: THREE.Material;
  /** Flat slopes (ramps, stair flights): one projection only, or two blended ones show doubled
   * lines there (the grid's `dominantAxis` define). */
  gridFlatSlopes: THREE.Material;
  /** Dynamic bodies. */
  checkerboard: THREE.Material;
  /** The moving platforms: fitted amber cells, so the moving pieces stand out. */
  platform: THREE.Material;
}

/** A model imported from TEST_MODELS and spawned with its physics (the GLB's custom props, or
 * `physicsParams`). */
interface GymModel {
  /** The GLB's name in TEST_MODELS. */
  file: string;
  /** The spawned entities' app id prefix (the GLB's import id without one). The
   * `customPropTest*` ids are the gym's first ones, kept: the saved debug state keys them. */
  appId?: string;
  pos: Vector3Like;
  /** `FIRST_MESH`: `pos` is where the first visible node goes (rootPlacing); `ROOT`: the glTF
   * root's position. */
  placeBy: 'FIRST_MESH' | 'ROOT';
  material: keyof GymMaterials;
  physicsParams?: SpawnImportedParams['physicsParams'];
}

/** The props, spawned before the platforms: a cube, Suzanne with a TRIMESH and with a CONVEXHULL
 * collider, and the slide angles test (ramps from gentle to too steep to climb). */
const PROP_MODELS: GymModel[] = [
  {
    file: 'customPropTestCube',
    appId: 'customPropTest',
    pos: { x: 2, y: 2, z: 2 },
    placeBy: 'FIRST_MESH',
    material: 'checkerboard',
  },
  {
    file: 'customPropTestMonkey',
    appId: 'customPropTest2',
    pos: { x: 4, y: 2, z: 3 },
    placeBy: 'FIRST_MESH',
    material: 'checkerboard',
    physicsParams: {
      isPhysObj: true,
      keepMesh: true,
      rigidBody: { rigidType: 'DYNAMIC' },
      collider: { type: 'TRIMESH', density: 2 },
    },
  },
  {
    file: 'customPropTestMonkey',
    appId: 'customPropTest2_2',
    pos: { x: 4, y: 6, z: 3 },
    placeBy: 'FIRST_MESH',
    material: 'checkerboard',
    physicsParams: {
      isPhysObj: true,
      keepMesh: true,
      rigidBody: { rigidType: 'DYNAMIC' },
      collider: { type: 'CONVEXHULL', density: 2 },
    },
  },
  {
    file: 'characterSlideAngles',
    pos: { x: 30, y: -1.9, z: -30 },
    placeBy: 'ROOT',
    material: 'gridFlatSlopes',
    physicsParams: { collider: { type: 'TRIMESH', friction: 1 } },
  },
];

/** The course, spawned after the platforms: a stack of boxes, then the stairs (straight ones in
 * three step sizes, each with a TRIMESH and a COMPOUND collider, cornered and spiral ones), two
 * terrains and the obstacles. */
const COURSE_MODELS: GymModel[] = [
  {
    file: 'test_multi_box',
    appId: 'customPropTest3',
    pos: { x: 2, y: 2, z: 2 },
    placeBy: 'FIRST_MESH',
    material: 'checkerboard',
  },
  ...(
    [
      ['stairsStraightTrimesh', 'customPropTest4', 37],
      ['stairsStraightCompound', 'customPropTest5', 45],
      ['stairsStraight2Trimesh', 'customPropTest6', 53],
      ['stairsStraight2Compound', 'customPropTest7', 61],
      ['stairsStraight3Trimesh', 'customPropTest8', 69],
      ['stairsStraight3Compound', 'customPropTest9', 77],
    ] as const
  ).map(
    ([file, appId, x]): GymModel => ({
      file,
      appId,
      pos: { x, y: -0.4, z: 5 },
      placeBy: 'FIRST_MESH',
      material: 'grid',
    })
  ),
  {
    file: 'stairsCorneredWithThickRailingsCompound',
    appId: 'customPropTest10',
    pos: { x: 45, y: -0.4, z: 35 },
    placeBy: 'FIRST_MESH',
    material: 'gridFlatSlopes',
  },
  {
    file: 'stairsCorneredWithThickRailingsTrimesh',
    appId: 'customPropTest11',
    pos: { x: 60, y: -0.4, z: 35 },
    placeBy: 'FIRST_MESH',
    material: 'gridFlatSlopes',
  },
  {
    file: 'stairsSpiralTrimesh',
    appId: 'customPropTest12',
    pos: { x: 20, y: 1.8, z: 33 },
    placeBy: 'FIRST_MESH',
    material: 'grid',
  },
  {
    file: 'terrainSpiked',
    appId: 'customPropTest13',
    pos: { x: -25, y: -1.8, z: 126.336 },
    placeBy: 'ROOT',
    material: 'grid',
  },
  {
    file: 'terrainSmooth',
    appId: 'customPropTest14',
    pos: { x: 52.635, y: -1.8, z: 150.833 },
    placeBy: 'ROOT',
    material: 'grid',
  },
  {
    file: 'obstacles',
    appId: 'customPropTest15',
    pos: { x: -30, y: -1, z: 30 },
    placeBy: 'ROOT',
    material: 'grid',
  },
];

/** A moving platform: a 0.2 m thick box or disc with a matching POS_BASED collider. */
interface GymPlatform {
  id: string;
  meshAppId: string;
  geoId: string;
  shape: { type: 'BOX'; width: number; depth: number } | { type: 'CYLINDER'; radius: number };
  /** The path; `angle` is the yaw in degrees (none: the platform doesn't turn). */
  points: { pos: Vector3Like; dur: number; angle?: number }[];
}

const PLATFORM_THICKNESS = 0.2;

/** The ferris wheel's path: a diamond in the x-y plane at z = 15, 16 points 2.5 m apart sideways
 * and 1 m apart in height, the platform turning 45° per point (twice around per lap). Its lowest
 * point rests on the ground (y = -1.9) instead of the diamond's corner (-2). */
const getFerrisWheelPoints = (): GymPlatform['points'] =>
  Array.from({ length: 16 }, (_, i) => {
    const side = i <= 4 ? i : i <= 12 ? 8 - i : i - 16;
    const up = i <= 8 ? i : 16 - i;
    return {
      pos: { x: 5 + 2.5 * side, y: i === 0 ? -1.9 : -2 + up, z: 15 },
      dur: 1500,
      angle: (i * 45) % 360,
    };
  });

/** The six moving platforms, created in this order. */
const PLATFORMS: GymPlatform[] = [
  {
    // Slides back and forth: 10 s out, 5 s back
    id: 'sideWaysPlatform',
    meshAppId: 'sideWaysPlatformMesh',
    geoId: 'movingPlatform1-geo',
    shape: { type: 'BOX', width: 2, depth: 4 },
    points: [
      { pos: { x: -15, y: -1, z: -7 }, dur: 10000 },
      { pos: { x: 5, y: -1, z: -7 }, dur: 5000 },
    ],
  },
  {
    // Waits at the bottom, rises 10 m, waits, stops halfway down on its way back
    id: 'elevatorPlatform',
    meshAppId: 'elevatorPlatformMesh',
    geoId: 'movingPlatform2-geo',
    shape: { type: 'BOX', width: 4, depth: 4 },
    points: [
      { pos: { x: -12, y: -1.8, z: -12 }, dur: 2000 },
      { pos: { x: -12, y: -1.8, z: -12 }, dur: 3000 },
      { pos: { x: -12, y: 8, z: -12 }, dur: 2000 },
      { pos: { x: -12, y: 8, z: -12 }, dur: 2000 },
      { pos: { x: -12, y: 2, z: -12 }, dur: 2000 },
    ],
  },
  {
    // A disc turning in place, a lap in 4 s
    id: 'carouselPlatform',
    meshAppId: 'carouselPlatformMesh1',
    geoId: 'movingPlatform3-geo',
    shape: { type: 'CYLINDER', radius: 4 },
    points: [0, 90, 180, 270].map((angle) => ({
      pos: { x: 14, y: -1.9, z: -4 },
      dur: 1000,
      angle,
    })),
  },
  {
    // A box turning the other way while it moves 8 m along z and back, a lap in 8 s
    id: 'carouselPlatform2',
    meshAppId: 'carouselPlatformMesh2',
    geoId: 'movingPlatform4-geo',
    shape: { type: 'BOX', width: 4, depth: 4 },
    points: [
      { pos: { x: 25, y: -1.9, z: -4 }, dur: 2000, angle: 0 },
      { pos: { x: 25, y: -1.9, z: 0 }, dur: 2000, angle: -90 },
      { pos: { x: 25, y: -1.9, z: 4 }, dur: 2000, angle: -180 },
      { pos: { x: 25, y: -1.9, z: 0 }, dur: 2000, angle: -270 },
    ],
  },
  {
    // A disc turning while it moves 8 m along x and back, a lap in 8 s
    id: 'carouselPlatform3',
    meshAppId: 'carouselPlatformMesh3',
    geoId: 'movingPlatform5-geo',
    shape: { type: 'CYLINDER', radius: 4 },
    points: [
      { pos: { x: 25, y: -1.9, z: 12 }, dur: 2000, angle: 0 },
      { pos: { x: 21, y: -1.9, z: 12 }, dur: 2000, angle: 90 },
      { pos: { x: 17, y: -1.9, z: 12 }, dur: 2000, angle: 180 },
      { pos: { x: 21, y: -1.9, z: 12 }, dur: 2000, angle: 270 },
    ],
  },
  {
    id: 'ferrisWheelPlatform',
    meshAppId: 'ferrisWheelPlatformMesh',
    geoId: 'movingPlatform6-geo',
    shape: { type: 'BOX', width: 2, depth: 4 },
    points: getFerrisWheelPoints(),
  },
];

/** Root transform that puts an import's first visible node (its first mesh, which is also its
 * physics anchor) at `pos`: these models were positioned by that node, not by their glTF root. */
const rootPlacing = (manifest: ImportedAssetManifest, pos: Vector3Like) => {
  const anchor = manifest.geometries.find(
    ({ customProps }) => !customProps.isPhysObj || customProps.keepMesh
  );
  const offset = anchor?.transform.position || { x: 0, y: 0, z: 0 };
  return { position: { x: pos.x - offset.x, y: pos.y - offset.y, z: pos.z - offset.z } };
};

const snapToStep = (value: number, step: number) => Math.round(value / step) * step;

/**
 * An ECS system moving a directional light (and its target) with an entity, so its shadow frustum
 * covers the area around it wherever it goes. The light's direction and distance stay as authored
 * (its position - target offset). The frustum moves in whole shadow map texels in light space, or
 * shadow edges would shimmer as it slides. The light is looked up lazily: a scene's JSON lights are
 * created after its scene function runs. `centerOffset` shifts the frustum center from the
 * followed entity (eg. toward where the camera sees more ground).
 */
const followWithSun = (
  sunAppId: string,
  followEntityId: number,
  centerOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
) => {
  const center = new THREE.Vector3();
  let sun: {
    id: number;
    targetId: number;
    transform: Transform;
    targetTransform: Transform;
    offset: THREE.Vector3;
    axisX: THREE.Vector3;
    axisY: THREE.Vector3;
    axisZ: THREE.Vector3;
    texelSize: number;
  } | null = null;

  const resolveSun = (world: ECSWorld) => {
    const light = getLightByAppId(sunAppId, world) as THREE.DirectionalLight | undefined;
    const id = getEntityIdByAppId(sunAppId, world);
    const targetId = id !== undefined ? getLightTargetId(id, world) : undefined;
    if (!light?.isDirectionalLight || id === undefined || targetId === undefined) return null;
    const transform = world.getComponent(id, ComponentType.TRANSFORM);
    const targetTransform = world.getComponent(targetId, ComponentType.TRANSFORM);
    if (!transform || !targetTransform) return null;

    const offset = transform.position.clone().sub(targetTransform.position);
    // Light-space axes (as the shadow camera's lookAt builds them)
    const axisZ = offset.clone().normalize();
    const axisX = new THREE.Vector3(0, 1, 0).cross(axisZ).normalize();
    const axisY = axisZ.clone().cross(axisX);
    const shadowCam = light.shadow.camera;
    const texelSize = (shadowCam.right - shadowCam.left) / light.shadow.mapSize.width;
    return { id, targetId, transform, targetTransform, offset, axisX, axisY, axisZ, texelSize };
  };

  return (world: ECSWorld) => {
    sun ??= resolveSun(world);
    const followed = world.getComponent(followEntityId, ComponentType.TRANSFORM);
    if (!sun || !followed) return;

    const { axisX, axisY, axisZ, texelSize } = sun;
    const p = center.copy(followed.position).add(centerOffset);
    sun.targetTransform.position
      .copy(axisX)
      .multiplyScalar(snapToStep(p.dot(axisX), texelSize))
      .addScaledVector(axisY, snapToStep(p.dot(axisY), texelSize))
      .addScaledVector(axisZ, p.dot(axisZ));
    sun.transform.position.copy(sun.targetTransform.position).add(sun.offset);
    sun.targetTransform.setDirty();
    world.commitTransform(sun.targetId, sun.targetTransform);
    sun.transform.setDirty();
    world.commitTransform(sun.id, sun.transform);
  };
};

/** Two equirectangular sky boxes, the sunset and the same sky without its clouds and sun, to
 * switch between in the Sky box debug tab. */
const createGymSkyBoxesAsync = async () => {
  await createSkyBox({
    id: 'stylizedSunsetEquiRect',
    base: {
      type: 'EQUIRECTANGULAR',
      file: '/debugger/assets/testTextures/skyboxes/sunset_stylized/sky_41_4k.png',
      textureId: 'equiRectSunsetStylizedId',
      colorSpace: THREE.SRGBColorSpace,
      rotate: Math.PI,
    },
    env: { environmentIntensity: GYM_ENVIRONMENT_INTENSITY },
  });

  await createSkyBox({
    id: 'emptyBlueSkyEquiRect',
    base: {
      type: 'EQUIRECTANGULAR',
      file: '/debugger/assets/testTextures/skyboxes/sunset_stylized/sky_empty_2k.png',
      textureId: 'equiRectEmptyId',
      colorSpace: THREE.SRGBColorSpace,
      rotate: Math.PI,
    },
    env: { environmentIntensity: GYM_ENVIRONMENT_INTENSITY },
  });
};

/** The gym's materials (see GymMaterials). */
const getGymMaterials = (): GymMaterials => ({
  grid: existsOrThrow(
    getMaterial('triplanarGrid'),
    'Could not find the triplanarGrid material for the gym scene.'
  ),
  gridFlatSlopes: getMaterialVariant('triplanarGrid', { staticDefines: { dominantAxis: true } }),
  checkerboard: existsOrThrow(
    getMaterial('triplanarCheckerboard'),
    'Could not find the triplanarCheckerboard material for the gym scene.'
  ),
  platform: getMaterialVariant('triplanarCheckerboard', {
    staticDefines: { fitToBounds: true },
    nodes: {
      colorNode: { checkerSize: 0.5, checkerColorA: '#a18862', checkerColorB: '#7b6b54' },
    },
  }),
});

/** The ground (a FIXED box), in a lighter grid than the other static meshes. */
const createGroundAsync = async (materials: GymMaterials) => {
  const groundEntityId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'largeGroundGeo',
        type: 'BOX',
        params: { width: GROUND.size, height: GROUND.height, depth: GROUND.size },
      }),
      mat: materials.grid,
      receiveShadow: true,
      position: GROUND.position,
      // A material variant, same shader
      matOverrides: {
        staticDefines: { minorLines: false },
        nodes: { colorNode: { backgroundColor: '#9c9c9c', lineColor: '#a5a5a5' } },
      },
    },
    { appId: 'largeGroundMesh' }
  );
  await createPhysicsEntity(
    { type: 'BOX', friction: 2 },
    { rigidType: 'FIXED', translation: GROUND.position },
    groundEntityId
  );
};

/** A frictionless, bouncy box dropped spinning next to the start. */
const createSpinningBoxAsync = async (materials: GymMaterials) => {
  const boxEntityId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'testBox1',
        type: 'BOX',
        params: { width: 1, height: 1, depth: 1 },
      }),
      mat: materials.checkerboard,
      castShadow: true,
      receiveShadow: true,
    },
    { appId: 'testBox1Mesh' }
  );
  await createPhysicsEntity(
    { type: 'BOX', restitution: 0.5, friction: 0 },
    {
      rigidType: 'DYNAMIC',
      translation: { x: 2, y: 0, z: 0 },
      angvel: { x: 1, y: -2, z: 20 },
    },
    boxEntityId
  );
};

/** The player character (a TANK brain on the keyboard and a gamepad, with its follow camera), a
 * second player character on the arrow keys (CAMERA_RELATIVE) and a dummy whose brain walks and
 * jumps around (GYM_DUMMY, GymDummyBrain.ts). They're deterministic on MAIN_THREAD only (async
 * shape casts in WORKER_THREAD mode, p428), so ARE_CHARACTERS_ENABLED can leave them out. The
 * player's id, `topDownChar`, is the gym's first one, kept: the saved debug state and the scene
 * runner's character paths key it. */
const createGymCharactersAsync = async () => {
  const characterConfig = {
    height: 1.6,
    radius: 0.5,
  };
  const createCharacterMesh = (index: number, beakColor: string) =>
    createCharacterVisualAsync({
      key: index,
      height: characterConfig.height,
      radius: characterConfig.radius,
      beakColor,
    });

  const characterMesh = await createCharacterMesh(1, '#333');
  const { character: playerCharacter } = await createDynamicCharacter({
    id: 'topDownChar',
    visual: characterMesh,
    config: characterConfig,
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
  getECSWorld().getRigidBody(playerCharacter.entityId)?.setTranslation({ x: 5, y: 3, z: -5 }, true);

  // Follow camera tracking the player-controlled character from above.
  createFollowObjectCameraRig({
    id: 'thirdPersonGymFollowCam',
    camera: existsOrThrow(
      getCameraByAppId('thirdPersonGymCamera'),
      'Could not find the gym camera "thirdPersonGymCamera".'
    ),
    targetMesh: characterMesh,
    // A world-space offset, aimed at the character's center
    offset: { x: 7, y: 20, z: 7 },
    smoothingTime: 0.2,
  });

  // Sun follows the player (the follow camera's focus), see followWithSun. The camera looks down
  // at the player from its (7, 20, 7) offset, so it sees more ground ahead (~20m) than behind
  // (~11m): center the shadow frustum ~4m ahead, along the camera's ground-forward (-x, -z).
  // The frustum size (thirdPersonGymSun.light.json) covers the ~±23m screen width at the player.
  const world = getECSWorld();
  world.removeSystem('gymSunFollow');
  const followSun = followWithSun('thirdPersonGymSun', characterMesh.userData.entityId as number, {
    x: -3,
    y: 0,
    z: -3,
  });
  world.addSystem(ECSSystemStage.APP_LOGIC, 'gymSunFollow', followSun);

  // A second player character on other keys (the arrow keys, Enter to jump, no run or crouch),
  // moving relative to the follow camera's view and turning toward where it goes
  const arrowsCharacterMesh = await createCharacterMesh(3, '#d08a18');
  const { character: arrowsCharacter } = await createDynamicCharacter({
    id: 'arrowKeysChar',
    visual: arrowsCharacterMesh,
    config: characterConfig,
    brain: {
      kind: 'CAMERA_RELATIVE',
      params: {
        bindings: {
          move: [
            {
              device: 'KEYBOARD',
              up: ['ArrowUp'],
              down: ['ArrowDown'],
              left: ['ArrowLeft'],
              right: ['ArrowRight'],
            },
          ],
          jump: [{ device: 'KEYBOARD', keys: ['Enter'] }],
        },
      },
    },
  });
  getECSWorld().getRigidBody(arrowsCharacter.entityId)?.setTranslation({ x: 2, y: 3, z: -8 }, true);

  // A character without input: its brain writes the intent every step, and goes with it
  const characterMesh2 = await createCharacterMesh(2, '#333');
  const { character: dummyCharacter } = await createDynamicCharacter({
    id: 'testDummyChar',
    visual: characterMesh2,
    config: characterConfig,
    brain: { kind: 'GYM_DUMMY' },
  });
  getECSWorld().getRigidBody(dummyCharacter.entityId)?.setTranslation({ x: -2, y: 5, z: -2 }, true);
};

/** Imports every model of the tables at once (each GLB once), keyed by file. */
const importGymModelsAsync = async () => {
  const files = [...new Set([...PROP_MODELS, ...COURSE_MODELS].map(({ file }) => file))];
  const manifests = await Promise.all(
    files.map((file) =>
      importAssetAsync({ fileName: `${TEST_MODELS}/${file}.glb`, throwOnError: true })
    )
  );
  return new Map(files.map((file, i) => [file, manifests[i]]));
};

/** Spawns the models in table order (the order their bodies are created in). */
const spawnGymModelsAsync = async (
  models: GymModel[],
  manifests: Map<string, ImportedAssetManifest | null>,
  materials: GymMaterials
) => {
  for (const { file, appId, pos, placeBy, material, physicsParams } of models) {
    const manifest = existsOrThrow(
      manifests.get(file),
      `Could not import the gym model "${file}".`
    );
    await spawnImportedAsset(manifest, {
      transform: placeBy === 'ROOT' ? { position: pos } : rootPlacing(manifest, pos),
      material: materials[material],
      castShadow: true,
      receiveShadow: true,
      physicsParams,
      entityOpts: appId ? { appId } : undefined,
    });
  }
};

/** A moving platform of the table: its mesh, then the platform (a POS_BASED body, no friction:
 * the dynamic character rides it by the platform's velocities, not by friction). */
const createPlatformAsync = async (platform: GymPlatform, materials: GymMaterials) => {
  const { id, meshAppId, geoId, shape, points } = platform;
  createMeshEntity(
    {
      geo: createGeometry(
        shape.type === 'BOX'
          ? {
              id: geoId,
              type: 'BOX',
              params: { width: shape.width, height: PLATFORM_THICKNESS, depth: shape.depth },
            }
          : {
              id: geoId,
              type: 'CYLINDER',
              params: {
                radiusTop: shape.radius,
                radiusBottom: shape.radius,
                height: PLATFORM_THICKNESS,
              },
            }
      ),
      mat: materials.platform,
      castShadow: true,
      receiveShadow: true,
    },
    { appId: meshAppId }
  );
  const pathPoints: MovingPlatformPoint[] = points.map(({ pos, dur, angle }) =>
    angle === undefined ? { pos, dur } : { pos, dur, rot: getQuatFromAngle(angle) }
  );
  await createMovingPlatform({
    id,
    shape: {
      mesh: existsOrThrow(getMeshByAppId(meshAppId), `Could not find the platform "${meshAppId}".`),
    },
    physicsParams: [
      { collider: { type: shape.type, friction: 0 }, rigidBody: { rigidType: 'POS_BASED' } },
    ],
    points: pathPoints,
  });
};

export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  const totalCount = 4;
  updateLoaderFn({ loadedCount: 0, totalCount });

  // The follow camera rig and the sun follow system would otherwise keep running against their
  // deleted entities and meshes (no-ops when ARE_CHARACTERS_ENABLED is off)
  registerOnSceneExit(SCENE_THIRD_PERSON_GYM_META.id, () => {
    getECSWorld().removeSystem('gymSunFollow');
    deleteFollowObjectCameraRig('thirdPersonGymFollowCam');
  });

  const [manifests] = await Promise.all([importGymModelsAsync(), createGymSkyBoxesAsync()]);
  updateLoaderFn({ loadedCount: 1, totalCount });

  const materials = getGymMaterials();
  await createGroundAsync(materials);
  await createGymStairsAndWallAsync({
    material: materials.grid,
    stairsPosition: { x: 5, y: -1.8, z: 0 },
    // A 10 m box sunk to stand 2 m out of the ground
    wallPosition: { x: -2, y: -5 + GROUND.height / 2, z: 0 },
  });
  await createSpinningBoxAsync(materials);
  if (ARE_CHARACTERS_ENABLED) await createGymCharactersAsync();
  updateLoaderFn({ loadedCount: 2, totalCount });

  await spawnGymModelsAsync(PROP_MODELS, manifests, materials);
  for (const platform of PLATFORMS) await createPlatformAsync(platform, materials);
  updateLoaderFn({ loadedCount: 3, totalCount });

  await spawnGymModelsAsync(COURSE_MODELS, manifests, materials);

  initPhysicsStressTest({ sceneId: SCENE_THIRD_PERSON_GYM_META.id });

  updateLoaderFn({ loadedCount: 4, totalCount });
};
