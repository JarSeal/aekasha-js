import { z } from 'zod';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';

// The surface conditions' scene field (p307 D1): a scene's own starting values, applied at its
// load over the defaults, before its scene code runs. A scene that sets it names the
// `surfaceConditions()` feature in its manifest.

const unit = (description: string) => z.number().min(0).max(1).optional().describe(description);

/** A scene's starting surface conditions: any of the state's values, the rest at their defaults. */
export const SceneSurfaceConditionsSchema = z
  .strictObject({
    /** How wet the surfaces start: 0 dry, 0.5 the pores full, 1 a water film. Default 0. */
    wetness: unit(
      'How wet the surfaces start: 0 dry, 0.5 the pores full, 1 a water film. Default 0.'
    ),
    /** Rain intensity, 0 to 1. Default 0. */
    rain: unit('Rain intensity, 0 to 1. Default 0.'),
    /** How full the puddles start, 0 to 1. Default 0. */
    puddleLevel: unit('How full the puddles start, 0 to 1. Default 0.'),
    /** The water surface's world Y for the shoreline's wet band, or null for none. Default null. */
    waterLevel: z
      .number()
      .nullable()
      .optional()
      .describe(
        "The water surface's world Y for the shoreline's wet band, or null for none. Default null."
      ),
    /** Snow cover, 0 to 1. Default 0. */
    snowCoverage: unit('Snow cover, 0 to 1. Default 0.'),
    /** The air temperature in °C (snow melts above 0). Default 15. */
    temperature: z
      .number()
      .optional()
      .describe('The air temperature in °C (snow melts above 0). Default 15.'),
    /** How much wetness dries per minute in full sun without wind. Default 0.1. */
    dryingRate: z
      .number()
      .min(0)
      .optional()
      .describe('How much wetness dries per minute in full sun without wind. Default 0.1.'),
    /** The wind's world x and z in m/s. Default [0, 0]. */
    wind: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("The wind's world x and z in m/s. Default [0, 0]."),
    /** `SIMULATED` (rain wets, sun and wind dry, snow melts) or `MANUAL` (only the app's calls
     * change them). Default `SIMULATED`. */
    mode: z
      .enum(['SIMULATED', 'MANUAL'])
      .optional()
      .describe(
        "SIMULATED (rain wets, sun and wind dry, snow melts) or MANUAL (only the app's calls change them). Default SIMULATED."
      ),
  })
  .describe(
    "The scene's starting surface conditions (the surfaceConditions() feature), over the defaults."
  );

/** A scene's starting surface conditions (its JSON `surfaceConditions`). */
export type SceneSurfaceConditions = z.infer<typeof SceneSurfaceConditionsSchema>;

// p607 D10
/** The surface conditions feature's scene field: a scene that sets it names
 * `surfaceConditions()`. */
export const surfaceConditionsSchemaPart = {
  feature: 'surfaceconditions',
  scene: {
    /** The scene's starting surface conditions (`surfaceConditions()`): `{ wetness?, rain?, puddleLevel?, waterLevel?, snowCoverage?, temperature?, dryingRate?, wind?, mode? }`. */
    surfaceConditions: SceneSurfaceConditionsSchema.optional(),
  },
} satisfies FeatureSchemaPart;
