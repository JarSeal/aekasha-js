## Installing it

List [`text()`](api:text), from `aekasha/text`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, a scene whose data
names a font fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).
[`getFont`](api:getFont) and [`loadFontAsync`](api:loadFontAsync) work without it; the feature
adds the scene load's step that loads a scene's `fonts`.

## Fonts

A font is a `*.font.json` next to its font file. The toolkit's `plexSans`:

<<< src/toolkit/fonts/plexSans/plexSans.font.json

- **`fileName`** is a static TTF, OTF or WOFF, relative to the JSON. A WOFF2 and a variable font
  are refused, with a message naming what to use instead (the family's static files, or a cut
  with `fonttools`: [Formats](repo:docs/techniques/text-fonts.md#formats)).
- **`type`** is the atlas: `MTSDF` (the default: sharp corners from three channels, and the true
  distance in alpha for soft outlines, glows and shadows), `MSDF` (the sharp corners only) or
  `SDF` (one channel, a quarter of the memory, rounder corners).
- **`charset`** is what the atlas holds: `presets` (`DIGITS`, `ASCII`, `LATIN_1`,
  `LATIN_EXT_A`, `GREEK`, `CYRILLIC`, `PUNCTUATION`), `chars`, `charsFromFiles` (a strings file:
  every character of a text file, every string of a JSON file) and `collectFromScenes`. Space and
  `fallbackGlyph` (`?`, drawn for a character the atlas lacks) are always in. A character the font
  doesn't have is dropped with a warning.
- **`size`** is the em in atlas pixels: the detail the field keeps, not the size text draws at (a
  48 px atlas draws a 400 px headline sharp). **`pxRange`** is how far the field reaches past the
  outline, both sides together: an outline or glow can be `pxRange / 2` atlas pixels thick.
- **`kerning`** writes the font's kerning between the atlas's characters (most of the layout's
  size). **`atlas`** limits the page (`maxSize`, a power of two up to 8192) and pads each glyph.

Each has a description in the JSON Schema, so an editor completes and checks the file from its
`$schema` line.

### What a font costs

The atlas is lossless (`R8G8B8A8_UNORM`, or `R8_UNORM` for `SDF`, with zstd) and has no mips:
a GPU block format's error, or a blurred mip, would move the outline. So its VRAM is width ×
height × 4 bytes. Measured on IBM Plex Sans Medium at the default size: `ASCII` (95 glyphs) is a
512² atlas, 1 MiB on the GPU and 178 KiB to download; `ASCII` and `LATIN_1` (191) 1024 × 512,
2 MiB, 372 KiB, plus a 47 KiB layout (10 KiB gzipped); with Latin Extended-A, Greek and Cyrillic
(507 glyphs) 1024², 4 MiB, 872 KiB. The encode warns past a 2048² atlas or 2,000 glyphs. The
handbook's [atlas cost table](repo:docs/techniques/text-fonts.md#the-atlas-cost-table) has every
charset at 32, 48, 64 and 96 px.

### Collecting the characters scenes write

With `"collectFromScenes": true`, the gather adds every character a scene's texts write with the
font (their save entries and the debug scenes' included) to `src/generated/fontCharsets.json`,
which the encode reads. The gather never encodes: a new character makes the font stale, and the
gather warns, naming the font, the characters, the scenes and `yarn assets --only <id>`. Until
then the text draws the fallback glyph, and `yarn build` fails on a stale font a shipped scene
writes. Text your code builds (a score, a player's name) isn't in the data: name its characters
in `chars` or a strings file.

::: note
Scenes have no texts before the text drawing arrives, so the collection finds none yet.
:::

## `yarn importFont`

```sh
yarn importFont ~/Downloads/IBMPlexSans-Bold.woff --charset ASCII,LATIN_1,PUNCTUATION
```

It refuses a WOFF2, a collection, a variable font or a font without the fallback glyph before
writing anything. Then it copies the font into `src/app/fonts/<id>/` (`--into toolkit` for
`src/toolkit/fonts/<id>/`, or a folder under `src/`, a scene's), writes the `*.font.json` with
every default filled in, writes a `LICENSE.txt` from the font's name table when the font names a
licence (it warns when it doesn't), prints how much of each preset the font covers, and encodes
it with `yarn assets --only <id>`:

```text
✓ [importFont] ibmPlexSansBold (src/app/fonts/ibmPlexSansBold/)
  src/app/fonts/ibmPlexSansBold/ibmPlexSansBold.font.json
  src/app/fonts/ibmPlexSansBold/IBMPlexSans-Bold.woff
  src/app/fonts/ibmPlexSansBold/LICENSE.txt
  Covers (* asked for):
    DIGITS         17 / 17
  * ASCII          95 / 95
  * LATIN_1        96 / 96
    LATIN_EXT_A   128 / 128
    GREEK          72 / 72
    CYRILLIC       98 / 98
  * PUNCTUATION    18 / 18
```

The other options: `--id`, `--chars "…"`, `--type`, `--size`, `--force` (overwrite) and
`--no-encode` (the files only). The id defaults to the file's name in camelCase, as above.
Commit the folder, the outputs in `src/public/aek-assets/` and `assets.lock.json`: a clone uses
the committed outputs and needs no encoder.

A font JSON written by hand works the same: save it and the dev server encodes it, or run
`yarn assets --only <id>`. Like every asset, run a full `yarn assets` before committing (only it
prunes the outputs it replaced; see [Asset optimization](hub:features/asset-optimization)).

## Loading a font

A scene lists the fonts its code draws with, and they load with its assets, before its scene code
runs:

```json
{
  "id": "myScene",
  "fonts": ["plexSans", "digitsDisplay"]
}
```

The font is the scene's: it's released with the scene once nothing samples its atlas. A font no
scene lists loads from code, in the calling scene's ownership, or kept for the whole app with
`isPersistent`:

```ts
import { getFont, getFontGlyphIndex, getFontKerningKey, loadFontAsync } from 'aekasha/text';

const mono = await loadFontAsync('plexMono', { isPersistent: true });

// A scene's font, once its scene has loaded
const font = getFont('plexSans');
if (font) {
  const a = getFontGlyphIndex(font, 'A'.codePointAt(0)!);
  const advance = font.advances[a]; // in em
  const kerning = font.kerning.get(getFontKerningKey(0x41, 0x56)) ?? 0; // "AV", in em
}
```

- [`FontData`](api:FontData) is the layout in typed arrays by glyph index, in code point order:
  `advances`, `planeRects` (each glyph's quad in em from the pen on the baseline) and
  `atlasRects` (its tile in the atlas's UV, `v` from the top), the line `metrics`
  ([`FontMetrics`](api:FontMetrics)), the kerning in em and the `atlas` texture. Read it, never
  write it: every reader shares it.
- [`getFontGlyphIndex`](api:getFontGlyphIndex) falls back to the fallback glyph for a code point
  the atlas lacks. Pass code points (`codePointAt`), not UTF-16 units.
- The atlas is an ordinary registered texture, `font:<id>`, so the Assets and GPU memory debug
  tabs list it. A second load returns the loaded font, and two at once share one load.
- A production build has only the fonts its shipped scenes list: `loadFontAsync` of another one
  rejects. Re-check your scene after the await: a scene switch meanwhile releases what the left
  scene loaded.

## The toolkit's fonts

Three faces of IBM Plex (SIL Open Font License 1.1), each in `src/toolkit/fonts/<id>/` with its
`LICENSE.txt` and the licence's text, `OFL.txt`:

| Font            | Face                  | Characters                                         | Atlas      |
| --------------- | --------------------- | -------------------------------------------------- | ---------- |
| `plexSans`      | IBM Plex Sans Medium  | `ASCII`, `LATIN_1` and `€–—…“”‘’•°`: 200 glyphs    | 1024 × 512 |
| `plexMono`      | IBM Plex Mono Regular | `ASCII`: 95 glyphs                                 | 512²       |
| `digitsDisplay` | IBM Plex Sans Bold    | `DIGITS`: 18 glyphs, for damage numbers and timers | 256²       |

They're `MTSDF` at 48 px. A scene names one by id like its own.

## Licences

The source font never ships: a build copies only the atlas and the layout. But the atlas holds the
glyphs' shapes, so the font's licence decides whether you may ship it in an app: open licences
(the OFL of most of Google Fonts and IBM Plex) allow it, a foundry's desktop licence often
doesn't. The handbook has the
[checklist](repo:docs/techniques/text-fonts.md#licences).

## Key APIs

- [`text`](api:text): the feature.
- [`loadFontAsync`](api:loadFontAsync) and [`getFont`](api:getFont), with
  [`FontData`](api:FontData) and [`FontMetrics`](api:FontMetrics).
- [`getFontGlyphIndex`](api:getFontGlyphIndex) and [`getFontKerningKey`](api:getFontKerningKey).
- The asset's types: [`FontAsset`](api:FontAsset), [`FontType`](api:FontType),
  [`FontCharsetPreset`](api:FontCharsetPreset) and [`SceneFontDef`](api:SceneFontDef).

## Read more

- The handbook: [Fonts for 3D text](repo:docs/techniques/text-fonts.md): the atlas types, the
  cost table, charsets, choosing `size` and `pxRange`, licences and the checklist.
- The API reference: [`aekasha/text`](hub:documentation/aekasha/text).

::: claude-md
:::
