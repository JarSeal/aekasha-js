export { registerSpatialRadiusProvider } from '../../core/ECS/SpatialMembership';
export type { SpatialRadiusProvider } from '../../core/ECS/SpatialMembership';
export { getConservativeGeometryRadius } from '../../core/Geometry';
export { spatial } from '../../core/Spatial/SpatialFeature';
export { SpatialGrid } from '../../core/Spatial/SpatialGrid';
export type {
  ReadonlyVec3,
  SpatialGridOptions,
  SpatialGridStats,
} from '../../core/Spatial/SpatialGrid';
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
} from '../../core/Spatial/SpatialIndexSystem';
export type { SpatialDomainOptions } from '../../core/Spatial/SpatialIndexSystem';
