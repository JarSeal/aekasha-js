// Ribbon decals (p309 D4, Phase 4): strips along a path on a terrain block, eg. tyre tracks, drawn
// by a decal pool like its other decals (`RuntimeDecals.ts`), each ribbon one decal of the pool.
// `spawnRibbonDecal` stamps one path; `createDecalTrail` follows a moving point and stamps its path
// in segments as it grows, each joined to the last (the same row at the joint, the cell's tiles
// running on), its first start and its last end faded, so a vehicle's track is a line of decals
// that the pool's lifetimes and FIFO fade out from the tail. The strip's geometry is
// `DecalRibbonPatch.ts`.
import { getMaterial, lwarn } from 'aekasha';
import type { TerrainBlock } from 'aekasha/terrain';
import { createFlatBlockSurface } from '../blocks/BlockSurface';
import { writeRibbonPatch } from './DecalRibbonPatch';
import type { DecalRibbonCounts, DecalRibbonSpec } from './DecalRibbonPatch';
import {
  createPlace,
  finishSpawn,
  getLiveState,
  pickCell,
  readDecalBlockTarget,
  releasePlace,
  takePlace,
} from './RuntimeDecals';
import type { DecalBlockTarget, DecalPool, PoolState, SpawnDecalOpts } from './RuntimeDecals';

const DEFAULTS = {
  /** Phase 3's offset: a ribbon's faces aren't the block's (see `DecalRibbonPatch.ts`) */
  lift: 0.015,
  endFadeMeters: 0.5,
  /** The decal material's own default, for a material whose `edgeFade` isn't a uniform */
  edgeShareU: 0.1,
  segmentLength: 2,
  minSpacing: 0.1,
};
const EPSILON = 1e-6;

/** What and where {@link spawnRibbonDecal} stamps: {@link SpawnDecalOpts}' block, cell, look and lifetime, along a path. */
export type SpawnRibbonDecalOpts = Omit<
  SpawnDecalOpts,
  'position' | 'normal' | 'size' | 'rotation'
> & {
  /** The path in world space (x, z), on the block: it's cut at its first point off it. */
  points: readonly { x: number; z: number }[];
  /** Metres across (default the cell's `physicalSize` across, its v). */
  width?: number;
  /** Metres of path one tile of the cell covers (default its `physicalSize` along, scaled with the width). */
  tileLength?: number;
  /** Metres into a tile where the ribbon starts (default 0): a ribbon going on from another starts at that one's `along` + its length. */
  along?: number;
  /** Whether its start fades out over `endFadeMeters` (default true). */
  fadeStart?: boolean;
  /** Whether its end fades out over `endFadeMeters` (default true). */
  fadeEnd?: boolean;
  /** Metres its faded ends fade over (default 0.5). */
  endFadeMeters?: number;
  /** Metres it's lifted along the block's normal (default 0.015: its faces aren't the block's). */
  lift?: number;
};

/** How {@link createDecalTrail} stamps its segments: {@link SpawnRibbonDecalOpts} but the path, its tile phase and its ends. */
export type CreateDecalTrailOpts = Omit<
  SpawnRibbonDecalOpts,
  'points' | 'along' | 'fadeStart' | 'fadeEnd'
> & {
  /** Metres of path a segment holds before it's stamped (default 2): the track's lag behind the point. */
  segmentLength?: number;
  /** Metres a point must be from the last one to count (default 0.1). */
  minSpacing?: number;
};

/** A trail of ribbon decals behind a moving point ({@link createDecalTrail}). */
export type DecalTrail = {
  /** Adds the point's place (world x, z). Stamps a segment once `segmentLength` of path is in; a point off the block ends the track. Returns the segment's decal entity when one was stamped, else null. */
  addPoint: (x: number, z: number) => number | null;
  /** Stamps what's left of the path, its end faded, and starts over: the next point starts a new track. Returns its decal entity, or null when nothing was left. */
  end: () => number | null;
};

/** The ribbon's spec, counts and block, reused */
const ribbon: DecalRibbonSpec = {
  points: [],
  pointCount: 0,
  width: 1,
  tileLength: 1,
  along: 0,
  cellRect: [0, 0, 1, 1],
  lift: 0,
  step: 1,
  fadeStart: true,
  fadeEnd: true,
  endFadeMeters: 0,
  edgeShareU: 0,
  origin: { x: 0, z: 0 },
};
const ribbonCounts: DecalRibbonCounts = { vertexCount: 0, indexCount: 0, stride: 1, length: 0 };
const block: DecalBlockTarget = {
  surface: createFlatBlockSurface(1),
  originX: 0,
  originZ: 0,
  half: 0.5,
};

/** The pool material's edge fade along u (`decal_edgeFade`'s x), else the material's default */
const getEdgeShareU = (state: PoolState) => {
  const uniforms = getMaterial(state.material)?.userData.uniforms as
    | Record<string, { value?: { x?: unknown } } | undefined>
    | undefined;
  const share = uniforms?.decal_edgeFade?.value?.x;
  return typeof share === 'number' ? share : DEFAULTS.edgeShareU;
};

/** Stamps the ribbon `ribbon` holds (its points, `along`, ends and directions set by the caller) on
 * a block: its block, cell and sizes resolved, its patch written into a place; null for a path
 * off the block or without length (no place taken), or one too long for the pool's patches */
const stampRibbon = (
  state: PoolState,
  target: TerrainBlock,
  opts: Omit<CreateDecalTrailOpts, 'segmentLength' | 'minSpacing'>,
  where: string
) => {
  if (!readDecalBlockTarget(state, target, where, block)) return null;
  const { points } = ribbon;
  let count = 0;
  let length = 0;
  while (count < ribbon.pointCount) {
    const point = points[count];
    if (
      Math.abs(point.x - block.originX) > block.half ||
      Math.abs(point.z - block.originZ) > block.half
    ) {
      break;
    }
    if (count > 0)
      length += Math.hypot(point.x - points[count - 1].x, point.z - points[count - 1].z);
    count++;
  }
  ribbon.pointCount = count;
  if (count < 2 || length < EPSILON) return null;

  const cell = pickCell(state, opts.cell, where);
  const physical = cell.size;
  const width = opts.width ?? physical?.[1] ?? NaN;
  if (!(width > 0)) {
    throw new Error(
      `${where}: the ribbon of "${cell.id}" has no width over 0 (give it a width, or the cell a physicalSize).`
    );
  }
  const tileLength = opts.tileLength ?? (physical ? (width * physical[0]) / physical[1] : NaN);
  if (!(tileLength > 0)) {
    throw new Error(
      `${where}: the ribbon of "${cell.id}" has no tile length over 0 (give it a tileLength, or the cell a physicalSize).`
    );
  }
  const { surface } = block;
  ribbon.width = width;
  ribbon.tileLength = tileLength;
  ribbon.cellRect = cell.rect;
  ribbon.lift = opts.lift ?? DEFAULTS.lift;
  ribbon.endFadeMeters = opts.endFadeMeters ?? DEFAULTS.endFadeMeters;
  ribbon.edgeShareU = getEdgeShareU(state);
  ribbon.step = surface.size / (Math.max(surface.cols, surface.rows) - 1) / 2;
  ribbon.origin.x = block.originX;
  ribbon.origin.z = block.originZ;

  const index = takePlace(state);
  const place = state.places[index] ?? createPlace(state);
  writeRibbonPatch(surface, ribbon, place.arrays, ribbonCounts);
  if (!ribbonCounts.indexCount) {
    releasePlace(state, index);
    lwarn(
      `${where}: a ribbon ${length.toFixed(1)} m long doesn't fit the pool "${state.pool.id}"'s patches of ${state.maxPatchVertices} vertices: stamp it in shorter parts.`
    );
    return null;
  }
  if (ribbonCounts.stride > 1 && !state.isRibbonWarned) {
    state.isRibbonWarned = true;
    lwarn(
      `${where}: a ribbon ${length.toFixed(1)} m long has more rows than the pool "${state.pool.id}"'s maxPatchVertices (${state.maxPatchVertices}) hold: its steps are ${ribbonCounts.stride} times longer, further off the block (stamp shorter ribbons, or raise maxPatchVertices or the lift).`
    );
  }
  return finishSpawn(state, index, place, ribbonCounts, opts);
};

/**
 * Stamps a ribbon decal along a path on a terrain block (tyre tracks, a drag mark): a strip
 * `width` across with its cell repeating along it, every vertex on the block, its ends faded over
 * `endFadeMeters`, drawn by the pool's batch like its other decals. For a track behind a moving
 * point, {@link createDecalTrail} stamps it in joined segments.
 * @param pool the pool ({@link createDecalPool})
 * @param opts the block, the path, the cell and its tiling, the ends and the decal's look and lifetime
 * @returns the ribbon's decal entity, or `null` when the path's first two points aren't on the
 * block or it has no length, when it's too long for the pool's patches (warned) or the pool is gone
 * @throws for a block the scene doesn't list, a cell the atlas doesn't have (or isn't loaded), or
 * no width or tile length (none given, and the cell has no `physicalSize`)
 * @remarks A ribbon is cut at its first point off the block. Its rows are at most half the block's
 * grid spacing apart (and its columns as close), so a long ribbon needs many vertices: one past the
 * pool's `maxPatchVertices` takes longer steps (warned once a pool), further off the block. The
 * cell is v across the ribbon and u along it (`tileAlong: 'U'` cells, eg. `tireTracks`).
 * @example
 * ```ts
 * import { spawnRibbonDecal } from 'aekasha/toolkit/terrain';
 *
 * // A skid mark along a curve, gone after a minute
 * spawnRibbonDecal(tracks, {
 *   target: block,
 *   points: [{ x: 2, z: 0 }, { x: 4, z: 0.5 }, { x: 6, z: 1.6 }],
 *   cell: 'tireTracks',
 *   lifetimeSec: 60,
 * });
 * ```
 */
export const spawnRibbonDecal = (pool: DecalPool, opts: SpawnRibbonDecalOpts): number | null => {
  const where = 'spawnRibbonDecal';
  const state = getLiveState(pool, where);
  if (!state) return null;
  ribbon.points = opts.points;
  ribbon.pointCount = opts.points.length;
  ribbon.along = opts.along ?? 0;
  ribbon.fadeStart = opts.fadeStart ?? true;
  ribbon.fadeEnd = opts.fadeEnd ?? true;
  ribbon.startDirection = undefined;
  ribbon.endDirection = undefined;
  return stampRibbon(state, opts.target, opts, where);
};

/**
 * Makes a trail behind a moving point (a wheel, a sledge): each `addPoint` extends its path, and
 * every `segmentLength` metres of path become a ribbon decal of the pool, joined to the last one
 * (the same row at the joint, the cell's tiles running on), the track's start faded. `end()`
 * stamps the rest with its end faded. The pool's lifetimes and FIFO fade the track out from its
 * tail, segment by segment.
 * @param pool the pool ({@link createDecalPool})
 * @param opts the block, the cell, the segments' length and the decals' look and lifetime
 * @returns the trail's `addPoint` and `end`
 * @remarks `addPoint` allocates nothing (its points are kept in reused objects) but on a frame it
 * stamps a segment. The track lags the point by up to `segmentLength`. A trail stays on its
 * block: a point off it ends the track (make a trail per block to cross blocks). Once the pool is
 * gone (its scene left), the trail stamps nothing.
 * @example
 * ```ts
 * import { createDecalTrail } from 'aekasha/toolkit/terrain';
 *
 * // A wheel's track: a point each frame, each segment gone 30 s after it's stamped
 * const track = createDecalTrail(tracks, { target: block, cell: 'tireTracks', lifetimeSec: 30 });
 * export const onFrame = () => track.addPoint(wheel.x, wheel.z);
 * ```
 */
export const createDecalTrail = (pool: DecalPool, opts: CreateDecalTrailOpts): DecalTrail => {
  const where = 'createDecalTrail';
  const segmentLength = opts.segmentLength ?? DEFAULTS.segmentLength;
  const minSpacing = opts.minSpacing ?? DEFAULTS.minSpacing;
  /** The points of the segment being collected (`count` of them), reused */
  const points: { x: number; z: number }[] = [];
  let count = 0;
  let pending = 0;
  let along = 0;
  let isFirst = true;
  /** The last segment's end direction, the next one's start */
  const joint = { x: 1, z: 0 };
  /** The block's place and half side, read once: `addPoint` runs every frame */
  const state = getLiveState(pool, where);
  const area = state && readDecalBlockTarget(state, opts.target, where, block);
  const originX = area ? area.originX : 0;
  const originZ = area ? area.originZ : 0;
  const half = area ? area.half : -1;

  const stamp = (isEnd: boolean) => {
    if (!state || count < 2) return null;
    ribbon.points = points;
    ribbon.pointCount = count;
    ribbon.along = along;
    ribbon.fadeStart = isFirst;
    ribbon.fadeEnd = isEnd;
    ribbon.startDirection = isFirst ? undefined : joint;
    ribbon.endDirection = undefined;
    const entityId = stampRibbon(state, opts.target, opts, where);
    const last = points[count - 1];
    const before = points[count - 2];
    const span = Math.hypot(last.x - before.x, last.z - before.z) || 1;
    joint.x = (last.x - before.x) / span;
    joint.z = (last.z - before.z) / span;
    along += pending;
    isFirst = false;
    pending = 0;
    // The next segment starts at this one's last point
    points[0].x = last.x;
    points[0].z = last.z;
    count = 1;
    return entityId;
  };
  const restart = () => {
    count = 0;
    pending = 0;
    along = 0;
    isFirst = true;
  };
  const end = () => {
    const entityId = count >= 2 && !pool.isDisposed() ? stamp(true) : null;
    restart();
    return entityId;
  };

  return {
    addPoint: (x, z) => {
      // A pool that's gone (its scene left) stamps nothing, quietly: this runs every frame
      if (!area || pool.isDisposed()) return null;
      if (Math.abs(x - originX) > half || Math.abs(z - originZ) > half) return end();
      if (count > 0) {
        const last = points[count - 1];
        const step = Math.hypot(x - last.x, z - last.z);
        if (step < minSpacing) return null;
        pending += step;
      }
      if (count === points.length) points.push({ x, z });
      else {
        points[count].x = x;
        points[count].z = z;
      }
      count++;
      return pending >= segmentLength ? stamp(false) : null;
    },
    end,
  };
};
