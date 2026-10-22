import * as THREE from 'three/webgpu';
import {
  createGeometry,
  createMaterial,
  createMeshEntity,
  getMeshByAppId,
  getECSWorld,
  getRootScene,
  ECSSystemStage,
  existsOrThrow,
} from 'aekasha';
import type { ECSWorld, GeoProps, GeoTypes, Materials, MatProps, MeshProps } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
import type { ColliderParams, RigidBodyParams } from 'aekasha/physics';
import {
  createPlatformPath,
  type MovingPlatformPathOptions,
  type MovingPlatformPoint,
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

/**
 * One collider of a moving platform ({@link MovingPlatformParams}' `physicsParams`); the first one
 * also carries the platform's rigid body.
 */
export interface MovingPlatformPhysicsParams {
  /** The collider; a primitive shape without its sizes takes them from the platform's mesh. */
  collider: ColliderParams;
  /**
   * The platform's rigid body, read from the first entry only, where it's required and must be
   * `rigidType: 'POS_BASED'` (kinematic, moved by position). Its `userData` is copied, with the
   * moving platform's fields added (`isMovingPlatform`, the segment's `velo` and `angVelo`, and
   * `friction`), which the dynamic character reads to ride the platform.
   */
  rigidBody?: RigidBodyParams;
}

/**
 * The old name of {@link MovingPlatformPhysicsParams}.
 * @deprecated Use {@link MovingPlatformPhysicsParams} (removed in toolkit 3.0.0).
 */
export type PhysicsParams = MovingPlatformPhysicsParams;

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

/**
 * Registers the system that moves every {@link createMovingPlatform} platform of `world`, at
 * `APP_PHYSICS_STEP` (once per fixed physics sub-step, with dt the fixed timestep) with order
 * -100: after the stage's default-order systems, the character brains (-5) and the controllers
 * (-10). A second call on the same world is a no-op.
 * @returns `world`
 * @remarks Per sub-step, not per frame: a frame that runs 0 or 2+ sub-steps would move a platform
 * unevenly, and a character riding it reads the step's velocities.
 */
export const registerMovingPlatformSystem = (world: ECSWorld) => {
  world.addSystem(
    ECSSystemStage.APP_PHYSICS_STEP,
    'movingPlatformSystem',
    movingPlatformSystemFn,
    -100
  );
  return world;
};

/**
 * What to delete with a platform's mesh.
 * @deprecated Never read: {@link MovingPlatformControls}' `delete` deletes the platform's entity
 * (its mesh and its body) and nothing else. Removed in toolkit 3.0.0.
 */
export interface DeleteMeshOptions {
  /** Delete the mesh's geometries. */
  deleteGeometries?: boolean;
  /** Delete the mesh's materials. */
  deleteMaterials?: boolean;
  /** Delete the materials' textures. */
  deleteTextures?: boolean;
  /** Delete all of the above. */
  deleteAll?: boolean;
}

/**
 * Playback controls of a platform made by {@link createMovingPlatform}.
 * @remarks The controls write the rigid body (its pose, its next kinematic pose and its user data
 * velocities) when they're called, not at a physics step: call them from scene code or UI, and
 * expect a call between two steps to take effect at the next one.
 */
export interface MovingPlatformControls {
  /**
   * Plays the path on from where it is, or from the start of the segment at point
   * `fromSegmentIndex` (which also drops {@link MovingPlatformControls.playSegment}'s stop). After
   * the last loop ended, the loops start over.
   */
  play: (fromSegmentIndex?: number) => void;
  /** Stops the platform where it is; its user data velocities go to zero. */
  pause: () => void;
  /**
   * Plays the segment from point `segmentIndex` alone, from its start, then stops. A bad index is
   * a no-op.
   */
  playSegment: (segmentIndex: number) => void;
  /** Stops the platform and puts it back at point 0, its loop count reset. */
  stop: () => void;
  /** Deletes the platform's entity (its mesh, when it has one, and its rigid body). */
  delete: () => void;
  /**
   * Changes the loops, the direction or the speed; the options left out keep their values. A
   * direction change mid-segment turns the platform round where it is, at the same speed.
   */
  setOptions: (options: MovingPlatformPathOptions) => void;
  /** The platform's playback state, a new object per call. */
  getState: () => {
    /** Whether it moves on the next step. */
    isPlaying: boolean;
    /** The loops ended since the start, the last stop or the last end. */
    currentLoopCount: number;
    /** The segment `playSegment` plays before it stops, or null. */
    targetSegmentIndex: number | null;
    /** Scales every segment's speed. */
    speedMultiplier: number;
    /** The point the current segment starts from. */
    curIndex: number;
    /** The point the current segment runs to. */
    nextIndex: number;
    /** How far along the current segment, 0 to 1. */
    t: number;
    /** The current segment's time at speed 1, in seconds. */
    segmentDuration: number;
  };
}

/** {@link createMovingPlatform}'s result: the platform's entity, its mesh and its controls. */
export interface MovingPlatformReturn {
  /** The platform's entity: the mesh's entity when it has one, else a physics-only entity. */
  entityId: number;
  /** The platform's mesh, when `shape` gave or made one. */
  mesh?: THREE.Mesh;
  /** Plays, pauses, stops and deletes the platform. */
  controls: MovingPlatformControls;
}

/**
 * How a moving platform plays ({@link MovingPlatformParams}' `opts`): the path's options, and
 * whether it starts at once.
 */
export interface MovingPlatformOptions extends MovingPlatformPathOptions {
  /** Whether it moves from the first physics step (default true); false waits for `play()`. */
  isPlayingFromStart?: boolean;
  /**
   * What to delete with the mesh.
   * @deprecated Never read (see {@link DeleteMeshOptions}); removed in toolkit 3.0.0.
   */
  deleteMeshOptions?: DeleteMeshOptions;
}

/**
 * {@link createMovingPlatform}'s props: the platform's mesh, its physics, its path and its
 * playback.
 */
export interface MovingPlatformParams {
  /**
   * The platform's id, unique among the live platforms: it names the mesh and the entity the
   * platform makes (`movingPlatformMesh-<id>`, `movingPlatform-<id>`).
   */
  id: string;
  /** The physics-only platform's debug name (without a mesh). */
  name?: string;
  /**
   * Where a mesh given as a three `Mesh` without a parent goes (default: the root scene). A mesh
   * made from props, or by `createMeshEntity`, already has one.
   */
  scene?: THREE.Scene | THREE.Group;
  /** The platform's mesh; without one the platform is physics only (invisible). */
  shape?: {
    /** A geometry or its props, with `mat`, when `mesh` isn't given. */
    geo?: GeoProps | GeoTypes;
    /** A material or its props, with `geo`. */
    mat?: MatProps | Materials;
    /**
     * A mesh (eg. one made with `createMeshEntity`, whose entity then gets the physics), or the
     * props to make one. Wins over `geo` and `mat`.
     */
    mesh?: MeshProps | THREE.Mesh;
    /** Whether a mesh made from `geo` and `mat` casts shadows (default false). */
    castShadow?: boolean;
    /** Whether a mesh made from `geo` and `mat` receives shadows (default false). */
    receiveShadow?: boolean;
  };
  /** The colliders, the first with the platform's rigid body. */
  physicsParams: MovingPlatformPhysicsParams | MovingPlatformPhysicsParams[];
  /** The path: one or more points, closed (after the last point it runs back to the first). */
  points: MovingPlatformPoint[];
  /** How it plays (default: forward, forever, at speed 1, from the start). */
  opts?: MovingPlatformOptions;
}

/** The platform's mesh: the one given, or a mesh entity made from mesh props or a geo and a mat. */
const createPlatformMesh = (
  id: string,
  shape: NonNullable<MovingPlatformParams['shape']>
): THREE.Mesh | undefined => {
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
 * Creates a kinematic platform that moves along a closed path of `points` (each `dur` in ms, 3000
 * by default, to the next point; the last one's back to the first), playing from the first
 * physics step unless `opts.isPlayingFromStart` is false. By default it runs forward forever
 * ({@link MovingPlatformOptions}: `loopTimes`, `direction`, `speedMultiplier`). The body's user
 * data carries the current segment's velocities, so a dynamic character standing on it rides
 * along.
 *
 * The platform's entity is the mesh's (from `shape`), or a new physics-only one: deleting it,
 * with its scene or by `controls.delete()`, deletes the platform. Its `id` keys its path: a second
 * live platform with the same id takes over the first's place in the system, which then stops.
 * @throws when the props can't make a platform (no `physicsParams` or points, a first rigid body
 * that isn't `POS_BASED`, a bad `dur`, `loopTimes` or `speedMultiplier`, a shape with neither a
 * mesh nor a geo and a mat; logged too), or when the entity is deleted while the body is created
 * (its scene exited)
 * @remarks Moves only once {@link registerMovingPlatformSystem} has run on the world. The
 * controls write the body when called, outside the physics step ({@link MovingPlatformControls}).
 * @example
 * ```ts
 * // An elevator that goes up and back down twice, 4 s each way, then stops at the bottom
 * const { controls } = await createMovingPlatform({
 *   id: 'elevator',
 *   shape: {
 *     mesh: { geo: { type: 'BOX', params: { width: 4, height: 0.2, depth: 4 } }, mat: 'liftMat' },
 *   },
 *   physicsParams: {
 *     collider: { type: 'BOX', friction: 0 },
 *     rigidBody: { rigidType: 'POS_BASED' },
 *   },
 *   points: [
 *     { pos: { x: 0, y: 0, z: 0 }, dur: 4000 },
 *     { pos: { x: 0, y: 6, z: 0 }, dur: 4000 },
 *   ],
 *   opts: { loopTimes: 1 },
 * });
 * // Later, eg. from a button: again from the bottom
 * controls.stop();
 * controls.play();
 * ```
 */
export const createMovingPlatform = async (
  props: MovingPlatformParams
): Promise<MovingPlatformReturn> => {
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

  if (mesh && !mesh.parent) (scene ?? getRootScene())?.add(mesh);

  return { entityId, mesh, controls };
};
