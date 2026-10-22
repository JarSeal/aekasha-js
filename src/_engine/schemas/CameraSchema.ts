import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { CoreEntityOptsSchema, Vector3Schema } from './_HelperSchemas';

const CameraBaseProps = z.object({
  /** Makes it the main camera, the one the scene renders through (in another world than the
   * default, only that world's main camera). Default: the first camera while none is active. */
  active: z
    .boolean()
    .optional()
    .describe('Makes it the main camera. Default: the first camera while none is active.'),
  /** The near clipping plane. Default 0.1. */
  near: z.number().optional().describe('The near clipping plane. Default 0.1.'),
  /** The far clipping plane. Default 2000. */
  far: z.number().optional().describe('The far clipping plane. Default 2000.'),
  /** three's zoom factor. Default 1. */
  zoom: z.number().optional().describe("three's zoom factor. Default 1."),
  /** The id a scene lists the JSON by (default: the file's name), and the entity's app id, over
   * `entityOpts.appId` (default: a generated UUID). Also keys the debugger's saved overrides. */
  appId: z
    .string()
    .optional()
    .describe(
      "The id scenes list it by (default: the file's name), and the entity's app id (default: a UUID)."
    ),
  /** Where the camera is. Default: the origin. */
  position: Vector3Schema.optional().describe('Where the camera is. Default: the origin.'),
  /** A point the camera looks at once created. */
  lookAtPoint: Vector3Schema.optional().describe('A point the camera looks at once created.'),
  /** Keeps the horizontal field of view (or an orthographic camera's width) of
   * `referenceAspect` at every canvas aspect, instead of the vertical one. Default false. */
  responsiveAspect: z
    .boolean()
    .optional()
    .describe(
      "Keeps the horizontal field of view (an orthographic camera's width) of referenceAspect at every canvas aspect. Default false."
    ),
  /** The aspect `fov` or `frustumSize` is authored for, with `responsiveAspect`. Default 16 / 9. */
  referenceAspect: z
    .number()
    .optional()
    .describe(
      'The aspect fov or frustumSize is authored for, with responsiveAspect. Default 16/9.'
    ),
});

const CameraPerspective = CameraBaseProps.extend({
  /** A perspective camera. */
  type: z.literal('PERSPECTIVE').describe('A perspective camera.'),
  /** The vertical field of view in degrees. Default 45. */
  fov: z.number().optional().describe('The vertical field of view in degrees. Default 45.'),
});

const CameraOrthographic = CameraBaseProps.extend({
  /** An orthographic camera. */
  type: z.literal('ORTHOGRAPHIC').describe('An orthographic camera.'),
  /** The view's height in world units (its width follows the aspect). Default 10. */
  frustumSize: z
    .number()
    .optional()
    .describe("The view's height in world units (its width follows the aspect). Default 10."),
});

const CAMERA_VARIANTS = [CameraPerspective, CameraOrthographic] as const;

/**
 * A camera's props (a `*.camera.json`'s `camProps`), which `createCameraEntity` takes as
 * they are: a perspective or orthographic camera, its clipping planes and zoom, where it is and
 * looks, and whether it keeps its horizontal view at every aspect.
 */
export const CameraProps = z
  .discriminatedUnion('type', CAMERA_VARIANTS)
  .describe('The camera: PERSPECTIVE or ORTHOGRAPHIC, and its settings.');
/**
 * A camera's props (a `*.camera.json`'s `camProps`), as `createCameraEntity` takes them.
 */
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

/**
 * A camera JSON (`*.camera.json`): its props, its entity options and its per-scene save entries.
 */
export const CameraAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The camera's props. */
  camProps: CameraProps,
  /** The camera entity's options. */
  entityOpts: CoreEntityOptsSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over `camProps` (the first applies). */
  __saveData: createSaveDataSchema(CameraOverridesSchema),
});

/** A camera JSON (`*.camera.json`), as {@link CameraAssetSchema} validates it. */
export type CameraAsset = z.infer<typeof CameraAssetSchema>;
