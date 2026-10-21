import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
import {
  ColorJSONSchema,
  CoreEntityOptsSchema,
  ShadowQualitySchema,
  Vector3Schema,
} from './_HelperSchemas';

const LightBaseProps = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().optional(),
});

// A shadow map's width and height, a shadow camera's near and far
const PairSchema = z.tuple([z.number(), z.number()]);

const Ambient = LightBaseProps.extend({
  type: z.literal('AMBIENT'),
  color: ColorJSONSchema.optional(),
  intensity: z.number().optional(),
});

const Hemisphere = LightBaseProps.extend({
  type: z.literal('HEMISPHERE'),
  color: ColorJSONSchema.optional(),
  groundColor: ColorJSONSchema.optional(),
  intensity: z.number().optional(),
});

const Point = LightBaseProps.extend({
  type: z.literal('POINT'),
  color: ColorJSONSchema.optional(),
  intensity: z.number().optional(),
  distance: z.number().optional(),
  decay: z.number().optional(),
  position: Vector3Schema.optional(),
  castShadow: z.boolean().optional(),
  frustumCullingEnabled: z.boolean().optional(),
  objectCullingEnabled: z.boolean().optional(),
  shadowPreset: ShadowQualitySchema.optional(),
  shadowBias: z.number().optional(),
  shadowNormalBias: z.number().optional(),
  shadowMapSize: PairSchema.optional(),
  shadowCameraNearFar: PairSchema.optional(),
  shadowBlurSamples: z.number().optional(),
  shadowRadius: z.number().optional(),
  shadowIntensity: z.number().optional(),
});

const Directional = LightBaseProps.extend({
  type: z.literal('DIRECTIONAL'),
  color: ColorJSONSchema.optional(),
  intensity: z.number().optional(),
  position: Vector3Schema.optional(),
  targetPos: Vector3Schema.optional(),
  castShadow: z.boolean().optional(),
  shadowPreset: ShadowQualitySchema.optional(),
  shadowBias: z.number().optional(),
  shadowNormalBias: z.number().optional(),
  shadowMapSize: PairSchema.optional(),
  shadowCameraNearFar: PairSchema.optional(),
  shadowCameraFrustum: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  shadowBlurSamples: z.number().optional(),
  shadowRadius: z.number().optional(),
  shadowIntensity: z.number().optional(),
});

const Spot = LightBaseProps.extend({
  type: z.literal('SPOT'),
  color: ColorJSONSchema.optional(),
  intensity: z.number().optional(),
  distance: z.number().optional(),
  angle: z.number().optional(),
  penumbra: z.number().optional(),
  decay: z.number().optional(),
  position: Vector3Schema.optional(),
  targetPos: Vector3Schema.optional(),
  castShadow: z.boolean().optional(),
  frustumCullingEnabled: z.boolean().optional(),
  objectCullingEnabled: z.boolean().optional(),
  shadowPreset: ShadowQualitySchema.optional(),
  shadowBias: z.number().optional(),
  shadowNormalBias: z.number().optional(),
  shadowMapSize: PairSchema.optional(),
  shadowCameraNearFar: PairSchema.optional(),
  shadowBlurSamples: z.number().optional(),
  shadowRadius: z.number().optional(),
  shadowIntensity: z.number().optional(),
  map: z.string().optional(),
});

const LIGHT_VARIANTS = [Ambient, Hemisphere, Point, Directional, Spot] as const;

const LightProps = z.discriminatedUnion('type', LIGHT_VARIANTS);

export type LightProps = z.infer<typeof LightProps>;

// Every type's fields, each optional: a save entry replaces the fields it gives
const LightOverridesSchema = z
  .object({
    __meta: MetaSchema,
    ...Ambient.shape,
    ...Hemisphere.shape,
    ...Point.shape,
    ...Directional.shape,
    ...Spot.shape,
    type: z.enum(LIGHT_VARIANTS.map((variant) => variant.shape.type.value)),
  })
  .partial();

export type LightOverrides = z.infer<typeof LightOverridesSchema>;

export const LightAssetSchema = z.object({
  $schema: z.string().optional(),
  lightProps: LightProps,
  entityOpts: CoreEntityOptsSchema.optional(),
  __sourcePath: z.string().optional(),
  __saveData: createSaveDataSchema(LightOverridesSchema),
});

export type LightAsset = z.infer<typeof LightAssetSchema>;
