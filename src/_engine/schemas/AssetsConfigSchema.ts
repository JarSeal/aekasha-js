import { z } from 'zod';
import { JsonSchemaRefSchema } from './_SaveDataSchema';

// The asset pipeline's settings: `assets.config.json` at the repo root (defaults, profiles, glob
// rules) and the per-asset `optimize` key of the texture, texture array, atlas and import JSONs.
// Build time only: the runtime never reads them. Strict objects, so a misspelt key is an error
// instead of a silently ignored one.

const TextureCodecSchema = z
  .enum(['uastc', 'etc1s', 'none'])
  .describe(
    'uastc: 1 B/px on every device (BC7 / ASTC 4×4), the default. etc1s: smallest download, colour slots only. none: not encoded (exact data, CPU readback).'
  );

/** A texture's codec: `uastc` (1 B/px on every device, the default), `etc1s` (the smallest
 * download, colour only) or `none` (not encoded). */
export type TextureCodec = z.infer<typeof TextureCodecSchema>;

const TextureSettingsSchema = z.strictObject({
  /** The codec. Default `uastc` (`none` for the `data` slot). */
  codec: TextureCodecSchema.optional(),
  /** The largest side in px, downscaled to fit (`null`: the source's size). Default 1024. */
  maxSize: z
    .number()
    .int()
    .min(4)
    .nullable()
    .optional()
    .describe('Largest side in px, downscaled to fit (null: the source size). Default 1024.'),
  /** Writes the full mip chain. Default true. */
  mipmaps: z.boolean().optional().describe('Writes the full mip chain. Default true.'),
  /** UASTC only: `--uastc-quality`, 0 (fastest) to 4 (slowest). Default 2. */
  level: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe('UASTC only: --uastc-quality, 0 (fastest) to 4 (slowest). Default 2.'),
  /** UASTC only: the RDO lambda (0: off). Default 2, and 1 for the normal and ORM slots. */
  rdo: z
    .number()
    .min(0)
    .optional()
    .describe(
      'UASTC only: the RDO lambda (0: off). Default 2; 1 for normal, orm, metallicRoughness and occlusion.'
    ),
  /** UASTC only: the Zstandard supercompression level (0: off). Default 18. */
  zstd: z
    .number()
    .int()
    .min(0)
    .max(22)
    .optional()
    .describe('UASTC only: Zstandard supercompression level (0: off). Default 18.'),
  /** ETC1S only: `--qlevel`, 1 to 255. Default 128. */
  quality: z
    .number()
    .int()
    .min(1)
    .max(255)
    .optional()
    .describe('ETC1S only: --qlevel, 1 to 255. Default 128.'),
  /** A two-channel normal map (X in RGB, Y in A); needs a material that unpacks it. Default false. */
  normalMode: z
    .boolean()
    .optional()
    .describe('Two-channel normal map (X in RGB, Y in A). Needs a material that unpacks it.'),
});

/** One slot's encode settings at one level: codec, size, mipmaps and the codec's own knobs. */
export type TextureSettings = z.infer<typeof TextureSettingsSchema>;

/** The texture slots a setting can name, `default` first. */
export const TEXTURE_SLOTS = [
  'default',
  'baseColor',
  'normal',
  'metallicRoughness',
  'occlusion',
  'emissive',
  'orm',
  'data',
] as const;

const TextureSlotSchema = z
  .enum(TEXTURE_SLOTS)
  .describe(
    'glTF slots, orm (packed occlusion / roughness / metalness), data (splat maps, masks, LUTs, height) or default.'
  );

/** A texture's slot: a glTF slot, `orm` (packed occlusion, roughness, metalness), `data` (splat
 * maps, masks, LUTs, height) or `default`. */
export type TextureSlot = z.infer<typeof TextureSlotSchema>;

// Per-slot settings; at each level a slot's entry merges over that level's `default`
const TexturesSettingsSchema = z
  .strictObject({
    /** Every slot's, under the slot's own. */
    default: TextureSettingsSchema.optional().describe("Every slot's, under the slot's own."),
    /** The base colour (albedo). */
    baseColor: TextureSettingsSchema.optional().describe('The base colour (albedo).'),
    /** The normal map. */
    normal: TextureSettingsSchema.optional().describe('The normal map.'),
    /** glTF's metallic-roughness map. */
    metallicRoughness: TextureSettingsSchema.optional().describe("glTF's metallic-roughness map."),
    /** The ambient occlusion map. */
    occlusion: TextureSettingsSchema.optional().describe('The ambient occlusion map.'),
    /** The emissive map. */
    emissive: TextureSettingsSchema.optional().describe('The emissive map.'),
    /** Packed occlusion, roughness and metalness. */
    orm: TextureSettingsSchema.optional().describe('Packed occlusion, roughness and metalness.'),
    /** Splat maps, masks, LUTs, height. */
    data: TextureSettingsSchema.optional().describe('Splat maps, masks, LUTs, height.'),
  })
  .describe("Per slot; each slot's entry merges over default.");

const MeshSettingsSchema = z.strictObject({
  /** The geometry compression: `meshopt` (default), `draco` or `none`. */
  codec: z
    .enum(['meshopt', 'draco', 'none'])
    .optional()
    .describe('Geometry compression. meshopt (default) also shrinks VRAM when quantized.'),
  /** Quantizes, reorders and filters the vertices; `false` is lossless. Default true (a collider:
   * false). */
  quantize: z
    .boolean()
    .optional()
    .describe(
      'Quantize, reorder and filter the vertices. false: lossless (EXT_meshopt_compression alone), the collider default.'
    ),
  /** The target triangle ratio (`null`: off). Default off. */
  simplify: z
    .number()
    .gt(0)
    .max(1)
    .nullable()
    .optional()
    .describe('Target triangle ratio (null: off).'),
});

/** A GLB's geometry settings at one level: compression, quantization, simplification. */
export type MeshSettings = z.infer<typeof MeshSettingsSchema>;

const BudgetMBSchema = z.number().positive().nullable().optional();

// Limits an optimized asset must stay within, or the production build fails for an asset a
// shipped scene uses and `yarn assets` exits 1. MB are 10^6 bytes.
const AssetBudgetSchema = z
  .strictObject({
    /** The estimated GPU memory of the whole asset in MB (`null`: no limit). */
    vramMB: BudgetMBSchema.describe(
      "Estimated GPU memory of the whole asset in MB: its textures (KTX2 at 1 B/px, the most it takes on any device) plus a GLB's geometry (null: no limit)."
    ),
    /** The output file's size in MB (`null`: no limit). */
    downloadMB: BudgetMBSchema.describe("The output file's size in MB (null: no limit)."),
  })
  .describe(
    "Per-asset limits. Set in an asset JSON's own optimize, it also replaces the per-texture ceiling (each texture's VRAM must fit its slot's maxSize and codec as set without the asset JSON's overrides)."
  );

// One level of settings: the defaults, a profile, a rule's or an asset's own overrides
const OptimizeLevelSchema = z.strictObject({
  /** The texture settings per slot. */
  textures: TexturesSettingsSchema.optional(),
  /** The GLB geometry settings. */
  mesh: MeshSettingsSchema.optional().describe(
    "A GLB's geometry: compression, quantization, simplification."
  ),
  /** The per-asset limits. */
  budget: AssetBudgetSchema.optional(),
});

/** One level of the asset pipeline's settings (the defaults, a profile, a rule's or an asset's
 * own): textures per slot, geometry and the budget. */
export type OptimizeLevel = z.infer<typeof OptimizeLevelSchema>;

const OptimizeObjectShape = {
  /** A profile of `assets.config.json`, under the asset's own overrides. */
  profile: z.string().optional().describe('A profile of assets.config.json.'),
  /** A standalone texture's slot (default `default`); a GLB's textures take their material
   * slot's. */
  slot: TextureSlotSchema.optional().describe(
    "A standalone texture's slot (default: default). A GLB's textures are classified by their material slot."
  ),
  /** Per-slot overrides, or `false` to keep the textures as they are. */
  textures: z
    .union([z.literal(false), TexturesSettingsSchema])
    .optional()
    .describe('Per-slot overrides, or false to keep the textures as they are.'),
  /** Geometry overrides, or `false` to keep the geometry as it is. */
  mesh: z
    .union([z.literal(false), MeshSettingsSchema])
    .optional()
    .describe('Overrides, or false to keep the geometry as it is.'),
  /** The asset's limits; set here, they also replace the per-texture ceiling. */
  budget: AssetBudgetSchema.optional(),
};

/**
 * The fields every type's `optimize` object can have; each type's schema narrows it
 * (`TextureOptimizeSchema`, `TextureArrayOptimizeSchema`, `ImportedAssetOptimizeSchema`).
 */
export const OptimizeObjectSchema = z.strictObject(OptimizeObjectShape);

/** The `optimize` key of an asset JSON, any type's: false passes the asset through as it is. */
export type AssetOptimize = false | z.infer<typeof OptimizeObjectSchema>;

/** The slots whose alpha isn't coverage (a normal map's, data packed into it): `alphaCoverage`
 * never scales them. */
export const NON_COVERAGE_SLOTS: readonly TextureSlot[] = ['normal', 'data'];

/**
 * An `optimize`'s `alphaCoverage`: the alpha test's cut, so each mip level's alpha is scaled to keep level 0's coverage. Only
 * for alpha that an `alphaTest` cuts (an albedo), set per asset (or atlas slot), since the cut is
 * its material's. A texture's and an atlas slot's `optimize` share it.
 * @internal
 */
export const AlphaCoverageSchema = z
  .number()
  .gt(0)
  .max(1)
  .describe(
    "The material's alphaTest (0-1, eg. 0.5): each mip level's alpha is scaled so the share of it passing this cut stays level 0's, so thin alpha-cut features (leaves, trunks, an impostor's edges) don't thin out with distance. Needs an alpha channel and mipmaps; not for a normal or data slot, or normalMode (their alpha isn't coverage). Default: off."
  );

/**
 * Refuses `alphaCoverage` on an optimize that names a slot whose alpha isn't coverage. A texture's
 * and an atlas slot's `optimize` run it.
 * @internal
 */
export const refineAlphaCoverageSlot = (
  optimize: { slot?: TextureSlot; alphaCoverage?: number },
  ctx: z.RefinementCtx
) => {
  if (optimize.alphaCoverage === undefined || !optimize.slot) return;
  if (NON_COVERAGE_SLOTS.includes(optimize.slot)) {
    ctx.addIssue({
      code: 'custom',
      path: ['alphaCoverage'],
      message: `the slot "${optimize.slot}" has no coverage alpha (a normal map's or packed data): alphaCoverage would scale it`,
    });
  }
};

/**
 * A `*.texture.json`'s `optimize`: it names its slot and has no geometry. `alphaCoverage` is
 * the texture's own, like an atlas slot's: not in a profile or a rule. `TextureAssetSchema`'s.
 * @internal
 */
export const TextureOptimizeSchema = z
  .union([
    z.literal(false),
    OptimizeObjectSchema.omit({ mesh: true })
      .extend({ alphaCoverage: AlphaCoverageSchema.optional() })
      .superRefine(refineAlphaCoverageSlot),
  ])
  .describe(
    "The asset pipeline's settings: a profile, the slot, per-slot overrides and the alphaCoverage, or false to keep the file as it is."
  );

/**
 * A `*.textureArray.json`'s `optimize`: like a texture's, but never `false` (nor
 * `textures: false`). An array is only ever a KTX2 file `ktx` encodes, so it has no form "as it
 * is". `TextureArrayAssetSchema`'s, and the base of an atlas slot's.
 * @internal
 */
export const TextureArrayOptimizeSchema = OptimizeObjectSchema.extend({
  textures: TexturesSettingsSchema.optional().describe('Per-slot overrides.'),
})
  .omit({ mesh: true })
  .describe(
    "The asset pipeline's settings: a profile, the slot and per-slot overrides, applied to every layer. The codec can't be none: an array is a KTX2 file."
  );

/**
 * A `*.importedAsset.json`'s `optimize`: its textures are classified by their material slot.
 * `ImportedAssetSchema`'s.
 * @internal
 */
export const ImportedAssetOptimizeSchema = z
  .union([z.literal(false), OptimizeObjectSchema.omit({ slot: true })])
  .describe(
    "The asset pipeline's settings: a profile plus texture and mesh overrides, or false to keep the file as it is."
  );

/** Whether a file name is relative to its asset JSON (`./`, `../`), not a `src/public` URL path. */
export const isJsonRelativeFileName = (fileName: string) => /^\.\.?\//.test(fileName);

/**
 * A texture's or an import's `fileName`: relative to its JSON, or a `src/public` URL path.
 * `TextureAssetSchema` and `ImportedAssetSchema` use it.
 * @internal
 */
export const AssetFileNameSchema = z
  .string()
  .describe(
    'Relative to this JSON file ("./source/rock.png", optimized into src/public/aek-assets/), or a URL path served from src/public ("/textures/rock.png", optionally after `path`).'
  );

/**
 * For assets declared inline in a scene JSON: the pipeline doesn't see those, so no `./` sources.
 * `InlineTextureSchema` and `InlineImportedAssetSchema` use it.
 * @internal
 */
export const PublicFileNameSchema = z
  .string()
  .refine((fileName) => !isJsonRelativeFileName(fileName), {
    message:
      'A file relative to the JSON ("./", "../") needs its own *.texture.json / *.importedAsset.json, not an inline asset.',
  })
  .describe('A URL path served from src/public ("/textures/rock.png", optionally after `path`).');

const PackFileSchema = z
  .string()
  .describe(
    'A source image relative to this JSON ("./source/ao.png"), or a URL path served from src/public. 8 or 16 bits.'
  );

const PackMultiplySchema = z
  .union([
    z.number().describe('A constant factor.'),
    z.strictObject({
      /** The source image. */
      src: PackFileSchema,
      /** The channel of `src`. Default `r`. */
      channel: z
        .enum(['r', 'g', 'b', 'a'])
        .optional()
        .describe('The channel of `src` (default r).'),
      /** value × (1 + (factor − 1) × strength). Default 1. */
      strength: z
        .number()
        .min(0)
        .optional()
        .describe('value × (1 + (factor − 1) × strength), eg. 0.8 for AO into albedo (default 1).'),
    }),
  ])
  .describe('Multiplied in after remap and invert (linear values), eg. AO into the albedo.');

/** A pack's output channels and channel groups (`pack.channels`' keys). */
export const PACK_TARGETS = ['r', 'g', 'b', 'a', 'rg', 'rgb', 'rgba'] as const;

type PackTarget = (typeof PACK_TARGETS)[number];

const PackChannelSchema = z.union([
  z.number().describe('A constant (0..1, linear) in every channel of the target.'),
  z.strictObject({
    /** The source image. */
    src: PackFileSchema,
    /** The channels of `src`, one per target channel. Default: the target's own. */
    channel: z
      .string()
      .regex(/^[rgba]{1,4}$/)
      .optional()
      .describe(
        'The channels of `src`, one per target channel (default: the target\'s own, eg. "rgb"). A greyscale image has its grey in r, g and b.'
      ),
    /** How `src` is encoded (alpha is always linear). Default: `srgb` for an sRGB texture's colour
     * channels, else `linear`. */
    colorSpace: z
      .enum(['srgb', 'linear'])
      .optional()
      .describe(
        'How `src` is encoded (alpha is always linear). Default: srgb for the colour channels of an sRGB texture (texOpts.colorSpace), else linear.'
      ),
    /** `src` is a normal map: resized as unit vectors before its channels are taken. */
    normal: z
      .boolean()
      .optional()
      .describe(
        '`src` is a normal map: it is resized as unit vectors, before its channels are taken. Only `invert` applies.'
      ),
    /** Maps [min, max] to 0-1; `auto`: the full range of the channels taken. */
    remap: z
      .union([z.literal('auto'), z.tuple([z.number(), z.number()])])
      .optional()
      .describe('Maps [min, max] to 0..1; auto: the full range of the channels taken.'),
    /** 1 − value, after `remap` (a DirectX normal's G). */
    invert: z.boolean().optional().describe("1 − value, after remap (eg. a DirectX normal's G)."),
    /** Multiplied in after `remap` and `invert`: a constant or another image's channel. */
    multiply: PackMultiplySchema.optional(),
  }),
]);

/**
 * A texture built from several source images, in place of `fileName`. The output has the
 * channels its targets cover: r, rg, rgb or rgba (two channels are written as RGB, B = 0).
 * `TextureAssetSchema`'s `pack`.
 * @internal
 */
export const TexturePackSchema = z
  .strictObject({
    /** The width and height the channels are combined at. Default: the sources' (which must
     * agree). */
    size: z
      .tuple([z.number().int().min(1), z.number().int().min(1)])
      .optional()
      .describe(
        "Width and height the channels are combined at (default: the sources' size, which must then agree). The optimize step resizes the result to its maxSize."
      ),
    /** Per output channel or channel group: a source channel, or a constant. */
    channels: z
      .strictObject(
        Object.fromEntries(
          PACK_TARGETS.map((target) => [
            target,
            PackChannelSchema.optional().describe(
              `The output's ${target}: a source image's channels, or a constant.`
            ),
          ])
        ) as {
          [target in PackTarget]: z.ZodOptional<typeof PackChannelSchema>;
        }
      )
      .describe('Per output channel or channel group: a source channel, or a constant.'),
  })
  .superRefine((pack, ctx) => {
    const covered = new Map<string, PackTarget>();
    for (const target of PACK_TARGETS) {
      const spec = pack.channels[target];
      if (spec === undefined) continue;
      for (const letter of target) {
        const other = covered.get(letter);
        if (other) {
          ctx.addIssue({
            code: 'custom',
            path: ['channels', target],
            message: `"${other}" and "${target}" both set ${letter}`,
          });
        }
        covered.set(letter, target);
      }
      if (typeof spec === 'number') continue;
      if (spec.channel && spec.channel.length !== target.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['channels', target, 'channel'],
          message: `"${target}" takes ${target.length} channel(s), "${spec.channel}" names ${spec.channel.length}`,
        });
      }
      if (spec.normal && (spec.remap || spec.multiply || spec.colorSpace)) {
        ctx.addIssue({
          code: 'custom',
          path: ['channels', target],
          message: 'a normal map source takes `invert` only (no remap, multiply or colorSpace)',
        });
      }
      if (spec.normal && (spec.channel ?? target).includes('a')) {
        ctx.addIssue({
          code: 'custom',
          path: ['channels', target],
          message: "a normal map's channels are r, g and b",
        });
      }
    }
    const letters = ['r', 'g', 'b', 'a'];
    const last = Math.max(...[...covered.keys()].map((letter) => letters.indexOf(letter)));
    const missing = letters.slice(0, last + 1).filter((letter) => !covered.has(letter));
    if (!covered.size) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: 'no channels' });
    } else if (missing.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['channels'],
        message: `the output channels are r, rg, rgb or rgba: set ${missing.map((l) => `"${l}"`).join(', ')} too (eg. to 0)`,
      });
    }
  })
  .describe('Build time only: the texture packed from source images, in place of `fileName`.');

/** A texture JSON's `pack`: the texture built from source images' channels, in place of
 * `fileName`. */
export type TexturePack = z.infer<typeof TexturePackSchema>;

const AssetsConfigRuleSchema = z.strictObject({
  /** The source paths it applies to, relative to the repo root (`**`, `*`, `?`, `{a,b}`). */
  glob: z
    .string()
    .describe(
      'Matched against the source file path relative to the repo root (eg. "src/app/props/**/*.glb"). Supports **, *, ? and {a,b}.'
    ),
  /** `false` passes the matched assets through as they are, over everything else. */
  optimize: z
    .literal(false)
    .optional()
    .describe('Pass the matched assets through as they are. Wins over everything else.'),
  ...OptimizeObjectShape,
});

/**
 * `assets.config.json` at the repo root: the asset pipeline's defaults over the built-in ones, its
 * named profiles, and glob rules applied in order. Build time only.
 */
export const AssetsConfigSchema = z.strictObject({
  /** The JSON Schema an editor validates the file with. */
  $schema: JsonSchemaRefSchema.optional(),
  /** Merged over the built-in defaults (`devTools/assetPipeline/settings.ts`). */
  defaults: OptimizeLevelSchema.optional().describe(
    "Merged over the engine's built-in defaults (devTools/assetPipeline/settings.ts)."
  ),
  /** Named settings an asset's or a rule's `profile` picks. */
  profiles: z
    .record(z.string(), OptimizeLevelSchema)
    .optional()
    .describe("Named settings an asset's or a rule's profile picks."),
  /** Applied in order (later wins) to every asset whose source path matches. */
  rules: z
    .array(AssetsConfigRuleSchema)
    .optional()
    .describe('Applied in order (later wins) to every asset whose source path matches.'),
});

/** `assets.config.json`, as {@link AssetsConfigSchema} validates it. */
export type AssetsConfig = z.infer<typeof AssetsConfigSchema>;

const BytesInOutSchema = z.object({
  /** The source's. */
  in: z.number().describe("The source's."),
  /** The output's. */
  out: z.number().describe("The output's."),
});

/**
 * Baked into the generated data by the gatherer from a pipeline run, never written by
 * hand. Every key is unset without a run. The texture, texture array, atlas slot and import schemas
 * spread the fields they get.
 * @internal
 */
export const GeneratedAssetFieldsSchema = z.object({
  /** The pipeline's output, what the runtime loads. Unset when there's none (encoder missing, a
   * failed encode, a remote file): the runtime loads the source. */
  __url: z.string().optional().describe("Set by the gatherer: the pipeline's output."),
  /** The source as the dev server serves it: loaded under the "Load source files" override, or
   * when the pipeline has no output. Not in production data, which ships no relative sources;
   * none for a pack. */
  __sourceUrl: z
    .string()
    .optional()
    .describe('Set by the gatherer: the source as the dev server serves it.'),
  /** Download: the source files vs the output. */
  __bytes: BytesInOutSchema.optional().describe('Set by the gatherer: the download in bytes.'),
  /** Estimated GPU memory (optimized only): the source as RGBA8 vs the output. */
  __vramBytes: BytesInOutSchema.optional().describe(
    'Set by the gatherer: the estimated GPU memory in bytes.'
  ),
  /** A standalone texture's codec (optimized only). */
  __codec: TextureCodecSchema.optional(),
  /** An imported asset's LOD chains built into its GLB, for tooling: per glTF mesh
   * primitive, its extent (in its own, possibly quantized, units) and each level's triangles and
   * error (levels[0] is the base). The runtime reads the GLB's own. */
  __lodChain: z
    .array(
      z.object({
        /** The glTF mesh's name. */
        mesh: z.string().describe("The glTF mesh's name."),
        /** The primitive's index in the mesh. */
        primitive: z.number().describe("The primitive's index in the mesh."),
        /** The primitive's largest bounding box side, in its own units. */
        extent: z.number().describe("The primitive's largest bounding box side."),
        /** Where LOD1 onwards take their attributes: the base's (`BASE`), shared by every level
         * (`WELDED`) or each level's own (`OWN`). */
        vertices: z
          .enum(['BASE', 'WELDED', 'OWN'])
          .describe("LOD1 onwards' attributes: the base's, shared by every level, or their own."),
        /** Each level's triangles and error, the base first. */
        levels: z
          .array(
            z.object({
              /** The level's triangles. */
              triangles: z.number().describe("The level's triangles."),
              /** The level's simplification error, relative to `extent`. */
              error: z.number().describe("The level's error, relative to extent."),
            })
          )
          .describe("Each level's triangles and error, the base first."),
      })
    )
    .optional()
    .describe("Set by the gatherer: the GLB's LOD chains per primitive."),
});

/** The fields the gatherer bakes into an asset from the asset pipeline's run: the output's URL,
 * the source's, the download and VRAM figures, the codec and an import's LOD chains. */
export type GeneratedAssetFields = z.infer<typeof GeneratedAssetFieldsSchema>;
