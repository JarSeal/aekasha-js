Status: draft | not-implemented
Category: Text, Hub
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p394_labels-screen-text-and-debug-text.md, p398_decal-editing-and-bake.md
Related: `hub/CLAUDE.md` (pages, examples, scenes, `aek:covers`), `devTools/verify/CLAUDE.md` (the scene runner's configurations and baselines), `src/_engine/ui/CLAUDE.md`'s Game UI (the HTML world anchors and the `exampleGameHud` wiring)

# The Text Showcase and the Hub — Plan

The epic's example scene finished and its Hub pages completed. Each earlier plan adds its station
to `textShowcase` as it lands (p392 creates the scene); this plan adds the HTML / CSS comparison,
ties the stations into one walk, and writes the Hub's Text and Decals pages and the example page.

## The scene (`src/app/scenes/textShowcase/`)

A gallery walk: stations in a ring around a plaza, each signposted with its own world text (the
signs are the first example), a camera preset per station in the scene's debug tab, and a player
to walk it.

| Station | Shows | From |
|---|---|---|
| 1. Sizing and orientation | The same word in `WORLD` and `SCREEN` sizing, `PLANE`, `BILLBOARD`, `BILLBOARD_Y`; wrapping, alignment, anchors | p392 |
| 2. Fonts | `plexSans`, `plexMono`, `digitsDisplay`; a missing glyph's fallback; the atlas with its channels | p391, p392 |
| 3. Effects | Each effect alone and all together; a panel of the UI kit's fields editing one text's effects live | p393 |
| 4. Fades | Texts spawned and removed on a timer with fades | p393 |
| 5. Labels | Labels on a static crate, a moving platform and a falling physics box (with offsets); occluded vs on top; plates, distance fade, leader lines | p394 |
| 6. Nameplates and damage numbers | Characters with nameplates; a dummy taking hits that spawn damage numbers from a pool | p394 |
| 7. HTML / CSS | The same labels and nameplates as UI kit world anchors (CSS outline, glow with `text-shadow`, a blur with `filter`, a pulse with a keyframe animation, a fade with a transition), beside station 5's MSDF ones, with the guide's table on a sign | p394 D5 |
| 8. Debug text | The debug overlays' toggles (debug env only; the station says so in production) | p394 |
| 9. Projected decals | Atlas and text decals on a crate, a barrel (curved), a wall and a rock; wear, thickness, stencil, emissive at night | p396, p397 |
| 10. Material decals and the bake | A crate material with a serial number decal on several crates; its baked twin beside it | p396-p398 |
| 11. Dynamic glyphs | "Type your name" (when p395 is built) | p395 |
| Measurement | 1,000 / 10,000 world texts, 1,000 labels vs 1,000 HTML anchors, the GPU and CPU ms | p392, p394 |

## Phases

### Phase 1: The walk and the HTML / CSS station

Station 7 (the UI kit's world anchor layer, `WorldAnchorSync` from `aekasha/toolkit/ecs`, CSS in
the scene's own stylesheet); the plaza's layout and signs; the camera presets; the player; a day /
night toggle for the emissive decals. The scene's `textShowcase.hub.png`.

### Phase 2: The scene runner and the measurements

`devTools/verify/scenes.config.ts`: `textShowcase` with a `debugger` configuration and a camera per
station; baselines recorded on WebGPU and `--webgl`. The measurement station's figures collected
in one table for the Hub and the handbook.

### Phase 3: The Hub

1. The Text feature page (`hub/pages/features/text/`): overview, fonts, the API, effects, labels,
   screen text, debug text, dynamic fonts, the HTML-or-MSDF guide, performance; `aek:covers` over
   `features/text/CLAUDE.md`'s sections.
2. The Decals feature page (`hub/pages/features/decals/`): projected and material decals, text
   decals, editing and baking; `aek:covers` over `features/decals/CLAUDE.md`.
3. The example page `hub/pages/examples/text/` with the scene and the snippets from its
   `#region`s (each marker's note naming the page).
4. Links from the UI kit's Game UI page (world anchors → the guide) and the Terrain page (decals →
   the Decals page). `yarn hub:build`.

### Phase 4: The docs and the readme

`readme.md`'s Features (text, decals), its asset types (`*.font.json`) and commands
(`yarn importFont`); the root `CLAUDE.md` where the earlier plans left anything; the handbook
README's matrix row for text.

### Phase 5: Versions and done

App minor (the scene), engine patch only if engine docs or JSDoc changed. `CHANGELOG.md`;
`yarn checkVersions --against main`; mark the plan done, and the epic: every child done (p395
dropped or done) moves the epic to `implemented`. Time for the `p399-text-showcase` PR into
`main`.

## Verification

`yarn verify:scenes --only textShowcase` (both backends), `yarn hub:build` (no dead links, the
`aek:covers` complete), `yarn verify:ui` unaffected, `yarn sbp` (the scene's features in the app
profile's budget).
