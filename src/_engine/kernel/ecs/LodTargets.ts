import type { LodTarget } from '../../features/lod/LodTypes';
import type { ComponentType } from './ECSCoreComponents';

// The LOD targets (p607 D5): a kernel registry the LOD system reads, so a feature with entities
// that aren't plain meshes (instancing's LOD pools) registers its target without importing LOD.
// A target registered without `lod()` is never read.

/**
 * A registered LOD target, with the component type it's for.
 * @internal
 */
export type LodTargetEntry = { componentType: ComponentType; target: LodTarget };

const lodTargets: LodTargetEntry[] = [];

/**
 * Lets `LOD` work on entities with `componentType` that have no plain mesh (eg. the
 * instanced LOD pool). See {@link LodTarget}. Registering a type again replaces its target.
 */
export const registerLodTarget = (componentType: ComponentType, target: LodTarget) => {
  const index = lodTargets.findIndex((e) => e.componentType === componentType);
  if (index >= 0) lodTargets[index].target = target;
  else lodTargets.push({ componentType, target });
};

/**
 * The registered LOD targets, in registration order (the first an entity has wins).
 * @internal
 */
export const getLodTargets = (): readonly LodTargetEntry[] => lodTargets;
