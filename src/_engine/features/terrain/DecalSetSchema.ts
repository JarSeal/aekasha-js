import { z } from 'zod';
import { DebugDataSchema, type DebugData } from '../../schemas/_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from '../../schemas/_SaveDataSchema';

// The decal set asset (p309 D3): an import's mesh decals (planes UV'd into a decal atlas's cells,
// conformed to a block in Blender) with their decal material and render order, no physics. The
// gatherer fills the defaults in and writes each set a scene lists (or a terrain block of it names)
// into its data (`DecalSetDef`), where `spawnDecalSet` reads it.

/** The defaults the gather fills in: drawn after the terrain (0) and before other transparents
 * (20 and up), receiving shadows. */
export const DECAL_SET_DEFAULTS = { renderOrder: 10, receiveShadow: true } as const;

// p309 D3
/**
 * A decal set (`*.decalSet.json`): an import's mesh decals drawn in a decal material. Each
 * node's mesh is a decal: its UVs in its atlas cell and a second UV set (`uv1`) 0..1 over the
 * decal, which the decal material's edge fade reads. A terrain block lists its sets in `decals`, a
 * scene the ones its code spawns in `decalSets`.
 */
export const DecalSetAssetSchema = z
  .strictObject({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The set's id. Default: the file name without `.decalSet.json`. */
    id: z
      .string()
      .min(1)
      .optional()
      .describe('The id. Default: the file name without .decalSet.json.'),
    /** The `*.importedAsset.json`'s id: its meshes are the decals. The gather adds it to a scene
     * listing the set. */
    importedAsset: z
      .string()
      .min(1)
      .describe(
        "The *.importedAsset.json's id: its meshes are the decals. The gather adds it to a scene listing the set."
      ),
    /** The decal material's id (a `*.material.json`, eg. the toolkit's `decalsGround_blend`). The
     * gather adds it to a scene listing the set. */
    material: z
      .string()
      .min(1)
      .describe(
        "The decal material's id (a *.material.json, eg. the toolkit's decalsGround_blend). The gather adds it to a scene listing the set."
      ),
    /** The meshes' draw order within a pass. Default: 10 (after the terrain's 0, before other
     * transparents' 20 and up). */
    renderOrder: z
      .number()
      .int()
      .optional()
      .describe(
        "The meshes' draw order within a pass. Default: 10 (after the terrain's 0, before other transparents' 20 and up)."
      ),
    /** The meshes receive shadows. Default: true. Decals never cast them. */
    receiveShadow: z
      .boolean()
      .optional()
      .describe('The meshes receive shadows. Default: true. Decals never cast them.'),
    /** The debug tools' name and description. */
    debugData: DebugDataSchema.optional(),
    /** Set by the gatherer. */
    __sourcePath: SourcePathSchema.optional(),
  })
  .describe("A decal set: an import's mesh decals, their decal material and render order.");

/** A decal set's JSON (`*.decalSet.json`), as written. */
export type DecalSetAsset = z.infer<typeof DecalSetAssetSchema>;

/**
 * A decal set as a scene's data has it (the gatherer's): its JSON with the defaults filled in.
 * `spawnDecalSet` spawns it.
 */
export type DecalSetDef = {
  /** The set's id */
  id: string;
  /** The import whose meshes are the decals */
  importedAsset: string;
  /** The decal material's id */
  material: string;
  /** The meshes' draw order within a pass */
  renderOrder: number;
  /** The meshes receive shadows */
  receiveShadow: boolean;
  /** The debug tools' name and description (not in a production build) */
  debugData?: DebugData;
};
