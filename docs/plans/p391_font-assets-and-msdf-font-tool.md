Status: draft | not-implemented
Category: Text, Assets
Epic: p390_text-rendering-and-text-decals.md
Blocks: p392_text-feature-msdf-renderer.md, p395_dynamic-glyph-atlas.md
Related: `devTools/assetPipeline/CLAUDE.md` (the encoders, `assets.lock.json`, budgets, `ktxTool.ts`' pinned download), `devTools/gather/CLAUDE.md` (`GATHERED_SUFFIXES`, the scene's asset lists), `src/_engine/features/texturesets/CLAUDE.md` (a feature that owns an asset type: its schema, gather and load), `src/_engine/ui/fonts/` (the IBM Plex WOFF2s and their OFL licences)

# Font Assets and the MSDF Font Tool — Plan

Ækasha fonts: a `*.font.json` asset next to its source font, encoded by `yarn assets` into a
lossless MTSDF atlas and a layout JSON, with only the characters the app asks for; `yarn
importFont` to start one; the gather collecting the characters scenes write (opt-in); the
toolkit's first fonts; and the runtime load the `text()` feature (p392) draws with. The epic's D2
and D5 are the decisions; this plan builds them.

## Design

### D1. The generator (decided by Phase 1)

The atlas generator turns a glyph outline into an MTSDF tile. The candidates, tried in this order:

1. **`msdfgen-wasm`** (npm): msdfgen compiled to WebAssembly with TypeScript bindings and its own
   atlas packing, loaded in Node from its `.wasm`. Wins if it makes MTSDF (or MSDF plus a true
   SDF we can merge), runs on Node 22.13.0, and its output matches the reference.
2. **msdf-atlas-gen, native** (Chlumsky's, the reference; `-type mtsdf`): an official Windows
   binary only; Homebrew on macOS and Linux; a CMake build elsewhere. Usable through
   `yarn setupAssetTools` only if a pinned, checksummed download exists for every platform the
   repo supports (Linux incl. WSL2, macOS; x64 / arm64), which today it doesn't. Fallback for a
   machine that has it (`AEK_MSDF_ATLAS_GEN=<path>`), never a requirement.
3. **A TypeScript port of msdfgen's core** (`devTools/assetPipeline/fonts/msdf/`): the shape
   from opentype.js' path commands, edge colouring (`edgeColoringSimple`), per-channel signed
   distance, MSDF error correction, and the true SDF for alpha. About 2-3k lines; the last resort,
   and the one that also runs in a browser worker (p395).

`@zappar/msdf-generator` (WebAssembly msdfgen for the browser) is checked in Phase 1 too, for
p395's worker. The spike writes its figures and the choice into this plan.

### D2. The font asset (`FontSchema.ts`, the `text()` feature's, on `aekasha/schemas`)

```jsonc
// src/toolkit/fonts/plexSans/plexSans.font.json
{
  "$schema": "../../../_engine/schemas/generated/font.schema.json",
  "id": "plexSans",
  "name": "IBM Plex Sans",
  "fileName": "IBMPlexSans-Medium.ttf",   // JSON-relative, TTF / OTF / WOFF / WOFF2
  "variation": { "wght": 500 },          // a variable font's instance (optional)
  "type": "MTSDF",                       // MTSDF (default) | MSDF | SDF
  "size": 48,                            // glyph em size in atlas pixels
  "pxRange": 8,                          // the distance range in atlas pixels
  "charset": {
    "presets": ["ASCII", "LATIN_1"],
    "chars": "€–—…“”‘’•°",
    "charsFromFiles": [],                // JSON or text files; every string's characters
    "collectFromScenes": false
  },
  "fallbackGlyph": "?",
  "kerning": true,
  "atlas": { "maxSize": 2048, "padding": 2, "pot": true }
}
```

- `presets`: `DIGITS` (`0-9 +-.,:%`), `ASCII` (printable 0x20-0x7E), `LATIN_1` (0xA0-0xFF),
  `LATIN_EXT_A`, `GREEK`, `CYRILLIC`, `PUNCTUATION` (general punctuation's common ones). A list in
  `devTools/assetPipeline/fonts/charsets.ts`, shared with the debug tab's "what's in this font".
- Space and `fallbackGlyph` are always in. A character the font doesn't have is dropped with a
  warning naming it.
- The atlas grows by powers of two up to `maxSize`; past it the encode fails, naming how many
  glyphs fit (more pages are p395's).

### D3. The outputs

- `src/public/aek-assets/fonts/<id>/<id>.atlas.ktx2`: KTX2 `R8G8B8A8_UNORM` (linear, not sRGB:
  distances), zstd level 19, no mips (an SDF atlas is sampled with its derivatives; mips blur the
  field into wrong distances). A PNG fallback (`atlas.format: 'PNG'`) only if Phase 1 finds three's
  `KTX2Loader` can't load uncompressed zstd KTX2 on both backends.
- `src/public/aek-assets/fonts/<id>/<id>.layout.json`: the metrics the layout needs and nothing
  else: `unitsPerEm` normalized to 1, `ascender`, `descender`, `lineHeight`, `underline*`, the
  atlas size, `pxRange`, `type`; per glyph (by code point) `advance`, `planeBounds` (em units),
  `atlasBounds` (pixels); `kerning` as a flat `[first, second, amount, …]` array, only pairs
  inside the charset. Rounded to 4 decimals. Typically 10-20 kB for Latin 1.
- `assets.lock.json` records both with the source's hash, the generator and its version, the
  resolved charset's hash, so `yarn assets` re-encodes only on a change and prunes the old ones.
- Budgets (`devTools/assetPipeline/budgets.ts`): a font's atlas bytes and glyph count, warned past
  the defaults (2048², 2000 glyphs).

### D4. `yarn importFont`

`yarn importFont <file> [--id <id>] [--charset ASCII,LATIN_1] [--chars "…"] [--into <folder>]
[--type MTSDF] [--size 48]` (`devTools/importFont.ts`): copies the font into the folder (default
`src/app/fonts/<id>/`; the toolkit's `src/toolkit/fonts/<id>/` with `--into toolkit`), writes the
`*.font.json` with the defaults filled in, reads the font's name and licence fields and writes them
into a `LICENSE` note beside it when the font embeds one, prints what the font covers of each
preset, then runs `yarn assets --only <id>`. Refuses to overwrite without `--force`. Its `main()`
runs only as the script.

### D5. Collecting the characters scenes use

With `collectFromScenes: true` the gather (`devTools/gather/fonts.ts`) adds, per font, the
characters of every text a scene JSON or a decal names with that font (p392's `texts`, p397's text
decals), and writes the union into a generated charset file (`src/generated/fontCharsets.json`)
that the encoder reads. The gather never encodes: a new character in a scene makes the font
**stale**, which the gather reports as a warning naming the font, the character and the command
(`yarn assets --only <id>`), and `yarn build` fails on (like a missing asset output today). In
`yarn dev` the text draws the fallback glyph until the encode.

### D6. Fonts at runtime

- The `text()` feature (p392) owns the asset type, as `textureSets()` owns texture sets: the
  schema next to the feature, the gather's `fonts` scene list (the fonts a scene's texts name are
  appended, like the texture closure), the load in the scene load's asset step.
- `getFont(id)` returns the loaded font (`FontData`: the layout parsed into typed arrays, a
  code point → glyph index map, the kerning in a `Map<number, number>` keyed `first << 16 |
  second`, the atlas texture); `loadFontAsync(id)` for code-made texts outside the scene's list.
  A font is owned by the scene that loaded it unless `persistent`.
- This plan builds the data and the load; p392 draws it.

### D7. The toolkit's fonts

A new toolkit asset category `fonts/` (`src/toolkit/fonts/<id>/`; `layoutRules.ts`, the root
`CLAUDE.md`'s toolkit list): `plexSans` (IBM Plex Sans Medium, ASCII + Latin 1) and `plexMono`
(IBM Plex Mono Regular, ASCII; the debug text's), from the TTFs of the same OFL family the UI kit
ships as WOFF2, and `digitsDisplay` (a bold display face, `DIGITS` only, for damage numbers: shows
how small a font can be). Licences beside each; `CREDITS.md` like the textures'.

## Phases

### Phase 1: The generator spike

1. Try D1's routes on `plexSans` at 48 px, `pxRange` 8, ASCII: output type (MTSDF or not),
   correctness (render each atlas with a reference median shader in a Node canvas or a small
   Vitest image test; compare with the native msdf-atlas-gen output on a machine that has it,
   max / mean channel error), artifacts at `A`, `W`, `@`, `ß`, `&`, encode time for ASCII and Latin
   1, package size and maintenance (last release, licence).
2. Check three r187's `KTX2Loader` on an uncompressed `R8G8B8A8_UNORM` + zstd KTX2 on WebGPU and
   WebGL2 (the `ktx` tool: `ktx create --format R8G8B8A8_UNORM --zstd 19`).
3. Write the choice and the figures here (D1's "as decided"), and whether the chosen generator
   runs in a browser worker (p395's input). Commit nothing but the plan and, if any, the spike's
   script under `devTools/spikes/` deleted at the phase's end.

### Phase 2: The schema, the encoder and the outputs

1. `FontSchema.ts` (D2) beside the `text()` feature's folder (created empty here, with its
   `index.ts` exporting only the schema's types; p392 fills it) and on `aekasha/schemas`; the
   generated JSON schema; `*.font.json` in `GATHERED_SUFFIXES`.
2. `devTools/assetPipeline/fonts/`: parse (opentype.js, or fontkit if variable instances need it;
   WOFF2 through `wawoff2` or fontkit), resolve the charset (`charsets.ts`), generate per glyph,
   pack (`textureAtlases.ts`' packer if it fits glyph rects, else a skyline packer in
   `fonts/pack.ts`), write D3's outputs, lock entries, prune, budgets.
3. Tests: charset resolution, kerning extraction (a fixture font's known pairs), the layout JSON's
   shape and rounding, the packer, a golden small atlas (`DIGITS`) compared within a tolerance.

### Phase 3: `yarn importFont`, the toolkit's fonts, the gather

1. `devTools/importFont.ts` (D4) and its `package.json` script; tests on a fixture font in a temp
   folder.
2. The toolkit's `fonts/` category (D7), its layout rule, encodes committed.
3. The gather: fonts in the generated data (`SceneData.fonts`, the scene's list and closure), D5's
   collection and staleness warning; the build's failure on a stale font.

### Phase 4: The runtime load

1. `FontData`, `getFont`, `loadFontAsync`, the scene's load and disposal (D6), in
   `features/text/Fonts.ts`; the feature's `install` registers only the load (p392 adds the rest).
2. Tests: the parse into typed arrays, kerning lookups, the fallback glyph, a font owned by a
   scene disposed with it.

### Phase 5: The Hub and the docs

1. The handbook page `docs/techniques/text-fonts.md`: formats, charsets, the dynamic option
   (p395), licences, the atlas cost table (glyph count × size → atlas size).
2. The Hub: a section on fonts in the Text feature page started here (`hub/pages/features/text/`,
   finished by p392 and p399), the `*.font.json` asset type, `yarn importFont`.
3. `devTools/assetPipeline/CLAUDE.md` (the font encoder), `devTools/gather/CLAUDE.md` (the
   collection), the root `CLAUDE.md` (the command, the toolkit category), `readme.md` (the command,
   the asset type).

### Phase 6: Versions and done

Toolkit minor (the fonts), engine: none yet if the feature ships with p392 on the same
integration branch (the epic's Branches and PRs: one bump at the `p390-text` merge). `CHANGELOG.md`
entry on the branch; mark the plan done.

## Verification

- `yarn test` (the encoder, the charsets, the import, the load); `yarn assets --only plexSans`
  twice (the second encodes nothing); `yarn build` fails on a stale collected font and passes
  after `yarn assets`.
- The atlas viewed in p392's debug tab (or, before it, the spike's image test).

## Non-goals

Colour fonts, bitmap fonts, complex-script shaping (the epic's Risks 3), more than one atlas page
(p395), hinting.
