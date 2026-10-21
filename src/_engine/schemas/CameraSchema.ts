import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
import { CoreEntityOptsSchema, Vector3Schema } from './_HelperSchemas';

const CameraBaseProps = z.object({
  active: z.boolean().optional(),
  near: z.number().optional(),
  far: z.number().optional(),
  zoom: z.number().optional(),
  appId: z.string().optional(),
  position: Vector3Schema.optional(),
  lookAtPoint: Vector3Schema.optional(),
  responsiveAspect: z.boolean().optional(),
  referenceAspect: z.number().optional(),
});

const CameraPerspective = CameraBaseProps.extend({
  type: z.literal('PERSPECTIVE'),
  fov: z.number().optional(),
});

const CameraOrthographic = CameraBaseProps.extend({
  type: z.literal('ORTHOGRAPHIC'),
  frustumSize: z.number().optional(),
});

const CAMERA_VARIANTS = [CameraPerspective, CameraOrthographic] as const;

export const CameraProps = z.discriminatedUnion('type', CAMERA_VARIANTS);
export type CameraProps = z.infer<typeof CameraProps>;

// Both types' fields, each optional: a save entry replaces the fields it gives
const CameraOverridesSchema = z
  .object({
    __meta: MetaSchema,
    ...CameraPerspective.shape,
    ...CameraOrthographic.shape,
    type: z.enum(CAMERA_VARIANTS.map((variant) => variant.shape.type.value)),
  })
  .partial();

export const CameraAssetSchema = z.object({
  $schema: z.string().optional(),
  camProps: CameraProps,
  entityOpts: CoreEntityOptsSchema.optional(),
  __sourcePath: z.string().optional(),
  __saveData: createSaveDataSchema(CameraOverridesSchema),
});

export type CameraAsset = z.infer<typeof CameraAssetSchema>;
