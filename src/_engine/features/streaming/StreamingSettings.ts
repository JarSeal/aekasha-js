// The streaming settings' defaults and checks (p353 §2), without zod: the runtime reads these, and
// StreamingSchema.ts builds the scene field's schema on them, so a build ships no schema code.
import type { SceneStreamingSettings } from './StreamingSchema';

/**
 * The smallest streaming cell size, in metres: a cell is a power of two of at least this, so
 * p306's terrain blocks (32-256 m) tile it exactly.
 */
export const STREAMING_MIN_CELL_SIZE = 32;

/**
 * The rings a scene's `streaming` leaves out: the outermost ring (Chebyshev distance in cells from
 * the focus cell) of each loaded state. A cell beyond `far` is unloaded.
 */
export const DEFAULT_STREAMING_RINGS = { resident: 1, nearby: 2, far: 5 } as const;

/**
 * The physics tiers a `NEARBY` cell's dynamic bodies can have (p353 Phase 4 D7), the first the
 * default: `STATIC` still collides (something can reach it), `DISABLED` keeps its velocities.
 */
export const STREAMING_NEARBY_PHYSICS_TIERS = ['STATIC', 'DISABLED'] as const;

/**
 * Whether `size` can be a streaming cell size: a power of two of at least
 * {@link STREAMING_MIN_CELL_SIZE}.
 * @internal
 */
export const isStreamingCellSize = (size: number) =>
  size >= STREAMING_MIN_CELL_SIZE && Number.isInteger(Math.log2(size));

/**
 * A scene's streaming settings with every default applied (`resolveStreamingSettings`).
 * @internal
 */
export type ResolvedStreamingSettings = {
  /** The cell side in metres. */
  cellSize: number;
  /** `1 / cellSize`, for `worldToCell`. */
  invCellSize: number;
  /** Each loaded state's outermost ring, by level: `[RESIDENT, NEARBY, FAR]`. */
  rings: readonly [number, number, number];
  /** Metres past a ring before a cell is demoted. */
  margin: number;
  /** The physics tier of a `NEARBY` cell's dynamic bodies. */
  nearbyPhysicsTier: 'STATIC' | 'DISABLED';
};

/**
 * What's wrong with a scene's streaming settings, or null when nothing is: the scene field's
 * schema and `setSceneStreamingSettings` check the same.
 * @internal
 */
export const getStreamingSettingsProblem = (settings: SceneStreamingSettings): string | null => {
  if (!isStreamingCellSize(settings.cellSize)) {
    return `streaming.cellSize must be a power of two of at least ${STREAMING_MIN_CELL_SIZE} (got ${settings.cellSize}).`;
  }
  const resident = settings.rings?.resident ?? DEFAULT_STREAMING_RINGS.resident;
  const nearby = settings.rings?.nearby ?? DEFAULT_STREAMING_RINGS.nearby;
  const far = settings.rings?.far ?? DEFAULT_STREAMING_RINGS.far;
  for (const ring of [resident, nearby, far]) {
    if (!Number.isInteger(ring) || ring < 0) {
      return `streaming.rings must be whole numbers of 0 or more (got ${resident}, ${nearby}, ${far}).`;
    }
  }
  if (resident > nearby || nearby > far) {
    return `streaming.rings must be resident <= nearby <= far (with the defaults: ${resident}, ${nearby}, ${far}).`;
  }
  if (settings.margin !== undefined && !(settings.margin >= 0)) {
    return `streaming.margin must be 0 or more (got ${settings.margin}).`;
  }
  const tier = settings.nearbyPhysicsTier;
  if (tier !== undefined && !STREAMING_NEARBY_PHYSICS_TIERS.includes(tier)) {
    return `streaming.nearbyPhysicsTier must be STATIC or DISABLED (got ${String(tier)}).`;
  }
  return null;
};

/**
 * A scene's streaming settings with the defaults applied (rings 1, 2, 5; `margin` a quarter of a
 * cell; `NEARBY` bodies `STATIC`). Expects settings `getStreamingSettingsProblem` passes.
 * @internal
 */
export const resolveStreamingSettings = (
  settings: SceneStreamingSettings
): ResolvedStreamingSettings => ({
  cellSize: settings.cellSize,
  invCellSize: 1 / settings.cellSize,
  rings: [
    settings.rings?.resident ?? DEFAULT_STREAMING_RINGS.resident,
    settings.rings?.nearby ?? DEFAULT_STREAMING_RINGS.nearby,
    settings.rings?.far ?? DEFAULT_STREAMING_RINGS.far,
  ],
  margin: settings.margin ?? settings.cellSize / 4,
  nearbyPhysicsTier: settings.nearbyPhysicsTier ?? STREAMING_NEARBY_PHYSICS_TIERS[0],
});
