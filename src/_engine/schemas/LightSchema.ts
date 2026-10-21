import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import {
  ColorJSONSchema,
  CoreEntityOptsSchema,
  ShadowQualitySchema,
  Vector3Schema,
} from './_HelperSchemas';

// A shadow map's width and height, a shadow camera's near and far
const PairSchema = z.tuple([z.number(), z.number()]);

// Every light field but `type`, documented once; each type picks its own, in its order
const LIGHT_FIELDS = {
  /** `false` creates the light disabled. Default true. */
  enabled: z.boolean().optional().describe('false creates the light disabled. Default true.'),
  /** The id a scene lists the JSON by (default: the file's name), and the entity's app id, over
   * `entityOpts.appId` (default: a generated UUID). Also keys the debugger's saved overrides. */
  appId: z
    .string()
    .optional()
    .describe(
      "The id scenes list it by (default: the file's name), and the entity's app id (default: a UUID)."
    ),
  /** The light's colour (a hemisphere light's sky colour). Default white. */
  color: ColorJSONSchema.optional(),
  /** A hemisphere light's ground colour. Default white. */
  groundColor: ColorJSONSchema.optional(),
  /** three's intensity: candela for a point or spot light, lux for the others. Default 1. */
  intensity: z
    .number()
    .optional()
    .describe(
      "three's intensity: candela for a point or spot light, lux for the others. Default 1."
    ),
  /** The range in world units past which the light adds nothing (0: no limit). Default 0. */
  distance: z
    .number()
    .optional()
    .describe('The range in world units past which it adds nothing (0: no limit). Default 0.'),
  /** How fast the light dims with distance (2: physically correct). Default 2. */
  decay: z
    .number()
    .optional()
    .describe('How fast it dims with distance (2: physically correct). Default 2.'),
  /** A spot light's cone half-angle in radians, at most π / 2. Default π / 3. */
  angle: z
    .number()
    .optional()
    .describe("The cone's half-angle in radians, at most π/2. Default π/3."),
  /** The share of the cone that fades at its edge, 0-1. Default 0. */
  penumbra: z
    .number()
    .optional()
    .describe('The share of the cone that fades at its edge, 0-1. Default 0.'),
  /** Where the light is. A directional light's direction is from here to `targetPos`. */
  position: Vector3Schema.optional().describe(
    'Where the light is. A directional light shines from here to targetPos.'
  ),
  /** Where a directional or spot light points: its target entity's position. Default the origin. */
  targetPos: Vector3Schema.optional().describe(
    "Where it points: its target entity's position. Default the origin."
  ),
  /** Casts shadows. Default false. */
  castShadow: z.boolean().optional().describe('Casts shadows. Default false.'),
  /** Opts into the ECS frustum culling: the light switches off while outside the camera's view. */
  frustumCullingEnabled: z
    .boolean()
    .optional()
    .describe("Opts into the ECS frustum culling: off while outside the camera's view."),
  /** Opts into the spatial index's object culling (`spatial()`). */
  objectCullingEnabled: z
    .boolean()
    .optional()
    .describe("Opts into the spatial index's object culling."),
  /** The shadow preset, which the `shadow*` fields below fine-tune. Default `MEDIUM`. */
  shadowPreset: ShadowQualitySchema.optional(),
  /** Over the preset: the depth bias that keeps a surface from shadowing itself. */
  shadowBias: z
    .number()
    .optional()
    .describe('Over the preset: the depth bias against self-shadowing (acne).'),
  /** Over the preset: the bias along the surface normal. */
  shadowNormalBias: z.number().optional().describe('Over the preset: the bias along the normal.'),
  /** Over the preset: the shadow map's width and height in px. */
  shadowMapSize: PairSchema.optional().describe(
    "Over the preset: the shadow map's [width, height] in px."
  ),
  /** The shadow camera's near and far planes. */
  shadowCameraNearFar: PairSchema.optional().describe("The shadow camera's [near, far]."),
  /** A directional light's shadow camera bounds: left, right, top and bottom. */
  shadowCameraFrustum: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional()
    .describe("The shadow camera's [left, right, top, bottom] in world units."),
  /** Over the preset: the soft shadow's sample count. */
  shadowBlurSamples: z.number().optional().describe("Over the preset: the soft shadow's samples."),
  /** Over the preset: the soft shadow's blur radius. */
  shadowRadius: z.number().optional().describe("Over the preset: the soft shadow's blur radius."),
  /** How dark the shadow is, 0-1. Default 1. */
  shadowIntensity: z.number().optional().describe('How dark the shadow is, 0-1. Default 1.'),
  /** A spot light's cookie: the id of a texture the scene loads. */
  map: z.string().optional().describe('The cookie: the id of a texture the scene loads.'),
};

type LightField = keyof typeof LIGHT_FIELDS;

/** `LIGHT_FIELDS`' `keys`, in that order (the generated data's key order) */
const pick = <K extends LightField>(...keys: K[]) =>
  Object.fromEntries(keys.map((key) => [key, LIGHT_FIELDS[key]])) as Pick<typeof LIGHT_FIELDS, K>;

const SHADOW_FIELDS = [
  'shadowPreset',
  'shadowBias',
  'shadowNormalBias',
  'shadowMapSize',
  'shadowCameraNearFar',
] as const;
const SHADOW_BLUR_FIELDS = ['shadowBlurSamples', 'shadowRadius', 'shadowIntensity'] as const;

const Ambient = z.object({
  ...pick('enabled', 'appId'),
  /** An ambient light: lights everything evenly. */
  type: z.literal('AMBIENT').describe('An ambient light: lights everything evenly.'),
  ...pick('color', 'intensity'),
});

const Hemisphere = z.object({
  ...pick('enabled', 'appId'),
  /** A hemisphere light: a sky colour from above fading to a ground colour from below. */
  type: z.literal('HEMISPHERE').describe('A sky colour from above fading to a ground colour.'),
  ...pick('color', 'groundColor', 'intensity'),
});

const Point = z.object({
  ...pick('enabled', 'appId'),
  /** A point light: shines every way from its position. */
  type: z.literal('POINT').describe('A point light: shines every way from its position.'),
  ...pick('color', 'intensity', 'distance', 'decay', 'position', 'castShadow'),
  ...pick('frustumCullingEnabled', 'objectCullingEnabled', ...SHADOW_FIELDS, ...SHADOW_BLUR_FIELDS),
});

const Directional = z.object({
  ...pick('enabled', 'appId'),
  /** A directional light: parallel rays, like the sun's. */
  type: z.literal('DIRECTIONAL').describe("Parallel rays, like the sun's."),
  ...pick('color', 'intensity', 'position', 'targetPos', 'castShadow', ...SHADOW_FIELDS),
  ...pick('shadowCameraFrustum', ...SHADOW_BLUR_FIELDS),
});

const Spot = z.object({
  ...pick('enabled', 'appId'),
  /** A spot light: a cone from its position towards its target. */
  type: z.literal('SPOT').describe('A cone from its position towards its target.'),
  ...pick('color', 'intensity', 'distance', 'angle', 'penumbra', 'decay', 'position'),
  ...pick('targetPos', 'castShadow', 'frustumCullingEnabled', 'objectCullingEnabled'),
  ...pick(...SHADOW_FIELDS, ...SHADOW_BLUR_FIELDS, 'map'),
});

const LIGHT_VARIANTS = [Ambient, Hemisphere, Point, Directional, Spot] as const;

const LightProps = z
  .discriminatedUnion('type', LIGHT_VARIANTS)
  .describe('The light: AMBIENT, HEMISPHERE, POINT, DIRECTIONAL or SPOT, and its settings.');

// Every type's fields, each optional: a save entry replaces the fields it gives
const LightOverridesSchema = z
  .object({
    __meta: MetaSchema,
    ...pick('enabled', 'appId'),
    type: z.enum(LIGHT_VARIANTS.map((variant) => variant.shape.type.value)),
    ...LIGHT_FIELDS,
  })
  .partial();

/**
 * A light JSON (`*.light.json`): its props (the runtime's `LightProps` for `createLightEntity`),
 * its entity options and its per-scene save entries.
 */
export const LightAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The light's type and settings. */
  lightProps: LightProps,
  /** The light entity's options. */
  entityOpts: CoreEntityOptsSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over `lightProps` (the first applies). */
  __saveData: createSaveDataSchema(LightOverridesSchema),
});

/** A light JSON (`*.light.json`), as {@link LightAssetSchema} validates it. */
export type LightAsset = z.infer<typeof LightAssetSchema>;
