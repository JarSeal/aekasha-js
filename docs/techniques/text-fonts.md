# Fonts for 3D text

A font in Ækasha is a `*.font.json` next to a font file: the asset pipeline encodes it into a distance field atlas (one KTX2 texture holding each glyph's shape as distances to its outline) and a layout JSON (each glyph's metrics and place in the atlas, and the kerning), with only the characters you ask for. Text drawn from it stays sharp at any size and angle, and its outlines, glows and shadows are shader maths, not extra textures. The asset type is `*.font.json`, the runtime the `text()` feature (`aekasha/text`), and the toolkit ships three fonts to start from.

The Hub's [Text page](../../hub/pages/features/text/guide.md) has the API; this page is how to choose, import and size a font. The [Asset optimization](asset-optimization.md) page has the pipeline every output goes through.

> **Note:** this page covers the fonts: the asset, its encode and its load. Drawing text with them (the texts, their shader, effects and labels) comes with the text feature's next plans, and the page grows with them.

## What it is

```text
 source font               yarn assets (or the dev server on save)                     at runtime
 IBMPlexSans-Medium.woff ─┐                                                            getFont('plexSans')
 plexSans.font.json ──────┼─► plexSans.atlas.<hash>.ktx2    1024 × 512 RGBA, lossless  → atlas: a texture
   charset: ASCII,        │   plexSans.layout.<hash>.json   200 glyphs, 6,115 kerning    advances, rects,
   LATIN_1, "€–—…"        │                                 pairs                        kerning (em)
 (scene texts, opt-in) ───┘
```

- **The atlas** holds a tile per glyph: in `MTSDF`, the multi-channel distance (the median of RGB, which keeps corners sharp) and the true distance in alpha (smooth, for soft effects). It's stored losslessly (`R8G8B8A8_UNORM` with zstd): a GPU block format's error would move the outline. It has no mips: the text shader reads the field with its screen-space derivatives instead.
- **The layout** has each glyph's advance and quad in em (the em is 1), its tile in the atlas, the font's line metrics and its kerning between the atlas's characters.
- **The source font never ships.** A build copies the atlas and the layout; the font file stays in `src/`.
- **Only the characters you ask for** are in the atlas, from presets (`ASCII`, `LATIN_1`, …), your own strings, string files, and (opt-in) every text your scenes write with the font. A character not in the atlas draws the fallback glyph (`?`).

## Best for

Distance field fonts are for **text in the 3D world and in the canvas**: names over heads, signs, damage numbers, scores, labels on objects, debug readouts, text that scales, rotates, tilts away from the camera or glows.

|           | Good fit                                                                                             | Poor fit                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Text      | Known in advance: UI strings, names you ship, numbers; a language or two in Latin, Greek or Cyrillic | Typed by players (chat, names) in any script; CJK's thousands of characters (a static atlas holds hundreds)          |
| Scripts   | Latin, Greek, Cyrillic: one glyph per character, kerned pairs                                        | Arabic, Hebrew, Devanagari, Thai and other scripts that need shaping; ligatures; colour fonts and emoji              |
| Placement | World space, billboards, the canvas at any scale                                                     | Long paragraphs of body text in menus: the UI kit's HTML text (`aekasha/ui`) has the browser's shaping and selection |

### Which atlas type

| `type`            | Channels                         | Corners                    | Effects                                                                   | VRAM        |
| ----------------- | -------------------------------- | -------------------------- | ------------------------------------------------------------------------- | ----------- |
| `MTSDF` (default) | RGB: multi-channel, A: true SDF  | Sharp at any magnification | Outlines, glows and soft shadows from the true distance, without rounding | 4 B a texel |
| `MSDF`            | RGB: multi-channel (A is 1)      | Sharp                      | A thin outline from the median; glows and shadows round off at corners    | 4 B a texel |
| `SDF`             | One channel: the true SDF (`R8`) | Rounded when magnified     | All, soft                                                                 | 1 B a texel |

`MTSDF` costs what `MSDF` does on the GPU (both RGBA) and about 15 % more download; take it unless you know the text never has an effect. `SDF` is a quarter of the memory and a third of the download, for text that's always small on screen, or a deliberately soft look.

## Performance

- **VRAM:** the atlas, uncompressed and without mips: width × height × 4 bytes (`SDF`: × 1). A 1024 × 512 `MTSDF` atlas is 2 MiB. Fonts are few, so this is rarely what fills the GPU; the [budget](#budgets) warns past 2048² or 2,000 glyphs.
- **Download:** the KTX2 (zstd) and the layout JSON. The layout is mostly kerning, which grows with the square of the charset: Plex Sans's ASCII has 1,301 kerned pairs, its Latin-1 5,036, Latin Extended-A 20,423. `kerning: false` leaves it out (Latin-1's layout then drops to about a fifth), for a monospaced face or text where it doesn't show.
- **Load:** the layout and the atlas download at once; the parse is a few milliseconds. `plexSans` loaded in 12 ms on WebGPU, 23 ms on WebGL2 through SwiftShader.
- **Encode:** about a second for Latin-1, four for a 500-glyph atlas (on an Apple silicon Mac). Only `yarn assets`, the dev server on save and `yarn importFont` encode; everyone else uses the committed outputs.
- **Drawing:** the text feature's, measured with it.

### The atlas cost table

IBM Plex Sans Medium (`MTSDF`, `pxRange` 8, `padding` 2, power-of-two sides), measured with the encoder (`size` is the em in atlas pixels). Each cell is the atlas's size, its VRAM, and its KTX2 download:

| Charset (glyphs)                     | `size` 32                   | `size` 48 (default)        | `size` 64                    | `size` 96                    |
| ------------------------------------ | --------------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| `DIGITS` (18)                        | 256 × 128, 128 KiB, 25 KiB  | 256 × 128, 128 KiB, 38 KiB | 256², 256 KiB, 52 KiB        | 512 × 256, 512 KiB, 75 KiB   |
| `ASCII` (95)                         | 512 × 256, 512 KiB, 119 KiB | 512², 1 MiB, 178 KiB       | 512², 1 MiB, 241 KiB         | 1024 × 512, 2 MiB, 350 KiB   |
| `ASCII`, `LATIN_1` (191)             | 512², 1 MiB, 247 KiB        | 1024 × 512, 2 MiB, 372 KiB | 1024 × 512, 2 MiB, 508 KiB   | 1024², 4 MiB, 742 KiB        |
| … `LATIN_EXT_A`, `PUNCTUATION` (337) | 1024 × 512, 2 MiB, 431 KiB  | 1024², 4 MiB, 651 KiB      | 1024², 4 MiB, 886 KiB        | 2048 × 1024, 8 MiB, 1.24 MiB |
| … `GREEK`, `CYRILLIC` (507)          | 1024 × 512, 2 MiB, 582 KiB  | 1024², 4 MiB, 872 KiB      | 2048 × 1024, 8 MiB, 1.15 MiB | 2048², 16 MiB, 1.65 MiB      |

The layout JSON beside each (the same at every size): 1.2 KiB for `DIGITS`, 14.5 KiB for `ASCII` (4.5 gzipped), 46.6 KiB for Latin-1 (10.0), 168 KiB for Extended-A (30.0), 255 KiB with Greek and Cyrillic (47.3); the kerning is most of it. IBM Plex Mono, which has no kerning: 5.2 KiB for `ASCII`, 10.2 KiB for Latin-1.

The types at `size` 48, `ASCII` and `LATIN_1`: `MTSDF` 372 KiB, `MSDF` 323 KiB, `SDF` 98 KiB (512 KiB of VRAM).

Read it as: **about 100 glyphs fit 512² at the default size, 200 fit 1024 × 512, 500 fit 1024²**, and doubling `size` doubled the atlas in every row but one (the power-of-two sides make the steps: 64 mostly fits the atlas 48 does). A bold face needs more room: `digitsDisplay` (Plex Sans Bold, `DIGITS`) is 256² where the Medium is 256 × 128.

## Formats

**In:** a static TTF, OTF or WOFF.

- **WOFF2 is refused** (the encoder's font reader has no Brotli). Take the family's static TTF, OTF or WOFF (most families ship them; IBM's npm packages have `fonts/complete/woff/`), or unpack one: `fonttools ttLib.woff2 decompress Font.woff2` writes a TTF (Python's `fonttools` with `brotli`).
- **A variable font is refused** (one with an `fvar` table: the generator reads it at its default instance only). Take the family's static instance of the weight you want, or cut one: `fonttools varLib.instancer Font.ttf wght=500 --remove-overlaps -o Font-Medium.ttf`.
- **A font collection** (`.ttc`) is refused: extract the face.
- **Overlapping contours** (a static font cut from a variable one without `--remove-overlaps`) encode, with a warning naming the glyphs: the true distance in alpha is too small inside them near the overlap, which an effect reading inside the outline shows as a seam. Remove the overlaps and encode again.

**Out:** the atlas (`<json path>.atlas.<hash>.ktx2`, `R8G8B8A8_UNORM`, or `R8_UNORM` for `SDF`, linear, zstd 19, no mips) and the layout (`<json path>.layout.<hash>.json`) in `src/public/aek-assets/`, recorded in `assets.lock.json`.

## Charsets

What the atlas holds is the union of:

| Source                      | What it adds                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `charset.presets`           | Named sets (below). Default `["ASCII"]` for a font without `charset`; none in a `charset` that leaves it out                         |
| `charset.chars`             | The string's characters, each once                                                                                                   |
| `charset.charsFromFiles`    | Files relative to the JSON: every character of a text file, and of every string (keys and values) of a JSON file: your strings table |
| `charset.collectFromScenes` | Every character a scene's text writes with this font ([below](#collecting-the-characters-scenes-write))                              |
| Always                      | Space and `fallbackGlyph`                                                                                                            |

Control characters (line breaks, tabs) are never glyphs. A character the font doesn't have is dropped with a warning: by name for one you named (`chars`, a file, a scene's), counted for a preset's. A fallback glyph the font lacks fails the encode.

| Preset        | Characters                                                                                | Count |
| ------------- | ----------------------------------------------------------------------------------------- | ----- |
| `DIGITS`      | `0`–`9`, space, `+ - . , : %`                                                             | 17    |
| `ASCII`       | Printable ASCII, U+0020–U+007E                                                            | 95    |
| `LATIN_1`     | Latin-1 Supplement's printable half, U+00A0–U+00FF (Western European: `é ñ ö ß Æ £ © °`) | 96    |
| `LATIN_EXT_A` | Latin Extended-A, U+0100–U+017F (Central European, Baltic, Turkish: `č ł ő ş ž`)          | 128   |
| `GREEK`       | Modern Greek: the alphabet, accented letters and tonos                                    | 72    |
| `CYRILLIC`    | Cyrillic's basic block, U+0400–U+045F, and Ukrainian `Ґ ґ`                                | 98    |
| `PUNCTUATION` | General Punctuation's common ones: `‐ – — ‘ ’ ‚ “ ” „ † ‡ • … ‰ ′ ″ ‹ ›`                  | 18    |

Typographic quotes, dashes, `…` and `€` aren't in `LATIN_1`: add `PUNCTUATION`, or name the few you use in `chars` (the toolkit's `plexSans` has `"chars": "€–—…“”‘’•°"`).

`yarn importFont` prints how much of each preset a font covers before you choose.

### Collecting the characters scenes write

With `"collectFromScenes": true`, the gather adds every character a scene's text writes with the font (texts in a scene JSON, text decals; their save entries and debug scenes included) into `src/generated/fontCharsets.json`, which the encoder reads. The gather never encodes:

- A scene that writes a new character makes the font **stale**. The gather warns, naming the font, up to 20 characters, the scenes writing them and the command: `yarn assets --only <id>`. Until then, `yarn dev` draws the fallback glyph for it.
- **`yarn build` fails** on a stale font that a shipped scene writes (a debug scene's only warns).
- It finds only what's in the data: text your code builds (a score, a player's name) isn't collected. Name those characters in `chars` or a strings file.

> **Note:** scene texts and text decals come with the text feature's next plans. Until then the collection finds no texts: `fontCharsets.json` has an empty string for each collecting font.

## Import into Ækasha

### `yarn importFont`

```sh
yarn importFont ~/Downloads/Inter-SemiBold.ttf --id inter --charset ASCII,LATIN_1,PUNCTUATION
```

1. It refuses a WOFF2, a collection or a variable font before writing anything, and a font without the fallback glyph.
2. It copies the font into its folder and writes `<id>.font.json` with every default filled in.
3. It writes `LICENSE.txt` beside them from the font's name table (copyright, trademark, designer, foundry, version, licence and its URL), when the font names a licence; when it doesn't, it warns.
4. It prints what the font covers of each preset (`*` marks the ones you asked for).
5. It encodes it: `yarn assets --only <id>`.

| Option                          | What it does                                                                                                    | Default                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `--id <id>`                     | The font's id and file names (letters, digits, `_`, `-`)                                                        | The file's name in camelCase (`IBMPlexSans-Medium.woff` → `ibmPlexSansMedium`) |
| `--charset <presets>`           | The presets, comma-separated                                                                                    | `ASCII`                                                                        |
| `--chars "…"`                   | More characters                                                                                                 | None                                                                           |
| `--into app\|toolkit\|<folder>` | `src/app/fonts/<id>/`, `src/toolkit/fonts/<id>/`, or a folder under `src/` (a scene's, for a font only it uses) | `app`                                                                          |
| `--type`, `--size`              | The atlas type and the em's size in atlas pixels                                                                | `MTSDF`, 48                                                                    |
| `--force`                       | Overwrites the JSON, the font and the note                                                                      | Refuses to overwrite                                                           |
| `--no-encode`                   | Writes the files only                                                                                           | Encodes                                                                        |

An id another font already has is refused. Relative paths are from where you ran the command.

```text
src/app/fonts/inter/
  Inter-SemiBold.ttf
  inter.font.json
  LICENSE.txt                  the name table's licence fields
```

**Commit** the folder (and the licence's full text if you add it, as the toolkit's `OFL.txt`), the outputs in `src/public/aek-assets/` and `assets.lock.json`. A clone uses the committed outputs and needs no encoder.

### By hand

Write the JSON next to the font (the fields: [Set-up and parameters](#set-up-and-parameters)) and save: the dev server encodes it, or run `yarn assets --only <id>`. Run a full `yarn assets` before committing: only it prunes the outputs of an encode you changed.

### Using a font

The engine feature: list `text()` (from `aekasha/text`) in `InitEngine`'s `features`. A scene whose data names a font fails the boot without it, naming the feature.

- **In a scene:** `"fonts": ["plexSans"]` loads the font with the scene's assets, before its scene code runs. The font is the scene's: released with it once no material samples its atlas.
- **From code:** `loadFontAsync(id, { isPersistent })` loads a font no scene lists (in the calling scene's ownership unless `isPersistent`; a production build has only the fonts a scene lists), `getFont(id)` returns a loaded one: its atlas texture, metrics, glyphs as typed arrays and kerning in em. `getFontGlyphIndex(font, codePoint)` finds a glyph (or the fallback), `getFontKerningKey(first, second)` keys the kerning map.

The atlas is an ordinary texture (`font:<id>`), so the Assets and GPU memory debug tabs list it.

## Set-up and parameters

| Field           | What it is                                                                                                                            | Default                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `id`            | The id scenes and code name it by                                                                                                     | The file's name            |
| `name`          | The font's name for people (debug tools)                                                                                              | None                       |
| `fileName`      | The font file, relative to the JSON: a static TTF, OTF or WOFF                                                                        | Required                   |
| `type`          | `MTSDF`, `MSDF` or `SDF` ([which](#which-atlas-type))                                                                                 | `MTSDF`                    |
| `size`          | The em's size in atlas pixels, 8–512                                                                                                  | 48                         |
| `pxRange`       | The distance range in atlas pixels, its full width (8: ±4 px around the outline), below `size`                                        | 8                          |
| `charset`       | `presets`, `chars`, `charsFromFiles`, `collectFromScenes` ([Charsets](#charsets))                                                     | `{ "presets": ["ASCII"] }` |
| `fallbackGlyph` | The character drawn for one the atlas lacks; one character, always in                                                                 | `?`                        |
| `kerning`       | Writes the font's kerning between the atlas's characters                                                                              | `true`                     |
| `atlas.maxSize` | The largest side in pixels, a power of two (64–8192): the atlas grows to it, and the encode fails past it, naming how many glyphs fit | 2048                       |
| `atlas.padding` | Empty pixels around each tile, so a bilinear tap never reads a neighbour                                                              | 2                          |
| `atlas.pot`     | Both sides powers of two                                                                                                              | `true`                     |

### Choosing `size`

`size` is the detail the field keeps, not the size text draws at: a distance field magnifies without blurring, so a 48 px atlas draws a 400 px headline sharp. What it loses is detail finer than a texel or two: thin serifs, hairlines, tight ink traps round off.

- **48** (the default) suits a text face at any size.
- **64–96** for a display face with fine detail or very thin strokes, or text a camera gets very close to. 64 often fits the atlas 48 does; 96 doubles it ([the table](#the-atlas-cost-table)).
- **32** for a charset that must stay small (an atlas within 1024 × 512 for 500 glyphs), with a plain, sturdy face.

### Choosing `pxRange`

`pxRange` is how far from the outline the field reaches, in atlas pixels, both sides together. It sets two things:

- **How thick an effect can be:** an outline or glow reaches at most `pxRange / 2` atlas pixels past the outline, so `pxRange / (2 × size)` em: 4 / 48 = 0.083 em at the defaults. A thicker outline needs a wider range (12–16 at 48).
- **How small text can draw cleanly:** the shader antialiases the edge over the range as it appears on screen, `pxRange × (screen pixels per em) / size` pixels. msdfgen's guidance keeps that at 2 or more (below it the antialiasing starts to fail, and below 1 it can't work): at the defaults, text down to about 12 px per em. A wider range helps small text.

A wider range spends the atlas's 8 bits over more distance (`pxRange / 256` atlas pixels a step), so each step is coarser. Keep `pxRange` well below `size` (the schema requires it below).

## Licences

- **The atlas carries the glyphs' shapes**, so the font's licence decides whether you may ship it in an app or a game. Read it before you ship: a desktop licence bought from a foundry often doesn't allow embedding in an app, and foundries sell app or game licences for that.
- **Open fonts** (the SIL Open Font License, OFL, of most of Google Fonts and IBM Plex; Apache 2.0) allow bundling with software, sold or not. Keep the licence with the font: `yarn importFont` writes `LICENSE.txt` from the font's own name table, and the toolkit's fonts carry the OFL's full text as `OFL.txt` too. Credit the fonts in your app's credits.
- **A Reserved Font Name** (the OFL's: "Plex" for IBM Plex) restricts the name of a modified font, not what you write with it.
- **A font with no licence in its name table** gets no note and a warning from `yarn importFont`: find out where it came from and what it allows before you ship it.
- **The source file never ships** (only the atlas and the layout are in a build), but it's in your repository: a font whose licence forbids sharing the file doesn't belong in a public repo.

## Variations

- **Several weights:** one font asset per face (`plexSans` and `digitsDisplay` are Medium and Bold of one family). Each is an atlas of its own; give the second only the characters it draws.
- **A small atlas for numbers:** `DIGITS` alone (`digitsDisplay`, 18 glyphs, 256², 40 KiB) for damage numbers, timers and scores.
- **Text players type:** a static atlas can't know it. Give the font the scripts your players use (Latin with Extended-A, Greek and Cyrillic fit 1024² at 48), and accept the fallback glyph for the rest, or show it with the UI kit's HTML text, which has the browser's fonts. A dynamic atlas that generates a missing glyph at runtime from the shipped font (subset to its scripts) in a worker is planned (p395, a feasibility study first); until then, everything is static.
- **CJK:** thousands of characters, beyond one atlas page (more pages are the dynamic atlas's). For a few known strings, `charsFromFiles` with your strings file keeps the atlas to the characters they use.

## Pitfalls and checklist

- [ ] A static TTF, OTF or WOFF, at the weight you want; no WOFF2, no variable font.
- [ ] Its licence allows embedding in an app; `LICENSE.txt` (and the licence's text) beside it.
- [ ] The charset covers every string you ship: your strings file in `charsFromFiles`, the characters code builds (digits, `+`, `%`, `:`) in `chars` or a preset.
- [ ] Typographic punctuation (`– — … “ ” ‘ ’`) and `€` added if your text uses them: `LATIN_1` hasn't got them.
- [ ] No "missing" warning you didn't expect in the encode's output (a character the font doesn't have draws the fallback).
- [ ] No overlap warning, or the font's overlaps removed.
- [ ] The atlas within 1024² for one font, and well under the 2,000-glyph budget.
- [ ] `kerning: false` on a monospaced face (its layout drops to a fraction).
- [ ] A full `yarn assets` before committing; the outputs and `assets.lock.json` committed.
- **A font missing in a production build:** no shipped scene lists it in its `fonts`, so neither its data nor its outputs are in the build: list it in a scene, or `loadFontAsync` fails.
- **"Its layout names the atlas …, and its data another":** the generated data is older than the outputs: `yarn gatherAppData`.
- **"Has no asset pipeline output":** the font was never encoded, or its encode failed (the dev server's log has why): `yarn assets --only <id>`.

### Budgets

A font's encode warns (it doesn't fail) past 2048² atlas pixels or 2,000 glyphs. The texture budgets' ceilings don't apply: a 2048² `MTSDF` atlas is 16 MiB, which would fail them, and a font may need it.

## Template file and example asset ids

No template file: `yarn importFont` writes the JSON.

- **The toolkit's fonts** (`src/toolkit/fonts/<id>/`; the sources and licences: `CREDITS.md`), all IBM Plex (OFL 1.1), `MTSDF` at 48, `pxRange` 8:

  | Font            | Face                  | Charset                                       | Atlas      | Download (atlas, layout)     |
  | --------------- | --------------------- | --------------------------------------------- | ---------- | ---------------------------- |
  | `plexSans`      | IBM Plex Sans Medium  | `ASCII`, `LATIN_1`, `€–—…“”‘’•°` (200 glyphs) | 1024 × 512 | 381 KiB, 56 KiB (12 gzipped) |
  | `plexMono`      | IBM Plex Mono Regular | `ASCII` (95 glyphs), no kerning in the font   | 512²       | 171 KiB, 5.2 KiB             |
  | `digitsDisplay` | IBM Plex Sans Bold    | `DIGITS` (18 glyphs)                          | 256²       | 40 KiB, 1.2 KiB              |

- **The encoder's tests:** `devTools/assetPipeline/fonts/`, with a golden `DIGITS` atlas of `plexSans`' font in `fixtures/`.
