import * as THREE from 'three/webgpu';
import { getLogger } from 'aekasha';

// A moving platform's path as a pure state machine: the points resolved once, the segment the
// platform is on, and its playback state. No physics: the factory (MovingPlatform.ts) writes what
// a step or a control changed to the rigid body.

/** The time to the next point when a point gives no `dur`, in ms. */
const DEFAULT_SEGMENT_DURATION = 3000;

/**
 * One point of a moving platform's path
 * ({@link toolkit/ecs/gameplay/movingPlatform/MovingPlatform!MovingPlatformParams}' `points`).
 */
export interface MovingPlatformPoint {
  /** The platform's position at the point, in world space. */
  pos: { x: number; y: number; z: number };
  /**
   * The platform's rotation at the point, a quaternion, normalized when read. A point without one
   * keeps the rotation of the point before it (point 0 without one: no rotation).
   */
  rot?: { x: number; y: number; z: number; w: number };
  /**
   * The time from this point to the next one in ms (default 3000); the last point's is the time
   * back to the first. 0 jumps there in one step.
   */
  dur?: number;
}

/**
 * How a moving platform plays its path: its loops, its direction and its speed. Given at creation
 * ({@link toolkit/ecs/gameplay/movingPlatform/MovingPlatform!MovingPlatformOptions}) or
 * changed later with {@link toolkit/ecs/gameplay/movingPlatform/MovingPlatform!MovingPlatformControls}'
 * `setOptions`.
 */
export interface MovingPlatformPathOptions {
  /**
   * How many times the path repeats after its first run: -1 (the default) forever, 0 once. A loop
   * ends each time the platform arrives at point 0, in either direction.
   */
  loopTimes?: number;
  /**
   * Which way the path runs (default `'FORWARD'`): in the points' order, or against it. A backward
   * segment takes the `dur` of the point it runs to (the time of the same edge forward).
   */
  direction?: 'FORWARD' | 'BACKWARD';
  /** Scales the speed of every segment, 1 by default; 0 holds the platform where it is. */
  speedMultiplier?: number;
}

/**
 * A path's state. The path is closed: after the last point it runs back to the first, and a loop
 * ends each time the platform arrives at point 0.
 * @internal
 */
export interface PlatformPath {
  /** Each point's position. */
  readonly positions: THREE.Vector3[];
  /** Each point's rotation, resolved (normalized, or the previous point's). */
  readonly rotations: THREE.Quaternion[];
  /** Each point's time to the next point, in seconds. */
  readonly durations: number[];
  /** Whether the platform moves on the next step. */
  isPlaying: boolean;
  /** Whether the last loop ended: the next play starts the loops over. */
  isEnded: boolean;
  /** 1 forward, -1 backward. */
  direction: 1 | -1;
  /** The loops after the first run: -1 forever. */
  loopTimes: number;
  /** The loops ended since the start, the last stop or the last end. */
  currentLoopCount: number;
  /** The segment `playSegment` plays, after which the platform stops; null for none. */
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
  /** The current segment's start position. */
  readonly fromPos: THREE.Vector3;
  /** The current segment's end position. */
  readonly toPos: THREE.Vector3;
  /** The current segment's start rotation. */
  readonly fromRot: THREE.Quaternion;
  /** The current segment's end rotation. */
  readonly toRot: THREE.Quaternion;
}

/**
 * What a step did: nothing (`IDLE`, not playing), moved along its segment (`MOVED`), arrived at
 * a point and started the next segment (`SEGMENT`), or arrived and stopped (`END`: the last loop
 * or `playSegment`'s segment ended).
 * @internal
 */
export type PlatformStepResult = 'IDLE' | 'MOVED' | 'SEGMENT' | 'END';

/**
 * Logs and throws a moving platform's creation error.
 * @internal
 */
function fail(id: string, reason: string): never {
  const msg = `Could not create moving platform "${id}": ${reason}.`;
  getLogger().error(msg);
  throw new Error(msg);
}

/**
 * Throws (and logs) when a moving platform's props can't make one: a shape without a mesh or a
 * geo, a geo without a mat, no physics params or a first one without a `POS_BASED` rigid body,
 * no points, a `dur` that isn't a finite number of 0 or more, or bad options.
 * @internal
 * @param props the platform's props, read structurally
 */
export const validateMovingPlatform = (props: {
  id: string;
  shape?: { geo?: unknown; mat?: unknown; mesh?: unknown };
  physicsParams: { rigidBody?: { rigidType?: string } } | { rigidBody?: { rigidType?: string } }[];
  points: MovingPlatformPoint[];
  opts?: MovingPlatformPathOptions;
}) => {
  const { id, shape, physicsParams, points, opts } = props;
  if (shape && !shape.mesh && !shape.geo) fail(id, 'a shape needs a mesh, or a geo and a mat');
  if (shape && !shape.mesh && !shape.mat) fail(id, 'a shape with a geo needs a mat');
  const first = Array.isArray(physicsParams) ? physicsParams[0] : physicsParams;
  if (!first) fail(id, 'physicsParams has no entry');
  if (first.rigidBody?.rigidType !== 'POS_BASED') {
    fail(id, 'the first physicsParams needs a rigidBody of rigidType "POS_BASED"');
  }
  if (!points.length) fail(id, 'points is empty');
  for (let i = 0; i < points.length; i++) {
    const dur = points[i].dur;
    if (dur !== undefined && !(Number.isFinite(dur) && dur >= 0)) {
      fail(id, `point ${i}'s dur (${dur}) isn't a finite number of 0 or more`);
    }
  }
  if (
    opts?.loopTimes !== undefined &&
    !(Number.isInteger(opts.loopTimes) && opts.loopTimes >= -1)
  ) {
    fail(id, `loopTimes (${opts.loopTimes}) isn't -1 or a whole number of 0 or more`);
  }
  const speed = opts?.speedMultiplier;
  if (speed !== undefined && !(Number.isFinite(speed) && speed >= 0)) {
    fail(id, `speedMultiplier (${speed}) isn't a finite number of 0 or more`);
  }
};

/**
 * Sets the segment from `curIndex` on: the next point in the direction, the poses at both ends
 * and the time (a backward segment runs the forward edge from its end point, so takes its `dur`).
 */
const updateSegment = (path: PlatformPath) => {
  const len = path.positions.length;
  const cur = path.curIndex;
  const next = path.direction === 1 ? (cur + 1) % len : (cur - 1 + len) % len;
  path.nextIndex = next;
  path.fromPos.copy(path.positions[cur]);
  path.toPos.copy(path.positions[next]);
  path.fromRot.copy(path.rotations[cur]);
  path.toRot.copy(path.rotations[next]);
  path.segmentDuration = path.durations[path.direction === 1 ? cur : next];
};

/**
 * Creates a path's state at point 0, its first segment set. The points aren't validated here
 * (`validateMovingPlatform`).
 * @internal
 * @param isPlaying whether the first step moves the platform
 */
export const createPlatformPath = (
  points: MovingPlatformPoint[],
  opts: MovingPlatformPathOptions = {},
  isPlaying = true
): PlatformPath => {
  const rotations: THREE.Quaternion[] = [];
  for (let i = 0; i < points.length; i++) {
    const rot = points[i].rot;
    if (rot) rotations.push(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w).normalize());
    else rotations.push(i === 0 ? new THREE.Quaternion() : rotations[i - 1].clone());
  }
  const path: PlatformPath = {
    positions: points.map(({ pos }) => new THREE.Vector3(pos.x, pos.y, pos.z)),
    rotations,
    durations: points.map(({ dur }) => (dur ?? DEFAULT_SEGMENT_DURATION) / 1000),
    isPlaying,
    isEnded: false,
    direction: opts.direction === 'BACKWARD' ? -1 : 1,
    loopTimes: opts.loopTimes ?? -1,
    currentLoopCount: 0,
    targetSegmentIndex: null,
    speedMultiplier: opts.speedMultiplier ?? 1,
    curIndex: 0,
    nextIndex: 0,
    t: 0,
    segmentDuration: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromRot: new THREE.Quaternion(),
    toRot: new THREE.Quaternion(),
  };
  updateSegment(path);
  return path;
};

/**
 * Whether some segment of the path, the one back to point 0 included, both moves and turns the
 * platform: a character riding it then sticks to it instead of sliding a bit.
 * @internal
 */
export const hasMoveAndTurn = (path: PlatformPath) => {
  const { positions, rotations } = path;
  const len = positions.length;
  if (len < 2) return false;
  for (let i = 0; i < len; i++) {
    const next = (i + 1) % len;
    if (!positions[i].equals(positions[next]) && !rotations[i].equals(rotations[next])) {
      return true;
    }
  }
  return false;
};

/**
 * Advances the path by `dt` seconds, writing the platform's pose at the new place into `outPos`
 * and `outRot` (untouched when it returns `IDLE`). A segment's end lands exactly on its point,
 * and the next step starts the next segment.
 * @internal
 */
export const stepPlatformPath = (
  path: PlatformPath,
  dt: number,
  outPos: THREE.Vector3,
  outRot: THREE.Quaternion
): PlatformStepResult => {
  if (!path.isPlaying) return 'IDLE';

  const duration = path.segmentDuration / path.speedMultiplier;
  if (duration > 0) path.t += dt / duration;
  // A dur: 0 segment jumps; 0 / 0 (a speed of 0 too) holds
  else if (duration === 0) path.t = 1;
  if (path.t > 1) path.t = 1;

  outPos.lerpVectors(path.fromPos, path.toPos, path.t);
  outRot.slerpQuaternions(path.fromRot, path.toRot, path.t);
  if (path.t !== 1) return 'MOVED';

  // Arrived at nextIndex: on to the segment from it
  const isTargetDone =
    path.targetSegmentIndex !== null && path.curIndex === path.targetSegmentIndex;
  const isLoopDone = path.nextIndex === 0;
  path.curIndex = path.nextIndex;
  path.t = 0;
  updateSegment(path);

  if (isTargetDone) {
    path.isPlaying = false;
    path.targetSegmentIndex = null;
    return 'END';
  }
  if (isLoopDone) {
    path.currentLoopCount++;
    if (path.loopTimes !== -1 && path.currentLoopCount > path.loopTimes) {
      path.isPlaying = false;
      path.isEnded = true;
      return 'END';
    }
  }
  return 'SEGMENT';
};

const isPointIndex = (path: PlatformPath, index: number) =>
  Number.isInteger(index) && index >= 0 && index < path.positions.length;

/** After the last loop ended, a play starts the loops over. */
const restartIfEnded = (path: PlatformPath) => {
  if (!path.isEnded) return;
  path.isEnded = false;
  path.currentLoopCount = 0;
};

/**
 * Plays the path on from where it is, or from the start of the segment at `fromIndex` (dropping
 * `playSegment`'s target); after the last loop ended, the loops start over.
 * @internal
 * @returns whether the platform moved to `fromIndex`'s segment (false for a missing or bad index)
 */
export const playPlatformPath = (path: PlatformPath, fromIndex?: number) => {
  restartIfEnded(path);
  path.isPlaying = true;
  if (fromIndex === undefined || !isPointIndex(path, fromIndex)) return false;
  path.curIndex = fromIndex;
  path.t = 0;
  path.targetSegmentIndex = null;
  updateSegment(path);
  return true;
};

/**
 * Plays the segment from point `index` alone, from its start, then stops.
 * @internal
 * @returns false for a bad index, which changes nothing
 */
export const playPlatformPathSegment = (path: PlatformPath, index: number) => {
  if (!isPointIndex(path, index)) return false;
  restartIfEnded(path);
  path.curIndex = index;
  path.t = 0;
  path.targetSegmentIndex = index;
  path.isPlaying = true;
  updateSegment(path);
  return true;
};

/**
 * Stops the path and puts it back at point 0: the loop count, `playSegment`'s target and the end
 * reset.
 * @internal
 */
export const stopPlatformPath = (path: PlatformPath) => {
  path.isPlaying = false;
  path.isEnded = false;
  path.currentLoopCount = 0;
  path.targetSegmentIndex = null;
  path.curIndex = 0;
  path.t = 0;
  updateSegment(path);
};

/**
 * Changes the loops, the direction or the speed. A direction change mid-segment turns the
 * platform round where it is: the segment runs back to the point it came from, at the same speed.
 * @internal
 */
export const setPlatformPathOptions = (path: PlatformPath, opts: MovingPlatformPathOptions) => {
  if (opts.loopTimes !== undefined) path.loopTimes = opts.loopTimes;
  if (opts.speedMultiplier !== undefined) path.speedMultiplier = opts.speedMultiplier;
  if (!opts.direction) return;
  const direction = opts.direction === 'BACKWARD' ? -1 : 1;
  if (direction === path.direction) return;
  path.direction = direction;
  if (path.t > 0) {
    // The same edge the other way round: from the old end point, as far along as there's left
    path.curIndex = path.nextIndex;
    path.t = 1 - path.t;
  }
  updateSegment(path);
};
