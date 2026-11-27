import { z } from 'zod';
import { ColorJSONSchema, DebugDataSchema } from '../../schemas/_HelperSchemas';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
} from '../../schemas/_SaveDataSchema';
import type { FeatureSchemaPart } from '../../schemas/FeatureSchemas';
import { FOG_DEFAULTS } from './FogDefaults';

// A fog (p106 D2): a `*.fog.json` or an inline definition in a scene's `fogs`. Every mode's
// parameters can be there at once, so the debug tab switches modes without losing values. The
// gatherer fills the defaults in (`resolveFogDef`, FogDefaults.ts), so the runtime sees whole
// definitions. The runtime imports only types from here: a value import would bring zod into the
// first download.

/** The fog modes, in the debug tab's order. */
export const FOG_MODES = ['LINEAR', 'EXP2', 'HEIGHT'] as const;

const nonNegative = (description: string) => z.number().min(0).optional().describe(description);

/** `LINEAR`'s parameters. */
const FogLinearSchema = z
  .strictObject({
    /** Metres from the camera where the fog starts. Default 10. */
    near: nonNegative('Metres from the camera where the fog starts. Default 10.'),
    /** Metres from the camera where the fog is full (more than `near`). Default 500. */
    far: nonNegative('Metres from the camera where the fog is full (more than near). Default 500.'),
  })
  .describe("LINEAR's parameters (three's Fog: a smoothstep between near and far).");

/** `EXP2`'s parameters. */
const FogExp2Schema = z
  .strictObject({
    /** The factor is `1 − exp(−(density · distance)²)`. Default 0.005. */
    density: nonNegative('The factor is 1 − exp(−(density · distance)²). Default 0.005.'),
  })
  .describe("EXP2's parameters (three's FogExp2).");

/** `HEIGHT`'s parameters. */
const FogHeightSchema = z
  .strictObject({
    /** The density per metre at `baseHeight`. Default 0.02. */
    density: nonNegative('The density per metre at baseHeight. Default 0.02.'),
    /** The world Y where the density is `density`. Default 0. */
    baseHeight: z
      .number()
      .optional()
      .describe('The world Y where the density is density. Default 0.'),
    /** How fast the density falls with height, per metre. Default 0.1. */
    falloff: nonNegative('How fast the density falls with height, per metre. Default 0.1.'),
    /** Metres from the camera before which there's no fog. Default 0. */
    startDistance: nonNegative("Metres from the camera before which there's no fog. Default 0."),
    /** The fog factor's maximum, 0 to 1. Default 1. */
    maxOpacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("The fog factor's maximum, 0 to 1. Default 1."),
  })
  .describe("HEIGHT's parameters: an exponential height fog, thick low down.");

/** The sun glow, in every mode. */
const FogSunScatteringSchema = z
  .strictObject({
    /** Whether the fog glows toward the sun. Default: on for `HEIGHT`, off otherwise. */
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the fog glows toward the sun. Default: on for HEIGHT, off otherwise.'),
    /** How far the colour moves toward the sun's, looking straight at it, 0 to 1. Default 0.5. */
    strength: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("How far the colour moves toward the sun's, looking at it, 0 to 1. Default 0.5."),
    /** How tight the glow is around the sun: higher is tighter. Default 8. */
    exponent: nonNegative('How tight the glow is around the sun: higher is tighter. Default 8.'),
  })
  .describe("The sun glow: the fog's colour moves toward the sun's around it.");

/** The keys a fog and its save entry share. */
const fogValueShape = {
  /** Whether it renders (with `setFogEnabled`'s switch). Default true. */
  enabled: z
    .boolean()
    .optional()
    .describe("Whether it renders (with setFogEnabled's switch). Default true."),
  /** `SKY` (the wired sky colour, `color` without one) or `MANUAL` (`color`). Default `SKY`. */
  colorSource: z
    .enum(['SKY', 'MANUAL'])
    .optional()
    .describe('SKY (the wired sky colour, color without one) or MANUAL (color). Default SKY.'),
  /** `MANUAL`'s colour, and `SKY`'s without a sky colour (sRGB). Default `#b4c0cc`. */
  color: ColorJSONSchema.optional().describe(
    "MANUAL's colour, and SKY's without a sky colour (sRGB). Default #b4c0cc."
  ),
  linear: FogLinearSchema.optional(),
  exp2: FogExp2Schema.optional(),
  height: FogHeightSchema.optional(),
  sunScattering: FogSunScatteringSchema.optional(),
  /** `NONE`, or `FOG_COLOR`: the clear colour is the fog's while no sky box shows a background.
   * Default `NONE`. */
  background: z
    .enum(['NONE', 'FOG_COLOR'])
    .optional()
    .describe(
      "NONE, or FOG_COLOR: the clear colour is the fog's while no sky box shows a background. Default NONE."
    ),
};

/** A fog's save entry: the values it changes in one scene (deep merged over the definition). */
export const FogOverridesSchema = z
  .strictObject({
    ...fogValueShape,
    /** Which parameters render. */
    mode: z.enum(FOG_MODES).optional().describe('Which parameters render.'),
    /** When and by whom it was saved. */
    __meta: MetaSchema.optional(),
  })
  .describe('The values a fog changes in one scene, deep merged over its definition.');

/** A fog as authored, in a `*.fog.json` or inline in a scene's `fogs`. */
export const FogAssetSchema = z
  .strictObject({
    /** What `setFog` and the save data name it by. A file's defaults to its name. */
    id: z
      .string()
      .min(1)
      .describe("What setFog and the save data name it by. A file's defaults to its name."),
    /** Whether the scene starts with it. Without one, the scene's first fog. */
    isDefault: z
      .boolean()
      .optional()
      .describe("Whether the scene starts with it. Without one, the scene's first fog."),
    /** `LINEAR` (between `near` and `far`), `EXP2` (by `density`) or `HEIGHT` (thick low down). */
    mode: z
      .enum(FOG_MODES)
      .describe('LINEAR (between near and far), EXP2 (by density) or HEIGHT (thick low down).'),
    ...fogValueShape,
    /** The debugger's data. */
    debugData: DebugDataSchema.optional(),
    /** The JSON Schema the editor validates the file with (`.schemas/`). */
    $schema: JsonSchemaRefSchema.optional(),
    /** Written by the data pipeline: the file the definition came from. */
    __sourcePath: z.string().optional(),
    /** Per-scene overrides (`{ [sceneId]: [latest, ...older] }`; only the latest applies). */
    __saveData: createSaveDataSchema(FogOverridesSchema),
  })
  .refine(
    (fog) =>
      (fog.linear?.near ?? FOG_DEFAULTS.linear.near) < (fog.linear?.far ?? FOG_DEFAULTS.linear.far),
    { error: "A fog's linear.far must be more than its linear.near.", path: ['linear', 'far'] }
  )
  .describe('A fog (the fog() feature): one of LINEAR, EXP2 and HEIGHT, its colour and sun glow.');

/** A fog as authored ({@link FogAssetSchema}): a `*.fog.json`, an inline one, or `setFog`'s. */
export type FogAsset = z.infer<typeof FogAssetSchema>;

/** A fog's save entry ({@link FogOverridesSchema}). */
export type FogOverrides = z.infer<typeof FogOverridesSchema>;

/** A fog to resolve: an authored one without its file's keys. */
export type FogInput = Omit<FogAsset, '$schema' | '__sourcePath' | '__saveData'>;

// p607 D10
/** The fog feature's scene field: `fogs`, ids of `*.fog.json` files or inline fogs. */
export const fogSchemaPart = {
  feature: 'fog',
  scene: {
    /** The scene's fogs (`fog()`): `*.fog.json` ids or inline fogs; it starts with the one with
     * `isDefault`, else the first. */
    fogs: z
      .array(z.union([z.string(), FogAssetSchema]))
      .optional()
      .describe(
        "The scene's fogs (the fog() feature): *.fog.json ids or inline fogs; it starts with the one with isDefault, else the first."
      ),
  },
} satisfies FeatureSchemaPart;
