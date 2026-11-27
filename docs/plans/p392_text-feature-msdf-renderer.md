Status: draft | not-implemented
Category: Text, Rendering
Epic: p390_text-rendering-and-text-decals.md
Blocks: p393_text-effects.md, p394_labels-screen-text-and-debug-text.md, p397_text-decals.md
Related: `src/_engine/features/lines/CLAUDE.md` (the pattern: handle, registry, entity binding, attach, scene exit, lazy chunk), `src/_engine/kernel/init/CLAUDE.md` (the feature contract), `src/_engine/features/merging/CLAUDE.md` (`packMergeMaterialTable`: a per-object table texture read by a shared graph), `src/_engine/features/instancing/CLAUDE.md` (instanced draws, the GPU and CPU backends), `devTools/sbp/CLAUDE.md` (the feature's group and budget)

# The Text Feature and the MTSDF Renderer — Plan

The `text()` engine feature (`features/text/`, `aekasha/text`): texts as handles or entities
(the epic's D1), laid out from p391's fonts, drawn as batched instanced glyph quads by an MTSDF
TSL graph (D2), sized in metres or screen pixels and oriented as a plane or a billboard (D3).
Effects are p393's; this plan builds the fill and the variant mechanism they plug into.

## Design

### D1. The API (`aekasha/text`)

```ts
const title = createText({
  text: 'Ækasha',
  font: 'plexSans',
  size: 0.5,                  // metres (WORLD) or CSS px (SCREEN)
  sizing: 'WORLD',            // 'WORLD' | 'SCREEN'
  orientation: 'BILLBOARD',   // 'PLANE' | 'BILLBOARD' | 'BILLBOARD_Y'
  color: '#ffffff',
  opacity: 1,
  align: 'CENTER',            // 'LEFT' | 'CENTER' | 'RIGHT'
  anchor: 'MIDDLE_CENTER',    // the text box's point at the text's origin
  maxWidth: 4,                // wraps at word boundaries; Infinity for none
  lineHeight: 1.2,
  letterSpacing: 0,
  depthTest: true,
  renderOrder: 20,
  blend: 'AUTO',              // 'AUTO' | 'ALPHA_TO_COVERAGE' | 'BLEND'
  position: [0, 2, 0],
  persistent: false,
});
title.setText('Ækasha 6');      // relayout only this text's glyphs
title.setColor('#ffcc00');      // a table row write
title.attach({ to: 'ENTITY', entityId: crate, offset: [0, 1.2, 0] });
title.dispose();

const signId = createTextEntity({ text: 'EXIT', font: 'plexSans', orientation: 'PLANE' }, { appId: 'exitSign' });
bindTextToEntity(text, entityId);
getText(id); getTextForEntity(entityId);
```

- `createText` throws naming the feature when `text()` isn't installed, and names the font when it
  isn't loaded (`loadFontAsync` first, or the scene's `fonts`).
- The setters write in place: no allocation, and a change only marks the text dirty. Layout runs
  once per dirty text in the feature's system, not in the setter.
- Options objects per the coding standards; the `world` in `entityOpts`.

### D2. The scene JSON

A scene's `texts` entries (`TextEntitySchema`, the feature's, gathered into `SceneData.texts`,
the kernel naming the type only): the same options plus `entityOpts` (`appId`, `parent`,
`persistent`), spawned in the scene load's entity step. The fonts they name are appended to the
scene's `fonts` (p391 D6). No `*.text.json` asset: a text is scene content, not a reusable asset.
A text entity's edit window (debug) edits its options and saves through `__saveData` like other
entities.

### D3. Layout (`TextLayout.ts`, pure)

Code points (surrogate pairs joined) → glyphs through the font's map, the fallback for a missing
one (warned once per character in debug); advances, kerning pairs, `letterSpacing`; line breaks at
`\n` and, with `maxWidth`, at the last space or after a hyphen (a word longer than the line breaks
by glyph); `align` per line; the box's size and the `anchor` offset. Writes into the text's glyph
range of the batch: per glyph `planeRect` (x, y, w, h in em × size), `atlasRect` (UV), and the
text's row index. Tests cover kerning, wrapping, alignment, anchors, surrogate pairs, an empty
string, `\n\n`.

### D4. The batches and the text table

- A **batch** per (font, effect variant, blend mode, `depthTest`, `renderOrder`): one `Mesh` of an
  instanced quad (`InstancedBufferGeometry`, a glyph per instance: `planeRect` vec4, `atlasRect`
  vec4, `row` float), its material the variant's graph. Its glyph buffer grows by doubling; a text's
  glyphs are a contiguous range; a removed text's range is freed and compacted on the next frame
  that has dirty texts (moving the tail ranges down, one upload of the moved span).
- The **text table** per batch: a `DataTexture` (RGBA32F, 4 texels a row: the world matrix'
  three rows, then colour + opacity; p393 adds its rows' effect values in more texels), like
  merging's `packMergeMaterialTable`, so a text's move or colour is one row's write and a
  `needsUpdate` of that row range (`addUpdateRange`). Texts are at most 2¹⁶ per batch.
- **Attached and entity texts** update their row in `APP_RENDER_SYNC` from the entity's world
  matrix only when it changed (the matrix compared to the row, or the entity's transform version
  when the ECS has one).
- **Culling:** a batch's `frustumCulled` is false (texts are spread over the world); a text
  outside the frustum still costs its glyphs' vertex work. A per-text bounding sphere and a
  `visible` flag are in the table; a CPU pass hiding off-screen texts is a measured follow-up
  (Phase 5 decides: if 2,000 world texts cost more than 0.3 ms GPU, the pass gets built).
- Bounds for the spatial index and raycasts: a text entity has a box from its layout, so a
  pick in the debugger selects it.

### D5. The graph (`TextMaterial.ts`, TSL)

- **Vertex:** the row's matrix; `PLANE` places the quad in the text's space; `BILLBOARD` builds
  the quad from the camera's right and up in world space; `BILLBOARD_Y` from the camera's
  direction projected on the XZ plane. `SCREEN` sizing scales the quad by the clip `w` × (CSS px
  ÷ the drawing buffer's height in CSS px), clamped by `minScale` / `maxScale`. Orientation and
  sizing are variant bits (no branches in the shader).
- **Fragment:** `sampleMtsdf` (`MtsdfNode.ts`, exported for p397): the atlas sample, the median
  of RGB, `screenPxRange` from `fwidth` of the atlas UV (clamped at 1 so minified text doesn't
  vanish), coverage = `clamp(screenPxRange × (median − 0.5) + 0.5)`. Colour × coverage ×
  opacity. `ALPHA_TO_COVERAGE` (no sorting, needs MSAA, falls back to `alphaTest` 0.5) or `BLEND`
  (premultiplied, depth write off).
- `blend: 'AUTO'`: alpha to coverage for a fill without soft effects, blend when p393's soft
  effects or a fade are on.
- The variant key and cache (`TextVariants.ts`): bits for orientation, sizing, blend, the effects
  (p393). A graph is built once per key per font atlas.

### D6. Disposal and scene exit

As lines: the feature's `exit` hook disposes every text neither `persistent` nor bound; an
entity's text goes with its entity; a batch with no texts is disposed after a frame (so a scene
reload doesn't rebuild its graph twice); a font's atlas is disposed with its scene unless a
persistent text uses it.

### D7. Debugging (`debug/_dbg__TextTab.ts`)

A Text tab: the batches (font, variant bits, glyph and text counts, the buffer's capacity), the
texts (search, select → its edit window; a text entity's opens the entity window), the fonts and
their atlases (shown at 1:1 with a channel picker: RGB median, R, G, B, A), a toggle drawing each
text's box with `lines()` when it's installed.

## Phases

### Phase 1: The feature, the handle and layout

1. `TextFeature.ts` (`text()`, after `lines()` in the template's list; the feature count 18 in the
   root `CLAUDE.md` and `kernel/init/CLAUDE.md`), `index.ts`, `TextRegistry.ts`, `TextObject.ts`
   (the handle, its options and setters), `TextLayout.ts` with its tests.
2. The `TEXT` component and `createTextEntity` / `bindTextToEntity` / `attach`, the hooks as
   `LineEntity.ts`; tests with the ECS.

### Phase 2: The batches and the graph (the fill)

1. `TextBatch.ts` (D4) and `TextTable.ts`, `TextMaterial.ts` and `MtsdfNode.ts` (D5),
   `TextVariants.ts`; the per-frame system (layout of dirty texts, row writes, compaction) with no
   allocations (the `perf-auditor` agent's check).
2. The `textShowcase` scene (`src/app/scenes/textShowcase/`; signposted stations, a debug camera
   path): world text in both sizings and the three orientations, wrapping and alignment, a text
   attached to a moving entity, a code-made text and a JSON one.
3. Check both backends (`yarn verify:scenes --only textShowcase` and `--webgl`): sharp edges
   from 4 px to filling the screen, at grazing angles, no shimmer in motion.

### Phase 3: The scene JSON and the edit window

1. `TextEntitySchema`, the gather's `texts`, the spawn in the scene load, `__saveData`.
2. The edit window and the Text tab (D7).

### Phase 4: Disposal, budgets and the build

1. D6; the SBP group `_engine/features/text` and its budget in `sbp.config.ts` (the app profile;
   the banner at 0); `yarn sbp`.
2. `moduleSideEffects.test.ts` and the layout check pass; the API baseline (`yarn
   verify:baselines --update` with the new entry).

### Phase 5: Measure

On `textShowcase`'s measurement station: 100, 1,000 and 10,000 world texts of 12 glyphs (one
batch), GPU ms and draw calls on WebGPU and WebGL2, the CPU ms of `setText` on 100 texts a frame.
Record the table here and in the handbook; decide D4's culling pass.

### Phase 6: The Hub and the docs

1. `features/text/CLAUDE.md` (its `##` sections: the API, layout, batches and the table, the
   graph, disposal, debugging) and its line in the root map.
2. The Hub's Text feature page (`hub/pages/features/text/`, `aek:covers` naming those sections),
   the API's `@example`s, the snippets from the showcase's `#region`s.
3. `readme.md` (Features: text), the root `CLAUDE.md`'s Bootstrap flow feature list.

### Phase 7: Versions and done

Shares the `p390-text` branch's bump (engine minor, app minor). `CHANGELOG.md`; mark the plan done.

## Verification

`yarn test`; `yarn verify:scenes --only textShowcase` (WebGPU and `--webgl`), its baseline;
`yarn sbp`; `yarn verify:baselines`; Phase 5's table.

## Non-goals

Rich text, text on a path, vertical text, RTL and shaping (the epic's Risks 3), text editing.
