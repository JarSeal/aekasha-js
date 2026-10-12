import type { FeatureSchemaPart } from '../../schemas/featureSchemas';
import { SceneSpatialDomainsSchema } from '../../schemas/spatialDomainSchema';

/** The spatial index feature's scene field (p607 D10): the domains a scene registers for itself. */
export const spatialSchemaPart = {
  feature: 'spatial',
  scene: {
    /** Spatial domains this scene registers for itself, before any of its entities join one; dropped on its exit (`DEFAULT`: partial, merged over its world settings). */
    spatialDomains: SceneSpatialDomainsSchema.optional(),
  },
} satisfies FeatureSchemaPart;
