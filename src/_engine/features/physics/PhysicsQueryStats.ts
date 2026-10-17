// The physics query statistics and ray helpers (p142).

import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { loadDebugModule, useDebug } from '../../kernel/config/DebugModules';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { RAY_STATS_WINDOWS, RAY_TESTER_ID_PREFIX } from '../../kernel/render/RayDebugTypes';
import { IntervalCounterStats } from '../../utils/IntervalCounterStats';
import type { IntervalCounterSnapshot } from '../../utils/IntervalCounterStats';
import { readStatsClock } from '../../utils/StatsClock';
import { facade } from './PhysicsState';
import type { PhysicsQueryObserver } from './types/PhysicsQueryTypes';

// Physics queries are counted and drawn by a query observer. It is installed only while the
// stats or the physics ray helpers are on, so a query costs one null check otherwise.
// MAIN_THREAD: the engine backend calls it (engAPI.setQueryObserver). WORKER_THREAD:
// WorldProxyAPI calls it.

/**
 * Physics query statistics, per rendered frame (see {@link getPhysicsRayStats}).
 * @internal
 */
export type PhysicsRayStats = {
  /** CAST_RAY + CAST_RAY_AND_GET_NORMAL + INTERSECTIONS_WITH_RAY queries */
  rays: Readonly<IntervalCounterSnapshot>;
  /** CAST_SHAPE queries */
  shapeCasts: Readonly<IntervalCounterSnapshot>;
  /** Queries issued but not answered yet (WORKER_THREAD; always 0 on MAIN_THREAD). A number
   * that keeps growing means worker replies are piling up or never arriving. */
  pendingQueries: number;
};

const physicsRaysStats = new IntervalCounterStats(RAY_STATS_WINDOWS);
const physicsShapeCastsStats = new IntervalCounterStats(RAY_STATS_WINDOWS);
const physicsRayStats: PhysicsRayStats = {
  rays: physicsRaysStats.snapshot(),
  shapeCasts: physicsShapeCastsStats.snapshot(),
  pendingQueries: 0,
};
let physicsRayStatsEnabled = false;
/** Debug only: the physics kind's "Show helpers" setting (Ray cast controls tab) */
let physicsRayHelpersEnabled = false;
type RayHelpersModule = typeof import('../../kernel/render/debug/_dbg__RayHelpers');
let rayHelpers: DebugModuleRef<RayHelpersModule> | null = null;

/**
 * Counts queries at issue time, so a frame's count includes every sub-step's queries, and
 * draws each one as a `'PHYSICS'` ray helper right away, even in WORKER_THREAD mode. The
 * helper runs to maxToi until the result sets its hit: in the same call on MAIN_THREAD, about
 * a frame later on WORKER_THREAD.
 *
 * The helper gets the query's own `dir`, not a normalized one: its lengths are then tois, and
 * `origin + dir * toi` is the exact hit point for any `|dir|`. (Only the helpers'
 * maxHelperLength cap on misses is in `|dir|` units then.)
 */
const physicsQueryObserver: PhysicsQueryObserver = {
  onQuery: (kind, origin, dir, maxToi, debug) => {
    // The ray tester windows' queries are drawn, never counted (RAY_TESTER_ID_PREFIX)
    const isCounted = physicsRayStatsEnabled && !debug?.id.startsWith(RAY_TESTER_ID_PREFIX);
    if (isCounted) {
      if (kind === 'CAST_SHAPE') physicsShapeCastsStats.add();
      else physicsRaysStats.add();
      physicsRayStats.pendingQueries++;
    }
    let helperToken = 0;
    if (physicsRayHelpersEnabled) {
      const helpers = useDebug(rayHelpers);
      if (helpers) {
        helperToken = helpers._drawRay(
          'PHYSICS',
          origin,
          dir,
          maxToi,
          null,
          debug,
          readStatsClock()
        );
      }
    }
    // The token's lowest bit tells onResult whether this query was counted as pending
    return helperToken * 2 + (isCounted ? 1 : 0);
  },
  onResult: (token, firstHitToi) => {
    // Clamped: a reply to a query issued before the last reset has nothing to subtract from
    if (token % 2 === 1 && physicsRayStats.pendingQueries > 0) physicsRayStats.pendingQueries--;
    // A no-op when the helper has been cast again or recycled since
    const helperToken = Math.floor(token / 2);
    if (helperToken) useDebug(rayHelpers)?._updateRayHit(helperToken, firstHitToi);
  },
};

/** The installed query observer, null while nothing needs one. Read by WorldProxyAPI. */
let queryObserver: PhysicsQueryObserver | null = null;

/** Installs the query observer while anything needs it, removes it otherwise. */
const updateQueryObserver = () => {
  queryObserver = physicsRayStatsEnabled || physicsRayHelpersEnabled ? physicsQueryObserver : null;
  facade.engAPI?.setQueryObserver(queryObserver);
};

/**
 * Enables or disables the physics ray statistics. Enabling resets them. While disabled (and no
 * other query instrumentation is on) a query costs one null check and nothing is counted.
 * @internal
 */
export const setPhysicsRayStatsEnabled = (enabled: boolean) => {
  if (enabled && !physicsRayStatsEnabled) resetPhysicsRayStats();
  physicsRayStatsEnabled = enabled;
  updateQueryObserver();
};

/**
 * Whether the physics ray statistics are enabled.
 * @internal
 */
export const isPhysicsRayStatsEnabled = () => physicsRayStatsEnabled;

/**
 * Debug only (a no-op outside the debug env): whether physics queries are drawn as `'PHYSICS'`
 * ray helpers. The Ray cast controls tab calls it with the physics helpers' "Show helpers"
 * setting; the helpers' look is set there too.
 * @internal
 */
export const setPhysicsRayHelpersEnabled = (enabled: boolean) => {
  physicsRayHelpersEnabled = enabled && IS_DEBUG_ENV;
  if (physicsRayHelpersEnabled && !rayHelpers) {
    rayHelpers = loadDebugModule(
      () => import('../../kernel/render/debug/_dbg__RayHelpers'),
      'RayHelpers'
    );
  }
  updateQueryObserver();
};

/**
 * The physics query statistics: queries issued per rendered frame (the last frame, the max ever
 * and the min/max/average of rolling intervals), rays and shape casts separately, plus the
 * queries still waiting for a worker reply. Counted when issued, so queries issued in
 * `APP_PHYSICS_STEP` count once per sub-step.
 *
 * The returned object is the same on every call and is updated in place, so polling it
 * allocates nothing. Copy the values out to keep them.
 * @internal
 */
export const getPhysicsRayStats = (): Readonly<PhysicsRayStats> => physicsRayStats;

/**
 * Resets the physics ray statistics. Physics' scene hooks call it on every scene enter.
 * @internal
 */
export const resetPhysicsRayStats = () => {
  const now = readStatsClock();
  physicsRaysStats.reset(now);
  physicsShapeCastsStats.reset(now);
  physicsRayStats.pendingQueries = 0;
};

/** Ends the physics ray stats frame. PhysicsEntity.ts' LATE_MAIN system calls it once per
 * rendered frame.
 * @internal
 */
export const endPhysicsRayStatsFrame = (nowMs: number) => {
  if (!physicsRayStatsEnabled) return;
  physicsRaysStats.endFrame(nowMs);
  physicsShapeCastsStats.endFrame(nowMs);
};

/**
 * The installed query observer, null while nothing needs one: the backend's (initPhysics) and
 * WorldProxyAPI's.
 * @internal
 */
export const getPhysicsQueryObserver = () => queryObserver;
