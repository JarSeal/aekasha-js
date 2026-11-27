Status: implemented (Phases 1-6)
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

**As decided (Phase 1, 2026-11-27, with the user): a hybrid.** Neither WebAssembly package makes
MTSDF: both are MSDF-only builds of msdfgen (msdfgen-wasm exports only `_generateMSDF` and its
wrapper writes alpha 255; Zappar's exports `generateMSDF` / `generateMSDFWithOverlapFix`). So:

- **RGB: `msdfgen-wasm` 1.0.0** (MIT; Chlumsky's msdfgen with Skia's overlap preprocessing; one
  release, 2025-03, one maintainer; 1.2 MB unpacked), pinned, as a devDependency of the pipeline.
- **A: our true SDF** (`devTools/assetPipeline/fonts/trueSdf.ts`, about 150 lines): fontkit's
  outline in the same per-glyph projection as msdfgen-wasm's (`computeGlpyhMsdfData`'s scale and
  translation), curves flattened to 1/100 px, the nearest segment's distance, signed by non-zero
  winding, mapped like msdfgen's channels (`distance / range + 0.5`, byte `clamp(256 x)`).
- **Everything else: fontkit 3.0.0** (MIT): metrics, the cmap (what a font covers), kerning
  (GPOS, through `font.layout` of each pair), the name table's licence. Not opentype.js (below).
- **Inputs:** TTF, OTF and WOFF (what msdfgen-wasm reads). **WOFF2 is refused** (its FreeType has no
  brotli; a decoder, `wawoff2`, last released 2022, is a follow-up if an app needs one) and so is
  **a variable font** (an `fvar` table: msdfgen-wasm reads a font file at its default instance and
  can't be given another), each with a message naming a static TTF / OTF / WOFF. D2 drops
  `variation`.
- **Not chosen:** route 2 (msdf-atlas-gen native) stays an unbuilt option; route 3 (the full
  TypeScript port) is the way to variable fonts and WOFF2 if they're ever needed, with
  msdfgen-wasm as its test reference.
- **p395 (a browser worker):** msdfgen-wasm is built for the browser (its README's purpose) and the
  true SDF is plain TypeScript, so the hybrid is a candidate there; not run in a browser by this
  spike. Its ESM entry has extensionless imports, which Node's ESM can't load (`createRequire` of
  the CJS entry works) and a bundler (Vite) resolves. fontkit in a worker is p395's size question.
  Zappar's package is a browser-worker wrapper (comlink, `new Worker`) sized for `@pmndrs/uikit`,
  MSDF-only: no use to p395 either.

The figures are Phase 1's As built.

### D2. The font asset (`FontSchema.ts`, the `text()` feature's, on `aekasha/schemas`)

```jsonc
// src/toolkit/fonts/plexSans/plexSans.font.json
{
  "$schema": "../../../../.schemas/font.schema.json",
  "id": "plexSans",
  "name": "IBM Plex Sans",
  "fileName": "IBMPlexSans-Medium.woff",  // JSON-relative, TTF / OTF / WOFF (D1: no WOFF2, no variable font)
  "type": "MTSDF",                       // MTSDF (default) | MSDF | SDF
  "size": 48,                            // glyph em size in atlas pixels
  "pxRange": 8,                          // the distance range in atlas pixels, its full width (±4 px)
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
  `src/_engine/features/text/FontCharsets.ts` (import-free, on `devTools/engineImports.test.ts`'
  list: runtime code can't import `devTools/`), shared with the debug tab's "what's in this font".
- Space and `fallbackGlyph` are always in. A character the font doesn't have is dropped with a
  warning naming it.
- The atlas grows by powers of two up to `maxSize`; past it the encode fails, naming how many
  glyphs fit (more pages are p395's).

### D3. The outputs

- `src/public/aek-assets/<the JSON's path under src/>.atlas.<hash>.ktx2` (the pipeline's output
  naming, Phase 2: `toolkit/fonts/plexSans/plexSans.atlas.9a11fc28.ktx2`): KTX2 `R8G8B8A8_UNORM` (linear, not sRGB:
  distances), zstd level 19, no mips (an SDF atlas is sampled with its derivatives; mips blur the
  field into wrong distances). No PNG fallback: Phase 1 found three's `KTX2Loader` loads it on
  both backends, texel-exact (Phase 1's As built). What the load (Phase 4) must know: it comes back
  as a `DataTexture` (`RGBAFormat`, `UnsignedByteType`, `colorSpace` none, `flipY` false, one
  level) with **`NearestFilter`** min and mag, so the load sets `LinearFilter`; and `v = 0` samples
  the PNG's **top** row on WebGPU and WebGL2 alike, so `atlasBounds` in pixels from the top map to
  `v = y / height` with no flip.
- `src/public/aek-assets/<the JSON's path>.layout.<hash>.json`, beside the atlas, naming it
  (`atlas.file`), so the runtime needs the layout's URL only: the metrics the layout needs and nothing
  else: `unitsPerEm` normalized to 1, `ascender`, `descender`, `lineHeight`, `underline*`, the
  atlas size, `pxRange`, `type`; per glyph (by code point) `advance`, `planeBounds` (em units),
  `atlasBounds` (pixels, from the top); rounded to 4 decimals. `kerning` only for pairs inside the
  charset, **grouped by the first code point, amounts in font units** with the font's
  `kerningUnitsPerEm` beside them (`{ "65": [86, -50, 87, -40, …], … }`): Phase 1 measured Plex Sans
  Medium's 5,036 kerned pairs inside Latin 1 at 70 kB (14.7 kB gzip) as the flat
  `[first, second, em amount, …]` array first planned, 37 kB (6.8 kB gzip) grouped in font units.
  The glyph table is about 8 kB for Latin 1.
- `assets.lock.json` records both with the source's hash, the generator and its version, the
  resolved charset's hash, so `yarn assets` re-encodes only on a change and prunes the old ones.
- Budgets (`devTools/assetPipeline/budgets.ts`): a font's atlas bytes and glyph count, warned past
  the defaults (2048², 2000 glyphs).

### D4. `yarn importFont`

`yarn importFont <file> [--id <id>] [--charset ASCII,LATIN_1] [--chars "…"] [--into <folder>]
[--type MTSDF] [--size 48]` (`devTools/importFont.ts`): copies the font into the folder (default
`src/app/fonts/<id>/`; the toolkit's `src/toolkit/fonts/<id>/` with `--into toolkit`; a WOFF2 or
variable font is refused first, D1), writes the
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
(IBM Plex Mono Regular, ASCII; the debug text's), from IBM's static WOFFs of the same OFL family
the UI kit ships as WOFF2 (npm `@ibm/plex-sans` 2.0.0 and `@ibm/plex-mono` 2.5.0 ship static
WOFF and WOFF2, no TTF; the UI kit's own WOFF2s are a variable Latin subset, refused by D1), and `digitsDisplay` (a bold display face, `DIGITS` only, for damage numbers: shows
how small a font can be). Licences beside each; `CREDITS.md` like the textures'.

## Phases

### Phase 1: The generator spike — done

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

As built (2026-11-27, macOS arm64, Node 22.13.0; the spike ran outside the repo, nothing of it is
kept; font: IBM Plex Sans Medium, static WOFF from `@ibm/plex-sans` 2.0.0):

- **Output type:** msdfgen-wasm and Zappar both MSDF-only (D1). Zappar runs only in a browser
  Worker, so it wasn't run.
- **msdfgen-wasm, timed:** module 6 ms; ASCII 94 glyphs 178 ms, Latin 1 188 glyphs 437 ms (the
  bitmaps alone; space and the blank code points have none). **No kerning:** it reads only the
  legacy `kern` table through FreeType (0 pairs), and Plex, like most current fonts, kerns in GPOS.
  Its own packer (maxrects) left half of the 512² ASCII page empty.
- **The hybrid, timed:** the true SDF for all of Latin 1 115 ms in plain JS; a whole MTSDF page,
  load to bytes: ASCII 267 ms (512²), Latin 1 614 ms (1024 × 512). `ktx create --format
  R8G8B8A8_UNORM --assign-tf linear --assign-primaries none --zstd 19`: 0.2-0.3 s, 182 kB (ASCII;
  the PNG 241 kB) and 393 kB (Latin 1; 570 kB).
- **Correctness** (each glyph's field drawn at 8× with bilinear sampling, against the outline
  rasterized by librsvg in the same projection; the error is coverage per output pixel):
  - the median (msdfgen-wasm's RGB), `A W @ ß & R e g o`: mean 0.19-0.33 %; up to 61 output pixels
    on the wrong side (about one atlas texel), at sharp inner corners only (`A`'s counter apex,
    `g`'s ink traps, `W`'s vertices); `e`, `o` none.
  - the alpha (our true SDF): mean 0.14-0.33 %; its wrong pixels are the corners a one-channel
    field rounds (45-239 at 8×), `o` none. As intended: the fill reads the median, the soft effects
    the alpha.
  - **The native msdf-atlas-gen reference wasn't run:** Homebrew fails on this macOS (26.5,
    "unsupported macOS version"). msdfgen-wasm is msdfgen itself, so the outline was the reference.
- **opentype.js 2.0.0 is out:** after drawing `&` and `@`, the same process's `A` came back with
  NaN coordinates (fine when drawn first): state leaks between glyphs. fontkit 3.0.0 gave the
  right outline every time, the same figures elsewhere.
- **fontkit's kerning:** the layout of all 36,481 Latin 1 pairs 447 ms, 5,036 kerned (D3's
  format). It reads WOFF2 and variable instances too (`getVariation({ wght: 500 })` on the UI
  kit's WOFF2), which msdfgen-wasm can't follow (D1).
- **KTX2 on three 0.187.0** (system Chrome headless through playwright-core: WebGPU on the GPU, the
  WebGL2 backend on the GPU, WebGL2 on SwiftShader; both pages): `KTX2Loader` (its raw path,
  zstd through its own `ZSTDDecoder`, no transcoder) loads 10-27 ms; every texel of all four
  channels read back through a render target at texel centres equals the source, 0 of 262,144 and
  0 of 524,288 off on every configuration; the loaded texture's shape and orientation are D3's.
  The readback's row order differs per backend (`readRenderTargetPixelsAsync`: bottom row first on
  WebGL2, top first on WebGPU), the texture's doesn't.

### Phase 2: The schema, the encoder and the outputs — done

1. `FontSchema.ts` (D2) beside the `text()` feature's folder (created empty here, with its
   `index.ts` exporting only the schema's types; p392 fills it) and on `aekasha/schemas`; the
   generated JSON schema; `*.font.json` in `GATHERED_SUFFIXES`.
2. `devTools/assetPipeline/fonts/`: parse with fontkit (refusing WOFF2 and a variable font, D1),
   resolve the charset (`charsets.ts`) against its cmap, generate per glyph (D1's hybrid:
   msdfgen-wasm loaded through `createRequire` of its CJS entry, its `.wasm` from
   `msdfgen-wasm/wasm`, `loadGlyphs` with `preprocess: true`, `computeGlpyhMsdfData` for each
   glyph's box and projection and `generateBitmap` for RGB, then `trueSdf.ts` for A in that
   projection; `MSDF` skips the alpha (255), `SDF` writes only it), pack (`textureAtlases.ts`'
   packer if it fits glyph rects, else a skyline packer in `fonts/pack.ts`; not msdfgen-wasm's),
   write D3's outputs, lock entries (msdfgen-wasm's and fontkit's versions in the key), prune,
   budgets. Two traps from Phase 1: msdfgen-wasm's bitmap rows are top first (it flips them), and
   the true SDF takes the raw outline, so in a glyph whose contours overlap (a static font cut from
   a variable one without removing overlaps) the alpha inside is too small near the inner edges
   (outside it's right: the nearest point of the union is on its boundary). The encoder warns on
   such a glyph (a contour's segment inside another contour) rather than fixing it here.
3. Tests: charset resolution, kerning extraction (a fixture font's known pairs), the layout JSON's
   shape and rounding, the packer, a golden small atlas (`DIGITS`) compared within a tolerance,
   the true SDF against the outline (Phase 1's method: the field drawn magnified against a
   rasterized outline; `o` with no corners as the strict case), the WOFF2 and variable-font
   refusals.

As built (2026-11-27, macOS arm64, Node 22.13.0):

- **The schema** (`src/_engine/features/text/FontSchema.ts`, on `aekasha/schemas` with `FONT_TYPES`,
  `FONT_CHARSET_PRESETS`, `FONT_DEFAULTS`): `id` optional (the file name), `fileName` relative to the
  JSON and `.ttf` / `.otf` / `.woff` only (a `.woff2` refused naming the formats), `size` 8-512,
  `pxRange` > 0, ≤ 64 and below `size`, `atlas.maxSize` a power of two 64-8192, `padding` 0-32,
  `fallbackGlyph` one code point. No `__saveData`, `debugData` or `optimize`. A font without
  `charset` gets `ASCII`; a `charset` without `presets` none. `*.font.json` is in
  `GATHERED_SUFFIXES` and `.schemas/font.schema.json`; the gather's pass 1 doesn't read fonts yet
  (Phase 3).
- **No `features/text/index.ts` yet:** `FeatureFactories.test.ts` requires every feature entry to
  have a `*Feature.ts`, so the `aekasha/text` entry (its alias, `tsconfig.json`'s paths, the Hub's
  entry table in `hub/pages/documentation/intro.md`, the API baseline) comes with the `text()`
  feature (Phase 4). The folder holds `FontSchema.ts`, `FontCharsets.ts` and the schema's test.
- **The encoder** (`devTools/assetPipeline/fonts/`): `fontSource.ts` (the resolved JSON, its files,
  the cache key's params, `FONT_ENCODER_VERSION`; light: no fontkit), `charset.ts`, `fontFile.ts`
  (fontkit: the refusals by signature and `fvar`, metrics, kerning), `msdfgen.ts` (its own types:
  the package's `exports` names no `types`), `outline.ts`, `trueSdf.ts`, `pack.ts` (skyline;
  `textureAtlases.ts`' layout aligns cells for mip levels, which a font atlas hasn't), `layout.ts`,
  `encodeFont.ts` (`generateFontAtlasAsync`: pixels and layout input, no `ktx`; `encodeFontAsset`:
  then the KTX2 and both outputs), `import()`ed by `pipeline.ts` on a font's first encode.
- **In the pipeline:** one job per font, keyed `font:<json>` (`getFontAssetKey`), its source kind
  `font`, key type `font` (pipeline, `ktx`, sharp, fontkit, msdfgen-wasm versions). A font is always
  encoded (no pass-through form, whatever the textures switch says) and is KTX-only for the build's
  missing-output check. The layout is the result's `output`, the atlas its `extraOutputs` (new on
  `CacheEntry` and the optimized outcome: the presence check, the store, its restore and the prune
  see every output). `ktxEncode.ts`' `encodeKtx2Raw` / `getKtxRawArgs` (`--format R8G8B8A8_UNORM`
  or `R8_UNORM --assign-tf linear --assign-primaries none --zstd 19`), `images.ts`' `encodePngBytes`.
  The run's line and `last-run.json` carry the font's stats (`FontEncodeStats`).
- **`SDF` is a one-channel `R8_UNORM` KTX2**, not RGBA (MTSDF and MSDF are RGBA; MSDF's alpha 255).
  Phase 1 checked only RGBA with `KTX2Loader`: Phase 4 checks R8 on both backends.
- **The layout's format** (`FONT_LAYOUT_FORMAT` 1, minified): `{ format, type, atlas: { file, width,
  height, size, pxRange }, metrics: { ascender, descender, lineHeight, underlineY (the underline's
  centre, as FreeType's), underlineThickness }, fallback, glyphs, kerningUnitsPerEm?, kerning? }`,
  each glyph `[advance]` without ink, else `[advance, planeLeft, planeBottom, planeRight, planeTop,
  atlasX, atlasY, atlasWidth, atlasHeight]` (em values to 4 decimals; the plane bounds are the
  tile's whole quad, its range included; atlas pixels from the top left).
- **Kerning** through `font.layout` of each pair with `liga`, `clig`, `dlig`, `calt`, `rlig` off; a
  pair the font still substitutes is skipped. Missing characters: the named ones (space, the
  fallback, `chars`, files) warned by name, a preset's counted; a missing fallback glyph fails.
- **Budgets** are warnings (`FONT_BUDGET`: 2048² pixels, 2000 glyphs), not the texture budget's
  ceilings (a 2048² RGBA atlas would fail those).
- **Overlap check:** samples spread evenly along each contour (a segment midpoint misses an overlap
  on a long straight edge); warns naming the glyphs.
- **Figures** (the fixture, IBM Plex Sans Medium WOFF): ASCII MTSDF 512², 0.4 s; ASCII + Latin 1
  1024 × 512, 191 glyphs, 5,036 kerned pairs, 1.5 s through the pipeline, atlas 381 kB, layout
  47.8 kB; a second run a hit, deleted outputs restored from the store. Against the outline at 8×:
  0.1-0.37 % of samples wrong; `o`'s within 0.032 px of the outline (one byte of the range), the
  corners' within 0.45 px (alpha) and 0.41 px (median).
- **Dependencies:** `msdfgen-wasm` 1.0.0, `fontkit` 3.0.0, `@types/fontkit` 2.0.9 (written for
  fontkit 2; it matches what's used), all pinned devDependencies.
- **Tests** (`devTools/assetPipeline/fonts/*.test.ts`, `FontSchema.test.ts`, `cache.test.ts`'
  extra outputs, `ktxEncode.test.ts`' raw args): the fixture is
  `devTools/assetPipeline/fonts/fixtures/IBMPlexSans-Medium.woff` (90 kB, from `@ibm/plex-sans`
  2.0.0, its OFL beside it); the golden `DIGITS` atlas `fixtures/plexSansDigits.golden.png` / `.json`
  (within 1 per channel; `AEK_UPDATE_FONT_GOLDEN=true` writes them, with a `FONT_ENCODER_VERSION`
  bump); the variable-font refusal on the UI kit's variable WOFF2.
- **Not run:** `yarn verify:baselines --update` (its API baseline gains `aekasha/schemas`' seven
  font names; it needs a build): before the PR.

### Phase 3: `yarn importFont`, the toolkit's fonts, the gather — done

1. `devTools/importFont.ts` (D4) and its `package.json` script; tests on a fixture font in a temp
   folder.
2. The toolkit's `fonts/` category (D7), its layout rule, encodes committed. `plexSans`' WOFF is
   the Phase 2 test fixture's file: point the font tests at the toolkit's copy and delete
   `devTools/assetPipeline/fonts/fixtures/IBMPlexSans-Medium.woff` and its licence (the golden files
   stay in `fixtures/`).
3. The gather: fonts in the generated data (`SceneData.fonts`, the scene's list and closure), D5's
   collection and staleness warning; the build's failure on a stale font. The encoder already takes
   the collected characters (`encodeFontAsset`'s `collected`, `resolveRequestedCharset`'s); the
   cache key doesn't yet (`getFontKeyParams` hashes the requested set without them): add the
   generated charset file to the key's files (`listFontFiles`) or the collected set to its params.
   The generated data's `__url` is the layout's (`getGeneratedFields`-like, from the run's
   `font:<json>` result).

As built (sections 1-2, 2026-11-27):

- **`yarn importFont`** (`devTools/importFont.ts`, `planFontImport` then `writeFontImportAsync`,
  tested in a temp `src/`): beyond D4, `--no-encode` (the files only); the id defaults to the file
  name in camelCase (`IBMPlexSans-Medium.woff` → `ibmPlexSansMedium`), letters, digits, `_`, `-`;
  `--into app` (default, `src/app/fonts/<id>/`, a new rule in `layoutRules.ts`' app asset folders),
  `toolkit` or a folder under `src/` (not `generated/`, `public/`); relative paths from yarn's
  `INIT_CWD`; an id another `*.font.json` has is refused (font JSONs only, until section 3 gives
  fonts an id space). The encode is `yarn assets --only <id>` as a child process (`assets.ts` runs
  at import). The licence note is `LICENSE.txt` (the name table's copyright, trademark, designer,
  manufacturer, version, licence and its URL), written only when the font names a licence, else a
  warning.
- **The toolkit's fonts** (`src/toolkit/fonts/<id>/`, a subfolder rule and `CREDITS.md` in
  `layoutRules.ts`), each imported by `yarn importFont --into toolkit`, its folder the font, its
  JSON, `LICENSE.txt` and `OFL.txt` (the npm package's licence text, which the OFL asks to travel
  with the font): `plexSans` (`@ibm/plex-sans` 2.0.0's `IBMPlexSans-Medium.woff`, ASCII + Latin 1 +
  D2's `chars`: 1024 × 512, 200 glyphs, 6,115 kerning pairs, atlas 390 kB, layout 57 kB),
  `plexMono` (`@ibm/plex-mono` 2.5.0's `IBMPlexMono-Regular.woff`, ASCII: 512², 95 glyphs, no
  kerning, 175 kB / 5.3 kB), `digitsDisplay` (**IBM Plex Sans Bold**, the plan named no face: same
  package and licence; `DIGITS`: 256², 18 glyphs, 4 pairs, 41 kB / 1.3 kB). `CREDITS.md` is
  written by hand (no `source.json` to generate it from). A full `yarn assets` then: 0 built.
- **The tests' font** is `src/toolkit/fonts/plexSans/IBMPlexSans-Medium.woff` (byte for byte the
  deleted fixture), so the golden `DIGITS` files didn't change.

As built (section 3, 2026-11-27):

- **Nothing to collect yet:** the scene has no texts before p392 (`texts`, its D2) and p397 (text
  decals), so the collection reads them through one function, `listSceneFontTexts`
  (`devTools/gather/fonts.ts`), which returns none, and `resolveFonts` doesn't append the texts'
  fonts to the scene's `fonts` (D6's closure): both are `TODO p392` / `p397` there. Everything
  else is built and tested with texts given by the tests. D5's verification (`yarn build` failing
  on a stale font, passing after `yarn assets`) can run end to end only with p392's texts: there it
  is unit tests (`devTools/gather/fonts.test.ts`).
- **The scene field:** `textSchemaPart` (`features/text/TextSchema.ts`, on `aekasha/schemas`,
  feature id `text`, in `ENGINE_SCHEMA_PARTS` last): `fonts`, font ids. A scene listing one gets
  `text` in its manifest, so `InitEngine` requires the `text()` feature: **Phase 4's feature id must
  be `text`**. p392 adds `texts` to the same part.
- **The generated data:** `SceneData.fonts` is `SceneFontDef[]` (`FontSchema.ts`, on
  `aekasha/schemas`): `{ id, type, __url?, __bytes?, __vramBytes? }`, plus `name` and
  `__sourcePath` in development data; `__url` is the layout (`getFontGeneratedFields`,
  `generated.ts`, from the run's `font:<json>` result), none without an output. The development
  data has a `fonts` section (every font by id, as scenes get them); production has none, so
  Phase 4's `loadFontAsync(id)` finds an unlisted font only in development data (or in another
  scene's entry). Pass 1 registers fonts in their own id space (`readFonts`: the id the JSON's or
  the file name's; a missing font or charset file fails the gather); the scene pass
  (`resolveFonts`, after the fogs) writes a scene's fonts once each, an unknown id failing it, and
  a production build checks each has an output (`ShipChecks.checkFont`: a font without one fails
  it, like an array).
- **The collection** (`collectFontChars`): per collecting font, each code point with the scenes
  writing it, from pass 1's scene JSONs with their save entries, **debug scenes included** (a
  production gather must write the same file, or the font's key would change between builds);
  control characters dropped; a text naming a font that doesn't collect adds nothing.
- **The charset file** `src/generated/fontCharsets.json` (`FONT_CHARSETS_FILE`, committed with the
  generated data): `{ "<fontId>": "<characters by code point>" }` for every collecting font, none
  when no font collects (the file is then removed). The gather writes it right after pass 1, even
  when a later step fails (a stale font fails a production build, and the `yarn assets` that fixes
  it must read the new collection), but not when pass 1 failed (a dropped scene would drop its
  characters). It reloads no page.
- **The key:** the collected set is in the key's params, not its files: `createFontSource` keeps
  `collected` only for a collecting font, and `getFontKeyParams` hashes the requested set with it
  (a collected character a preset already holds changes no key; a non-collecting font's key is as
  before, so no lock entry changed). `collectPipelineAssets` reads the file once
  (`readCollectedFontChars`); a file that doesn't read drops the collecting fonts from the run (no
  prune), naming it. The encode gets `collected` from its source.
- **Staleness** (`reportStaleFonts`, after the collection): with a run, a collecting font whose
  optimized output was encoded without a collected character (against the run's source's requested
  set, so a character the font lacks isn't stale again after its encode) is warned about, naming
  up to 20 characters, the scenes writing them and `yarn assets --only <id>`; in a production
  build it's an error, failing the build, when a shipped scene writes one (a debug scene's only: a
  warning). A `yarn assets` run reads the file the last gather wrote, so a scene changed since needs
  a second run (its gather warns).

### Phase 4: The runtime load — done

1. `FontData`, `getFont`, `loadFontAsync`, the scene's load and disposal (D6), in
   `features/text/Fonts.ts`; the feature's `install` registers only the load (p392 adds the rest).
   With it the `aekasha/text` entry (`index.ts`, `devTools/aliases.ts`, `tsconfig.json`'s paths, the
   Hub's entry table, the API baseline) and the font types on it. The parse reads Phase 2's layout
   format (`atlas.file` relative to the layout's URL, the glyph arrays); check an `SDF` font's
   `R8_UNORM` KTX2 through `KTX2Loader` on WebGPU and WebGL2.
   The atlas through `KTX2Loader` (D3: a `DataTexture`, its filters set to `LinearFilter`, no
   mips, no colour space), kerning scaled from `kerningUnitsPerEm` to em at the parse.
2. Tests: the parse into typed arrays, kerning lookups, the fallback glyph, a font owned by a
   scene disposed with it.

As built (section 1, 2026-11-28):

- **`features/text/Fonts.ts`**: `FontData` is `{ id, type, atlas, atlasWidth, atlasHeight, size,
  pxRange, metrics, glyphCount, codePoints (Uint32Array, ascending), advances, planeRects,
  atlasRects (Float32Array, 4 a glyph), glyphIndices (Map), fallbackIndex, kerning (Map) }`:
  `planeRects` are `left, bottom, width, height` in em (p392's `planeRect`), `atlasRects` `u, v,
  width, height` in UV with `v` from the top (D3: no flip); a glyph without ink has zeros.
  `getFontGlyphIndex(font, codePoint)` falls back to `fallbackIndex`. **The kerning key isn't D6's
  `first << 16 | second`** (a code point past the BMP needs 21 bits, and `chars` or a scene's
  collected text can hold one): `getFontKerningKey(first, second)`, `first * 0x110000 + second`,
  the amounts in em (scaled from `kerningUnitsPerEm` at the parse). **`isPersistent`, not D6's
  `persistent`**, as the asset loaders name it (`loadFontAsync(id, { isPersistent })`).
- **The layout format moved into the engine**: `features/text/FontLayoutFormat.ts`
  (`FONT_LAYOUT_FORMAT`, `FontLayout`, `FontLayoutGlyph`, types only, on
  `devTools/engineImports.test.ts`' list); the encoder's `layout.ts` imports and re-exports them,
  so the encoder and the parse read one definition. The parse refuses another format (before the
  atlas's download), a glyph entry of another length and a missing fallback glyph, each naming
  the font and `yarn assets --only <id>`.
- **The atlas is an ordinary registered texture**, `font:<id>`, loaded by `loadTextureAsync` from
  the data's `__atlasUrl` (section 2's fix, below; `LinearFilter` both ways, `generateMipmaps`
  false, `NoColorSpace`; `throwOnError`), so its owners, its release with the scene (once no
  material samples it), the Assets tab and the GPU memory tab are the kernel's; its `dispose`
  event drops the font from the map. The load checks the atlas's size against the layout's.
- **The load:** the declaration is the development data's `fonts` section, else the first scene
  entry (production: the scenes' only, as Phase 3 wrote). The layout's fetch and the atlas's load
  start together at the call (the atlas in the caller's owner scope); a loaded font is re-tagged to
  the caller's scope; a call while one loads shares it and is re-tagged after it. Persistence is the first
  load's (the atlas's registration): a later `isPersistent` load of a non-persistent font warns.
  A font without `__url`, or no data's, rejects naming `yarn assets --only <id>`.
- **The scene load:** `installFonts` (the `text()` feature's only install) starts a scene's
  `fonts` in `worldCleared` from the scene's own entries, so they download beside its textures,
  and awaits them in `assetsLoaded` (before the scene code). A font that fails is logged naming
  the scene, and the load goes on.
- **The feature and the entry:** `text()` (`TextFeature.ts`, id `text`), `aekasha/text`
  (`index.ts`: the four functions, `FontData`, `FontMetrics` and the schema's `FontAsset`,
  `FontCharsetPreset`, `FontType`, `SceneFontDef`; before `aekasha/schemas` in `ENTRY_FILES`, so
  the font types' API docs are on the text page), `devTools/aliases.ts`, `tsconfig.json`'s paths,
  `ENGINE_FEATURE_FACTORIES`, the Hub's entry table. **Not in the template's list** (`src/index.ts`):
  p392 Phase 1 adds it after `lines()` with the count of 18 in the `CLAUDE.md` files, so the app's
  first download doesn't change here.
- **Checked in the browser** (2026-11-28, system Chrome headless on macOS arm64, the dev app's
  `textureSets` scene; a temporary `SDF` `DIGITS` font of Plex Sans Bold, encoded, checked, then
  removed and pruned): `loadFontAsync` of `plexSans` (200 glyphs, 6,115 kerning pairs, `AV`
  −0.047 em; 12 ms on WebGPU, 23 ms on WebGL2 through SwiftShader), `digitsDisplay` and the `SDF`
  font: **every texel of every channel read back at texel centres equals the KTX2's data, the `SDF`
  font's `R8_UNORM` (a `DataTexture`, `RedFormat`, `UnsignedByteType`) included**, on both backends;
  the readback's row order flips between them for R8 as for RGBA (Phase 1), so R8 has D3's
  orientation. A second load returns the same font, two at once share one load, a scene switch
  releases a scene's font and its atlas, and a persistent one stays.
- **Found: a production build dropped the atlas** (Phase 3's gap). `assetOutputsBuildPlugin` (and
  `embedBuild.ts`' copy for an embed profile) kept only the files a `__url` in the generated data
  names, and the atlas was named only inside the layout. Fixed in section 2 (below).
- **Not run:** `yarn verify:baselines --update` (the API baseline gains `aekasha/text`; it needs a
  build): before the PR, with Phase 2's.

As built (section 2, 2026-11-28):

- **The atlas's URL is in the data** (D3 changed, with the user: the runtime needed only the
  layout's URL): `SceneFontDef.__atlasUrl`, the run's extra output (`getFontGeneratedFields`,
  `generated.ts`), written beside `__url` in development and production data. `collectUrls`
  (`assetOutputsBuildPlugin.ts`, which `embedBuild.ts` uses too) keeps `__url` and `__atlasUrl`
  (`OUTPUT_URL_KEYS`), so a build and an embed ship the atlas. The load starts both downloads at
  once (a round trip less per font) and refuses a layout whose `atlas.file` isn't
  `__atlasUrl`'s file (generated data older than the outputs: `yarn gatherAppData`), and a font
  without either URL. The layout still names its atlas. Re-checked in the browser (WebGPU): every
  texel as before, the release and the shared load the same.
- **Tests** (`features/text/Fonts.test.ts`, 22): on the kernel's own texture registry, owners and
  scene release, with the KTX2 file's load, `fetch` and `document` stubbed: the parse (code point
  order, the typed arrays, a glyph without ink, the rects in em and UV from the top, the metrics
  copied, kerning in em and none, the fallback for a missing code point, the three refusals), the
  kerning key past the BMP, the load (both downloads started before either ends, the atlas's
  sampler state, a loaded font without a load, a shared load, a scene's entry without the fonts
  section, no data, no output, a 404 naming both files and a retry, a wrong atlas size or another
  encode's atlas, the late `isPersistent` warning), a font's scene (owned by the loading scene, kept
  by the next scene's re-tag, released with the last one and gone with its atlas; a persistent one
  kept; outside an owner scope, the scene current at the atlas's registration, as a texture), the
  scene hooks (started at the world's clear from the scene's own entries, awaited once after its
  assets; a failed font logged naming the scene; a scene without fonts) and `text()`. Four
  mutations of the parse and the drop on dispose each fail a test. The gather's test checks
  `__atlasUrl` in both datas; `assetOutputsBuildPlugin.test.ts` (new) `collectUrls`.

### Phase 5: The Hub and the docs — done

1. The handbook page `docs/techniques/text-fonts.md`: formats, charsets, the dynamic option
   (p395), licences, the atlas cost table (glyph count × size → atlas size).
2. The Hub: a section on fonts in the Text feature page started here (`hub/pages/features/text/`,
   finished by p392 and p399), the `*.font.json` asset type, `yarn importFont`.
3. `devTools/assetPipeline/CLAUDE.md` (the font encoder; `FontLayoutFormat.ts` is the layout's one
   definition), `devTools/gather/CLAUDE.md` (the collection, `SceneFontDef`'s `__url` and
   `__atlasUrl`, `collectUrls`' keys), a `src/_engine/features/text/CLAUDE.md` (the runtime load:
   `FontData`, the atlas as `font:<id>`, the scene hooks; p392 extends it), the root `CLAUDE.md` (the command, the toolkit category), `readme.md` (the command,
   the asset type).

As built (2026-11-28):

- **The handbook** (`docs/techniques/text-fonts.md`, on the model of `texture-sets.md`): what it is,
  best for, which atlas type, performance, **the atlas cost table measured with the encoder**
  (`generateFontAtlasAsync` and `encodeKtx2Raw` from a scratch script: IBM Plex Sans Medium,
  `MTSDF`, five charsets from `DIGITS` to Latin + Extended-A + Greek + Cyrillic at 32, 48, 64 and
  96 px, the three types at 48, Plex Mono for the layout without kerning; about 100 glyphs fit 512²
  at 48, 200 1024 × 512, 500 1024²; doubling `size` doubled the atlas in every row but one; the
  layout is mostly kerning, quadratic in the charset), formats and their `fonttools` fixes,
  charsets, the collection, `yarn importFont`, using a font, the parameters with choosing `size` and
  `pxRange` (msdfgen's ≥ 2 screen px rule), licences, variations (p395's dynamic atlas as planned),
  the checklist and budgets, the toolkit's fonts. Also a line in `README.md`'s general pages and
  a Fonts section in `asset-optimization.md` (not in the plan).
- **The Hub:** the Text feature page (`hub/pages/features/text/`: World group, order 73, Lucide's
  `type` icon added at the Hub's pinned 1.53.0; covers `Font assets` and `Loading fonts`; no
  `::: scene` or `aek:image`: `textShowcase` is p392's), whose intro says fonts come first. The
  `importFont` output on it is real (`planFontImport` on the toolkit's Plex Sans Bold). Fonts also
  in Scenes and assets (the asset type, the `fonts` key, the manifest), Toolkit (the tree, a Fonts
  section) and Asset optimization; `hub/CLAUDE.md`'s feature page list.
- **The `CLAUDE.md` files:** `src/_engine/features/text/CLAUDE.md` (new; `## Font assets`, `##
  Loading fonts`; p392 adds its sections) and its line in the root's map; the root's command,
  `features/`' extra folder, the toolkit's `fonts/`, the app's `fonts/` and a sentence in the data
  pipeline; `devTools/assetPipeline/CLAUDE.md` (a Fonts bullet, `collectUrls`' keys in the build's);
  `devTools/gather/CLAUDE.md` (`fonts.ts`, the suffix, the schema and part, the pass order);
  `src/_engine/kernel/init/CLAUDE.md` (`text()` an eighteenth in `ENGINE_FEATURE_FACTORIES`, not in
  the template's list). The feature counts stay seventeen (p392 Phase 1 changes them).
- **`readme.md`:** Fonts in the engine's and the toolkit's features, the command, the tree.
- **Checked:** `yarn hub:build --no-embed` (142 pages, no new warning, no coverage warning),
  `yarn test`. Not run: `yarn verify:baselines --update` (Phases 2 and 4), before the PR.

### Phase 6: Versions and done — done

Toolkit minor (the fonts), engine: none yet if the feature ships with p392 on the same
integration branch (the epic's Branches and PRs: one bump at the `p390-text` merge). `CHANGELOG.md`
entry on the branch; mark the plan done.

As built (2026-11-28):

- **No version bumped** (decided with the user): the toolkit's minor wasn't bumped here either.
  This branch (from `main` at `916af9ce`, which hadn't moved) is `p390-text`'s base, and the
  engine, toolkit and app minors are bumped once in the `p390-text` PR, where `main`'s versions by
  then are known. `yarn checkVersions --against main` fails until then; the epic's Branches and
  PRs has the branch and the PR's to-do.
- **The `CHANGELOG.md` entry is the branch's**, `## 2026-11-28 — p390-text (p391 Phases 1-6)`,
  with Engine, Toolkit and Project sections (no App: the branch changed no app file). Its part
  headings are unnumbered (`### Engine (a minor, numbered at the p390-text merge)`): the Hub reads
  a part only from `### Engine <version> (<codename>)` (`devTools/hub/generated/version.ts`), so
  What's new shows the entry without a version `package.json` lacks. p392-p395 add to it.
  `yarn hub:build --no-api --no-embed` passes with it (its search index warning, 602 KiB, is the
  same without the entry).
- **Marked done:** `_DONE_p391_font-assets-and-msdf-font-tool.md`; the epic's `Blocks` names it,
  p392's `Blocked by` (only this plan) is gone and p395's names only p392. No `CLAUDE.md` file or
  Hub page named the file. The docs were Phase 5's.
- **Carried:** D5's end-to-end check (`yarn build` failing on a stale collected font, passing after
  `yarn assets`) needs p392's `texts` (Phase 3's `TODO p392` in `devTools/gather/fonts.ts`);
  `yarn verify:baselines --update`, before the `p390-text` PR.

## Verification

- `yarn test` (the encoder, the charsets, the import, the load); `yarn assets --only plexSans`
  twice (the second encodes nothing); `yarn build` fails on a stale collected font and passes
  after `yarn assets`.
- The atlas viewed in p392's debug tab (or, before it, the spike's image test).

## Non-goals

Colour fonts, bitmap fonts, complex-script shaping (the epic's Risks 3), more than one atlas page
(p395), hinting.
