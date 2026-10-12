export { registerSpatialRadiusProvider } from '../../kernel/ecs/SpatialMembership';
export type { SpatialRadiusProvider } from '../../kernel/ecs/SpatialMembership';
export { getConservativeGeometryRadius } from '../../kernel/assets/Geometry';
export { spatial } from './SpatialFeature';
export { SpatialGrid } from './SpatialGrid';
export type { ReadonlyVec3, SpatialGridOptions, SpatialGridStats } from './SpatialGrid';
export {
  getSpatialDomain,
  getSpatialGrid,
  invalidateSpatialDomain,
  isInSpatialDomain,
  joinSpatialDomain,
  leaveSpatialDomain,
  rebuildSpatialDomain,
  refreshSpatialRadius,
  registerSpatialDomain,
  unregisterSpatialDomain,
} from './SpatialIndexSystem';
export type { SpatialDomainOptions } from './SpatialIndexSystem';
