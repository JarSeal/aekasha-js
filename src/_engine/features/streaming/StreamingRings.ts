// The streaming rings' maths (p353 §2): a cell's level from its ring around the focus cell, with
// asymmetric thresholds. Pure: the state machine (StreamingCells.ts) and its tests call it.
import type { ResolvedStreamingSettings } from './StreamingSettings';

/**
 * A cell's level: what its content is (p353 §2's table), from the nearest to the focus.
 * `UNLOADED` is past the last ring.
 * @internal
 */
export const StreamingLevel = {
  RESIDENT: 0,
  NEARBY: 1,
  FAR: 2,
  UNLOADED: 3,
} as const;

/**
 * One of {@link StreamingLevel}'s values.
 * @internal
 */
export type StreamingLevel = (typeof StreamingLevel)[keyof typeof StreamingLevel];

/**
 * The deepest level whose cells have content loaded: `FAR`, whose cells hold their far and kept
 * layers (p353 Phase 5 D1).
 * @internal
 */
export const DEEPEST_LOADED_LEVEL = StreamingLevel.FAR;

/**
 * Whether a cell of `level` has its content loaded.
 * @internal
 */
export const isLoadedLevel = (level: StreamingLevel) => level <= DEEPEST_LOADED_LEVEL;

/**
 * The Chebyshev distance in metres from a point to a cell's square (0 inside it): the larger of
 * the gaps along x and z. A demotion measures from the focus to the cell's edge with it.
 * @internal
 */
export const getCellEdgeDistance = (
  cx: number,
  cz: number,
  cellSize: number,
  x: number,
  z: number
) => {
  const minX = cx * cellSize;
  const minZ = cz * cellSize;
  const gapX = Math.max(minX - x, 0, x - (minX + cellSize));
  const gapZ = Math.max(minZ - z, 0, z - (minZ + cellSize));
  return gapX > gapZ ? gapX : gapZ;
};

/**
 * A cell's next level from its current one (`prev`), its ring (Chebyshev distance in cells from
 * the focus cell) and `edgeDistance` (`getCellEdgeDistance` from the focus).
 *
 * A cell is promoted to the nearest level whose ring holds it (`ring <= rings[level]`). It's
 * demoted only once the focus is more than `rings[level] × cellSize + margin` from its edge: a
 * cell in ring `r` is within `r × cellSize` of the focus, so `margin` is the band past the ring
 * where it keeps its level, and a focus on a boundary never thrashes. A demotion goes to the
 * nearest level that would still keep it.
 * @internal
 */
export const decideStreamingLevel = (
  prev: StreamingLevel,
  ring: number,
  edgeDistance: number,
  settings: ResolvedStreamingSettings
): StreamingLevel => {
  const { rings, cellSize, margin } = settings;
  let promoted: StreamingLevel = StreamingLevel.UNLOADED;
  for (let level = 0; level < rings.length; level++) {
    if (ring <= rings[level]) {
      promoted = level as StreamingLevel;
      break;
    }
  }
  if (promoted <= prev) return promoted;
  for (let level: number = prev; level < rings.length; level++) {
    if (edgeDistance <= rings[level] * cellSize + margin) return level as StreamingLevel;
  }
  return StreamingLevel.UNLOADED;
};
