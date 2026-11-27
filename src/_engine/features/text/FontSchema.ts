import { z } from 'zod';
import { isJsonRelativeFileName } from '../../schemas/AssetsConfigSchema';
import { JsonSchemaRefSchema } from '../../schemas/_SaveDataSchema';

// The font asset (p391 D2): a source font beside its JSON, encoded by the asset pipeline into a
// signed distance field atlas (KTX2) and a layout JSON with only the characters asked for. The
// `text()` feature (p392) owns the type, as `textureSets()` owns texture sets.

/** The atlas types: `MTSDF` (the median's three channels and a true distance in alpha: sharp
 * corners and soft effects), `MSDF` (the three, alpha 1), `SDF` (the true distance alone) */
export const FONT_TYPES = ['MTSDF', 'MSDF', 'SDF'] as const;

/** An atlas type ({@link FONT_TYPES}) */
export type FontType = (typeof FONT_TYPES)[number];

/** The named character sets a font's `charset.presets` takes; their characters are the encoder's */
export const FONT_CHARSET_PRESETS = [
  'DIGITS',
  'ASCII',
  'LATIN_1',
  'LATIN_EXT_A',
  'GREEK',
  'CYRILLIC',
  'PUNCTUATION',
] as const;

/** A named character set ({@link FONT_CHARSET_PRESETS}) */
export type FontCharsetPreset = (typeof FONT_CHARSET_PRESETS)[number];

/** The source formats the encoder reads (WOFF2 and variable fonts are refused, by the encoder) */
const FONT_SOURCE_EXTENSIONS = ['.ttf', '.otf', '.woff'];

/** The defaults the encoder fills in for a font JSON's optional fields */
export const FONT_DEFAULTS = {
  type: 'MTSDF',
  size: 48,
  pxRange: 8,
  charset: {
    presets: ['ASCII'],
    chars: '',
    charsFromFiles: [],
    collectFromScenes: false,
  },
  fallbackGlyph: '?',
  kerning: true,
  atlas: { maxSize: 2048, padding: 2, pot: true },
} as const satisfies {
  type: FontType;
  size: number;
  pxRange: number;
  charset: {
    presets: readonly FontCharsetPreset[];
    chars: string;
    charsFromFiles: readonly string[];
    collectFromScenes: boolean;
  };
  fallbackGlyph: string;
  kerning: boolean;
  atlas: { maxSize: number; padding: number; pot: boolean };
};

const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;

/** A path's extension, lower case, from its last segment ('' for none; `./font` has none) */
const getExtension = (fileName: string) => {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

const FontFileNameSchema = z
  .string()
  .refine(isJsonRelativeFileName, {
    message: 'A font file relative to this JSON ("./IBMPlexSans-Medium.woff").',
  })
  .superRefine((fileName, ctx) => {
    const extension = getExtension(fileName);
    if (extension === '.woff2') {
      ctx.addIssue({
        code: 'custom',
        message:
          "A WOFF2 font isn't read by the encoder: use the font's static TTF, OTF or WOFF (unpack the WOFF2 with a converter, or take the family's own static files).",
      });
    } else if (!FONT_SOURCE_EXTENSIONS.includes(extension)) {
      ctx.addIssue({
        code: 'custom',
        message: `A font file is a static TTF, OTF or WOFF (${FONT_SOURCE_EXTENSIONS.join(', ')}), not "${extension || 'no extension'}".`,
      });
    }
  })
  .describe(
    'The source font, relative to this JSON ("./IBMPlexSans-Medium.woff"): a static TTF, OTF or WOFF (no WOFF2, no variable font).'
  );

/** A font's characters: presets, characters and files, plus what scenes write (opt-in). Space and
 * the fallback glyph are always in. */
const FontCharsetSchema = z
  .strictObject({
    /** Named sets of characters. Default: `["ASCII"]` when the font has no `charset`; `[]` in a
     * `charset` that leaves it out. */
    presets: z
      .array(z.enum(FONT_CHARSET_PRESETS))
      .optional()
      .describe(
        'Named sets of characters. Default: ["ASCII"] without a charset, [] in a charset that leaves it out.'
      ),
    /** More characters, each in once however often it's written. */
    chars: z
      .string()
      .optional()
      .describe("More characters, each in once however often it's written."),
    /** JSON or text files relative to this JSON: every character of a text file, and of every
     * string in a JSON file (keys and values). */
    charsFromFiles: z
      .array(
        z.string().refine(isJsonRelativeFileName, {
          message: 'A file relative to this JSON ("./strings.json").',
        })
      )
      .optional()
      .describe(
        'JSON or text files relative to this JSON: every character of a text file, and of every string in a JSON file (keys and values).'
      ),
    /** Adds the characters of every text a scene writes with this font. Default: false. */
    collectFromScenes: z
      .boolean()
      .optional()
      .describe('Adds the characters of every text a scene writes with this font. Default: false.'),
  })
  .describe(
    'The characters the atlas holds. Space and the fallback glyph are always in; one the font lacks is dropped with a warning.'
  );

/** The atlas page's size limits and the space around each glyph */
const FontAtlasSchema = z
  .strictObject({
    /** The largest side in pixels, a power of two (64-8192). The atlas grows to it, and the
     * encode fails past it. Default: 2048. */
    maxSize: z
      .number()
      .int()
      .min(64)
      .max(8192)
      .refine(isPowerOfTwo, { message: 'A power of two (64, 128, … 8192).' })
      .optional()
      .describe(
        'The largest side in pixels, a power of two (64-8192). The atlas grows to it, and the encode fails past it. Default: 2048.'
      ),
    /** Empty pixels around each glyph's field, so a bilinear tap never reads a neighbour.
     * Default: 2. */
    padding: z
      .number()
      .int()
      .min(0)
      .max(32)
      .optional()
      .describe(
        "Empty pixels around each glyph's field, so a bilinear tap never reads a neighbour. Default: 2."
      ),
    /** Both sides powers of two. Default: true. */
    pot: z.boolean().optional().describe('Both sides powers of two. Default: true.'),
  })
  .describe("The atlas page's size limits and the space around each glyph.");

/**
 * A font (`*.font.json`): a static TTF, OTF or WOFF beside it, encoded by `yarn assets` into a
 * distance field atlas and a layout JSON holding only the characters `charset` asks for.
 */
export const FontAssetSchema = z
  .strictObject({
    /** The JSON Schema an editor validates the file with. */
    $schema: JsonSchemaRefSchema.optional(),
    /** The font's id. Default: the file name without `.font.json`. */
    id: z.string().min(1).optional().describe('The id. Default: the file name without .font.json.'),
    /** The font's name for people (the debug tools, `yarn importFont`'s note). */
    name: z.string().min(1).optional().describe("The font's name for people."),
    /** The source font, relative to this JSON: a static TTF, OTF or WOFF. */
    fileName: FontFileNameSchema,
    /** The atlas type. Default: `MTSDF`. */
    type: z
      .enum(FONT_TYPES)
      .optional()
      .describe(
        'The atlas type: MTSDF (sharp corners and a true distance for soft effects), MSDF (sharp corners only) or SDF (the true distance alone). Default: MTSDF.'
      ),
    /** The em's size in atlas pixels. Default: 48. */
    size: z
      .number()
      .int()
      .min(8)
      .max(512)
      .optional()
      .describe("The em's size in atlas pixels (8-512). Default: 48."),
    /** The distance range in atlas pixels, its full width (8: ±4 px around the outline). Wider
     * allows thicker outlines and glows, at a softer edge per pixel. Default: 8. */
    pxRange: z
      .number()
      .positive()
      .max(64)
      .optional()
      .describe(
        'The distance range in atlas pixels, its full width (8: ±4 px around the outline). Wider allows thicker outlines and glows. Default: 8.'
      ),
    /** The characters the atlas holds. Default: `{ "presets": ["ASCII"] }`. */
    charset: FontCharsetSchema.optional(),
    /** The character drawn for one the atlas lacks: one character, always in the atlas.
     * Default: `?`. */
    fallbackGlyph: z
      .string()
      .refine((value) => [...value].length === 1, { message: 'One character.' })
      .optional()
      .describe('The character drawn for one the atlas lacks; always in the atlas. Default: "?".'),
    /** Writes the font's kerning between the atlas's characters into the layout. Default: true. */
    kerning: z
      .boolean()
      .optional()
      .describe(
        "Writes the font's kerning between the atlas's characters into the layout. Default: true."
      ),
    /** The atlas page's limits. */
    atlas: FontAtlasSchema.optional(),
  })
  .superRefine((font, ctx) => {
    const size = font.size ?? FONT_DEFAULTS.size;
    const pxRange = font.pxRange ?? FONT_DEFAULTS.pxRange;
    if (pxRange >= size) {
      ctx.addIssue({
        code: 'custom',
        path: ['pxRange'],
        message: `pxRange (${pxRange}) must be smaller than the em's size (${size} px).`,
      });
    }
  })
  .describe('A font: a source font encoded into a distance field atlas and a layout JSON.');

/** A font's JSON (`*.font.json`), as written. */
export type FontAsset = z.infer<typeof FontAssetSchema>;

/**
 * A font in a scene's generated data (its `fonts`), as the gatherer writes it: what the load
 * needs, the layout's URL first (the layout names its atlas).
 */
export type SceneFontDef = {
  /** The font's id */
  id: string;
  /** The atlas type */
  type: FontType;
  /** The font's name for people (development data only) */
  name?: string;
  /** The layout JSON, the asset pipeline's output; none when the font has no output yet. */
  __url?: string;
  /** The download in bytes, the font file's against the atlas and layout's. */
  __bytes?: { in: number; out: number };
  /** The atlas's GPU memory in bytes. */
  __vramBytes?: { in: number; out: number };
  /** The font JSON, from the repo root (development data only) */
  __sourcePath?: string;
};
