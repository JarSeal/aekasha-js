import type { ECSWorld } from './ECS';
import type { ComponentType } from './ECSCoreComponents';

// Spatial membership (p607 D5): kernel registries the spatial index reads and fills, so a feature
// whose entities join spatial domains (instancing's pools) measures and joins them without
// importing the spatial index. Both are inert without `spatial()`.

// --- RADIUS PROVIDERS (p346 §3.3) ---
// Like ObjectFrustumCullingSystem.ts's bounding-volume providers: the first registered component
// type an entity has picks the provider that measures it. A member none of them measures gets
// radius 0 (a point).

/** A member's radius in its local space (before its Transform scale), or undefined if it can't be measured. */
export type SpatialRadiusProvider = (entityId: number, world: ECSWorld) => number | undefined;

/**
 * A registered radius provider, with how its radius scales.
 * @internal
 */
export type SpatialRadiusProviderEntry = {
  componentType: ComponentType;
  provider: SpatialRadiusProvider;
  isScaleIndependent: boolean;
};

const radiusProviders: SpatialRadiusProviderEntry[] = [];

/**
 * Measures the members that have `componentType`. The radius is read when an entity joins a
 * domain, and multiplied by the largest axis of its Transform scale on every rebuild, unless
 * `scaleIndependent` (eg. a light's range). Registering a type again replaces its provider.
 */
export function registerSpatialRadiusProvider(
  componentType: ComponentType,
  provider: SpatialRadiusProvider,
  opts?: { scaleIndependent?: boolean }
): void {
  const entry: SpatialRadiusProviderEntry = {
    componentType,
    provider,
    isScaleIndependent: opts?.scaleIndependent ?? false,
  };
  const index = radiusProviders.findIndex((e) => e.componentType === componentType);
  if (index >= 0) radiusProviders[index] = entry;
  else radiusProviders.push(entry);
}

/**
 * The provider that measures `entityId`: the first registered whose component type it has.
 * @internal
 */
export function findSpatialRadiusProvider(
  entityId: number,
  world: ECSWorld
): SpatialRadiusProviderEntry | undefined {
  for (let i = 0; i < radiusProviders.length; i++) {
    if (world.hasComponent(entityId, radiusProviders[i].componentType)) return radiusProviders[i];
  }
  return undefined;
}

// --- DOMAIN MEMBERSHIP ---

/**
 * How a feature joins its entities to a spatial domain: the spatial index's functions, set by
 * `spatial()`'s install.
 * @internal
 */
export type SpatialDomainMembership = {
  /** Whether entities can join `domainId` in `world` (`DEFAULT` always can). */
  hasDomain: (world: ECSWorld, domainId: string) => boolean;
  /** Joins `entityId` to the domain (`joinSpatialDomain`): false when it couldn't. */
  join: (entityId: number, domainId: string, world: ECSWorld) => boolean;
};

let membership: SpatialDomainMembership | null = null;

/**
 * Sets the spatial index's membership functions (`spatial()`'s install).
 * @internal
 */
export const setSpatialDomainMembership = (next: SpatialDomainMembership) => {
  membership = next;
};

/**
 * The spatial index's membership functions, or null without `spatial()`.
 * @internal
 */
export const getSpatialDomainMembership = () => membership;
