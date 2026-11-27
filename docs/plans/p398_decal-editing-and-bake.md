Status: draft | not-implemented
Category: Decals, Debugger
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p396_engine-decals-feature.md, p397_text-decals.md
Blocks: p399_text-showcase-scene-and-hub.md
Related: `src/_engine/debug/editors/CLAUDE.md` (the material editor: its tabs on `createEditorDrawer`, `registerMaterialEditorPreparer`, the per-material records, undo, the save source `_dbg__MaterialSave.ts`), `src/_engine/kernel/render/CLAUDE.md`'s Texture bakes (`bakeTexture`'s `mesh` UV-space bake, `exportBakedTexture`), `devTools/devFiles/CLAUDE.md` (what a dev save can write), p990_follow-ups-from-done-plans.md (the material editor's next steps; "Start editor view", p090, is still a prompt in `docs/templates/todo-plan-prompts.txt`)

# Decal Editing and the Decal Bake — Plan

Editing decals in the debugger and baking them into a material (the epic's D9):

- **Material decals** (p396 D2, p397 D3) in the existing material editor (p084, p085): a Decals
  tab to attach, remove and edit them on the preview stage.
- **Placed decals** (p396 D1's `DECAL` entities) in an edit window per entity, with undo and the
  scene save.
- **The bake:** a material's decal layer rendered into a texture in its mesh's UV space, so the
  decals cost one texture fetch instead of their layer, exported in dev through the dev file
  server.

The user asked that decal editing wait for "the material editor plan". The editor is already built
(p084, p085 done), so this plan builds on it. Placing decals in the scene with move / rotate gizmos
waits softly on the "Start editor view" plan (p090, not written yet; see Non-goals).

## Design

### D1. The Decals tab (material editor)

A tab beside Params and Settings (`_dbg__MaterialEditorDecals.ts`), shown for a material the
decal layer supports (p396 D2: not terrain, not the merge material; the tab says why when
hidden):

- **The list:** the material's decals (up to `MAX_MATERIAL_DECALS`), add (source kind: atlas
  cell or text), remove, reorder (draw order), duplicate.
- **Per decal:**
  - Source: an atlas and a cell picker (the cells' previews from the atlas texture) or, for
    text, the text field, the font picker (the scene's fonts and the toolkit's), align, fit.
  - Placement: UV set, centre, size, rotation, as fields; and **pick on the ball**: a click on the
    preview stage raycasts the shown mesh and writes the hit's UV as the centre (Shift + drag
    scales, Alt + drag rotates), so placement doesn't need the UV numbers.
  - Look: colour, opacity, blend (over / multiply), and for text p397's outline, wear (amount,
    scale, edge, seed), paint (thickness, roughness, metalness), stencil, emissive.
  - **Paint thickness is the "normal map":** a thickness value makes the text read as thick paint
    from its computed normal (p397 D4). An atlas decal's normal is its atlas' `normalRough`; a
    `normalStrength` scales either.
- **The preview shape:** the stage's ball has poor UVs for decals at the poles; the tab adds the
  stage's shape choice (ball, rounded box, plane, cylinder; the "other preview shapes" in p990's
  material editor follow-up) with each shape's UV layout shown as an overlay toggle.
- **Edits** are the editor's overrides (`overrides.decals` in the per-material record, through
  `patchMaterialRecord`), live on the copy (uniform writes; an add, remove or source kind change
  rebuilds the copy), recorded for undo (`materialEditor.setValue` with section `decals`), and
  saved by the existing save source into the scene's `__saveData` (or, when the material isn't
  in the scene, "Not saveable", as today). The gather's material merge learns the `decals` list
  (merged by index, whole entries compared).

### D2. A placed decal's edit window

The `DECAL` entity's window (a window kind registered by `features/decals/debug/`): its target (an
entity picker), placement (position on the target, normal, up, size, as fields; a "Snap to
target" re-projecting onto the target's nearest point), the source and look as D1's, its pool and
material. Edits rebuild its patch (p396's queued rebuild), record undo per field, and save the
entity's `__saveData`. A "Select in scene" button frames the camera on it. The Decals debug tab
lists pools (capacity, used, FIFO pressure) and placed decals.

### D3. The bake

- **What:** for a mesh and its material's decal layer, `bakeTexture({ id, size, mesh: {
  geometry }, outputs: { albedo, normalRough, emissive? } })` renders the layer alone (the decals
  over a transparent base) into the mesh's UV space. The material then reads the baked textures as
  one more layer (`{ kind: 'BAKED', textures }`, the layer's own source kind) instead of the
  decals: one fetch per output per pixel, whatever the number of decals.
- **Needs:** a UV set with no overlapping islands (the bake writes each texel once; overlaps
  merge); the tab checks the chosen UV set for overlaps (a CPU pass over the triangles' UV
  areas, warned with the overlapping share) and offers `uv1` when the mesh has one.
- **Live:** "Bake" in the tab shows the baked result on the stage immediately (a toggle switches
  live layer ↔ baked, for comparing).
- **Export in dev:** "Export baked" writes the PNGs through `exportBakedTexture` (dev files; the
  `textures/` folder next to the material, or a chosen one), then writes `*.texture.json`s for them
  and a material change replacing the `decals` list with a `BAKED` entry (through the dev file
  server's commit, with its confirm dialog and backup). `yarn assets` encodes the PNGs like any
  texture. The original decal list is kept in the material JSON as `decalsSource` so a later edit
  can rebake.
- **Production:** no saving (the dev file server is the debug env's; a backend is needed). The
  API stays usable at runtime for a game that bakes decals itself (a bake at load, not saved).
- **Placed decals** can't bake (they're per entity on any surface); a later option could bake a
  target's placed decals into its own material variant. Recorded as a follow-up.

## Phases

### Phase 1: The Decals tab, atlas decals

D1's list, atlas source, placement fields and picking, overrides, undo and save; the preview
shapes; tests on the override merge and the gather's `decals` merge.

### Phase 2: Text decals in the tab

D1's text source and look, the font picker; the editor's preparer loads a font the material names
(`registerMaterialEditorPreparer` from the text feature's debug module, the editor importing no
feature code).

### Phase 3: Placed decals' edit window and the Decals tab

D2; the window's undo and save; the showcase's placed decals edited and saved in a test run.

### Phase 4: The bake

D3's bake, the `BAKED` source, the overlap check, live comparison, export and the material JSON
rewrite in dev; tests on the overlap check and the JSON rewrite; a baked crate material in the
showcase next to its live twin (GPU ms of each with 8 decals).

### Phase 5: The Hub and the docs

`debug/editors/CLAUDE.md` (the Decals tab), `features/decals/CLAUDE.md` (the window, the bake),
the Debug suite and Decals pages; `docs/techniques/decals.md`'s editing and baking sections.

### Phase 6: Versions and done

On the `p396-decals` branch's bump; this plan's end is the `p396-decals` PR into `main` (the
epic's Branches and PRs). `CHANGELOG.md`; mark the plan done.

## Verification

`yarn test`; the test bridge driving the tab (add a text decal, pick on the ball, bake, compare);
`yarn verify:devFiles` still passing; the export's PNG round-tripping through `yarn assets` and
drawing the same as the live layer (a scene runner comparison within tolerance).

## Non-goals

- In-scene placement with move / rotate gizmos and decal painting with the mouse on scene meshes:
  wait for the "Start editor view" plan (p090, its selection and transform tools). The edit
  window's fields and "Snap to target" cover placement until then.
- Production saving (a backend), baking placed decals, texture painting.
