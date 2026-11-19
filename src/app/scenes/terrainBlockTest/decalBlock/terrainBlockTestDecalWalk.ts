import { ECSSystemStage, getECSWorld, getRandomStream } from 'aekasha';
import { getPhysicsSimClock } from 'aekasha/physics';
import { getTerrainBlock } from 'aekasha/terrain';
import type { TerrainBlock } from 'aekasha/terrain';
import { createDecalPool, createDecalTrail, spawnDecal } from 'aekasha/toolkit/terrain';
import type { DecalPool, DecalTrail } from 'aekasha/toolkit/terrain';

// p309 Phase 4's check (section 5): runtime decals on the decal block. A walker (a point, not a
// character: no scene with blocks has one) goes round a seeded loop over the ridge, stamping a
// footprint every stride, left and right of its path, into a pool of 128 (`spawnDecal`: the FIFO
// takes the oldest once it's full, its oldest eighth fading out); a cart on a smaller loop leaves
// two wheel tracks (`createDecalTrail`, `tireTracks`, 1.7 m apart as the Blender tracks beside
// them) in a second pool, each segment fading out 30 s after it's stamped. Both are driven by the
// fixed-step clock (`getPhysicsSimClock`): a decal's place is a function of the step it's stamped
// at, never of the frame timing, so the scene runner's snapshot shows the same decals each run
// (the FIFO's fades are by place; no lifetime ends within its 360 steps). Visual only: the loops'
// shapes come from the named stream `terrainBlockTestWalk`, which every load restarts.
//
// URL parameters: `?tbtDecals=blend|cutout|off` (the footprints' material; default blend, the
// `JOIN` transparent path), `?tbtDecalRate=<footprints a second>` (default 2, a 1.4 m/s walk;
// the cart keeps its speed in step: the 10-minute buffer churn's 60 makes it a fast drive),
// `?tbtDecalFifoFade=<decals>` (both pools' `fifoFade`, default theirs: the bench's GPU profile
// without the FIFO's colour writes).
// `terrainBlockTestDecals` (the scene's window global's `decals`) has the pools and the counts.

const STREAM = 'terrainBlockTestWalk';
const SYSTEM_ID = 'terrainBlockTestDecalWalk';
/** `CONFIG.ts`' fixed steps a second (the clock counts steps) */
const STEPS_PER_SECOND = 60;
/** Metres between a foot's print and the other's */
const STRIDE = 0.7;
/** A print's centre off the path, metres */
const FOOT_OFFSET = 0.13;
/** Footprints a second by default: a 1.4 m/s walk */
const DEFAULT_RATE = 1.4 / STRIDE;
/** The cart's speed against the walker's */
const CART_SPEED_SHARE = 2;
/** The wheels' gauge (the Blender tracks': 2 × 0.85 m) */
const GAUGE = 1.7;
/** Metres of the cart's path between its wheels' points */
const TRAIL_SAMPLE = 0.25;
/** A path's integration step, metres */
const PATH_STEP = 0.05;
/** Decals a frame at most (a stalled frame doesn't burst; the backlog goes on next frame) */
const MAX_SPAWNS_PER_FRAME = 8;
const TRACK_LIFETIME_SEC = 30;
const TRACK_FADE_SEC = 5;

export type DecalWalkMode = 'BLEND' | 'CUTOUT' | 'OFF';

/** The walk's settings: `mode` from the URL at each load, `rate` and `isPaused` live (the tab) */
export const decalWalkSettings = {
  mode: 'BLEND' as DecalWalkMode,
  /** Footprints a second */
  rate: DEFAULT_RATE,
  isPaused: false,
  /** Both pools' `fifoFade` (undefined: the pools' default) */
  fifoFade: undefined as number | undefined,
};

/** A closed loop around the block's centre: radii, a seeded wobble, and where along it a mover is */
type Loop = {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  wobble: number;
  wobblePhase: number;
  /** The mover's angle and the metres it went */
  angle: number;
  meters: number;
};

/** A point on a loop and its unit direction, reused */
type PathPoint = { x: number; z: number; dx: number; dz: number };

/** What the walk made, for the tab and the bench (the scene's window global's `decals`) */
export type DecalWalkState = {
  footprints: DecalPool | null;
  tracks: DecalPool | null;
  /** Footprints and track segments stamped */
  footprintsSpawned: number;
  segmentsSpawned: number;
  /** The walker's place at its last footprint */
  walker: PathPoint;
  /** Called every frame the walk runs, after its spawns (the tab's camera follow) */
  onWalkFrame: ((walker: Readonly<PathPoint>) => void) | null;
};

export const decalWalkState: DecalWalkState = {
  footprints: null,
  tracks: null,
  footprintsSpawned: 0,
  segmentsSpawned: 0,
  walker: { x: 0, z: 0, dx: 1, dz: 0 },
  onWalkFrame: null,
};

/** Reads `?tbtDecals`, `?tbtDecalRate` and `?tbtDecalFifoFade` */
const readSettings = (params: URLSearchParams) => {
  const mode = params.get('tbtDecals')?.toUpperCase();
  decalWalkSettings.mode = mode === 'CUTOUT' || mode === 'OFF' ? mode : 'BLEND';
  const rate = Number(params.get('tbtDecalRate'));
  decalWalkSettings.rate = rate > 0 ? Math.min(rate, 240) : DEFAULT_RATE;
  decalWalkSettings.isPaused = false;
  const fifoFade = params.get('tbtDecalFifoFade');
  decalWalkSettings.fifoFade =
    fifoFade !== null && Number(fifoFade) >= 0 ? Number(fifoFade) : undefined;
};

const createLoop = (cx: number, cz: number, radius: number, random: () => number): Loop => ({
  cx,
  cz,
  rx: radius * (0.85 + 0.15 * random()),
  rz: radius * (0.85 + 0.15 * random()),
  wobble: radius * 0.12 * random(),
  wobblePhase: random() * Math.PI * 2,
  angle: random() * Math.PI * 2,
  meters: 0,
});

/** The loop's point and direction at `angle` into `out` (the wobble a third harmonic) */
const pointAt = (loop: Loop, angle: number, out: PathPoint) => {
  const w = 3 * angle + loop.wobblePhase;
  out.x = loop.cx + (loop.rx + loop.wobble * Math.sin(w)) * Math.cos(angle);
  out.z = loop.cz + (loop.rz + loop.wobble * Math.sin(w)) * Math.sin(angle);
  const dr = 3 * loop.wobble * Math.cos(w);
  const dx = dr * Math.cos(angle) - (loop.rx + loop.wobble * Math.sin(w)) * Math.sin(angle);
  const dz = dr * Math.sin(angle) + (loop.rz + loop.wobble * Math.sin(w)) * Math.cos(angle);
  const length = Math.hypot(dx, dz) || 1;
  out.dx = dx / length;
  out.dz = dz / length;
  return out;
};

/** Moves the loop's mover on to `meters` along it, in `PATH_STEP`s; its point into `out` */
const advanceTo = (loop: Loop, meters: number, out: PathPoint) => {
  pointAt(loop, loop.angle, out);
  while (loop.meters + PATH_STEP <= meters) {
    const w = 3 * loop.angle + loop.wobblePhase;
    const r = Math.max(loop.rx, loop.rz) + loop.wobble * Math.sin(w);
    // An angle step of about PATH_STEP metres, then the metres it really was
    const next = loop.angle + PATH_STEP / r;
    const x = out.x;
    const z = out.z;
    pointAt(loop, next, out);
    loop.meters += Math.hypot(out.x - x, out.z - z);
    loop.angle = next;
  }
  return out;
};

/**
 * Starts the walk on the decal block: its two pools, the walker and the cart, and their system.
 * @returns the stop, for the scene's exit (which deletes the pools anyway)
 */
export const startDecalWalk = (block: TerrainBlock) => {
  readSettings(new URLSearchParams(window.location.search));
  const state = decalWalkState;
  state.footprints = null;
  state.tracks = null;
  state.footprintsSpawned = 0;
  state.segmentsSpawned = 0;
  const grid = getTerrainBlock(block.id)?.grid;
  if (decalWalkSettings.mode === 'OFF' || !grid) return () => {};

  const cx = grid.x * grid.size;
  const cz = grid.z * grid.size;
  const half = grid.size / 2;
  const random = getRandomStream(STREAM);
  const walkerLoop = createLoop(cx, cz, half * 0.72, random);
  const cartLoop = createLoop(cx, cz, half * 0.45, random);

  state.footprints = createDecalPool({
    id: 'terrainBlockTestFootprints',
    material: decalWalkSettings.mode === 'CUTOUT' ? 'decalsGround_cutout' : 'decalsGround_blend',
    atlas: 'decalsGround',
    maxDecals: 128,
    fifoFade: decalWalkSettings.fifoFade,
  });
  state.tracks = createDecalPool({
    id: 'terrainBlockTestTracks',
    material: 'decalsGround_blend',
    atlas: 'decalsGround',
    maxDecals: 64,
    fifoFade: decalWalkSettings.fifoFade,
  });
  const trailOpts = {
    target: block,
    cell: 'tireTracks',
    lifetimeSec: TRACK_LIFETIME_SEC,
    fadeSec: TRACK_FADE_SEC,
  };
  const wheels: DecalTrail[] = [
    createDecalTrail(state.tracks, trailOpts),
    createDecalTrail(state.tracks, trailOpts),
  ];

  const walker = state.walker;
  const cart: PathPoint = { x: 0, z: 0, dx: 1, dz: 0 };
  /** Metres walked and the cart's sampled metres, by the steps run while not paused */
  let walked = 0;
  let cartSampled = 0;
  let lastStep = Math.floor(getPhysicsSimClock());
  let footIndex = 0;
  const world = getECSWorld();

  world.addSystem(ECSSystemStage.APP_LOGIC, SYSTEM_ID, () => {
    const footprints = state.footprints;
    const tracks = state.tracks;
    if (!footprints || !tracks || footprints.isDisposed()) return;
    const step = Math.floor(getPhysicsSimClock());
    if (!decalWalkSettings.isPaused) {
      walked += ((step - lastStep) * STRIDE * decalWalkSettings.rate) / STEPS_PER_SECOND;
    }
    lastStep = step;

    let spawns = 0;
    while ((footIndex + 1) * STRIDE <= walked && spawns < MAX_SPAWNS_PER_FRAME) {
      footIndex++;
      advanceTo(walkerLoop, footIndex * STRIDE, walker);
      // Left foot (−1) then right (+1): left of the heading seen from above is (dz, −dx)
      const side = footIndex % 2 === 0 ? -1 : 1;
      spawnDecal(footprints, {
        target: block,
        position: {
          x: walker.x - side * FOOT_OFFSET * walker.dz,
          z: walker.z + side * FOOT_OFFSET * walker.dx,
        },
        // v (the cell's top: the toe) along the heading
        rotation: Math.atan2(-walker.dx, -walker.dz),
        cell: 'footprintBoot',
      });
      state.footprintsSpawned++;
      spawns++;
    }

    const cartMeters = walked * CART_SPEED_SHARE;
    while (cartSampled + TRAIL_SAMPLE <= cartMeters && spawns < MAX_SPAWNS_PER_FRAME) {
      cartSampled += TRAIL_SAMPLE;
      advanceTo(cartLoop, cartSampled, cart);
      for (let i = 0; i < wheels.length; i++) {
        const side = i === 0 ? -1 : 1;
        const x = cart.x - (side * GAUGE * cart.dz) / 2;
        const z = cart.z + (side * GAUGE * cart.dx) / 2;
        if (wheels[i].addPoint(x, z) !== null) {
          state.segmentsSpawned++;
          spawns++;
        }
      }
    }
    state.onWalkFrame?.(walker);
  });
  return () => {
    world.removeSystem(SYSTEM_ID);
    state.footprints = null;
    state.tracks = null;
  };
};
