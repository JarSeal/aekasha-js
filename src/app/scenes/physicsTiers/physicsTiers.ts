import * as THREE from 'three/webgpu';

import {
  ECSSystemStage,
  createCameraEntity,
  getActiveCameraId,
  setMainCamera,
  getECSWorld,
  getEntityIdByAppId,
  getMeshByAppId,
  ComponentType,
  createActionMap,
  createGeometry,
  createMaterial,
  decMaterialRef,
  incMaterialRef,
  createMeshEntity,
  setMeshMaterial,
  registerOnSceneEnter,
  registerOnSceneExit,
  getLoaderStatusUpdater,
  existsOrThrow,
  lwarn,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { SunShadowFitComponentType, FollowToolComponentType } from 'aekasha/toolkit/ecs';
import { createLines, polylineToSegments } from 'aekasha/lines';
import { createPhysicsEntity, setPhysicsTierPolicy } from 'aekasha/physics';
import type { PhysicsTier, PhysicsTierRing, RigidBodyAPI } from 'aekasha/physics';

const PHYSICS_TIERS_SCENE_ID = 'physicsTiers';

const GRID = 7;
const PILE_SPACING = 70;
/** Pile layers, bottom first: a 3 × 3, a 2 × 2 and one crate on top (14 crates). */
const PILE_LAYERS = [3, 2, 1];
const CRATE_HALF = 1.2;
const GROUND_SIZE = 600;
const PLOUGH_RADIUS = 4;
const PLOUGH_SPEED = 20;

const RINGS: PhysicsTierRing[] = [
  { tier: 'FULL', within: 40 },
  { tier: 'STATIC', within: 90 },
  { tier: 'DISABLED', within: 160 },
  { tier: 'REMOVED' },
];

const TIER_COLORS: Record<PhysicsTier, number> = {
  FULL: 0xd9822b,
  STATIC: 0x3d7bd9,
  DISABLED: 0x7a7a7a,
  REMOVED: 0xbfc8d6,
};

const STEP_SYSTEM_ID = 'physicsTiersPloughSystem';
const TINT_SYSTEM_ID = 'physicsTiersTintSystem';

/** The crates' mesh entities and meshes, index for index. */
interface Crates {
  entityIds: number[];
  meshes: THREE.Mesh[];
}

/** The plough's path: along each pile row, alternating direction, then back to the start. */
const createPloughPath = () => {
  const half = ((GRID - 1) / 2) * PILE_SPACING;
  const reach = half + 25;
  const points: THREE.Vector3[] = [];
  for (let row = 0; row < GRID; row++) {
    const z = -half + row * PILE_SPACING;
    const fromX = row % 2 ? reach : -reach;
    points.push(
      new THREE.Vector3(fromX, PLOUGH_RADIUS, z),
      new THREE.Vector3(-fromX, PLOUGH_RADIUS, z)
    );
  }
  points.push(points[0].clone());
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  /** The point `distance` along the (looping) path, written into `out`. */
  const pointAt = (distance: number, out: THREE.Vector3) => {
    let d = distance % total;
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i]) return out.lerpVectors(points[i], points[i + 1], d / lengths[i]);
      d -= lengths[i];
    }
    return out.copy(points[0]);
  };
  return { start: points[0], pointAt };
};

type PloughPath = ReturnType<typeof createPloughPath>;

/** Flat `xyz` segments of a circle on the XZ plane. */
const circleSegments = (radius: number, y: number) => {
  const points: THREE.Vector3[] = [];
  const count = Math.max(32, Math.round(radius * 1.5));
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return polylineToSegments(points, true);
};

const TIERS: PhysicsTier[] = ['FULL', 'STATIC', 'DISABLED', 'REMOVED'];
const getTierMaterialId = (tier: PhysicsTier) => `physicsTiersCrate_${tier}`;

/** A tier's crate material (the REMOVED one a ghost). */
const createTierMaterial = (tier: PhysicsTier) =>
  createMaterial({
    id: getTierMaterialId(tier),
    type: 'STANDARD',
    params: {
      color: TIER_COLORS[tier],
      roughness: 0.7,
      ...(tier === 'REMOVED' ? { transparent: true, opacity: 0.25, depthWrite: false } : {}),
    },
  });

/** Tints each crate by its tier: one shared material per tier, swapped only on a change. The
 * scene holds a ref on each from `retain` to `release`: a material no crate shows would be
 * disposed. */
const createTint = (crates: Crates) => {
  const materials: Record<PhysicsTier, THREE.Material> = {
    FULL: createTierMaterial('FULL'),
    STATIC: createTierMaterial('STATIC'),
    DISABLED: createTierMaterial('DISABLED'),
    REMOVED: createTierMaterial('REMOVED'),
  };
  const materialIds = TIERS.map(getTierMaterialId);
  const retain = () => {
    for (const id of materialIds) incMaterialRef(id);
  };
  const release = () => {
    for (const id of materialIds) decMaterialRef(id);
  };
  /** Each crate's shown tier, index for index with `crates` (none before its first frame). */
  const shown: (PhysicsTier | undefined)[] = [];
  const system = (world: ECSWorld) => {
    const tiers = world.getStorage(ComponentType.PHYSICS_SIM_TIER);
    const { entityIds, meshes } = crates;
    for (let i = 0; i < entityIds.length; i++) {
      const tier = tiers.get(entityIds[i])?.tier ?? 'FULL';
      if (shown[i] === tier) continue;
      shown[i] = tier;
      setMeshMaterial(meshes[i], materials[tier]);
      // A ghost casts no shadow
      meshes[i].castShadow = tier !== 'REMOVED';
    }
  };
  return { material: materials.FULL, system, retain, release };
};

/** The ground: a FIXED box, its top at y = 0. */
const createGroundAsync = async () => {
  const groundId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'physicsTiersGround',
        type: 'BOX',
        params: { width: GROUND_SIZE, height: 1, depth: GROUND_SIZE },
      }),
      mat: createMaterial({
        id: 'physicsTiersGround',
        type: 'STANDARD',
        params: { color: 0x3c4a3a, roughness: 0.95 },
      }),
      position: { x: 0, y: -0.5, z: 0 },
      receiveShadow: true,
    },
    { appId: 'physicsTiersGround', debugData: { name: 'Physics tiers ground' } }
  );
  await createPhysicsEntity({ type: 'BOX' }, { rigidType: 'FIXED' }, groundId);
};

/** The GRID × GRID crate piles, every crate in the tier policy; a pile's bodies created
 * together, the piles one after another (each a loader step). */
const createCratePilesAsync = async (
  crates: Crates,
  material: THREE.Material,
  onPileCreated: (pileIndex: number) => void
) => {
  const crateGeo = createGeometry({
    id: 'physicsTiersCrate',
    type: 'BOX',
    params: { width: CRATE_HALF * 2, height: CRATE_HALF * 2, depth: CRATE_HALF * 2 },
  });
  const half = ((GRID - 1) / 2) * PILE_SPACING;
  const size = CRATE_HALF * 2;
  for (let pz = 0; pz < GRID; pz++) {
    for (let px = 0; px < GRID; px++) {
      const pileX = -half + px * PILE_SPACING;
      const pileZ = -half + pz * PILE_SPACING;
      const creates: Promise<number>[] = [];
      PILE_LAYERS.forEach((perSide, layer) => {
        const offset = ((perSide - 1) / 2) * size;
        for (let iz = 0; iz < perSide; iz++) {
          for (let ix = 0; ix < perSide; ix++) {
            const position = {
              x: pileX - offset + ix * size,
              y: CRATE_HALF + layer * size,
              z: pileZ - offset + iz * size,
            };
            const appId = `physicsTiersCrate_${px}_${pz}_${layer}_${ix}_${iz}`;
            const meshId = createMeshEntity(
              { geo: crateGeo, mat: material, position, castShadow: true, receiveShadow: true },
              { appId }
            );
            crates.entityIds.push(meshId);
            crates.meshes.push(
              existsOrThrow(getMeshByAppId(appId), `Could not find the crate "${appId}".`)
            );
            creates.push(
              createPhysicsEntity(
                { type: 'BOX', hx: CRATE_HALF, hy: CRATE_HALF, hz: CRATE_HALF, friction: 0.8 },
                { rigidType: 'DYNAMIC', translation: position },
                meshId,
                { tierPolicy: true }
              )
            );
          }
        }
      });
      await Promise.all(creates);
      onPileCreated(pz * GRID + px);
    }
  }
};

/** The plough: a kinematic ball at the path's start, with the tier rings drawn around it. */
const createPloughAsync = async (path: PloughPath) => {
  const world = getECSWorld();
  const ploughId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'physicsTiersPlough',
        type: 'SPHERE',
        params: { radius: PLOUGH_RADIUS, widthSegments: 32, heightSegments: 16 },
      }),
      mat: createMaterial({
        id: 'physicsTiersPlough',
        type: 'STANDARD',
        params: { color: 0xffe08a, emissive: 0xffb02e, emissiveIntensity: 0.6 },
      }),
      position: path.start,
      castShadow: true,
    },
    { appId: 'physicsTiersPlough', debugData: { name: 'Physics tiers plough' } }
  );
  await createPhysicsEntity(
    { type: 'BALL', radius: PLOUGH_RADIUS },
    { rigidType: 'POS_BASED', translation: path.start },
    ploughId
  );
  const ploughBody = existsOrThrow(
    world.getRigidBody(ploughId),
    'Could not find the plough body in the physicsTiers scene.'
  );
  RINGS.forEach(({ tier, within }) => {
    if (within === undefined) return;
    createLines({
      id: `physicsTiersRing_${tier}`,
      segments: circleSegments(within, 0.15 - PLOUGH_RADIUS),
      color: TIER_COLORS[tier],
      width: 2,
      attach: { to: 'ENTITY', entityId: ploughId, world },
    });
  });
  return { ploughId, ploughBody };
};

/**
 * The plough's step system and the tint system, and the exit that removes them. The plough moves
 * on fixed steps (scene time, not frame time), so it runs the same every visit. Called last in the
 * load: what the exit undoes is taken after everything that can throw (a load that fails never
 * exits).
 */
const startPloughAndTint = (
  path: PloughPath,
  ploughBody: RigidBodyAPI,
  tint: ReturnType<typeof createTint>
) => {
  const world = getECSWorld();
  let travelled = 0;
  const target = new THREE.Vector3();
  tint.retain();
  registerOnSceneExit(PHYSICS_TIERS_SCENE_ID, () => {
    world.removeSystem(STEP_SYSTEM_ID);
    world.removeSystem(TINT_SYSTEM_ID);
    tint.release();
  });
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, STEP_SYSTEM_ID, (_world, dt) => {
    travelled += PLOUGH_SPEED * dt;
    ploughBody.setNextKinematicTranslation(path.pointAt(travelled, target));
  });
  world.addSystem(ECSSystemStage.APP_RENDER_SYNC, TINT_SYSTEM_ID, tint.system);
};

/** A chase camera following the plough, and C to switch between it and the overview. */
const createChaseCamera = (path: PloughPath, ploughId: number) => {
  const world = getECSWorld();
  const chaseOffset = new THREE.Vector3(0, 55, 80);
  const chaseId = createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 55,
      near: 0.5,
      far: 1200,
      active: false,
      position: {
        x: path.start.x + chaseOffset.x,
        y: path.start.y + chaseOffset.y,
        z: path.start.z + chaseOffset.z,
      },
      lookAtPoint: { x: path.start.x, y: path.start.y, z: path.start.z },
    },
    {
      appId: 'physicsTiersChase',
      debugData: { name: 'Physics tiers chase camera', description: 'Follows the plough.' },
    },
    world
  );
  world.addComponent(chaseId, FollowToolComponentType.FOLLOW, {
    leaderId: ploughId,
    offset: chaseOffset,
    targetOffset: new THREE.Vector3(),
    speed: 4,
  });
  // A scene map (replaced on the next visit, by its id); exact modifiers, so Ctrl+C isn't a switch
  const actions = createActionMap({
    id: PHYSICS_TIERS_SCENE_ID,
    sceneId: PHYSICS_TIERS_SCENE_ID,
    ignoreModifiers: false,
    actions: { toggleCamera: { type: 'BUTTON', name: 'Switch the overview and chase cameras' } },
    bindings: { toggleCamera: [{ device: 'KEYBOARD', keys: ['c'] }] },
  });
  actions.onPressed('toggleCamera', () => {
    const overviewId = getEntityIdByAppId('physicsTiersOverview', world);
    if (overviewId === undefined) return;
    setMainCamera(world, getActiveCameraId() === overviewId ? chaseId : overviewId);
  });
};

/**
 * The physics simulation tiers demo: crate piles whose tiers follow a distance policy around a
 * kinematic plough ball. The plough mows a serpentine through the piles, so the crates it scatters
 * freeze (STATIC), drop out of the simulation (DISABLED) and out of the physics world (REMOVED) as
 * it moves on, and come back where they were left when it returns. Each crate is tinted by its
 * tier. The policy runs on fixed steps (its default STEPS cadence) and the plough moves on them,
 * so a visit plays out the same way every time, in both worker targets.
 */
export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  const world = getECSWorld();
  const totalCount = GRID * GRID + 1;
  updateLoaderFn({ loadedCount: 0, totalCount });

  await createGroundAsync();

  const crates: Crates = { entityIds: [], meshes: [] };
  const tint = createTint(crates);
  await createCratePilesAsync(crates, tint.material, (pileIndex) =>
    updateLoaderFn({ loadedCount: pileIndex + 1, totalCount })
  );

  const path = createPloughPath();
  const { ploughId, ploughBody } = await createPloughAsync(path);
  setPhysicsTierPolicy(
    {
      focus: () => ploughId,
      rings: RINGS,
      interval: 10,
      cadence: 'STEPS', // Optional (default is 'STEPS')
      sceneId: PHYSICS_TIERS_SCENE_ID,
    },
    world
  );
  startPloughAndTint(path, ploughBody, tint);
  createChaseCamera(path, ploughId);

  // The JSON lights are created after this function runs: the sun gets its shadow fit on enter
  registerOnSceneEnter(PHYSICS_TIERS_SCENE_ID, () => {
    const sunId = getEntityIdByAppId('physicsTiersSun', world);
    if (sunId === undefined) {
      lwarn("Physics tiers scene: could not find the sun light 'physicsTiersSun'.");
      return;
    }
    world.addComponent(sunId, SunShadowFitComponentType.SUN_SHADOW_FIT, {
      maxDistance: 160,
      casterExtension: 10,
    });
  });
  updateLoaderFn({ loadedCount: totalCount, totalCount });
};
