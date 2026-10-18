import * as THREE from 'three/webgpu';
import { DIRECTIONS } from './ThreeMath';
import type { DebugModuleRef } from '../config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../config/DebugModules';
import {
  IntervalCounterStats,
  type IntervalCounterSnapshot,
} from '../../utils/IntervalCounterStats';
import { DEFAULT_ECS_WORLD_ID } from '../ecs/ECS';
import { ECSSystemStage } from '../loop/SystemStages';
import { RAY_STATS_WINDOWS, type RayDebugOpts } from './RayDebugTypes';
import type { FeatureContext } from '../init/Features';

// three.js ray casting for the kernel (input picking) and the debug tools, on no entry: an app
// casts through physics (getPhysicsWorld().castRay) or picks through its input bindings

/**
 * Options of the `castRayFrom*` functions.
 * @internal
 */
export type RayCastOpts<TIntersected extends THREE.Object3D = THREE.Object3D> = {
  /** Minimum hit distance (Raycaster.near), default 0 */
  near?: number;
  /** Maximum hit distance (Raycaster.far), default Infinity (castRayFromPoints: the from→to
   * distance) */
  far?: number;
  /** Whether the objects' descendants are tested too, default true */
  recursive?: boolean;
  /** Reused result array: it is cleared and filled, and returned instead of a new array */
  target?: Array<THREE.Intersection<TIntersected>>;
  /** Called per hit in distance order; return false to stop iterating. Don't cast another ray
   * from it (all casts share one raycaster): collect the hits first, then cast. */
  perIntersect?: (intersect: THREE.Intersection<TIntersected>) => void | boolean;
  /** Whether this ray is counted in the ray cast statistics, default true */
  countInStats?: boolean;
  /** Debug helper options, ignored outside debug */
  debug?: RayDebugOpts;
  /** Only castRayFromAngle: the local axis rotated by the angle, default FORWARD */
  directionForAngle?: keyof typeof DIRECTIONS;
};

// Shared by every cast, made on the first (C1: a build that never casts leaves Raycaster out).
// castPrepared restores its near/far after each cast.
let sharedRaycaster: THREE.Raycaster | undefined;
const getRaycaster = () => (sharedRaycaster ??= new THREE.Raycaster());
const scratchDirection = new THREE.Vector3();
const screenPos = new THREE.Vector2();

/**
 * Wires up the debug side: the Ray cast controls tab (a no-op outside debug). Called once by
 * the main loop init.
 * @internal
 */
export const initRayCasting = () => {
  useDebug(debugGUI)?._initRayCastingDebugger();
};

/** Intersects the objects with the already positioned raycaster. Every cast funnels through here. */
const castPrepared = <TIntersected extends THREE.Object3D>(
  objects: THREE.Object3D | THREE.Object3D[],
  opts: RayCastOpts<TIntersected> | undefined,
  defaultFar: number
): Array<THREE.Intersection<TIntersected>> => {
  const far = opts?.far ?? defaultFar;
  const target = opts?.target;
  const perIntersect = opts?.perIntersect;
  const recursive = opts?.recursive ?? true;

  const raycaster = getRaycaster();
  let intersects: Array<THREE.Intersection<TIntersected>>;
  raycaster.near = opts?.near ?? 0;
  raycaster.far = far;
  try {
    if (target) target.length = 0;
    intersects = Array.isArray(objects)
      ? raycaster.intersectObjects(objects, recursive, target)
      : raycaster.intersectObject(objects, recursive, target);
  } finally {
    raycaster.near = 0;
    raycaster.far = Infinity;
  }

  if (perIntersect) {
    for (let i = 0; i < intersects.length; i++) {
      if (perIntersect(intersects[i]) === false) break;
    }
  }
  if (statsEnabled && opts?.countInStats !== false) stats?.add();
  // Every cast, with or without debug options: rays without an id are drawn when the Three.js
  // helpers show anonymous rays
  const helpers = useDebug(rayHelpers);
  if (helpers) {
    helpers._drawRay(
      'THREE',
      raycaster.ray.origin,
      raycaster.ray.direction,
      far,
      intersects.length ? intersects[0].distance : null,
      opts?.debug,
      performance.now()
    );
  }
  return intersects;
};

/**
 * Casts a ray from an origin in a direction.
 * @internal
 * @param objects the object or objects to test against
 * @param direction normalized
 * @returns the hits, closest first (`opts.target` when given)
 */
export const castRayFromDirection = <TIntersected extends THREE.Object3D = THREE.Object3D>(
  objects: THREE.Object3D | THREE.Object3D[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  opts?: RayCastOpts<TIntersected>
): Array<THREE.Intersection<TIntersected>> => {
  getRaycaster().set(origin, direction);
  return castPrepared(objects, opts, Infinity);
};

/**
 * Casts a ray from a point to another point: only hits between them are returned (`far`
 * defaults to the from→to distance). For a direction, {@link castRayFromDirection}.
 * @internal
 * @param objects the object or objects to test against
 * @param from the ray's origin
 * @param to the ray's end point
 * @returns the hits, closest first (`opts.target` when given)
 */
export const castRayFromPoints = <TIntersected extends THREE.Object3D = THREE.Object3D>(
  objects: THREE.Object3D | THREE.Object3D[],
  from: THREE.Vector3,
  to: THREE.Vector3,
  opts?: RayCastOpts<TIntersected>
): Array<THREE.Intersection<TIntersected>> => {
  const distance = from.distanceTo(to);
  getRaycaster().set(from, scratchDirection.subVectors(to, from).normalize());
  return castPrepared(objects, opts, distance);
};

/**
 * Casts a ray from an origin in the direction of an angle: `opts.directionForAngle` (default
 * FORWARD, -Z) rotated by the angle.
 * @internal
 * @param objects the object or objects to test against
 * @param from the ray's origin
 * @param angle the rotation applied to the direction
 * @returns the hits, closest first (`opts.target` when given)
 */
export const castRayFromAngle = <TIntersected extends THREE.Object3D = THREE.Object3D>(
  objects: THREE.Object3D | THREE.Object3D[],
  from: THREE.Vector3,
  angle: THREE.Euler | THREE.Quaternion,
  opts?: RayCastOpts<TIntersected>
): Array<THREE.Intersection<TIntersected>> => {
  scratchDirection.copy(DIRECTIONS[opts?.directionForAngle || 'FORWARD']);
  if ('isEuler' in angle) {
    scratchDirection.applyEuler(angle).normalize();
  } else {
    scratchDirection.applyQuaternion(angle).normalize();
  }
  getRaycaster().set(from, scratchDirection);
  return castPrepared(objects, opts, Infinity);
};

/**
 * Casts a ray from a screen position through the camera (picking), e.g. for mouse/touch input.
 * `opts.directionForAngle` is ignored.
 * @internal
 * @param objects the object or objects to test against
 * @param ndcX the normalized device x, -1 (left) to 1 (right)
 * @param ndcY the normalized device y, -1 (bottom) to 1 (top)
 * @param camera the camera the screen position is relative to (usually the one rendering)
 * @returns the hits, closest first (`opts.target` when given)
 */
export const castRayFromScreenPosition = <TIntersected extends THREE.Object3D = THREE.Object3D>(
  objects: THREE.Object3D | THREE.Object3D[],
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
  opts?: RayCastOpts<TIntersected>
): Array<THREE.Intersection<TIntersected>> => {
  getRaycaster().setFromCamera(screenPos.set(ndcX, ndcY), camera);
  return castPrepared(objects, opts, Infinity);
};

// Stats

// Ray cast statistics windows (per rendered frame), made when first enabled or read: only the
// debug tools do either, so a production build leaves IntervalCounterStats out
let stats: IntervalCounterStats | undefined;
const getStats = () => (stats ??= new IntervalCounterStats(RAY_STATS_WINDOWS));
let statsEnabled = false;

/**
 * Enables or disables the ray cast statistics. Enabling resets them. While disabled, a cast
 * costs one boolean check and nothing is counted.
 * @internal
 */
export const setRayCastStatsEnabled = (enabled: boolean) => {
  if (enabled && !statsEnabled) getStats().reset();
  statsEnabled = enabled;
};

/**
 * Whether the ray cast statistics are enabled.
 * @internal
 */
export const isRayCastStatsEnabled = () => statsEnabled;

/**
 * The ray cast statistics: rays cast per rendered frame (the last frame, the max ever and the
 * min/max/average of rolling intervals). Casts made on frames the FPS limiter skips count toward
 * the next rendered frame.
 *
 * The returned object is the same on every call and is updated in place every rendered frame,
 * so polling it allocates nothing. Copy the values out to keep them.
 * @internal
 */
export const getRayCastStats = (): Readonly<IntervalCounterSnapshot> => getStats().snapshot();

/**
 * Resets the ray cast statistics. The scene loader calls it on every scene enter.
 * @internal
 */
export const resetRayCastStats = () => {
  stats?.reset();
};

/** Once per rendered frame (LATE_MAIN, after rendering): ends the stats frame, then runs the
 * debug helpers' update pass (hold, fade out, recycle). */
const rayCastFrameEndSystem = () => {
  const helpers = useDebug(rayHelpers);
  if (!statsEnabled && !helpers) return;
  const now = performance.now();
  if (statsEnabled) stats?.endFrame(now);
  helpers?._updateRayHelpers(now);
};

/**
 * Installs ray casting (the kernel, p607): the system that ends the ray stats frame.
 * @internal
 */
export const installRaycast = (ctx: FeatureContext) => {
  ctx.registerPlugin((world) => {
    // Only the default world: LATE_MAIN runs once per world, and a frame must end only once
    if (world.id !== DEFAULT_ECS_WORLD_ID) return;
    world.addSystem(
      ECSSystemStage.LATE_MAIN,
      'rayCastFrameEndSystem',
      rayCastFrameEndSystem,
      -1000
    );
  });
};

// Debug
type RaycastGUIModule = typeof import('./debug/_dbg__Raycast');
type RayHelpersModule = typeof import('./debug/_dbg__RayHelpers');
let debugGUI: DebugModuleRef<RaycastGUIModule> | null = null;
let rayHelpers: DebugModuleRef<RayHelpersModule> | null = null;

/**
 * Loads the ray cast debug modules: the tab and the helper renderer (debug env only).
 * @internal
 */
export const registerRaycastDebugGUI = async () => {
  [debugGUI, rayHelpers] = await Promise.all([
    loadDebugModuleAsync(() => import('./debug/_dbg__Raycast')),
    loadDebugModuleAsync(() => import('./debug/_dbg__RayHelpers')),
  ]);
};

/**
 * Hides every ray debug helper (they are pooled, not disposed). The scene loader calls it on
 * every scene exit.
 * @internal
 */
export const deleteAllRayHelpers = () => {
  useDebug(rayHelpers)?._clearRayHelpers();
};
