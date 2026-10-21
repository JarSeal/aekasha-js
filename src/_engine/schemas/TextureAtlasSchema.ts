import { z } from 'zod';
import { DebugDataSchema, UserDataSchema } from './_HelperSchemas';
import {
  AlphaCoverageSchema,
  GeneratedAssetFieldsSchema,
  refineAlphaCoverageSlot,
  TextureArrayOptimizeSchema,
} from './AssetsConfigSchema';
import { TexOptsSchema } from './TextureSchema';
import { JsonSchemaRefSchema, SourcePathSchema } from './_SaveDataSchema';

// A slot's name: it ends its texture's id, so no dots
const ATLAS_SLOT_NAME_PATTERN = /^[A-Za-z][A-Za-z\d_-]*$/;

/** An atlas slot's texture id, `<atlasId>.<slot>`: the id a scene or material names the slot by. */
export const getAtlasSlotTextureId = (atlasId: string, slot: string) => `${atlasId}.${slot}`;

/**
 * An atlas's `mipChain` values. {@link AtlasMipChain} is its type.
 * @internal
 */
export const ATLAS_MIP_CHAINS = ['PROTECTED', 'FULL'] as const;
/** An atlas's `mipChain`: `PROTECTED` stops the mip chain where the cells would mix, `FULL` goes
 * down to 1 × 1. */
export type AtlasMipChain = (typeof ATLAS_MIP_CHAINS)[number];

/** The mip levels of a full chain of a `width` × `height` image, level 0 included (down to
 * 1 × 1). */
export const getFullMipLevelCount = (width: number, height: number) =>
  Math.floor(Math.log2(Math.max(width, height))) + 1;

const PxSchema = z.number().int();

// A slot's `optimize`: an array's, plus the slot's own `alphaCoverage`
const TextureAtlasSlotOptimizeSchema = TextureArrayOptimizeSchema.extend({
  alphaCoverage: AlphaCoverageSchema.optional(),
})
  .superRefine(refineAlphaCoverageSlot)
  .describe(
    "The asset pipeline's settings: a profile, the slot and per-slot overrides, and the slot's alphaCoverage. The codec can't be none: an atlas slot is a KTX2 file."
  );

const TextureAtlasSlotSchema = z
  .strictObject({
    /** The slot texture's sampler state and colour space (`colorSpace` decides how its sources
     * are read). */
    texOpts: TexOptsSchema.optional(),
    /** A ready-made image of the whole layout, not composed from the cells (every cell needs a
     * `rect`). */
    image: z
      .string()
      .min(1)
      .optional()
      .describe(
        "A ready-made image of the whole layout (the atlas's `size`), relative to this JSON (\"./bake.png\") or served from src/public, or a texture asset's id: the slot isn't composed from its cells (no resize, edge extension or fill), so it holds them where their `rect`s say (every cell needs one) and no cell has a source in it. For an atlas a tool already composed, eg. an exported impostor's."
      ),
    /** RGB(A), linear 0-1: the atlas outside the cells, and cells without a source in this slot.
     * Default transparent black. */
    fill: z
      .union([
        z.tuple([z.number(), z.number(), z.number()]),
        z.tuple([z.number(), z.number(), z.number(), z.number()]),
      ])
      .optional()
      .describe(
        'RGB(A), linear 0..1 like a pack constant: the atlas outside the cells, and the cells without a source in this slot (default transparent black; a normal map wants [0.5, 0.5, 1]). Not with `image`.'
      ),
    /** Build time only: the asset pipeline's settings for the slot. */
    optimize: TextureAtlasSlotOptimizeSchema.optional(),
    /** The slot texture's `userData`. */
    userData: UserDataSchema.optional(),
    /** What the debug tools show for the slot texture. */
    debugData: DebugDataSchema.optional(),
  })
  .refine((slot) => !(slot.image && slot.fill), {
    message: '"image" is the whole slot: it has no "fill"',
  })
  .describe('One map slot: its texture settings, its fill or ready-made image, and its optimize.');

/** One map slot of an atlas JSON (`slots.<name>`): its texture settings, its fill or ready-made
 * image, and its build-time `optimize`. */
export type TextureAtlasSlot = z.infer<typeof TextureAtlasSlotSchema>;

const TextureAtlasCellSchema = z
  .strictObject({
    /** The cell's id: its key in the cell table. */
    id: z.string().min(1).describe("The cell's id: its key in the cell table."),
    /** x, y, width and height in the atlas's px (top-left origin), the padding included. Default:
     * placed by the packer. */
    rect: z
      .tuple([PxSchema.min(0), PxSchema.min(0), PxSchema.min(1), PxSchema.min(1)])
      .optional()
      .describe(
        "x, y, width and height in the atlas's px (top-left origin), the padding included: multiples of 4, and of the packer's grid (4 · 2^⌊log2 padding⌋) to keep every level the padding protects. Default: placed by the packer."
      ),
    /** A packed cell's content width and height in px. Default: its first source's size. */
    size: z
      .tuple([PxSchema.min(1), PxSchema.min(1)])
      .optional()
      .describe(
        "A packed cell's content width and height in px, the padding not included (default: its first source's size, in the order of `slots`). Not with `rect`."
      ),
    /** Per slot, the image resized into the cell: a texture asset's id or a source image. */
    sources: z
      .record(
        z.string(),
        z
          .string()
          .min(1)
          .describe(
            'A texture asset\'s id (its source file or pack, not its output), or a source image relative to this JSON ("./source/crack.png") or served from src/public ("/textures/crack.png").'
          )
      )
      .optional()
      .describe(
        'Per slot: the image resized into the cell. A slot left out gets its fill; a slot with an `image` takes none. Only left out when every slot has an `image`.'
      ),
    /** Free-form, passed through to the cell table. */
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Free-form, passed through to the cell table (eg. a decal's physical size)."),
  })
  .refine((cell) => !(cell.rect && cell.size), {
    message: '"rect" places the cell and sets its size: "size" is for a packed cell',
  })
  .describe("One cell: its id, its place or size, and each slot's source.");

/**
 * A texture atlas JSON (`*.textureAtlas.json`), built by the asset pipeline: cells of any size
 * packed into one layout, one KTX2 output per map slot (albedo, normal, …), and a cell table. At
 * runtime each slot is an ordinary texture with the id `<atlasId>.<slot>`
 * ({@link getAtlasSlotTextureId}); a scene lists the atlas id in its `textures` for every slot,
 * or a slot's id for that one.
 */
export const TextureAtlasAssetSchema = z.object({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** The atlas id, its slot textures' id prefix. Default: the file's name. */
  id: z
    .string()
    .optional()
    .describe("The atlas id, its slot textures' id prefix. Default: the file's name."),
  /** The layout's width and height in px (multiples of 4). */
  size: z
    .tuple([PxSchema.min(4).multipleOf(4), PxSchema.min(4).multipleOf(4)])
    .describe(
      "The layout's width and height in px (multiples of 4). A slot over its maxSize drops its top mip levels."
    ),
  /** Px of edge extension around each cell's content: the mip levels it protects. Default 8. */
  padding: PxSchema.min(0)
    .optional()
    .describe(
      "Px of edge extension around each cell's content (default 8). The mip chain stops at the level it protects: 2^level ≤ padding, so 16 keeps levels 0-4. Packed cells go on a grid of 4 · 2^⌊log2 padding⌋ px (64 for 16), so the last level's 4 × 4 compression blocks never hold two cells; an explicit rect off that grid shortens the chain."
    ),
  /** `PROTECTED` (default): the mip chain stops where the cells would mix. `FULL`: down to 1 × 1. */
  mipChain: z
    .enum(ATLAS_MIP_CHAINS)
    .optional()
    .describe(
      "PROTECTED (default): the mip chain stops at the last level the padding and the rects keep apart, so a cell never reads its neighbour. FULL: every level down to 1 × 1 (the exact 2 × 2 box, area-filtered past an odd size), so the cells mix below the protected levels: for cells whose neighbours are near-identical (an impostor's neighbouring views), where a short chain would shimmer at distance."
    ),
  /** The map slots by name, one output each. */
  slots: z
    .record(
      z
        .string()
        .regex(
          ATLAS_SLOT_NAME_PATTERN,
          "a slot's name is letters, digits, _ and - (it ends its texture's id, after a dot)"
        ),
      TextureAtlasSlotSchema
    )
    .refine((slots) => Object.keys(slots).length > 0, { message: 'no slots' })
    .describe('The map slots by name (letters, digits, _ and -), one output each.'),
  /** The cells, in packing order. */
  cells: z.array(TextureAtlasCellSchema).min(1).describe('The cells, in packing order.'),
  /** Fails a slot's load when its file can't load. Default: logs and uses an empty stand-in. */
  throwOnError: z
    .boolean()
    .optional()
    .describe("Fails a slot's load when its file can't load. Default: logs it."),
  /** The slot textures' `userData`. */
  userData: UserDataSchema.optional(),
  /** What the debug tools show for the atlas. */
  debugData: DebugDataSchema.optional(),
  /** Set by the gatherer: the file it came from. */
  __sourcePath: SourcePathSchema.optional(),
});

/** A texture atlas JSON (`*.textureAtlas.json`), as {@link TextureAtlasAssetSchema} validates it. */
export type TextureAtlasAsset = z.infer<typeof TextureAtlasAssetSchema>;

/** An atlas's `padding` when it gives none, in px. */
export const DEFAULT_ATLAS_PADDING = 8;

// One cell in the cell table
const TextureAtlasCellInfoSchema = z.object({
  /** The content rect as UVs, [u0, v0, u1, v1] with v up (three's, like a mesh's UVs). */
  uv: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** The content's width and height in the layout's px. */
  size: z.tuple([z.number(), z.number()]),
  /** The cell's `data`, as the atlas JSON gives it. */
  data: z.record(z.string(), z.unknown()).optional(),
});

/** One cell in an atlas slot's cell table (`__atlas.cells`): its UV rect, its size in px and its
 * `data`. */
export type TextureAtlasCellInfo = z.infer<typeof TextureAtlasCellInfoSchema>;

// A slot texture's `__atlas`, baked in by the gatherer
const TextureAtlasSlotInfoSchema = z.object({
  /** The atlas's id. */
  id: z.string(),
  /** The slot's name. */
  slot: z.string(),
  /** The layout's size in px. */
  size: z.tuple([z.number(), z.number()]),
  /** The atlas's padding in px. */
  padding: z.number(),
  /** Mip levels the layout keeps apart (level 0 included); a slot over its maxSize has fewer. */
  levels: z.number(),
  /** Set when the file has every level down to 1 × 1 (`mipChain: "FULL"`): the levels past
   * `levels` mix neighbouring cells. */
  mipChain: z.literal('FULL').optional(),
  /** Set when the slot is a ready-made image (`slots.<name>.image`), not composed from its cells. */
  fromImage: z.literal(true).optional(),
  /** The cell table, by cell id. */
  cells: z.record(z.string(), TextureAtlasCellInfoSchema),
});

/**
 * An atlas slot texture's `__atlas`, baked in by the gatherer: the layout, its padding and levels,
 * and the cell table. The kernel's texture and atlas registries read it.
 * @internal
 */
export type TextureAtlasSlotInfo = z.infer<typeof TextureAtlasSlotInfoSchema>;

// A slot as a texture in the generated data: written by the gatherer, never validated, so the
// schema is only its type's
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the type's source
const TextureAtlasSlotTextureSchema = z.object({
  /** The slot texture's id, `<atlasId>.<slot>`. */
  id: z.string(),
  /** The slot's sampler state and colour space. */
  texOpts: TexOptsSchema.optional(),
  /** The atlas's `throwOnError`. */
  throwOnError: z.boolean().optional(),
  /** The atlas's and the slot's `userData`. */
  userData: UserDataSchema.optional(),
  /** The slot's `debugData`. */
  debugData: DebugDataSchema.optional(),
  /** The atlas JSON it came from. */
  __sourcePath: z.string().optional(),
  /** The layout and the cell table. */
  __atlas: TextureAtlasSlotInfoSchema,
  ...GeneratedAssetFieldsSchema.omit({ __lodChain: true, __sourceUrl: true }).shape,
});

/** An atlas slot as a texture in the generated data: the slot's texture settings, the layout and
 * cell table (`__atlas`), and its pipeline output. */
export type TextureAtlasSlotTexture = z.infer<typeof TextureAtlasSlotTextureSchema>;
