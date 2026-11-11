import { z } from 'zod';
import { DebugDataSchema, UserDataSchema } from '../../schemas/_HelperSchemas';
import { JsonSchemaRefSchema, SourcePathSchema } from '../../schemas/_SaveDataSchema';
import { TextureArrayOptimizeSchema } from '../../schemas/AssetsConfigSchema';

// A merge material's palette (`*.mergeMaterial.json`, docs/plans/p374_multi-material-merging.md
// D2): the materials one merge material stands in for, and a texture array per map slot. The
// gatherer checks the members' class (D1) from their material JSONs; the asset pipeline builds
// each slot's array.

/**
 * A palette's map slots: the merge material's array per map. `orm` packs a member's `aoMap` (r),
 * `roughnessMap` (g) and `metalnessMap` (b), as three reads them.
 */
export const MERGE_MATERIAL_SLOTS = ['map', 'normalMap', 'orm', 'emissiveMap'] as const;

/** A palette's map slot, one of {@link MERGE_MATERIAL_SLOTS}. */
export type MergeMaterialSlot = (typeof MERGE_MATERIAL_SLOTS)[number];

/** The material maps an `orm` slot packs, in its channel order (r, g, b). */
export const ORM_SOURCE_MAP_KEYS = ['aoMap', 'roughnessMap', 'metalnessMap'] as const;

/**
 * The most materials a palette holds: an array's layers, the floor on both backends (WebGPU's
 * default `maxTextureArrayLayers`, WebGL2's minimum `MAX_ARRAY_TEXTURE_LAYERS`).
 */
export const MAX_MERGE_MATERIAL_ENTRIES = 256;

const SlotSizeSchema = z
  .tuple([z.number().int().min(1), z.number().int().min(1)])
  .describe(
    "Width and height every layer is resized to (then fit to the optimize step's maxSize and to multiples of 4, as an array's)."
  );

const SlotMissingSchema = z
  .enum(['NEUTRAL', 'SKIP'])
  .optional()
  .describe(
    'A member without this map: NEUTRAL (default) samples a neutral layer (white, a flat normal), which keeps its scalars; SKIP skips the fetch for it (a uniform branch per triangle). Its layer is neutral either way.'
  );

const MergeMaterialSlotSchema = z
  .strictObject({
    /** The size every layer is resized to. */
    size: SlotSizeSchema,
    /** A member without this map: a neutral layer (`NEUTRAL`, default) or no fetch (`SKIP`). */
    missing: SlotMissingSchema,
  })
  .describe("One map slot's array: its layer size and what a member without the map gets.");

const OrmSourceKeySchema = z.enum(ORM_SOURCE_MAP_KEYS);

const MergeMaterialOrmSlotSchema = MergeMaterialSlotSchema.extend({
  /** The member maps packed into it. Default: all three. */
  from: z
    .array(OrmSourceKeySchema)
    .min(1)
    .refine((keys) => new Set(keys).size === keys.length, { message: 'a map is listed twice' })
    .optional()
    .describe(
      "The member maps packed into it (default all three): aoMap into r, roughnessMap into g, metalnessMap into b, as three reads them. A member's map left out fails the palette."
    ),
}).describe(
  'The packed occlusion / roughness / metalness array: its layer size, its source maps and what a member without them gets.'
);

/** One map slot of a palette (`slots.<name>`): its layer size and `missing`; `orm`'s also its
 * `from`. */
export type MergeMaterialSlotDef = z.infer<typeof MergeMaterialOrmSlotSchema>;

/**
 * A merge material's palette JSON (`*.mergeMaterial.json`): the materials one merge material
 * stands in for, in palette index order, and a texture array per map slot, each member's map as
 * its layer (built by the asset pipeline). The members must share a compatibility class (one
 * shader, one draw's state): the gatherer checks it from their material JSONs.
 */
export const MergeMaterialAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The registry id, in the materials' id space. Default: the file's name. */
  id: z
    .string()
    .optional()
    .describe(
      "The registry id, in the materials' id space (it becomes a material). Default: the file's name."
    ),
  /** The member materials' ids, in palette index order (a layer index in every slot). */
  materials: z
    .array(z.string().min(1).describe("A material JSON's id (*.material.json)."))
    .min(2)
    .max(MAX_MERGE_MATERIAL_ENTRIES)
    .superRefine((ids, ctx) => {
      const seen = new Map<string, number>();
      ids.forEach((id, index) => {
        const other = seen.get(id);
        if (other !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `"${id}" is listed twice (also at ${other})`,
          });
        }
        seen.set(id, index);
      });
    })
    .describe(
      `The member materials' ids (*.material.json), in palette index order: material i is layer i of every slot. 2-${MAX_MERGE_MATERIAL_ENTRIES}, each once.`
    ),
  /** The map slots, one texture array each. */
  slots: z
    .strictObject({
      /** The albedo array (sRGB). */
      map: MergeMaterialSlotSchema.optional().describe('The albedo array (sRGB).'),
      /** The normal map array. */
      normalMap: MergeMaterialSlotSchema.optional().describe('The normal map array.'),
      /** The packed occlusion / roughness / metalness array. */
      orm: MergeMaterialOrmSlotSchema.optional(),
      /** The emissive map array (sRGB). */
      emissiveMap: MergeMaterialSlotSchema.optional().describe('The emissive map array (sRGB).'),
    })
    .refine((slots) => Object.values(slots).some(Boolean), { message: 'no slots' })
    .describe(
      "The map slots, one texture array each: map, normalMap, orm (aoMap, roughnessMap and metalnessMap packed) and emissiveMap. A member's map needs its slot."
    ),
  /** Build time only: the asset pipeline's settings for every slot's array. */
  optimize: TextureArrayOptimizeSchema.omit({ slot: true })
    .optional()
    .describe(
      "The asset pipeline's settings for every slot's array: a profile and per-slot overrides (textures.baseColor, .normal, .orm, .emissive). Each array's slot is its own; the codec can't be none."
    ),
  /** Fails the load when an array can't load. Default: logs and uses an empty stand-in. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails the load when an array can't load. Default: logs it."),
  /** The merge material's `userData`. */
  userData: UserDataSchema.optional(),
  /** What the debug tools show for the palette. */
  debugData: DebugDataSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
});

/** A merge material's palette JSON (`*.mergeMaterial.json`), as {@link MergeMaterialAssetSchema}
 * validates it. */
export type MergeMaterialAsset = z.infer<typeof MergeMaterialAssetSchema>;
