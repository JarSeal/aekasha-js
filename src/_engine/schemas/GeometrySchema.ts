import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema, Vector3Schema, Vector4Schema } from './_HelperSchemas';

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
 * A primitive geometry's props: one variant per `type`, each with its three params. A mesh's
 * inline `geo` uses it (`createGeometry` builds it); {@link GeoAssetPropsSchema} adds `MERGED`.
 * @internal
 */
export const GeoPropsSchema = z
  .discriminatedUnion('type', GEO_VARIANTS)
  .describe('The geometry: BOX, SPHERE, CYLINDER, CAPSULE or CONE, and its params.');

/**
 * A primitive geometry's props, as {@link GeoPropsSchema} validates them. `RuntimeTypes.test.ts`
 * checks it against the runtime's `GeoProps`.
 * @internal
 */
export type GeoProps = z.infer<typeof GeoPropsSchema>;

/** One part of a `MERGED` geometry: a registered geometry and its transform into the merge. */
const MergedGeoPartSchema = z.object({
  /** A geometry JSON's id, or an imported asset's piece (`<importId>/<nodeName>`). Not another
   * `MERGED` geometry. */
  geo: z
    .string()
    .describe("A geometry JSON's id, or an imported piece (<importId>/<nodeName>); not MERGED."),
  /** Where the part goes in the merged geometry. Default: the origin. */
  position: Vector3Schema.optional().describe('Where the part goes. Default: the origin.'),
  /** Euler angles in radians (XYZ order); `quaternion` wins over it. */
  rotation: Vector3Schema.optional().describe('Euler angles in radians; quaternion wins over it.'),
  /** A rotation quaternion. */
  quaternion: Vector4Schema.optional().describe('A rotation quaternion.'),
  /** The part's scale; a negative component mirrors it (its winding is flipped). Default 1. */
  scale: Vector3Schema.optional().describe('The scale; negative mirrors. Default 1.'),
  /** The material slot (the group's `materialIndex`) with `groups: 'BY_SLOT'`. Default 0. */
  materialSlot: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("The material slot with groups 'BY_SLOT'. Default 0."),
  /** An id for the part, kept in the merged geometry's `userData.mergeParts`. */
  key: z.string().optional().describe('An id for the part, kept in userData.mergeParts.'),
});

const MergedVariant = GeoBaseProps.extend({
  /** Several registered geometries, each with its transform, merged into one (one draw). */
  type: z.literal('MERGED').describe('Several geometries merged into one.'),
  /** The parts and the merge's options. */
  params: z
    .object({
      /** The parts, in the merged order. */
      parts: z.array(MergedGeoPartSchema).min(1).describe('The parts, in the merged order.'),
      /** `BY_SLOT` makes one geometry group per `materialSlot`, for a material array. Default
       * `NONE`. */
      groups: z
        .enum(['NONE', 'BY_SLOT'])
        .optional()
        .describe("BY_SLOT: one group per materialSlot. Default 'NONE'."),
      /** `UNION` fills an attribute a part lacks; `INTERSECTION` keeps only the shared ones.
       * Default `UNION`. */
      attributes: z
        .enum(['UNION', 'INTERSECTION'])
        .optional()
        .describe("UNION fills missing attributes; INTERSECTION drops them. Default 'UNION'."),
      /** An indexed result. Default true. */
      indexed: z.boolean().optional().describe('An indexed result. Default true.'),
    })
    .describe("The parts and the merge's options."),
});

/**
 * A geometry JSON's props (`*.geometry.json`'s `geoProps`, and a scene's inline `geometries`):
 * a primitive ({@link GeoPropsSchema}) or `MERGED`, which the scene loader merges from its parts.
 * A mesh's inline `geo` can't be `MERGED`.
 * @internal
 */
export const GeoAssetPropsSchema = z
  .discriminatedUnion('type', [...GEO_VARIANTS, MergedVariant])
  .describe('The geometry: BOX, SPHERE, CYLINDER, CAPSULE, CONE or MERGED, and its params.');

/**
 * A geometry JSON's props, as {@link GeoAssetPropsSchema} validates them. `RuntimeTypes.test.ts`
 * checks its `MERGED` member against the runtime's `MergedGeoProps`.
 * @internal
 */
export type GeoAssetProps = z.infer<typeof GeoAssetPropsSchema>;

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
  geoProps: GeoAssetPropsSchema,
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over the params and `debugData` (the first applies). */
  __saveData: createSaveDataSchema(GeoOverridesSchema),
});

/** A geometry JSON (`*.geometry.json`), as {@link GeoAssetSchema} validates it. */
export type GeoAsset = z.infer<typeof GeoAssetSchema>;
