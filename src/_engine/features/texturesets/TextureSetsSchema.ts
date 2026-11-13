import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';

/** The texture sets feature's scene field (p303 D1): `textureSets`, the ids of the
 * `*.textureSet.json` sets code uses (each loads its default packing). The asset's schema is
 * `schemas/TextureSetSchema.ts`. */
export const textureSetsSchemaPart = {
  feature: 'texturesets',
  scene: {
    /** Texture set ids (`*.textureSet.json`) the scene's code uses: each loads its default
     * packing's textures. The gather adds the sets its materials' inputs name. */
    textureSets: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Texture set ids (*.textureSet.json) the scene's code uses: each loads its default packing's textures. The gather adds the sets its materials' inputs name."
      ),
  },
} satisfies FeatureSchemaPart;
