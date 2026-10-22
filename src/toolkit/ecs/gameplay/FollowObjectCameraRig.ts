import * as THREE from 'three/webgpu';
import {
  APP_RENDER_SYNC_ORDER,
  ECSSystemStage,
  getCurrentSceneId,
  getECSWorld,
  registerOnAllSceneExits,
  smoothDampVec3,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';

const DEFAULT_OFFSET = { x: 0, y: 5, z: 10 };
const DEFAULT_LERP_SMOOTH_TIME = 0.1;
const DEFAULT_DAMP_SMOOTH_TIME = 0.2;
// The SMOOTH_DAMP step's speed cap without mouse input (m/s); the mouse orbit has none
const DAMP_MAX_SPEED = 100;
const DEFAULT_LOOK_AHEAD_SMOOTHING_TIME = 0.6;
const DEFAULT_LOOK_AHEAD_RETURN_SPEED = 1;
// The look-ahead's travel velocity is smoothed over this time (s), so a pose that only moves on
// physics steps (no interpolation) doesn't read as stopping between them
const TRAVEL_SMOOTHING_TIME = 0.1;
// Below this horizontal speed (m/s) the target counts as standing still
const MIN_TRAVEL_SPEED = 0.5;
// Above this horizontal speed (m/s) a move is a teleport (a respawn), not travel
const MAX_TRAVEL_SPEED = 100;

/**
 * {@link createFollowObjectCameraRig}'s options: the camera, the mesh it follows, and how it
 * follows it.
 */
export type FollowObjectCameraParams = {
  id: string;
  /** The scene whose exit deletes the rig; without one it stays until
   * {@link deleteFollowObjectCameraRig} */
  sceneId?: string;
  camera: THREE.Camera;
  targetMesh: THREE.Mesh;
  /** What is the offset of the camera from the target */
  offset?: { x: number; y: number; z: number };
  /** Smoothing function type (default is 'SMOOTH_DAMP') */
  smoothingType?: 'SMOOTH_DAMP' | 'LERP';
  /** Smoothing time used for SMOOTH_DAMP or LERP */
  smoothingTime?: number;
  /** The height above the target the camera points at (for example the character's head), with
   * `getMouseMoveInput` only */
  targetHeight?: number;
  /**
   * How the camera turns without `getMouseMoveInput` (with it, the orbit decides).
   * `'LOOK_AT_TARGET'` (the default) aims at the followed point every frame, so the view
   * direction swings while the camera catches up with a moving target. `'FIXED'` keeps looking
   * along `-offset` and only moves the camera, so the view never turns.
   */
  orientation?: 'LOOK_AT_TARGET' | 'FIXED';
  /**
   * Leads the followed point ahead of the target in its horizontal direction of travel (read from
   * the drawn pose's movement), so the view shows more of where the target is heading. Off when
   * not given.
   */
  lookAhead?: {
    /** How far ahead the followed point leads a moving target (m) */
    distance: number;
    /** About how long the lead takes to reach `distance`, or to swing round when the target
     * turns (s, default 0.6) */
    smoothingTime?: number;
    /** How fast the lead moves back to the target once it stands still (m/s, default 1); 0 keeps
     * the lead where it is */
    returnSpeed?: number;
  };
  /** Function to run after the camera.lookAt (at the very end) */
  afterLookAtFn?: (params: {
    id: string;
    /** The followed point (the target, plus the look-ahead's lead and `targetHeight`) */
    targetPos: THREE.Vector3;
    camera: THREE.Camera;
    targetMesh: THREE.Mesh;
    offset: THREE.Vector3;
    smoothingType: 'SMOOTH_DAMP' | 'LERP';
    smoothingTime: number;
    spherical: THREE.Spherical;
  }) => void;
  getMouseMoveInput?: () => { x: number; y: number };
};

type FollowRigState = {
  world: ECSWorld;
  sceneId?: string;
  tick: (dt: number) => void;
};

// One shared system drives every rig, each in the world it was created for (the default world)
const activeRigs = new Map<string, FollowRigState>();

const followObjectCameraRigSystemFn = (world: ECSWorld, dt: number) => {
  for (const rig of activeRigs.values()) if (rig.world === world) rig.tick(dt);
};

// Deletes the exiting scene's rigs: while the exit listeners run, it's still the current scene
const deleteExitingSceneRigs = () => {
  const sceneId = getCurrentSceneId();
  if (!sceneId) return;
  for (const [id, rig] of activeRigs) if (rig.sceneId === sceneId) activeRigs.delete(id);
};

/** Registers the single shared camera-follow system on `world`, driving every active
 * createFollowObjectCameraRig() instance's smoothing. It reads `targetMesh.position`, i.e. the
 * rendered pose, so it runs at APP_RENDER_SYNC with APP_RENDER_SYNC_ORDER.POSE_CONSUMERS: after
 * physicsInterpolationSystem has written this frame's final (possibly interpolated) pose into
 * the Object3D, and before frustum culling reads the main camera. At APP_LOGIC the mesh would
 * still hold the previous frame's discrete pose, so the camera would chase a pose that differs
 * from the one being drawn. An explicit order is required: at the default order 0 it would tie
 * with physicsInterpolationSystem, and a tie runs in registration order (the app's install
 * comes after the physics feature's, but nothing else keeps it so).
 * Call this once per world before creating any camera rigs on it — mirrors
 * toolkit/ecs/effects/FollowTool.ts's registerFollowToolEffect(world) convention. */
export const registerFollowObjectCameraRigSystem = (world: ECSWorld) => {
  world.addSystem(
    ECSSystemStage.APP_RENDER_SYNC,
    'followObjectCameraRigSystem',
    followObjectCameraRigSystemFn,
    APP_RENDER_SYNC_ORDER.POSE_CONSUMERS
  );
  registerOnAllSceneExits('followObjectCameraRig', deleteExitingSceneRigs);
  return world;
};

// The look-ahead's lead: a horizontal offset from the target toward its direction of travel,
// updated once per frame from the drawn pose. Presentation only: it reads the rendered pose,
// so it isn't part of the deterministic simulation.
const createLookAhead = (
  targetMesh: THREE.Object3D,
  {
    distance,
    smoothingTime = DEFAULT_LOOK_AHEAD_SMOOTHING_TIME,
    returnSpeed = DEFAULT_LOOK_AHEAD_RETURN_SPEED,
  }: NonNullable<FollowObjectCameraParams['lookAhead']>
) => {
  const lead = new THREE.Vector3();
  const leadVelocity = new THREE.Vector3();
  const desiredLead = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  let hasPrevPos = false;
  let travelX = 0;
  let travelZ = 0;

  const update = (dt: number) => {
    const pos = targetMesh.position;
    if (hasPrevPos) {
      const vx = (pos.x - prevPos.x) / dt;
      const vz = (pos.z - prevPos.z) / dt;
      if (vx * vx + vz * vz <= MAX_TRAVEL_SPEED * MAX_TRAVEL_SPEED) {
        const k = 1 - Math.exp(-dt / TRAVEL_SMOOTHING_TIME);
        travelX += (vx - travelX) * k;
        travelZ += (vz - travelZ) * k;
      }
    }
    prevPos.copy(pos);
    hasPrevPos = true;

    const speed = Math.sqrt(travelX * travelX + travelZ * travelZ);
    if (speed >= MIN_TRAVEL_SPEED) {
      desiredLead.set((travelX / speed) * distance, 0, (travelZ / speed) * distance);
      smoothDampVec3(lead, desiredLead, leadVelocity, smoothingTime, Infinity, dt);
      return;
    }

    // Standing still: back to the target in a straight line, at returnSpeed
    leadVelocity.set(0, 0, 0);
    const length = lead.length();
    if (length === 0 || returnSpeed <= 0) return;
    const step = returnSpeed * dt;
    if (step >= length) lead.set(0, 0, 0);
    else lead.multiplyScalar(1 - step / length);
  };

  return { lead, update };
};

/**
 * Makes `camera` follow `targetMesh` at `offset`, smoothed, from the next frame on. The rig is
 * keyed by `id`: creating one with an id in use replaces it.
 * @remarks Moves the camera only once {@link registerFollowObjectCameraRigSystem} has run on the
 * world.
 * @example
 * ```ts
 * // A top-down camera that never turns and shows a little more of where the player is heading
 * createFollowObjectCameraRig({
 *   id: 'playerCam',
 *   camera,
 *   targetMesh: playerMesh,
 *   offset: { x: 0, y: 14, z: 7 },
 *   orientation: 'FIXED',
 *   lookAhead: { distance: 1.5 },
 * });
 * ```
 */
export const createFollowObjectCameraRig = (params: FollowObjectCameraParams) => {
  const {
    id,
    sceneId,
    camera,
    targetMesh,
    offset: offsetParam,
    smoothingType,
    smoothingTime,
    targetHeight,
    orientation,
    lookAhead: lookAheadParam,
    afterLookAtFn,
    getMouseMoveInput,
  } = params;

  const targetPos = new THREE.Vector3();
  const idealPos = new THREE.Vector3();
  const velocity = new THREE.Vector3(0, 0, 0); // For dampening (if using smoothDamp)
  const targetHeightVector = new THREE.Vector3(0, targetHeight, 0);
  const sphericalOffset = new THREE.Vector3(); // mouse-look offset, rewritten every tick
  const fixedLookPoint = new THREE.Vector3();

  const offsetObj = offsetParam || DEFAULT_OFFSET;
  const offset = new THREE.Vector3(offsetObj.x, offsetObj.y, offsetObj.z);
  const smoothType = smoothingType || 'SMOOTH_DAMP';
  const smoothTime =
    smoothingTime !== undefined
      ? smoothingTime
      : smoothType === 'LERP'
        ? DEFAULT_LERP_SMOOTH_TIME
        : DEFAULT_DAMP_SMOOTH_TIME;
  const dist = new THREE.Vector3(0, 0, 0).distanceTo(offset);
  const isFixedOrientation = orientation === 'FIXED' && !getMouseMoveInput;
  const lookAhead = lookAheadParam ? createLookAhead(targetMesh, lookAheadParam) : null;

  // Spherical coordinate system for orbiting
  // Phi: Vertical angle (0 = top, PI = bottom). Start at roughly 45-60 deg.
  // Theta: Horizontal angle.
  const spherical = new THREE.Spherical(dist, Math.PI / 3, 0);

  // Limits for looking up/down (Don't clip through floor or flip over)
  const minPolarAngle = 0.1; // Look almost straight up
  const maxPolarAngle = Math.PI / 2 - 0.1; // Don't go below ground level

  const sensitivity = 0.002; // Mouse sensitivity

  const afterLookParams = {
    id,
    targetPos,
    idealPos,
    camera,
    targetMesh,
    offset,
    smoothingType: smoothType,
    smoothingTime: smoothTime,
    spherical,
  };

  // The smoothing step, chosen once: moves the camera toward idealPos
  const dampMaxSpeed = getMouseMoveInput ? Infinity : DAMP_MAX_SPEED;
  const smoothStep =
    smoothType === 'LERP'
      ? (dt: number) => {
          // An exponential approach with time constant smoothTime, so the feel doesn't change
          // with the frame rate (a fixed per-frame lerp factor would converge 2.4x faster at
          // 144Hz than at 60Hz)
          camera.position.lerp(idealPos, 1 - Math.exp(-dt / smoothTime));
        }
      : (dt: number) => {
          // Modifies camera.position AND velocity (the momentum) in place
          smoothDampVec3(camera.position, idealPos, velocity, smoothTime, dampMaxSpeed, dt);
        };

  // Orbits the offset by the mouse movement into sphericalOffset
  const orbit = (mouseDelta: { x: number; y: number }) => {
    // Horizontal (Theta) - Rotate around Y
    // Subtract to rotate "intuitively" (drag background) or add for inverted
    spherical.theta -= mouseDelta.x * sensitivity;

    // Vertical (Phi) - Rotate up/down
    spherical.phi -= mouseDelta.y * sensitivity;

    // Clamp Vertical angle
    spherical.phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, spherical.phi));

    // Convert the angles back into a Vector3 offset (x, y, z)
    sphericalOffset.setFromSpherical(spherical);
  };

  const tick = (dt: number) => {
    // Skips a frame without time (the first frame, a pause) or with a NaN dt
    if (!(dt > 0.0001)) return;

    // The followed point: the drawn pose (the mesh, not the rigid body, for visual smoothness
    // when the visuals are interpolated), led ahead of it when lookAhead is on
    targetPos.copy(targetMesh.position);
    if (lookAhead) {
      lookAhead.update(dt);
      targetPos.add(lookAhead.lead);
    }

    if (getMouseMoveInput) {
      orbit(getMouseMoveInput());
      // Look at eg. the player's head
      targetPos.add(targetHeightVector);
      idealPos.copy(targetPos).add(sphericalOffset);
    } else {
      idealPos.copy(targetPos).add(offset);
    }

    smoothStep(dt);

    if (isFixedOrientation) {
      camera.lookAt(fixedLookPoint.copy(camera.position).sub(offset));
    } else {
      camera.lookAt(targetPos);
    }

    if (afterLookAtFn) {
      afterLookParams.targetPos = targetPos;
      afterLookAtFn(afterLookParams);
    }
  };

  activeRigs.set(id, { world: getECSWorld(), sceneId, tick });
};

/** Stops the rig `id`; the camera stays where it is. An unknown id is a no-op. */
export const deleteFollowObjectCameraRig = (id: string) => {
  activeRigs.delete(id);
};
