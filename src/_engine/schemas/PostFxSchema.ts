import { z } from 'zod';
import {
  createSaveDataSchema,
  JsonSchemaRefSchema,
  MetaSchema,
  SourcePathSchema,
} from './_SaveDataSchema';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';

// The pass's params: plain JSON values handed to its `fxNode` as they are, not made into uniforms
// (the pass decides what becomes a uniform)
const PostFxParamsSchema = z
  .record(z.string(), z.unknown())
  .describe("Flat params, handed to the pass's fxNode as JSON values (not uniforms).");

// The debugger's hints for one param's control; the control's kind comes from the param's value
const PostFxParamMetaSchema = z
  .object({
    /** The control's label. Default: the param's key. */
    label: z.string().describe("The control's label. Default: the param's key."),
    /** A number param's slider minimum. */
    min: z.number().describe("A number param's slider minimum."),
    /** A number param's slider maximum. */
    max: z.number().describe("A number param's slider maximum."),
    /** A number param's slider step. */
    step: z.number().describe("A number param's slider step."),
    /** Makes the control a drop-down: each option's text → the param's value. */
    options: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .describe("A drop-down: each option's text → the param's value."),
    /** Leaves the param out of the debugger. */
    hidden: z.boolean().describe('Leaves the param out of the debugger.'),
  })
  .partial()
  .describe("The debugger's hints for the param's control.");

/** A PostFX pass JSON's debugger hints for one param (`paramsMeta`'s values): its label, slider
 * bounds, dropdown options, or that the debugger leaves it out. */
export type PostFxParamMeta = z.infer<typeof PostFxParamMetaSchema>;

// The build-time flags handed to `fxNode` as its third argument
const PostFxStaticDefinesSchema = z
  .record(z.string(), z.unknown())
  .describe("Handed to the pass's fxNode as its third argument (build-time flags).");

const PostFxOverridesSchema = z.object({
  /** When the entry was saved, and the versions then. */
  __meta: MetaSchema.optional(),
  /** Whether the pass is part of the chain. */
  enabled: z.boolean().optional().describe('Whether the pass is part of the chain. Default true.'),
  /** Over the pass's `params`. */
  params: PostFxParamsSchema.optional(),
  /** Over the pass's `staticDefines`. */
  staticDefines: PostFxStaticDefinesSchema.optional(),
  /** Over the pass's `debugData`. */
  debugData: DebugDataSchema.optional(),
  /** Over the pass's `userData`. */
  userData: UserDataSchema.optional(),
});

/**
 * A PostFX pass JSON (`*.postFx.json`): its TSL file and params, the debugger's hints and its
 * per-scene save entries. A scene's `postFx` lists passes in their order (the `postFx()` feature).
 */
export const PostFxAssetSchema = z.object({
  /** The pass's id, which a scene's `postFx` names it by. */
  id: z
    .string({ error: "PostFX pass 'id' key is required." })
    .describe("The pass's id, which a scene's postFx names it by."),
  /** The pass's TS file (exporting `fxNode`), relative to the first folder under `src/`
   * (`"postFx/ambientOcclusion.tsl.ts"`). */
  tslFile: z
    .string({ error: "PostFX pass 'tslFile' key is required." })
    .describe(
      'The pass\'s TS file (exporting fxNode), relative to the first folder under src/ ("postFx/ambientOcclusion.tsl.ts").'
    ),
  /** Whether the pass is part of the chain. Default true. */
  enabled: z.boolean().optional().describe('Whether the pass is part of the chain. Default true.'),
  /** Flat params, handed to `fxNode` as JSON values. */
  params: PostFxParamsSchema.optional(),
  /** The debugger's control hints per param key (the pass never reads them). */
  paramsMeta: z
    .record(z.string(), PostFxParamMetaSchema)
    .optional()
    .describe("The debugger's control hints per param key (the pass never reads them)."),
  /** Handed to `fxNode` as its third argument. */
  staticDefines: PostFxStaticDefinesSchema.optional(),
  /** What the debug tools show for the pass. */
  debugData: DebugDataSchema.optional(),
  /** Free-form data for the app. */
  userData: UserDataSchema.optional(),
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
  /** Per scene id, its save entries over the pass (the first applies). */
  __saveData: createSaveDataSchema(PostFxOverridesSchema),
});

/** A PostFX pass JSON (`*.postFx.json`), as {@link PostFxAssetSchema} validates it. */
export type PostFxAsset = z.infer<typeof PostFxAssetSchema>;
