// The brute-force oracle (docs/plans/_DONE_p050_spatial-index.md §9): a debug-only cross-check
// that the grid's candidates for a query are a superset of an exact distance test, never the
// reverse, since the grid's candidates are conservative by design (§7's "candidates, not
// results"). Opt-in per world and domain via setSpatialGridOracleEnabled, surfaced in
// _dbg__SpatialGrid.ts; a no-op call in production (IS_DEBUG_ENV-gated). While on, it checks the
// queries consumers pass to validateSpatialGridQuery, plus a few probe queries near random members
// every frame, so a domain that no consumer queries yet is checked too. It compares against live
// positions, so in a STATIC or MANUAL domain it also flags members that moved without an
// invalidateSpatialDomain/rebuildSpatialDomain call. Its state is on the world's domain registry
// (SpatialDomains.ts' `WorldDomains.oracles`), which drops it with an unregistered domain.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';
import { findSpatialRadiusProvider } from '../../kernel/ecs/SpatialMembership';
import type { ReadonlyVec3 } from './SpatialGrid';
import {
  DEFAULT_SPATIAL_DOMAIN,
  findWorldDomains,
  getWorldDomains,
  maxAbsScale,
  type SpatialDomain,
  type SpatialOracleState,
} from './SpatialDomains';

const ORACLE_PROBES_PER_FRAME = 8;
/** Mismatches past this many (per enable) are only counted, not logged. */
const ORACLE_MAX_WARNINGS = 10;

function getOracle(world: ECSWorld, domainId: string): SpatialOracleState | undefined {
  return findWorldDomains(world)?.oracles.get(domainId);
}

/**
 * Turns the oracle on or off for one domain, and resets its counts.
 * For the Spatial grid debug tab.
 * @internal
 */
export function setSpatialGridOracleEnabled(
  world: ECSWorld,
  enabled: boolean,
  domainId: string = DEFAULT_SPATIAL_DOMAIN
): void {
  getWorldDomains(world).oracles.set(domainId, { enabled, checked: 0, mismatches: 0, warned: 0 });
}

/**
 * Whether the oracle checks the domain's queries, for the Spatial grid debug tab.
 * @internal
 */
export function isSpatialGridOracleEnabled(
  world: ECSWorld,
  domainId: string = DEFAULT_SPATIAL_DOMAIN
): boolean {
  return getOracle(world, domainId)?.enabled ?? false;
}

/**
 * How many checked queries in the domain missed a member the oracle found, since it was turned
 * on: for the Spatial grid debug tab.
 * @internal
 */
export function getOracleMismatchCount(
  world: ECSWorld,
  domainId: string = DEFAULT_SPATIAL_DOMAIN
): number {
  return getOracle(world, domainId)?.mismatches ?? 0;
}

/**
 * How many queries the oracle has checked in the domain since it was turned on.
 * For the Spatial grid debug tab.
 * @internal
 */
export function getOracleCheckedQueryCount(
  world: ECSWorld,
  domainId: string = DEFAULT_SPATIAL_DOMAIN
): number {
  return getOracle(world, domainId)?.checked ?? 0;
}

/** The true "within range" set, computed by iterating the domain's members as the ECS records them (SPATIAL_INDEXED, or the domain's SPATIAL_DOMAINS bit) — the thing the grid is trying to approximate cheaply. */
function bruteForceQuery(
  world: ECSWorld,
  domain: SpatialDomain,
  p: ReadonlyVec3,
  r: number
): Set<number> {
  const result = new Set<number>();
  const test = (entityId: number) => {
    const pos = world.getPosition(entityId);
    if (!pos) return;
    const radius = computeSpatialRadius(entityId, world);
    const dx = pos.x - p.x;
    const dy = pos.y - p.y;
    const dz = pos.z - p.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= r + radius) result.add(entityId);
  };

  if (domain.bit < 0) {
    for (const [entityId] of world.getStorage(ComponentType.SPATIAL_INDEXED)) test(entityId);
  } else {
    const bit = 1 << domain.bit;
    for (const [entityId, membership] of world.getStorage(ComponentType.SPATIAL_DOMAINS)) {
      if (membership.mask & bit) test(entityId);
    }
  }
  return result;
}

function checkQuery(
  world: ECSWorld,
  domain: SpatialDomain,
  oracle: SpatialOracleState,
  p: ReadonlyVec3,
  r: number
): void {
  const exact = bruteForceQuery(world, domain, p, r);
  const found = new Set<number>();
  domain.grid.queryVisit(p, r, (id) => {
    found.add(id);
  });
  oracle.checked++;

  for (const id of exact) {
    if (found.has(id)) continue;
    oracle.mismatches++;
    if (oracle.warned >= ORACLE_MAX_WARNINGS) continue;
    oracle.warned++;
    lwarn(
      `SpatialGrid oracle: entity ${id} is within range of query ` +
        `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) r=${r.toFixed(2)} in domain ` +
        `'${domain.id}' but the grid's candidates missed it — see docs/plans/_DONE_p050_spatial-index.md §9.` +
        (oracle.warned === ORACLE_MAX_WARNINGS ? ' Further mismatches are only counted.' : '')
    );
  }
}

const _probe = { x: 0, y: 0, z: 0 };

/**
 * Probe queries near random members, within a cell of them, with radii up to two cells: the
 * rebuild system's, for each domain in the debug env.
 * @internal
 */
export function runOracleProbes(world: ECSWorld, domain: SpatialDomain): void {
  const oracle = getOracle(world, domain.id);
  const memberCount = domain.grid.memberCount;
  if (!oracle?.enabled || memberCount === 0) return;
  const cellSize = domain.opts.cellSize;
  for (let i = 0; i < ORACLE_PROBES_PER_FRAME; i++) {
    const pos = world.getPosition(domain.grid.memberAt(Math.floor(Math.random() * memberCount)));
    if (!pos) continue;
    _probe.x = pos.x + (Math.random() * 2 - 1) * cellSize;
    _probe.y = pos.y + (Math.random() * 2 - 1) * cellSize;
    _probe.z = pos.z + (Math.random() * 2 - 1) * cellSize;
    checkQuery(world, domain, oracle, _probe, Math.random() * cellSize * 2);
  }
}

/** The radius `entityId` has as a member right now (its provider's, scaled by its Transform), for
 * the brute-force query. */
function computeSpatialRadius(entityId: number, world: ECSWorld): number {
  const entry = findSpatialRadiusProvider(entityId, world);
  const local = entry?.provider(entityId, world) ?? 0;
  if (!entry || entry.isScaleIndependent || !(local > 0) || !Number.isFinite(local)) return local;
  return local * maxAbsScale(world.getScale(entityId));
}

/**
 * Call after a real `queryVisit`/`queryInto` call on domain `domainId`'s grid, to validate that
 * call's result. No-op unless both `IS_DEBUG_ENV` and the oracle are on for that domain — safe
 * to call unconditionally from a hot path.
 * @param world the domain's world
 * @param p the query's centre
 * @param r the query's radius
 * @param domainId the queried domain
 * @example
 * ```ts
 * import { getSpatialDomain, validateSpatialGridQuery } from 'aekasha/spatial';
 *
 * const grid = getSpatialDomain(world, 'PICKUPS');
 * const count = grid?.queryInto(player.position, 5, nearby) ?? 0;
 * // With the Spatial grid tab's oracle on, logs a pickup the grid missed
 * validateSpatialGridQuery(world, player.position, 5, 'PICKUPS');
 * ```
 */
export function validateSpatialGridQuery(
  world: ECSWorld,
  p: ReadonlyVec3,
  r: number,
  domainId: string = DEFAULT_SPATIAL_DOMAIN
): void {
  if (!IS_DEBUG_ENV) return;
  const oracle = getOracle(world, domainId);
  const domain = findWorldDomains(world)?.byId.get(domainId);
  if (!oracle?.enabled || !domain) return;
  checkQuery(world, domain, oracle, p, r);
}
