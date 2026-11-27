import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';

// p391 D6
/** The text feature's scene fields: `fonts`, the ids of the `*.font.json` fonts the scene loads.
 * The font asset's schema is `FontSchema.ts`. */
export const textSchemaPart = {
  feature: 'text',
  scene: {
    /** Font ids (`*.font.json`) the scene loads with its assets, for its code's texts. */
    fonts: z
      .array(z.string().min(1))
      .optional()
      .describe("Font ids (*.font.json) the scene loads with its assets, for its code's texts."),
  },
} satisfies FeatureSchemaPart;
