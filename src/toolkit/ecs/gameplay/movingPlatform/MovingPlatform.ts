import * as THREE from 'three/webgpu';
import {
  createGeometry,
  createMaterial,
  createMeshEntity,
  getMeshByAppId,
  getECSWorld,
  type ECSWorld,
  ECSSystemStage,
  existsOrThrow,
} from 'aekasha';
import type { GeoProps, GeoTypes, Materials, MatProps, MeshProps } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
import type { ColliderParams, RigidBodyParams } from 'aekasha/physics';
import {
  createPlatformPath,
  hasMoveAndTurn,
  playPlatformPath,
  playPlatformPathSegment,
  setPlatformPathOptions,
  stepPlatformPath,
  stopPlatformPath,
  validateMovingPlatform,
} from './PlatformPath';
import {
  computePlatformVelocities,
  zeroPlatformVelocities,
  type PlatformVelocities,
} from './PlatformVelocity';

// The factory and the controls. The path's state machine is PlatformPath.ts, the velocities the
// dynamic character reads from the body's user data PlatformVelocity.ts.

/** One collider of a moving platform, the first one with the platform's rigid body. */
export type PhysicsParams = {
  collider: ColliderParams;
  rigidBody?: RigidBodyParams;
};

// One shared system drives every platform, each tick owned by its platform's entity: it runs only
// for that entity's world, and is dropped once the entity is gone (eg. deleted with its scene).
type PlatformTick = { world: ECSWorld; entityId: number; tick: (dt: number) => void };
const activePlatformTicks = new Map<string, PlatformTick>();

const movingPlatformSystemFn = (world: ECSWorld, dt: number) => {
  for (const [key, platform] of activePlatformTicks) {
    if (platform.world !== world) continue;
    if (!world.isAlive(platform.entityId)) {
      activePlatformTicks.delete(key);
      continue;
    }
    platform.tick(dt);
  }
};

/** Registers the single shared moving-platform system on `world`, driving every active
 * createMovingPlatform() instance's path at APP_PHYSICS_STEP: once per fixed physics sub-step
 * with dt = the fixed timestep, writing that step's kinematic target pose right before it (a
 * once-per-frame tick would move the platform unevenly whenever a frame runs 0 or 2+ sub-steps).
 * Order -100: after the same stage's default-order (0) systems and the character brains (-5) and
 * controllers (-10). Call this once per world before creating any moving platforms on it, as
 * toolkit/ecs/effects/HoverEffect.ts's registerHoverToolEffect(world) does: the caller registers
 * the system once, individual instances just add themselves to it. */
export const registerMovingPlatformSystem = (world: ECSWorld) => {
  world.addSystem(
    ECSSystemStage.APP_PHYSICS_STEP,
    'movingPlatformSystem',
    movingPlatformSystemFn,
    -100
  );
  return world;
};

/** What to delete with a platform's mesh. Not read yet: `controls.delete()` deletes the platform's entity only. */
export type DeleteMeshOptions = {
  deleteGeometries?: boolean;
  deleteMaterials?: boolean;
  deleteTextures?: boolean;
  deleteAll?: boolean;
};

/** Playback controls of a platform made by {@link createMovingPlatform}. */
export type MovingPlatformControls = {
  play: (fromSegmentIndex?: number) => void;
  pause: () => void;
  playSegment: (segmentIndex: number) => void;
  stop: () => void; // Resets to start
  delete: () => void;
  setOptions: (options: {
    loopTimes?: number;
    direction?: 'FORWARD' | 'BACKWARD';
    speedMultiplier?: number;
  }) => void;
  getState: () => {
    isPlaying: boolean;
    currentLoopCount: number;
    targetSegmentIndex: number | null;
    speedMultiplier: number;
    curIndex: number;
    nextIndex: number;
    t: number;
    segmentDuration: number;
  };
};

/** {@link createMovingPlatform}'s result: the platform's entity, its mesh and its controls. */
export type MovingPlatformReturn = {
  entityId: number;
  mesh?: THREE.Mesh;
  controls: MovingPlatformControls;
};

type PlatformShape = NonNullable<Parameters<typeof createMovingPlatform>[0]['shape']>;

/** The platform's mesh: the one given, or a mesh entity made from mesh props or a geo and a mat. */
const createPlatformMesh = (id: string, shape: PlatformShape): THREE.Mesh | undefined => {
  if (shape.mesh && 'isMesh' in shape.mesh) return shape.mesh;
  if (shape.mesh) {
    const meshAppId = shape.mesh.appId || `movingPlatformMesh-${id}`;
    createMeshEntity({ ...shape.mesh, appId: meshAppId });
    return getMeshByAppId(meshAppId);
  }
  if (!shape.geo || !shape.mat) return undefined;
  const meshAppId = `movingPlatformMesh-${id}`;
  createMeshEntity({
    appId: meshAppId,
    geo: 'isBufferGeometry' in shape.geo ? shape.geo : createGeometry(shape.geo),
    mat: 'isMaterial' in shape.mat ? shape.mat : createMaterial(shape.mat),
    castShadow: Boolean(shape.castShadow),
    receiveShadow: Boolean(shape.receiveShadow),
  });
  return getMeshByAppId(meshAppId);
};

/**
 * Creates a kinematic platform that moves along `points` (each `dur` in ms, 3000 by default to
 * reach the next point) and plays from the start unless `opts.isPlayingFromStart` is false.
 * `loopTimes` -1 (the default) loops forever.
 * @remarks Moves only once {@link registerMovingPlatformSystem} has run on the world.
 */
export const createMovingPlatform = async (props: {
  id: string;
  name?: string;
  scene: THREE.Scene | THREE.Group;
  shape?: {
    geo?: GeoProps | GeoTypes;
    mat?: MatProps | Materials;
    mesh?: MeshProps | THREE.Mesh;
    castShadow?: boolean;
    receiveShadow?: boolean;
  };
  physicsParams: PhysicsParams | PhysicsParams[];
  points: {
    pos: { x: number; y: number; z: number };
    rot?: { x: number; y: number; z: number; w: number };
    dur?: number;
  }[];
  opts?: {
    deleteMeshOptions?: DeleteMeshOptions;
    isPlayingFromStart?: boolean; // Default true
    loopTimes?: number;
    direction?: 'FORWARD' | 'BACKWARD';
    speedMultiplier?: number;
  };
}): Promise<MovingPlatformReturn> => {
  const { id, name, scene, shape, physicsParams, points, opts } = props;
  validateMovingPlatform(props);

  const mesh = shape ? createPlatformMesh(id, shape) : undefined;
  const path = createPlatformPath(points, opts, opts?.isPlayingFromStart ?? true);

  // A copy of the caller's rigid body params, with the user data the dynamic character reads
  const paramsArray = Array.isArray(physicsParams) ? physicsParams : [physicsParams];
  const callerBodyParams = existsOrThrow(
    paramsArray[0].rigidBody,
    `Could not create moving platform, rigidBody is missing (id: ${id}).`
  );
  const rigidBodyParams: RigidBodyParams = {
    ...callerBodyParams,
    userData: {
      ...callerBodyParams.userData,
      isMovingPlatform: true,
      velo: { x: 0, y: 0, z: 0 },
      angVelo: { x: 0, y: 0, z: 0 },
      // Whether the character fully sticks on the platform or slides a bit
      friction: hasMoveAndTurn(path) ? 0 : 0.8,
    },
  };
  const colliderParamsArray = paramsArray.map((p) => p.collider);

  if (mesh) mesh.userData.isMovingPlatform = true;

  // A mesh with an entity (built from props above, or made by the caller with createMeshEntity)
  // gets the physics components on that entity; a raw mesh is the target of a new entity; no
  // mesh makes an invisible physics-only platform
  const meshEntityId: number | undefined = mesh?.userData.entityId;
  const target: THREE.Object3D | number | undefined = meshEntityId ?? mesh;
  const world = getECSWorld();
  const entityId = await createPhysicsEntity(
    colliderParamsArray,
    rigidBodyParams,
    target,
    target === undefined ? { appId: `movingPlatform-${id}`, debugData: { name } } : undefined
  );
  if (!world.isAlive(entityId)) {
    throw new Error(
      `Moving platform "${id}"'s entity was deleted while it was created (its scene exited).`
    );
  }
  const body = existsOrThrow(
    world.getRigidBody(entityId),
    `Could not find rigid body for moving platform (id: ${id})`
  );

  // The body's user data velocities: written in place and pushed with setUserData, which merges
  // them into the body's user data (a snapshot in WORKER_THREAD mode, cloned when sent)
  const velocities: PlatformVelocities = {
    velo: { x: 0, y: 0, z: 0 },
    angVelo: { x: 0, y: 0, z: 0 },
  };
  const writeVelocities = () => {
    if (path.isPlaying) {
      const { fromPos, toPos, fromRot, toRot, segmentDuration, speedMultiplier } = path;
      const duration = segmentDuration / speedMultiplier;
      computePlatformVelocities(fromPos, toPos, fromRot, toRot, duration, velocities);
    } else {
      zeroPlatformVelocities(velocities);
    }
    body.setUserData(velocities, true);
  };
  // Puts the body at the current segment's start
  const teleport = () => {
    body.setTranslation(path.fromPos, true);
    body.setRotation(path.fromRot, true);
    body.setNextKinematicTranslation(path.fromPos);
    body.setNextKinematicRotation(path.fromRot);
  };

  writeVelocities();
  teleport();
  if (mesh) {
    mesh.position.copy(path.fromPos);
    mesh.quaternion.copy(path.fromRot);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
  }

  const controls: MovingPlatformControls = {
    play: (fromIndex) => {
      if (playPlatformPath(path, fromIndex)) {
        body.setNextKinematicTranslation(path.fromPos);
        body.setNextKinematicRotation(path.fromRot);
      }
      writeVelocities();
    },
    pause: () => {
      path.isPlaying = false;
      writeVelocities();
    },
    playSegment: (index) => {
      if (!playPlatformPathSegment(path, index)) return;
      writeVelocities();
      teleport();
    },
    stop: () => {
      stopPlatformPath(path);
      writeVelocities();
      teleport();
    },
    delete: () => {
      // The entity holds the mesh (when there is one) and the physics components: deleting it
      // removes both (TAG_IS_PHYSICS_OBJECT's onDeleteEntity hook deletes the body)
      getECSWorld().deleteEntity(entityId);
      activePlatformTicks.delete(`platformLoop-${id}`);
    },
    setOptions: (options) => {
      setPlatformPathOptions(path, options);
      writeVelocities();
    },
    getState: () => ({
      isPlaying: path.isPlaying,
      currentLoopCount: path.currentLoopCount,
      targetSegmentIndex: path.targetSegmentIndex,
      speedMultiplier: path.speedMultiplier,
      curIndex: path.curIndex,
      nextIndex: path.nextIndex,
      t: path.t,
      segmentDuration: path.segmentDuration,
    }),
  };

  // The pose each step writes, the platform's own
  const curPos = new THREE.Vector3();
  const curRot = new THREE.Quaternion();
  activePlatformTicks.set(`platformLoop-${id}`, {
    world,
    entityId,
    tick: (dt) => {
      const result = stepPlatformPath(path, dt, curPos, curRot);
      if (result === 'IDLE') return;
      body.setNextKinematicTranslation(curPos);
      body.setNextKinematicRotation(curRot);
      // A new segment's velocities, or zero at the end
      if (result !== 'MOVED') writeVelocities();
    },
  });

  if (mesh && !mesh.parent) scene.add(mesh);

  return { entityId, mesh, controls };
};
