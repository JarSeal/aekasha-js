import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { PostFxAssetSchema } from '../../schemas/PostFxSchema';

// p607 D10
/** The PostFX feature's scene fields: the pass chain and whether it starts on. */
export const postFxSchemaPart = {
  feature: 'postfx',
  scene: {
    /** Ordered PostFX pass chain: unlike the other registries, array order is execution order (each pass builds on the previous pass's output). */
    postFx: z.array(z.union([z.string(), PostFxAssetSchema])).optional(),
    /** Whether the scene's PostFX chain starts switched on. Default true when `postFx` is non-empty. */
    postFxEnabled: z.boolean().optional(),
  },
} satisfies FeatureSchemaPart;
