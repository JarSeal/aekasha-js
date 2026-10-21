import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema } from './_HelperSchemas';

const GeoBaseProps = z.object({
  /** The registry id. Default: the JSON's file name (a scene's inline geometry: the geometry's
   * uuid). */
  id: z.string().optional().describe("The registry id. Default: the file's name."),
  /** What the debug tools show for the geometry. */
  debugData: DebugDataSchema.optional(),
});

const BoxVariant = GeoBaseProps.extend({
  /** A box (three's `BoxGeometry`). */
  type: z.literal('BOX').describe('A box.'),
  /** The constructor's arguments by name; three's defaults for those left out. */
  params: z
    .object({
      /** The width (x). Default 1. */
      width: z.number().optional().describe('The width (x). Default 1.'),
      /** The height (y). Default 1. */
      height: z.number().optional().describe('The height (y). Default 1.'),
      /** The depth (z). Default 1. */
      depth: z.number().optional().describe('The depth (z). Default 1.'),
      /** Segments along the width. Default 1. */
      widthSegments: z.number().optional().describe('Segments along the width. Default 1.'),
      /** Segments along the height. Default 1. */
      heightSegments: z.number().optional().describe('Segments along the height. Default 1.'),
      /** Segments along the depth. Default 1. */
      depthSegments: z.number().optional().describe('Segments along the depth. Default 1.'),
    })
    .optional()
    .describe("The constructor's arguments by name; three's defaults for those left out."),
});

const SphereVariant = GeoBaseProps.extend({
  /** A sphere (three's `SphereGeometry`). */
  type: z.literal('SPHERE').describe('A sphere.'),
  /** The constructor's arguments by name; three's defaults for those left out. */
  params: z
    .object({
      /** The radius. Default 1. */
      radius: z.number().optional().describe('The radius. Default 1.'),
      /** Segments along the width. Default 32. */
      widthSegments: z.number().optional().describe('Segments along the width. Default 32.'),
      /** Segments along the height. Default 16. */
      heightSegments: z.number().optional().describe('Segments along the height. Default 16.'),
      /** The horizontal start angle in radians. Default 0. */
      phiStart: z.number().optional().describe('The horizontal start angle in radians. Default 0.'),
      /** The horizontal sweep in radians. Default 2π. */
      phiLength: z.number().optional().describe('The horizontal sweep in radians. Default 2π.'),
      /** The vertical start angle in radians. Default 0. */
      thetaStart: z.number().optional().describe('The vertical start angle in radians. Default 0.'),
      /** The vertical sweep in radians. Default π. */
      thetaLength: z.number().optional().describe('The vertical sweep in radians. Default π.'),
    })
    .optional()
    .describe("The constructor's arguments by name; three's defaults for those left out."),
});

const CylinderVariant = GeoBaseProps.extend({
  /** A cylinder (three's `CylinderGeometry`). */
  type: z.literal('CYLINDER').describe('A cylinder.'),
  /** The constructor's arguments by name; three's defaults for those left out. */
  params: z
    .object({
      /** The top radius. Default 1. */
      radiusTop: z.number().optional().describe('The top radius. Default 1.'),
      /** The bottom radius. Default 1. */
      radiusBottom: z.number().optional().describe('The bottom radius. Default 1.'),
      /** The height (y). Default 1. */
      height: z.number().optional().describe('The height (y). Default 1.'),
      /** Segments around the circumference. Default 32. */
      radialSegments: z
        .number()
        .optional()
        .describe('Segments around the circumference. Default 32.'),
      /** Segments along the height. Default 1. */
      heightSegments: z.number().optional().describe('Segments along the height. Default 1.'),
      /** Leaves the ends open. Default false. */
      openEnded: z.boolean().optional().describe('Leaves the ends open. Default false.'),
      /** The start angle in radians. Default 0. */
      thetaStart: z.number().optional().describe('The start angle in radians. Default 0.'),
      /** The sweep in radians. Default 2π. */
      thetaLength: z.number().optional().describe('The sweep in radians. Default 2π.'),
    })
    .optional()
    .describe("The constructor's arguments by name; three's defaults for those left out."),
});

const CapsuleVariant = GeoBaseProps.extend({
  /** A capsule (three's `CapsuleGeometry`): `height` is the middle section's. */
  type: z.literal('CAPSULE').describe("A capsule (height is the middle section's)."),
  /** The constructor's arguments by name; three's defaults for those left out. */
  params: z
    .object({
      /** The radius. Default 1. */
      radius: z.number().optional().describe('The radius. Default 1.'),
      /** The middle section's height. Default 1. */
      height: z.number().optional().describe("The middle section's height. Default 1."),
      /** Segments of each end cap's curve. Default 4. */
      capSegments: z.number().optional().describe("Segments of each end cap's curve. Default 4."),
      /** Segments around the circumference. Default 8. */
      radialSegments: z
        .number()
        .optional()
        .describe('Segments around the circumference. Default 8.'),
      /** Segments along the height. Default 1. */
      heightSegments: z.number().optional().describe('Segments along the height. Default 1.'),
    })
    .optional()
    .describe("The constructor's arguments by name; three's defaults for those left out."),
});

const ConeVariant = GeoBaseProps.extend({
  /** A cone (three's `ConeGeometry`). */
  type: z.literal('CONE').describe('A cone.'),
  /** The constructor's arguments by name; three's defaults for those left out. */
  params: z
    .object({
      /** The base radius. Default 1. */
      radius: z.number().optional().describe('The base radius. Default 1.'),
      /** The height (y). Default 1. */
      height: z.number().optional().describe('The height (y). Default 1.'),
      /** Segments around the circumference. Default 32. */
      radialSegments: z
        .number()
        .optional()
        .describe('Segments around the circumference. Default 32.'),
      /** Segments along the height. Default 1. */
      heightSegments: z.number().optional().describe('Segments along the height. Default 1.'),
      /** Leaves the ends open. Default false. */
      openEnded: z.boolean().optional().describe('Leaves the ends open. Default false.'),
      /** The start angle in radians. Default 0. */
      thetaStart: z.number().optional().describe('The start angle in radians. Default 0.'),
      /** The sweep in radians. Default 2π. */
      thetaLength: z.number().optional().describe('The sweep in radians. Default 2π.'),
    })
    .optional()
    .describe("The constructor's arguments by name; three's defaults for those left out."),
});

const GEO_VARIANTS = [
  BoxVariant,
  SphereVariant,
  CylinderVariant,
  CapsuleVariant,
  ConeVariant,
] as const;

/**
 * A geometry's props (`*.geometry.json`'s `geoProps`): one variant per `type`, each with its three
 * params. The scene's inline `geometries` and a mesh's `geo` use it.
 * @internal
 */
export const GeoPropsSchema = z
  .discriminatedUnion('type', GEO_VARIANTS)
  .describe('The geometry: BOX, SPHERE, CYLINDER, CAPSULE or CONE, and its params.');

/**
 * A geometry JSON's props, as {@link GeoAssetSchema} validates them. `RuntimeTypes.test.ts` checks
 * it against the runtime's `GeoProps`.
 * @internal
 */
export type GeoProps = z.infer<typeof GeoPropsSchema>;

// Every type's params, each optional: a save entry's params go over the geometry's
const GeoOverridesSchema = z.object({
  /** When the entry was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  /** Over the geometry's `debugData`. */
  debugData: DebugDataSchema.optional(),
  /** Over the geometry's params. */
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

/**
 * A geometry JSON (`*.geometry.json`): its props (the runtime's `GeoProps` for
 * `createGeometry`) and its per-scene save entries.
 */
export const GeoAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The geometry's type and params. */
  geoProps: GeoPropsSchema,
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over the params and `debugData` (the first applies). */
  __saveData: createSaveDataSchema(GeoOverridesSchema),
});

/** A geometry JSON (`*.geometry.json`), as {@link GeoAssetSchema} validates it. */
export type GeoAsset = z.infer<typeof GeoAssetSchema>;
