Status: draft | not-implemented
Category: Text
Blocks: _DONE_p391_font-assets-and-msdf-font-tool.md, p392_text-feature-msdf-renderer.md, p393_text-effects.md, p394_labels-screen-text-and-debug-text.md, p395_dynamic-glyph-atlas.md, p396_engine-decals-feature.md, p397_text-decals.md, p398_decal-editing-and-bake.md, p399_text-showcase-scene-and-hub.md
Related: `src/_engine/features/lines/CLAUDE.md` (the handle + entity pattern text copies), `src/_engine/ui/CLAUDE.md`'s Game UI (the HTML world anchors, the other label route), `src/toolkit/terrain/CLAUDE.md` (p309's decal material and runtime decals, which p396 generalizes), `src/_engine/features/terrain/CLAUDE.md` (decal sets), `src/_engine/debug/editors/CLAUDE.md` (the material editor p398 extends), `src/_engine/kernel/render/CLAUDE.md` (texture bakes, p398's bake), `devTools/assetPipeline/CLAUDE.md` (where p391's font encoder goes)

# Text Rendering and Text Decals — Epic

Text in the 3D world: world-space text, labels, in-canvas screen text and debug text, with outlines,
glow, shadows, blur, colour pulses and fades; fonts turned into Ækasha fonts by the asset pipeline
with only the characters an app needs; and text painted onto meshes as decals, on a decal system
generalized out of the terrain toolkit, edited in the material editor and baked into a material.

**Renamed** (2026-11-27, with the user): the request was "Billboard text and decal text features".
A billboard is one orientation option of a text (D3), so the epic is named for what it delivers.

## The request, mapped

| Asked for | Where | Notes |
|---|---|---|
| World-space text | p392 | `sizing: 'WORLD'`, metres |
| UI text | p394, and the UI kit as it is | The HUD and menus stay the HTML UI kit (D7). p394's screen text is in-canvas text that lives in the world: nameplates, damage numbers |
| Labels | p394 | A preset over a text, plus the guide to HTML world anchors |
| Debug overlays | p394 | Immediate-mode `drawDebugText`, debug builds only |
| Distance fields | p391, p392 | MTSDF (D2) |
| Outlines, glow, drop shadows, blur, colour pulse | p393 | Build-time variants: zero cost when off (D4) |
| World or fixed sizing | p392 | `sizing: 'WORLD' \| 'SCREEN'` |
| Billboard or plane orientation | p392 | `orientation: 'PLANE' \| 'BILLBOARD' \| 'BILLBOARD_Y'` |
| Fade in / out on add / remove | p393 | Per-text opacity, no variant |
| Font import helper, a command | p391 | `*.font.json` + `yarn importFont`, encoded by `yarn assets` |
| Only some characters | p391 | Charset presets, `chars`, `charsFromFiles` |
| Only the characters used (opt-in) | p391 (static), p395 (dynamic) | D5 |
| Text decals on meshes, positioned and oriented | p397 | On p396's decal system |
| Decal system | p396 | p309's core moved into an engine `decals()` feature |
| Worn-out text, thick paint (normal) | p397 | From the distance field, no normal map needed (D8) |
| Editing in the material editor | p398 | The existing editor (p084, p085) gets a Decals tab |
| Bake the decal onto the material | p398 | UV-space bake, exported in dev; production saving needs a backend |
| A showcase scene with every variant and the HTML/CSS examples | p399 | `textShowcase`, built up by each plan |

## Text methods compared

What each way of drawing text costs and how sharp it stays. The figures are typical, not measured
here; p392 Phase 5 and p393 measure ours.

| Method | Sharpness | Cost | Effects | Verdict |
|---|---|---|---|---|
| HTML / CSS (the UI kit's world anchors) | Perfect, the browser's | Layout and compositing per element; past about 200 moving labels the DOM is the frame's cost. No depth occlusion; not in snapshots or PostFX | All of CSS | Kept for the HUD, menus and a few labels (D7) |
| Canvas 2D drawn into a texture | Blurry when magnified, aliased when minified | A texture and an upload per text and per change | Whatever was drawn | No |
| Bitmap font atlas | Sharp at its one size | Cheap | None | No |
| Single-channel SDF | Scales well; rounds sharp corners when magnified | One tap | Outline, glow, shadow, softness | Covered by MTSDF |
| MSDF (multi-channel SDF) | Sharp corners at any size | One RGB tap and a median | Outline, but only within its range, and the far field is noisy | The core |
| **MTSDF** (MSDF + a true SDF in alpha) | MSDF's sharpness, plus a clean far field | One RGBA tap | Everything the true SDF reaches: outline, glow, shadow, blur | **Chosen** (D2) |
| Extruded geometry (three's `TextGeometry`) | Perfect, 3D | Many triangles per glyph | Lit like any mesh | Logos only; already in three |
| GPU vector curves (Slug-style) | Perfect at any size | Complex shaders, curve data per glyph | Few | Out of scope |

Libraries: troika-three-text isn't WebGPU-ready (its shaders are GLSL injected into three's WebGL
materials). three-msdf-text-utils has a TSL material, but its effects are fixed in its graph; owning
the graph lets every effect be a build-time variant (D4), and the engine needs the same sampling
node for decals (p397).

### MSDF and MTSDF in plain words

- **A signed distance field (SDF)** stores, per texel, how far that point is from the glyph's
  edge: 0.5 on the edge, more inside, less outside. The shader draws the glyph where the
  interpolated value is above 0.5. The texture can be small because bilinear filtering of
  distances gives a smooth edge at any magnification, unlike filtering of colours.
- **Why corners round off:** at a sharp corner two edges meet, and one distance can't tell the
  shader which edge is nearer on either side; interpolation smooths the corner.
- **MSDF** stores three distances, one per colour channel, each to a different set of edges
  (msdfgen's "edge colouring"). The **median** of the three restores the sharp corner: where two
  channels agree a point is inside, the median says inside. So corners stay sharp at any size.
- **The distance range** (`pxRange`, in atlas pixels) is how far from the edge the field holds
  values. The shader turns it into **screen pixels** with the UV derivatives
  (`screenPxRange = pxRange × atlasSize / screenSizeOfTheGlyph`), so the edge is antialiased to
  about one screen pixel at every size and angle.
- **MSDF's weakness:** away from the edge the three channels disagree, so effects that read far
  from the edge (a wide glow, a soft shadow) pick up artifacts.
- **MTSDF** adds a fourth channel, alpha, holding the plain single-channel distance. The fill
  and a thin outline read the median (sharp); glow, shadow and blur read alpha (smooth). One RGBA
  sample serves both.
- **The limit:** an effect can only reach as far as `pxRange`. An 8 px range at a 48 px glyph
  size reaches about a sixth of the glyph's height. A wider glow or blur needs a larger range
  (a bigger atlas) or PostFX.
- **Compression:** block compression (UASTC, ETC1S, BC) quantizes the channels independently and
  breaks the median, so atlases stay lossless (PNG, or KTX2 `R8G8B8A8_UNORM` with zstd). An
  atlas is small anyway: about 100 Latin glyphs at 48 px fit in 512 × 512 (1 MB in GPU memory).

## Decisions

### D1. A text is a handle that can be an entity, like a line

`lines()` (`features/lines/`) set the pattern, and text follows it: `createText(opts)` returns a
plain handle in a module-wide registry; `createTextEntity(opts, entityOpts)` makes it an entity
(a `TEXT` component, placed by its `TRANSFORM`, a child of another entity through the usual
parenting); `bindTextToEntity(text, entityId)` ties a handle's life to an entity;
`text.attach({ to: 'ENTITY', entityId, offset })` only follows one. Deleting the entity disposes
the text and the other way round. Scene exit disposes every text that is neither `persistent` nor
bound.

Why not entities only: debug text and damage numbers are made and dropped many times a second,
and an entity each would cost ECS churn for nothing. Why not handles only: a sign in a scene JSON,
a nameplate on a character or a label on a physics body wants the entity's lifetime, transform,
`APP_ID`, persistence and the edit window.

**Rendering is batched, not one mesh per text.** Every glyph is an instance of one quad; the
glyphs of all texts sharing a font, an effect variant (D4) and a blend mode are one draw. A text
is a row in its batch's text table (its world matrix, colour, opacity, size, effect values), so
moving a text rewrites a row, not its glyphs, and an attached text's row follows its entity in
`APP_RENDER_SYNC` only when the entity moved. Billboarding and screen sizing are computed in the
vertex stage, so a moving camera costs no CPU.

### D2. MTSDF atlases, our own TSL graph

See the comparison. The fill reads the median of RGB, the soft effects the alpha. The sampling
node (`sampleMtsdf`, screen-px range, the median) is one module, shared by text (p392), its effects
(p393) and text decals (p397).

### D3. Sizing and orientation

- `sizing: 'WORLD'`: the font size in metres. `'SCREEN'`: in CSS pixels at any distance, with
  `minScale` / `maxScale` clamps and an optional `fadeDistance`.
- `orientation: 'PLANE'` (the text's own transform: signs, floor markings), `'BILLBOARD'` (faces
  the camera) or `'BILLBOARD_Y'` (turns about world Y only: nameplates over characters).
- `depthTest: true` by default; `false` draws on top (labels through walls, debug text).

### D4. Effects are build-time variants

A text's `effects` (outline, glow, shadow, softness, pulse, gradient) select which parts the
batch's graph is built with; their values are per-text in the text table. Texts with the same set
share a draw; an effect that's off isn't in any graph, so it costs nothing. Fades are opacity in
the table, no variant. A variant is built once per font, effect set and blend mode and cached.

### D5. Fonts: a font asset, charsets, and the dynamic atlas later

- **Input formats:** TTF, OTF (TrueType or CFF outlines) and WOFF. WOFF2 and variable fonts are
  refused for now (p391 D1: its generator reads a font file at its default instance only, and has
  no brotli); a static instance in one of the three formats is the route. Colour fonts (COLR, SVG,
  bitmap emoji) are out of scope.
- **The Ækasha font** is a `*.font.json` (its source font beside it, like a model's GLB) that
  `yarn assets` encodes into an MTSDF atlas plus a layout JSON (metrics, advances, plane and atlas
  bounds per glyph, kerning pairs) in `src/public/aek-assets/`. `yarn importFont <file>` writes the
  JSON with sensible defaults.
- **Which characters:** charset presets (`DIGITS`, `ASCII`, `LATIN_1`, `LATIN_EXT_A`, `GREEK`,
  `CYRILLIC`, …), `chars` (any string), `charsFromFiles` (eg. an app's localization JSONs), and
  opt-in `collectFromScenes`, which adds every character written in the scenes' and decals' JSON
  text. The gather can see only JSON, so text built in code (scores, player names) needs a preset,
  `chars` or the dynamic atlas.
- **This is what current engines do:** Unity's TextMeshPro and Godot both ship static atlases with
  a chosen set, and both offer a dynamic atlas that renders missing glyphs at runtime from the
  font file. Collecting the used characters at build time is the same idea as web font subsetting.
  p395 is the dynamic atlas: a lazy chunk, opt-in per font (`dynamic: true`).
- **A missing glyph** draws the font's `fallbackGlyph` (default `?`, else a box) and warns once
  per character in debug.

### D6. Decals become an engine feature

p309 built decals inside the toolkit's terrain category: an atlas decal material, projected mesh
decals, pools as `BATCHED` merge groups, ribbons and trails, decal sets. Text decals and the
material editor need decals on any mesh and any material, so the core moves to an engine
`decals()` feature (`aekasha/decals`, p396):

- **Projected decals** (per placement, any mesh, no UVs needed): p309's patch builder and pools,
  with sources registered by kind (`ATLAS` cell, `TEXT`).
- **Material decals** (new): a material's `decals` list, placed in the mesh's UV space and
  composed into any node material's colour, normal, roughness and emissive by one TSL node, built
  only when the list isn't empty. Every mesh with that material carries them (a logo on every
  crate of a material).

Terrain keeps its decal materials, generators and decal sets. `createDecalPool`, `spawnDecal`,
`spawnMeshDecalAsync`, `spawnRibbonDecal` and `createDecalTrail` on `aekasha/toolkit/terrain`
become deprecated wrappers (removed in toolkit 4.0), so the toolkit bumps a minor.

### D7. HTML stays the UI

The UI kit (DOM, `aekasha/ui`) is the HUD, menus and the game UI pieces, and its world anchors
(`ui/game/anchors/`, synced by `toolkit/ecs/effects/WorldAnchorSync.ts`) are the HTML label route.
They're sharp, accessible (screen readers, focus, selection) and styled with CSS. MSDF text is for
text that belongs in the 3D picture: occluded by geometry, in snapshots and PostFX, hundreds at
once, on surfaces. p394's guide says which to pick; p399's scene shows both side by side.

### D8. Text decal effects come from the distance field

The distance field is also a height profile: inside the glyph it rises from the edge. So:

- **Wear:** seeded noise raises the threshold locally, eating into the letters, more at the edges.
- **Paint thickness:** a height from the distance (`smoothstep` over a `thickness` width), its
  normal from the height's screen derivatives, mixed into the surface's normal; roughness and
  metalness values for the paint.
- **Stencil breaks, outline, emissive** likewise from the field.

No normal map is authored; the decal's normal is computed per pixel.

### D9. Editing and the bake build on the existing editors

The material editor (p084, p085, done) gets a Decals tab for material decals; a projected decal
gets an edit window per entity. Placing decals with gizmos in the scene waits softly on a future
"Start editor view" plan (p090, a prompt in `docs/templates/todo-plan-prompts.txt`). The bake
renders a material's decal layer into a texture in the mesh's UV space through the kernel's
texture bakes, which needs a non-overlapping UV set. In dev the dev file server writes the baked
texture and the material JSON change; a production build has no saving (that needs a backend).

## Risks

1. **The atlas generator (p391 Phase 1, a spike).** Chlumsky's msdf-atlas-gen, the reference,
   ships an official binary for Windows only (macOS and Linux through Homebrew or a CMake build),
   so it can't be downloaded and pinned like `ktx`. The routes in order: `msdfgen-wasm` (a
   WebAssembly msdfgen with TypeScript bindings, run in Node; whether it makes MTSDF is to be
   confirmed), the native tool where present, then a TypeScript port of msdfgen's core (edge
   colouring, the distance per channel, error correction) as the last resort. The spike's
   go / no-go decides p395 too (it needs a generator that runs in a browser worker).
   **Decided** (p391 Phase 1, 2026-11-27): msdfgen-wasm is MSDF-only, so a hybrid: its MSDF in RGB,
   our own true SDF in alpha, fontkit for metrics and GPOS kerning (msdfgen-wasm reads none).
   p391 D1 has the figures and what the hybrid can't read (WOFF2, variable fonts).
2. **Effect reach** is bounded by `pxRange` (see the explainer). Documented, with the atlas cost
   of a larger range.
3. **Complex scripts** (Arabic, Indic, Thai) need shaping (HarfBuzz), and colour emoji need colour
   glyphs. Out of scope: Latin, Greek and Cyrillic with kerning pairs. The route, recorded in the
   Non-goals and moved to p990 when the epic is done: `harfbuzzjs` (about 300 kB of WebAssembly, a
   lazy chunk) shaping into the same glyph quads.
4. **Transparency order:** a blended batch draws its texts in insertion order, so overlapping
   blended texts at different depths can blend in the wrong order. `ALPHA_TO_COVERAGE` (the
   default for fills without soft effects) needs no order; a batch can opt into a back-to-front
   sort of its text ranges when the camera moves (CPU cost, counted).
5. **The material decal layer** touches every material's build through a kernel hook (p396
   Phase 1 decides its shape against `kernel/assets/MaterialInputResolvers.ts`' registration
   pattern). A wrong shape costs a rebuild of every material; the hook is a no-op without decals.
6. **A fade-out delays deletion:** `removeText(text, { fade })` deletes once the fade ends, so a
   caller re-checks a handle after it (the JSDoc says so). Scene exit stays instant.

## Branches and PRs

- **`p390-text`** (integration branch, from `main`): p391, p392, p393, p394 and p395, each plan's
  phases committed on it (a sub-branch per plan when two are worked at once, merged back into
  `p390-text`). One PR into `main` when p394 is done, or p395 when its spike is a go and it's built
  by then: engine minor (the `text()` feature), toolkit minor (the fonts), app minor (the scene's
  stations).
  - **p391 was built on its own branch**, `p391_font-assets-and-msdf-font-tool` (from `main` at
    `916af9ce`), which is `p390-text`'s base (2026-11-28, with the user): `p390-text` is created
    from its last commit, and p392 starts there. p391 bumped no version. Its `CHANGELOG.md` entry
    is the branch's (`## 2026-11-28 — p390-text (p391 Phases 1-6)`): each plan adds to it, and its
    part headings stay unnumbered (`### Engine (a minor, numbered at the p390-text merge)`), so
    the Hub's What's new shows no version `package.json` lacks.
  - **Before the PR:** the date and the plans in the entry's heading; the bumps (engine, toolkit
    and app minors, each once, at the level of the biggest change since `main`) and the part
    headings' numbers and codenames; `yarn verify:baselines --update` (the API baseline gains
    `aekasha/text` and p391's font names on `aekasha/schemas`, and whatever p392-p395 add);
    `yarn checkVersions --against main`, which fails on this branch until the bumps.
- **`p396-decals`** (integration branch, from `main` after `p390-text` merged, since p397 needs
  the MTSDF node): p396, p397 and p398. One PR into `main` after p398: engine minor (`decals()`),
  toolkit minor (the deprecated wrappers, the terrain decals on the engine core), app minor.
- **`p399-text-showcase`** (from `main` after both): the showcase's last pass and the Hub. Its
  own PR, app minor and the engine's patch for the Hub only if engine docs changed.
- p395 may also land on its own later branch if its spike says go after `p390-text` merged.

Each plan's last phase says when its PR is due, from this section.

## The example scene (asked, answered)

Yes: `textShowcase` (`src/app/scenes/textShowcase/`), a station per feature. p392 creates it,
each plan adds its stations, p399 finishes it with the HTML/CSS comparison and the Hub's example
page.

## Non-goals

- Rich text markup (inline colours, bold runs). A text has one style; several texts make a mixed
  line. A follow-up if games need it.
- Text input in the 3D world (a caret, selection). Text fields are the UI kit's.
- Label decluttering (moving labels so they don't overlap). A follow-up.
- Saving in production (needs a backend). The bake's export works in dev.
- Complex-script shaping and colour emoji (Risks 3), with `harfbuzzjs` as the route.
