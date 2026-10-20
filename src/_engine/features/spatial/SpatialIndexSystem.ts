import * as THREE from 'three/webgpu';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';
import { MAX_SPOT_ANGLE } from '../../kernel/ecs/ObjectFrustumCullingSystem';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { getConservativeGeometryRadius } from '../../kernel/assets/Geometry';
import {
  registerSpatialRadiusProvider,
  setSpatialDomainMembership,
  type SpatialRadiusProvider,
} from '../../kernel/ecs/SpatialMembership';
import {
  addToDomain,
  buildDefaultDomain,
  clearMaskBit,
  DEFAULT_SPATIAL_DOMAIN,
  findWorldDomains,
  getSpatialDomain,
  getWorldDomains,
  insertMember,
  maxAbsScale,
  rebuildDomain,
  removeFromDomain,
  setMaskBit,
  type SpatialDomain,
} from './SpatialDomains';
import { runOracleProbes } from './SpatialOracle';

// The spatial index's ECS side (docs/plans/_DONE_p050_spatial-index.md §3, §8): the membership API,
// the radius providers, the rebuild system and the install. The domains (the registry, settings
// and scene scope) are in SpatialDomains.ts, the brute-force oracle in SpatialOracle.ts.

// Debug
type SpatialGridDebugModule = typeof import('./debug/_dbg__SpatialGrid');
let debugGUI: DebugModuleRef<SpatialGridDebugModule> | null = null;

/**
 * Loads and builds the Spatial grid debug tab: the `spatial()` feature's `onDebug` hook.
 * @internal
 */
export const registerSpatialIndexDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__SpatialGrid'));
  useDebug(debugGUI)?._createSpatialGridDebugGUI();
};

// --- MEMBERSHIP (p346 §3.2) ---
// DEFAULT's membership is the SPATIAL_INDEXED component (also its JSON flag, `spatialIndex`);
// the other domains' is one SPATIAL_DOMAINS bit mask per entity, since domains are runtime
// configuration and components are declared statically. An entity can be in several domains.

/**
 * Adds `entityId` to `world`'s domain `domainId` with its current position and radius. Returns
 * false if the domain isn't registered, the entity isn't alive, or the domain is full; true if
 * the entity is (or already was) a member. Joining `DEFAULT` adds SPATIAL_INDEXED.
 */
export function joinSpatialDomain(
  entityId: number,
  domainId: string,
  world: ECSWorld = getECSWorld()
): boolean {
  if (!world.isAlive(entityId)) return false;
  if (domainId === DEFAULT_SPATIAL_DOMAIN) {
    if (!world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED)) {
      world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
    }
    return true;
  }

  const domain = findWorldDomains(world)?.byId.get(domainId);
  if (!domain) {
    if (IS_DEBUG_ENV) {
      lwarn(
        `SpatialIndex: can't join entity ${entityId} to domain '${domainId}', it isn't ` +
          `registered in world '${world.id}' (registerSpatialDomain).`
      );
    }
    return false;
  }
  if (domain.grid.has(entityId)) return true;
  if (!addToDomain(world, domain, entityId)) return false;
  setMaskBit(world, domain, entityId);
  return true;
}

/** Removes `entityId` from `world`'s domain `domainId` (a no-op for a non-member). Leaving `DEFAULT` removes SPATIAL_INDEXED. */
export function leaveSpatialDomain(
  entityId: number,
  domainId: string,
  world: ECSWorld = getECSWorld()
): void {
  if (domainId === DEFAULT_SPATIAL_DOMAIN) {
    if (world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED)) {
      world.removeComponent(entityId, ComponentType.SPATIAL_INDEXED);
    }
    return;
  }

  const domain = findWorldDomains(world)?.byId.get(domainId);
  if (!domain || !domain.grid.has(entityId)) return;
  removeFromDomain(domain, entityId);
  clearMaskBit(world, domain, entityId);
}

/** Whether `entityId` is a member of `world`'s domain `domainId` (false when the domain isn't
 * registered). `DEFAULT`: whether it has SPATIAL_INDEXED. */
export function isInSpatialDomain(
  entityId: number,
  domainId: string,
  world: ECSWorld = getECSWorld()
): boolean {
  if (domainId === DEFAULT_SPATIAL_DOMAIN) {
    return world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED);
  }
  const domain = findWorldDomains(world)?.byId.get(domainId);
  if (!domain) return false;
  const mask = world.getComponent(entityId, ComponentType.SPATIAL_DOMAINS)?.mask ?? 0;
  return (mask & (1 << domain.bit)) !== 0;
}

/**
 * Re-reads `entityId`'s radius from its provider in every domain it's a member of. Call it after
 * changing what the provider measures (a light's distance or angle, a mesh's geometry); a
 * Transform scale change needs no call.
 */
export function refreshSpatialRadius(entityId: number, world: ECSWorld = getECSWorld()): void {
  const list = findWorldDomains(world)?.list;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    if (list[i].grid.has(entityId)) insertMember(world, list[i], entityId);
  }
}

/** Takes the entity out of every domain in its SPATIAL_DOMAINS mask. */
const leaveMaskedDomains = (entityId: number, world: ECSWorld) => {
  const mask = world.getComponent(entityId, ComponentType.SPATIAL_DOMAINS)?.mask ?? 0;
  const byBit = findWorldDomains(world)?.byBit;
  if (!mask || !byBit) return;
  for (let bit = 0; bit < byBit.length; bit++) {
    const domain = byBit[bit];
    if (domain && mask & (1 << bit)) removeFromDomain(domain, entityId);
  }
};

/**
 * A point/spot light's influence-sphere radius (a spot's cone as the sphere around its apex,
 * `distance / cos(angle)`; Infinity for an unattenuated light or a cone past `MAX_SPOT_ANGLE`):
 * the light's radius in the grid, and what light culling (LightObjectCullingSystem.ts) queries
 * with, so both agree on the light's volume. Frustum culling's light spheres
 * (ObjectFrustumCullingSystem.ts) use the same formula and cutoff.
 * @internal
 */
export function computeLightInfluenceRadius(light: THREE.PointLight | THREE.SpotLight): number {
  // distance === 0 is Three.js's own convention for "never attenuate / infinite
  // range" (see ObjectFrustumCullingSystem.ts) — Infinity forces this light into
  // the grid's oversized tier, where it's always a candidate everywhere.
  if (light.distance === 0) return Infinity;
  if (light instanceof THREE.SpotLight) {
    if (light.angle > MAX_SPOT_ANGLE) return Infinity;
    return light.distance / Math.cos(light.angle);
  }
  return light.distance;
}

// --- RADIUS PROVIDERS (p346 §3.3) ---
// The registry is the kernel's (kernel/ecs/SpatialMembership.ts), so other features register
// into it without importing this module; the mesh and light providers are registered by the
// install.

const getLightRadius: SpatialRadiusProvider = (entityId, world) => {
  const light = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  return light instanceof THREE.PointLight || light instanceof THREE.SpotLight
    ? computeLightInfluenceRadius(light)
    : undefined;
};

const getMeshRadius: SpatialRadiusProvider = (entityId, world) => {
  const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  return obj instanceof THREE.Mesh ? getConservativeGeometryRadius(obj.geometry) : undefined;
};

// The DEFAULT domain's membership (installSpatialIndex registers it on SPATIAL_INDEXED)
const spatialIndexedHooks = {
  onAddComponent: (entityId: number, world: ECSWorld) => {
    if (IS_DEBUG_ENV) {
      const isAmbient = world.hasComponent(entityId, ComponentType.TAG_IS_AMBIENT_LIGHT);
      const isHemisphere = world.hasComponent(entityId, ComponentType.TAG_IS_HEMISPHERE_LIGHT);
      if (isAmbient || isHemisphere) {
        lwarn(
          `SpatialIndex: entity ${entityId} opted in but is an ` +
            `${isAmbient ? 'ambient' : 'hemisphere'} light — it has no meaningful position to ` +
            `index (docs/plans/_DONE_p050_spatial-index.md §3.1).`
        );
      }
    }
    const domains = getWorldDomains(world);
    const domain = domains.byId.get(DEFAULT_SPATIAL_DOMAIN);
    if (domain) addToDomain(world, domain, entityId);
    // The build inserts every SPATIAL_INDEXED holder, this entity included (it's stored before
    // its hooks run)
    else buildDefaultDomain(world, domains);
  },
  onRemoveComponent: (entityId: number, world: ECSWorld) => leaveDefaultDomain(entityId, world),
  onDeleteEntity: (entityId: number, world: ECSWorld) => leaveDefaultDomain(entityId, world),
};

function leaveDefaultDomain(entityId: number, world: ECSWorld) {
  const domain = findWorldDomains(world)?.byId.get(DEFAULT_SPATIAL_DOMAIN);
  if (domain) removeFromDomain(domain, entityId);
}

/**
 * Re-reads every member's position and scaled radius from its Transform: the storage read once,
 * the grid written by slot (the loop's index), and in `TYPED_ARRAY` mode from the store's arrays
 * (its `get` would make a `Transform` per member).
 */
function refreshDomainMembers(world: ECSWorld, domain: SpatialDomain): void {
  const grid = domain.grid;
  const localRadius = domain.localRadius;
  const typedStore = world.getTypedTransformStore();
  if (typedStore) {
    const { posX, posY, posZ, scaleX, scaleY, scaleZ } = typedStore;
    for (let i = 0; i < grid.memberCount; i++) {
      const entityId = grid.memberAt(i);
      const slot = typedStore.getSlot(entityId);
      if (slot === -1) continue;
      grid.updatePositionAt(i, posX[slot], posY[slot], posZ[slot]);
      const local = localRadius.get(entityId);
      if (local === undefined) continue;
      const scale = Math.max(
        Math.abs(scaleX[slot]),
        Math.abs(scaleY[slot]),
        Math.abs(scaleZ[slot])
      );
      grid.updateRadiusAt(i, local * scale);
    }
    return;
  }
  const transforms = world.getStorage(ComponentType.TRANSFORM);
  for (let i = 0; i < grid.memberCount; i++) {
    const entityId = grid.memberAt(i);
    const transform = transforms.get(entityId);
    if (!transform) continue;
    const pos = transform.position;
    grid.updatePositionAt(i, pos.x, pos.y, pos.z);
    const local = localRadius.get(entityId);
    if (local !== undefined) grid.updateRadiusAt(i, local * maxAbsScale(transform.scale));
  }
}

const getDomainOrWarn = (world: ECSWorld, domainId: string, action: string) => {
  const domain = findWorldDomains(world)?.byId.get(domainId);
  if (!domain && IS_DEBUG_ENV) {
    lwarn(
      `SpatialIndex: can't ${action} domain '${domainId}', it isn't registered in world ` +
        `'${world.id}' (registerSpatialDomain).`
    );
  }
  return domain;
};

/**
 * Refreshes every member of `world`'s domain `domainId` from its Transform and rebuilds the grid
 * at the next frame's rebuild (APP_POST_PHYSICS), for any update policy. For a `STATIC` domain
 * whose members moved, or a `MANUAL` one whose owner doesn't need the result before then. A
 * no-op change for `DYNAMIC`, which does this every frame.
 */
export function invalidateSpatialDomain(world: ECSWorld, domainId: string): void {
  const domain = getDomainOrWarn(world, domainId, 'invalidate');
  if (domain) domain.needsRefresh = true;
}

/**
 * Refreshes every member of `world`'s domain `domainId` from its Transform and rebuilds the grid
 * now, for any update policy. The way a `MANUAL` domain is kept current: call it before
 * querying when members joined, left or moved since the last rebuild.
 */
export function rebuildSpatialDomain(world: ECSWorld, domainId: string): void {
  const domain = getDomainOrWarn(world, domainId, 'rebuild');
  if (!domain) return;
  refreshDomainMembers(world, domain);
  rebuildDomain(domain, findWorldDomains(world)!.frame);
}

/**
 * Keeps every domain current by its update policy, in registration order: `DYNAMIC` is refreshed
 * and rebuilt, `STATIC` is rebuilt when a member joined or left, and any domain is refreshed and
 * rebuilt when invalidated. Registered last in APP_POST_PHYSICS (§8) so APP_LOGIC/APP_RENDER_SYNC
 * consumers see a current snapshot.
 * Registered by the feature's install.
 * @internal
 */
export const spatialIndexRebuildSystem = (world: ECSWorld) => {
  const domains = findWorldDomains(world);
  if (!domains) return; // no domain registered in this world yet

  // A scene change freed DEFAULT's grid, but persistent entities kept SPATIAL_INDEXED: build it
  // back before anything queries it (every other holder builds it by joining, p349 §3.6)
  if (
    !domains.byId.has(DEFAULT_SPATIAL_DOMAIN) &&
    world.getStorage(ComponentType.SPATIAL_INDEXED).size > 0
  ) {
    buildDefaultDomain(world, domains);
  }

  const frame = IS_DEBUG_ENV ? ++domains.frame : 0;
  const list = domains.list;
  for (let i = 0; i < list.length; i++) {
    const domain = list[i];
    const policy = domain.opts.update;
    if (policy === 'DYNAMIC' || domain.needsRefresh) {
      refreshDomainMembers(world, domain);
      rebuildDomain(domain, frame);
    } else if (policy === 'STATIC' && domain.needsRebuild) {
      // The members that joined were read on joining; the others haven't moved
      rebuildDomain(domain, frame);
    }
    if (IS_DEBUG_ENV) runOracleProbes(world, domain);
  }
};

/**
 * Installs the spatial index (the `spatial()` feature's install, SpatialFeature.ts): the domain
 * membership hooks, the mesh and light radius providers, the membership other features join
 * through, and the rebuild system.
 * @internal
 */
export const installSpatialIndex = (ctx: FeatureContext) => {
  // onRemoveComponent too, so removing the component directly can't leave stale grid members
  ctx.registerComponentHooks(ComponentType.SPATIAL_DOMAINS, {
    onRemoveComponent: leaveMaskedDomains,
    onDeleteEntity: leaveMaskedDomains,
  });

  registerSpatialRadiusProvider(ComponentType.TAG_IS_POINT_LIGHT, getLightRadius, {
    scaleIndependent: true,
  });
  registerSpatialRadiusProvider(ComponentType.TAG_IS_SPOT_LIGHT, getLightRadius, {
    scaleIndependent: true,
  });
  registerSpatialRadiusProvider(ComponentType.TAG_IS_MESH, getMeshRadius);

  ctx.registerComponentHooks(ComponentType.SPATIAL_INDEXED, spatialIndexedHooks);

  // How instancing's pools join their `spatialDomain` (kernel/ecs/SpatialMembership.ts)
  setSpatialDomainMembership({
    hasDomain: (world, domainId) =>
      domainId === DEFAULT_SPATIAL_DOMAIN || Boolean(getSpatialDomain(world, domainId)),
    join: joinSpatialDomain,
  });

  ctx.registerPlugin((world) => {
    // order: -1, matching objectFrustumCullingSystem's precedent — runs after this
    // stage's default-order (0) systems, in particular physicsToTransformSystem,
    // so it rebuilds from this frame's final transforms, not last frame's.
    world.addSystem(
      ECSSystemStage.APP_POST_PHYSICS,
      'spatialIndexRebuildSystem',
      spatialIndexRebuildSystem,
      -1
    );
  });
};
