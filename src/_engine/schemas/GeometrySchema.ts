import { z } from 'zod';
import { createSaveDataSchema, MetaSchema } from './_SaveDataSchema';
import { DebugDataSchema } from './_HelperSchemas';

const GeoBaseProps = z.object({
  id: z.string().optional(),
  debugData: DebugDataSchema.optional(),
});

const BoxVariant = GeoBaseProps.extend({
  type: z.literal('BOX'),
  params: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      depth: z.number().optional(),
      widthSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      depthSegments: z.number().optional(),
    })
    .optional(),
});

const SphereVariant = GeoBaseProps.extend({
  type: z.literal('SPHERE'),
  params: z
    .object({
      radius: z.number().optional(),
      widthSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      phiStart: z.number().optional(),
      phiLength: z.number().optional(),
      thetaStart: z.number().optional(),
      thetaLength: z.number().optional(),
    })
    .optional(),
});

const CylinderVariant = GeoBaseProps.extend({
  type: z.literal('CYLINDER'),
  params: z
    .object({
      radiusTop: z.number().optional(),
      radiusBottom: z.number().optional(),
      height: z.number().optional(),
      radialSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      openEnded: z.boolean().optional(),
      thetaStart: z.number().optional(),
      thetaLength: z.number().optional(),
    })
    .optional(),
});

const CapsuleVariant = GeoBaseProps.extend({
  type: z.literal('CAPSULE'),
  params: z
    .object({
      radius: z.number().optional(),
      height: z.number().optional(),
      capSegments: z.number().optional(),
      radialSegments: z.number().optional(),
      heightSegments: z.number().optional(),
    })
    .optional(),
});

const ConeVariant = GeoBaseProps.extend({
  type: z.literal('CONE'),
  params: z
    .object({
      radius: z.number().optional(),
      height: z.number().optional(),
      radialSegments: z.number().optional(),
      heightSegments: z.number().optional(),
      openEnded: z.boolean().optional(),
      thetaStart: z.number().optional(),
      thetaLength: z.number().optional(),
    })
    .optional(),
});

const GEO_VARIANTS = [
  BoxVariant,
  SphereVariant,
  CylinderVariant,
  CapsuleVariant,
  ConeVariant,
] as const;

export const GeoPropsSchema = z.discriminatedUnion('type', GEO_VARIANTS);

export type GeoProps = z.infer<typeof GeoPropsSchema>;

// Every type's params, each optional: a save entry's params go over the geometry's
const GeoOverridesSchema = z.object({
  __meta: MetaSchema.optional(),
  debugData: DebugDataSchema.optional(),
  params: z
    .object({
      ...BoxVariant.shape.params.unwrap().shape,
      ...SphereVariant.shape.params.unwrap().shape,
      ...CylinderVariant.shape.params.unwrap().shape,
      ...CapsuleVariant.shape.params.unwrap().shape,
      ...ConeVariant.shape.params.unwrap().shape,
    })
    .optional(),
});

export type GeoOverrides = z.infer<typeof GeoOverridesSchema>;

export const GeoAssetSchema = z.object({
  $schema: z.string().optional(),
  geoProps: GeoPropsSchema,
  __sourcePath: z.string().optional(),
  __saveData: createSaveDataSchema(GeoOverridesSchema),
});

export type GeoAsset = z.infer<typeof GeoAssetSchema>;
