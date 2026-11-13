import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { SceneTextureSetArraySchema } from '../../schemas/TextureSetSchema';

/** The texture sets feature's scene fields (p303 D1, D4): `textureSets`, the ids of the
 * `*.textureSet.json` sets code uses (each loads its default packing), and `textureSetArrays`, the
 * set arrays the scene builds with its load. The asset's schema is `schemas/TextureSetSchema.ts`. */
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
    /** Set arrays the scene builds with its load, before its materials: one array texture per slot
     * of the packing, layer `i` from `sets[i]`. The gather adds the ones its materials'
     * `{ textureSetArray: [...], packing }` inputs name. */
    textureSetArrays: z
      .array(SceneTextureSetArraySchema)
      .optional()
      .describe(
        "Set arrays the scene builds with its load, before its materials: one array texture per slot of the packing, layer i from sets[i]. The gather adds the ones its materials' { textureSetArray: [...], packing } inputs name."
      ),
  },
} satisfies FeatureSchemaPart;
