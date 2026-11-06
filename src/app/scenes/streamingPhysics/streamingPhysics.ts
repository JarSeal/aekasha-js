import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  IS_DEBUG_ENV,
  createGeometry,
  createMaterial,
  createMeshEntity,
  decMaterialRef,
  existsOrThrow,
  getECSWorld,
  getEntityIdByAppId,
  getMaterial,
  incMaterialRef,
  lwarn,
  registerOnSceneEnter,
  registerOnSceneExit,
  setMeshMaterial,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { FollowToolComponentType, SunShadowFitComponentType } from 'aekasha/toolkit/ecs';
import { createJoint, createPhysicsEntity, setPhysicsTierPolicy } from 'aekasha/physics';
import type { PhysicsTier, RigidBodyAPI } from 'aekasha/physics';
import {
  getStreamingCellKey,
  registerStreamingCellContent,
  setStreamingFocus,
  type StreamingCellContext,
} from 'aekasha/streaming';

// World streaming with physics (docs/plans/p353_macro-streaming-grid.md Phase 4): 12 × 12 cells of
// 64 m (the scene JSON's `streaming`), each code content of three units: a ground slab (a FIXED
// collider, deleted with its cell), a pile of crates in the tier policy near the cell's +x edge, and
// on the middle row a jointed chain lying across that edge. A kinematic plough mows along the
// middle row on fixed steps: it's the streaming focus and the policy's, and it pushes crates over
// the cells' edges, where the cell they land in takes them over when theirs unloads. A crate takes
// its cell's tier: the policy's in a RESIDENT cell (FULL near the plough, STATIC further), the
// scene's nearbyPhysicsTier (DISABLED) in a NEARBY one; the tint shows which. The plough moves on
// steps and the policy decides on them, but cells load on frames, so only a scene load (and a
// probe run, which holds the cells) plays out the same every time (p353 §6).

export const STREAMING_PHYSICS_SCENE_ID = 'streamingPhysics';
const CAMERA_APP_ID = 'streamingPhysicsCamera';
const SUN_APP_ID = 'streamingPhysicsSun';

const CELL_SIZE = 64;
/** Cells from -GRID_HALF to GRID_HALF - 1 on each axis */
const GRID_HALF = 6;
/** Pile layers, bottom first: a 3 × 3, a 2 × 2 and one crate on top (14 crates) */
const PILE_LAYERS = [3, 2, 1];
const CRATE_HALF = 1.2;
/** A pile's centre from its cell's -x edge: 14 m short of the +x edge, so the plough pushes crates
 * over it */
const PILE_X_IN_CELL = 50;
const CHAIN_LINKS = 4;
const LINK_HALF = 0.6;
/** The chain lies this far off the plough's line (+z), out of its way */
const CHAIN_Z_OFFSET = 10;
const PLOUGH_RADIUS = 4;
/** The plough's line, the middle of row 0, and how far each way it goes */
const PLOUGH_Z = CELL_SIZE / 2;
const PLOUGH_REACH = GRID_HALF * CELL_SIZE - 40;

const POLICY_FULL_WITHIN = 40;
const TIERS: PhysicsTier[] = ['FULL', 'STATIC', 'DISABLED'];
const TIER_COLORS: Record<string, number> = {
  FULL: 0xd9822b,
  STATIC: 0x3d7bd9,
  DISABLED: 0x7a7a7a,
};

const STEP_SYSTEM_ID = 'streamingPhysicsPloughSystem';
const TINT_SYSTEM_ID = 'streamingPhysicsTintSystem';

/** The plough's settings, which the scene's debug tab edits (a change moves it on other steps) */
export const streamingPhysicsPlough = {
  /** Metres per second, along the middle row and back */
  speed: 12,
  isMoving: true,
};

const getTierMaterialId = (tier: PhysicsTier) => `streamingPhysicsCrate_${tier}`;

/** The cells' shared geometries and materials, by id: a cache hit while they exist. Each unit
 * gets them in its own load (an asset goes on its last ref, streaming's CLAUDE.md). */
const getSharedAssets = () => {
  createGeometry({
    id: 'streamingPhysicsGround',
    type: 'BOX',
    params: { width: CELL_SIZE, height: 1, depth: CELL_SIZE },
  });
  createGeometry({
    id: 'streamingPhysicsCrate',
    type: 'BOX',
    params: { width: CRATE_HALF * 2, height: CRATE_HALF * 2, depth: CRATE_HALF * 2 },
  });
  createGeometry({
    id: 'streamingPhysicsLink',
    type: 'BOX',
    params: { width: LINK_HALF * 2, height: LINK_HALF * 2, depth: LINK_HALF * 2 },
  });
  createMaterial({
    id: 'streamingPhysicsGroundA',
    type: 'STANDARD',
    params: { color: 0x3c4a3a, roughness: 0.95 },
  });
  createMaterial({
    id: 'streamingPhysicsGroundB',
    type: 'STANDARD',
    params: { color: 0x46563f, roughness: 0.95 },
  });
  createMaterial({
    id: 'streamingPhysicsLink',
    type: 'STANDARD',
    params: { color: 0xc9c2b0, roughness: 0.5, metalness: 0.4 },
  });
  for (const tier of TIERS) {
    createMaterial({
      id: getTierMaterialId(tier),
      type: 'STANDARD',
      params: { color: TIER_COLORS[tier], roughness: 0.7 },
    });
  }
};

/** The crates on show, and the tier each is tinted by (index for index) */
const crates = { entityIds: [] as number[], shown: [] as (PhysicsTier | undefined)[] };

/** A cell's ground: a slab with a FIXED collider, its top at y = 0 */
const loadGround = async (ctx: StreamingCellContext) => {
  getSharedAssets();
  const groundId = createMeshEntity({
    geo: 'streamingPhysicsGround',
    mat: (ctx.cx + ctx.cz) & 1 ? 'streamingPhysicsGroundB' : 'streamingPhysicsGroundA',
    position: { x: (ctx.cx + 0.5) * CELL_SIZE, y: -0.5, z: (ctx.cz + 0.5) * CELL_SIZE },
    receiveShadow: true,
  });
  await createPhysicsEntity({
    colliders: { type: 'BOX' },
    body: { rigidType: 'FIXED' },
    target: groundId,
  });
  return [groundId];
};

// #region streaming-physics-pile (shown in the Hub: hub/pages/features/streaming/)
/** A cell's crate pile, every crate in the tier policy. The creates run before the first await,
 * so in the cell's creation scope: in a NEARBY cell they start in its tier, out of the policy. */
const loadPile = async (ctx: StreamingCellContext) => {
  getSharedAssets();
  const pileX = ctx.cx * CELL_SIZE + PILE_X_IN_CELL;
  const pileZ = (ctx.cz + 0.5) * CELL_SIZE;
  const size = CRATE_HALF * 2;
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
        const meshId = createMeshEntity({
          geo: 'streamingPhysicsCrate',
          mat: getTierMaterialId('FULL'),
          position,
          castShadow: true,
          receiveShadow: true,
        });
        creates.push(
          createPhysicsEntity(
            {
              colliders: {
                type: 'BOX',
                hx: CRATE_HALF,
                hy: CRATE_HALF,
                hz: CRATE_HALF,
                friction: 0.8,
              },
              body: { rigidType: 'DYNAMIC', translation: position },
              target: meshId,
            },
            { tierPolicy: true }
          )
        );
      }
    }
  });
  // Returned once their bodies exist: the cell then gives them its tier
  const ids = await Promise.all(creates);
  for (const id of ids) {
    crates.entityIds.push(id);
    crates.shown.push(undefined);
  }
  return ids;
};
// #endregion streaming-physics-pile

/** A chain of links joined end to end, lying across the cell's +x edge (half of it in the next
 * cell), out of the plough's way: a joint group that changes tier as one */
const loadChain = async (ctx: StreamingCellContext) => {
  getSharedAssets();
  const { world } = ctx;
  const edgeX = (ctx.cx + 1) * CELL_SIZE;
  const z = (ctx.cz + 0.5) * CELL_SIZE + CHAIN_Z_OFFSET;
  const step = LINK_HALF * 2 + 0.4;
  const creates: Promise<number>[] = [];
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const position = { x: edgeX + (i - (CHAIN_LINKS - 1) / 2) * step, y: LINK_HALF, z };
    const meshId = createMeshEntity({
      geo: 'streamingPhysicsLink',
      mat: 'streamingPhysicsLink',
      position,
      castShadow: true,
    });
    creates.push(
      createPhysicsEntity({
        colliders: { type: 'BOX', hx: LINK_HALF, hy: LINK_HALF, hz: LINK_HALF },
        body: { rigidType: 'DYNAMIC', translation: position },
        target: meshId,
      })
    );
  }
  const ids = await Promise.all(creates);
  if (!ctx.isCurrent()) return ids;
  const bodies = ids.map((id) => world.getRigidBody(id));
  const joints: Promise<unknown>[] = [];
  for (let i = 1; i < bodies.length; i++) {
    const [body1, body2] = [bodies[i - 1], bodies[i]];
    if (!body1 || !body2) continue;
    joints.push(
      createJoint({
        type: 'SPHERICAL',
        body1Id: body1.id,
        body2Id: body2.id,
        anchor1: { x: step / 2, y: 0, z: 0 },
        anchor2: { x: -step / 2, y: 0, z: 0 },
      })
    );
  }
  await Promise.all(joints);
  return ids;
};

const registerCells = () => {
  const sceneId = STREAMING_PHYSICS_SCENE_ID;
  for (let cz = -GRID_HALF; cz < GRID_HALF; cz++) {
    for (let cx = -GRID_HALF; cx < GRID_HALF; cx++) {
      const cellKey = getStreamingCellKey(cx, cz);
      registerStreamingCellContent({ sceneId, cellKey, load: loadGround });
      registerStreamingCellContent({ sceneId, cellKey, load: loadPile });
      // The chain's other half is in the next cell: not past the grid's last one
      if (cz === 0 && cx < GRID_HALF - 1) {
        registerStreamingCellContent({ sceneId, cellKey, load: loadChain });
      }
    }
  }
};

/** Tints each crate by its tier (a material per tier, swapped on a change), forgetting the
 * deleted ones; a crate held from drawing (a cell priming) keeps its material until it's shown */
const tintSystem = (world: ECSWorld) => {
  const tiers = world.getStorage(ComponentType.PHYSICS_SIM_TIER);
  const { entityIds, shown } = crates;
  for (let i = entityIds.length - 1; i >= 0; i--) {
    const entityId = entityIds[i];
    if (!world.isAlive(entityId)) {
      // Swap-remove
      entityIds[i] = entityIds[entityIds.length - 1];
      shown[i] = shown[shown.length - 1];
      entityIds.pop();
      shown.pop();
      continue;
    }
    const tier = tiers.get(entityId)?.tier ?? 'FULL';
    if (shown[i] === tier || world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) continue;
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    // No tint for REMOVED (nothing here asks for it)
    const material = getMaterial(getTierMaterialId(tier));
    if (!(mesh instanceof THREE.Mesh) || !material) continue;
    shown[i] = tier;
    setMeshMaterial(mesh, material);
  }
};

/** The plough's position `travelled` metres along the middle row and back, into `out` */
const ploughPointAt = (travelled: number, out: THREE.Vector3) => {
  const span = PLOUGH_REACH * 2;
  const t = travelled % (span * 2);
  const x = t < span ? -PLOUGH_REACH + t : PLOUGH_REACH - (t - span);
  return out.set(x, PLOUGH_RADIUS, PLOUGH_Z);
};

/** The plough: a kinematic ball at the row's -x end, the streaming and the policy focus */
const createPloughAsync = async (world: ECSWorld) => {
  const start = ploughPointAt(0, new THREE.Vector3());
  const ploughId = createMeshEntity(
    {
      geo: createGeometry({
        id: 'streamingPhysicsPlough',
        type: 'SPHERE',
        params: { radius: PLOUGH_RADIUS, widthSegments: 32, heightSegments: 16 },
      }),
      mat: createMaterial({
        id: 'streamingPhysicsPlough',
        type: 'STANDARD',
        params: { color: 0xffe08a, emissive: 0xffb02e, emissiveIntensity: 0.6 },
      }),
      position: start,
      castShadow: true,
    },
    { appId: 'streamingPhysicsPlough', debugData: { name: 'Streaming physics plough' } }
  );
  await createPhysicsEntity({
    colliders: { type: 'BALL', radius: PLOUGH_RADIUS },
    body: { rigidType: 'POS_BASED', translation: start },
    target: ploughId,
  });
  const body = existsOrThrow(world.getRigidBody(ploughId), 'Streaming physics: no plough body.');
  return { ploughId, body };
};

/** Moves the plough on fixed steps (scene time), and tints the crates; both removed on exit */
const startPloughAndTint = (world: ECSWorld, body: RigidBodyAPI) => {
  const tierMaterialIds = TIERS.map(getTierMaterialId);
  // Held by the scene: a tier no crate shows would otherwise lose its material
  for (const id of tierMaterialIds) incMaterialRef(id);
  let travelled = 0;
  const target = new THREE.Vector3();
  registerOnSceneExit(STREAMING_PHYSICS_SCENE_ID, () => {
    world.removeSystem(STEP_SYSTEM_ID);
    world.removeSystem(TINT_SYSTEM_ID);
    for (const id of tierMaterialIds) decMaterialRef(id);
    crates.entityIds.length = 0;
    crates.shown.length = 0;
  });
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, STEP_SYSTEM_ID, (_world, dt) => {
    if (!streamingPhysicsPlough.isMoving) return;
    travelled += streamingPhysicsPlough.speed * dt;
    body.setNextKinematicTranslation(ploughPointAt(travelled, target));
  });
  world.addSystem(ECSSystemStage.APP_RENDER_SYNC, TINT_SYSTEM_ID, tintSystem);
};

/**
 * The streaming physics scene: the cells' content registered, the plough made and set as the
 * streaming focus (before the cells around it load, after this function) and as the tier policy's,
 * the camera following it.
 */
export const scene = async () => {
  const world = getECSWorld();
  getSharedAssets();
  crates.entityIds.length = 0;
  crates.shown.length = 0;
  // Registered on every load (a scene's registrations go when it's left)
  registerCells();

  const { ploughId, body } = await createPloughAsync(world);
  setStreamingFocus(ploughId);
  // The focus lasts across loads: the next scene measures from its main camera again
  registerOnSceneExit(STREAMING_PHYSICS_SCENE_ID, () => setStreamingFocus(null));
  setPhysicsTierPolicy(
    {
      focus: () => ploughId,
      rings: [{ tier: 'FULL', within: POLICY_FULL_WITHIN }, { tier: 'STATIC' }],
      sceneId: STREAMING_PHYSICS_SCENE_ID,
    },
    world
  );
  startPloughAndTint(world, body);

  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) {
    lwarn(`Streaming physics: no camera '${CAMERA_APP_ID}' to follow the plough.`);
  } else {
    world.addComponent(cameraId, FollowToolComponentType.FOLLOW, {
      leaderId: ploughId,
      offset: new THREE.Vector3(0, 70, 88),
      targetOffset: new THREE.Vector3(),
      speed: 4,
    });
  }

  // The JSON lights are created after this function runs: the sun gets its shadow fit on enter
  registerOnSceneEnter(STREAMING_PHYSICS_SCENE_ID, () => {
    const sunId = getEntityIdByAppId(SUN_APP_ID, world);
    if (sunId === undefined) return;
    world.addComponent(sunId, SunShadowFitComponentType.SUN_SHADOW_FIT, {
      maxDistance: 160,
      casterExtension: 10,
    });
  });

  if (IS_DEBUG_ENV) {
    const { createStreamingPhysicsTab } = await import('./_dbg__streamingPhysics');
    createStreamingPhysicsTab();
  }
};
