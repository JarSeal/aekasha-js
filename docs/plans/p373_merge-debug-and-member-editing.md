Status: in progress | Phase 1 implemented
Category: Merging, Debug, Editor
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 1.3)
Related: \_DONE_p083_editor-creator-view.md (the editor epic; future select/transform tools build on D4), p150_current-entity-data-source-info-on-edit-windows.md (source info on edit windows), \_DONE_p345_gpu-memory-and-draw-call-debugger.md (draw counts), `src/_engine/debug/CLAUDE.md` (the debugger on the UI kit: drawer tabs, panes as property grids, lists, edit windows with `createDebugWindowGrid`, undo / redo) and `src/_engine/ui/CLAUDE.md` (the kit's draggable windows: kinds, registration, LS, scene loads)

# Merge Debugging & Member Editing

Makes merging visible and editable in debug mode:

- a **"Merging" drawer tab** listing groups and their members, with what each group saves;
- **group and member windows**, with links between them;
- an **overlay** showing which meshes a group is made of, and an A/B toggle that draws a group
  unmerged;
- an **edit-session API**: a member is detached from its group while it's being moved, then merged
  back. The member window's transform fields use it now; the select/transform tools (not planned
  yet) will use it later.

---

## 1. Grounding

The debugger is built on the UI kit (`src/_engine/debug/CLAUDE.md`): a drawer tab's content is
CMPs and declarative panes (a property grid of the kit's fields), lists are the kit's list, edit
windows are the kit's draggable windows with a property grid. Checked 2026-11-04:

- **No Meshes tab or mesh edit window exists** (`DEFAULT_DEBUG_DRAWER_TAB_ORDER`,
  `kernel/config/Config.ts`). The pattern for a feature's entity list with edit windows is the LOD
  tab: `lod()`'s install registers it with `if (IS_DEBUG_ENV) ctx.onDebug(registerLodDebugGUI)`,
  which loads `features/lod/debug/_dbg__LOD.ts` (`createDebuggerTab`, its rows a
  `debuggerListCMP`); its entity window (`_dbg__LodEntityWindow.ts`) registers its kind with
  `registerDraggableWindowKind` at the module's load (`ui/overlays/windows/DraggableWindow.ts`),
  opens with `toggleDraggableWindow` and `getKindWindowId`, and is an `EntityWindowOpener` for the
  profiler (`registerEntityWindowOpener`). The Lights tab (`kernel/light/debug/_dbg__LightGUI.ts`,
  `_dbg__LightEditWindow.ts`) is the kernel's.
- **Drawer tabs**: `createDebuggerTab({ id, title, icon, content, refreshIntervalMs, onOpen, ... })`
  (`debug/DebuggerGUI.ts`, on `aekasha/debug`); `content` returns sections, `{ pane: true,
  content: [...] }` a property grid (bindings, folders, buttons, `custom`); `updateDebuggerTab` is
  a no-op unless the tab is visible. A `debuggerListCMP` row click is `onActivate`, its toggles
  the row's actions. An icon names a registered icon (`ui/core/icons/`).
- **Edit windows**: `createDebugWindowGrid` (`debug/_dbg__DebugWindowGrid.ts`): its own
  scheduler, `getEntityInfoItems` (the entity's ids, type, name), `getReasonedButtonItem` (a
  disabled button with its reason), `getInfoRowItem`, `getNoteItem`. A field's `onChange` gets
  `last: true` at a gesture's end with `prev` the value before it, where the light window saves
  and records undo.
- **Managed entities**: `_registerManagerDebugInfo(manager, { label, icon, tabId })` and
  `_getEntityManagerInfo` (`debug/_dbg__ManagedEntities.ts`). A managed entity's window is
  read-only with a link to its manager's tab (the sky box's lights do this).
- **Debug helpers** added to the root scene are marked with `markDebugHelper(obj)`
  (`debug/Profiler.ts`, on `aekasha/debug`), so the profiler census counts them in their own row.
- **Undo** (`debug/UndoRedo.ts`, `registerUndoRedoActionHandler`; the engine's debug modules
  import `debug/_dbg__UndoRedo.ts`): per-scene buckets; actions registered by type with do/undo
  handlers; `recordOrCoalesceUndoRedoAction` merges a field's ticks within 800 ms.
- **Lines** (`features/lines/`, `features/lines/CLAUDE.md`): the line system the LOD overlay
  (`features/lod/debug/_dbg__LodOverlay.ts`) also uses; without `lines()` a debug tool that draws
  lines is off with one log line (`isLinesInstalledFor`).
- **Checks**: the scene runner's `debugger` configuration (`devTools/verify/CLAUDE.md`) shoots
  every tab and window of the scenes with a `debugger` entry and runs axe on them.
- p372 gives `MERGE_GROUP`, `MERGE_MEMBER`, `TAG_MERGED`, `updateMergeMember` and the part table;
  group entities are `MANAGED_BY` `MERGE`.

## 2. Design

### D1 — "Merging" drawer tab (`features/merging/debug/_dbg__Merging.ts`)

Registered by `merging()`'s install with `if (IS_DEBUG_ENV) ctx.onDebug(registerMergingDebugGUI)`,
which loads the `_dbg__` module through the debug loader (`loadDebugModuleAsync`), as `lod()`
does; a new `mergingControls` id in `DEFAULT_DEBUG_DRAWER_TAB_ORDER` and a built-in icon. A
production build carries none of it (`yarn verify:baselines`' debug code check).

- **Summary pane** (a property grid of monitors): groups, members, merged vertices, draws now vs.
  draws if unmerged (members + groups, main pass; × shadow casters for the shadow passes), wasted
  vertices, rebuilds and in-place updates last second, build time.
- **Group list** (`debuggerListCMP`): one row per group (id, `AUTO` cell, material, members,
  vertices); row actions for "highlight" (D3) and "show unmerged" (D3); activating a row opens the
  group window.
- **Refusals:** a folder (closed by default) listing the entities that asked for `merge` and were
  refused (p372 §5), with the reason.
- `refreshIntervalMs: 500` while visible.

### D2 — Windows

Two window kinds (`registerDraggableWindowKind` at the `_dbg__` module's load), opened with
`toggleDraggableWindow` and `getKindWindowId(kind, entityId)`, each a `createDebugWindowGrid`:

- **Group window** (`mergeGroup`): settings, stats, member list (a kit list; columns would need a treegrid, which the kit's table doesn't have
  (p805 D1); activating a row
  opens the member window), buttons: rebuild, compact, dissolve (undoable: re-creates the group
  with the same members).
- **Member window** (`mergeMember`): `getEntityInfoItems`, geometry and material ids, its part
  range, "Merged into <group>" (a link to the group window), transform fields (the kit's vector
  and rotation fields, D4), "remove from group" (undoable; a reasoned button while an edit session
  is open).
- `_registerManagerDebugInfo('MERGE', { label: 'Merge group', icon, tabId })`, so anything that
  shows a managed entity links to the group window, and a `registerEntityWindowOpener` for both
  kinds, so the profiler's Objects tab opens them.
- A future Meshes tab (not planned) opens the member window for merged meshes.

### D3 — Overlay and A/B

- **Highlight:** member bounding boxes drawn with the line system in one colour per group (a
  stable hash of the group id), only for groups in view; marked with `markDebugHelper`; off with
  one log line without `lines()`. "Highlight all" in the summary pane.
- **Show unmerged** per group: hides the group mesh and shows its members' own meshes (removes
  `TAG_MERGED` visibility without leaving the group), for an A/B of image and draw count. Runtime
  only, cleared on scene exit.
- **Colour by member** (open question): a debug-only vertex colour attribute on the group mesh.

### D4 — Edit sessions and picking

```ts
beginMergeMemberEdit(entityId: number, world?): void;
endMergeMemberEdit(entityId: number, world?): void; // in-place rewrite via updateMergeMember
cancelMergeMemberEdit(entityId: number, world?): void; // restores the transform at begin
getMergeMemberAtFace(groupEntityId: number, faceIndex: number, world?): number | undefined;
```

- **Begin** collapses the member's range in the group (like a disable) and shows its own mesh, so
  moving it costs nothing per frame in the group. **End** writes the new transform into its range
  once. A physics member's body is moved with the same transform (`world.setTransform`), since a
  static body doesn't follow its mesh.
- **Picking:** a binary search over the group's part table by `faceIndex × 3` (index start). The
  future select tool raycasts as usual and resolves a group hit to the member.
- **Undo:** one `merge.memberTransform` action per session (transform before and after); undo
  and redo go through `updateMergeMember`.
- **First user:** the member window's position / rotation / scale fields (D2) open a session on
  the first change and end it at the gesture's end (the field's `onChange` with `last: true`,
  where the light window records its undo), or when the window closes.
- **Persistence:** none here. Writing an edited transform back to the scene JSON is the editor
  epic's save plan (p083 "Future plans").

## 3. Phases

### Phase 1 — Tab and windows (D1, D2) — done

**Exit:** largeWorld's groups are listed with correct counts; group and member windows open from
rows and link to each other; the profiler's Objects tab links a group entity to its window; the
scene runner's `debugger` configuration shoots the tab and both windows on largeWorld (a
`debugger` entry in `scenes.config.ts`), axe clean, in both debugger themes.

Decided when it started (2026-11-11):

- **Branch:** p372 merged into `main` on its own (PR #82, engine 6.5.0), so p373 is on
  `p373_merge-debug-and-member-editing` from that merge, with its own bump and changelog entry
  (Phase 4: engine 6.5.0 → 6.6.0); p370 §14's row is corrected in Phase 4.
- **The figures the merging code doesn't keep** (builds and in-place updates counted, the last
  build's time, the refusals) are recorded by it behind `if (IS_DEBUG_ENV)`, as LOD's frame stats
  (`LodSystem.ts`): a production build folds them away, so `merging`'s first-download size stays.
  The refusals are kept per world (the entity, the group asked for, the reason), the newest 200;
  the tab lists those still alive and not in a group.
- **Rebuild and compact are one button:** every build merges the live members only, so a rebuild
  compacts (`wasted` back to 0). The group window has "Rebuild"; its wasted row says so.
- **Draws are per pass, without culling:** "draws now" is the built groups, "unmerged" the built
  members not disabled; the shadow pass's the same for the shadow casters (a light's passes,
  cascades and cube faces, aren't counted: per shadow pass).
- **Phase 1's member window shows the transform read-only** (live monitors); Phase 3's edit
  sessions make the fields editable.
- `_registerManagerDebugInfo('MERGE', …)` names the tab (`ManagerDebugInfo` has no window opener);
  the profiler opens the windows through `registerEntityWindowOpener` (the group's at the default
  priority, the member's at -1, after physics' and the character's, as LOD's).

Sections:

1. The tab: the debug counters and refusals in the merging code, `registerMergeDebug` loading
   `debug/_dbg__Merging.ts` too, `mergingControls` in `DEFAULT_DEBUG_DRAWER_TAB_ORDER`, a built-in
   `merge` icon; the summary pane, the group list and the refusals folder; unit tests.
2. The windows: group (`mergeGroup`) and member (`mergeMember`) kinds, their links, rebuild and
   dissolve / remove with undo, the manager info and the entity window openers; unit tests.
3. The checks: largeWorld's `debugger` entry in `scenes.config.ts` (the tab, both windows), the
   scene runner in both debugger themes, the profiler's Objects link, `yarn sbp` and
   `yarn verify:baselines` (no debug code in a build, `merging` unchanged).

As built, section 1 (2026-11-11):

- The merging code's debug figures (`MergeState.ts`: `getMergeDebugStats(world)` →
  `{ builds, inPlaceUpdates, lastBuild, refusals }`, `noteMergeRefusal`, `noteMergeBuild`,
  `noteMergeInPlaceUpdate`, `MAX_MERGE_REFUSALS` 200), each call behind `if (IS_DEBUG_ENV)`:
  `buildGroup` times a build from its start to applied (`performance.now()`, as LOD's frame
  stats; a worker build's time includes the wait), the four in-place writes count
  (`rewriteMember`, `dropMember`, `collapseDisabledMember`, `restoreEnabledMember`), and the
  refusals are `addToMergeGroup`'s, `AUTO`'s and an invalid `merge` (`queueMerge`'s warning, the
  reason "invalid merge …"). A later refusal of the same entity replaces its record.
- `registerMergeDebug` loads `debug/_dbg__MergeGroups.ts` (the moved-member check) and
  `debug/_dbg__Merging.ts` (the tab) together. `mergingControls` is last in
  `DEFAULT_DEBUG_DRAWER_TAB_ORDER`, after `streamingControls`.
- The `merge` icon (`svg/merge-group.svg`, drawn in the line form: two boxes bracketed into one):
  `mergeIcon` in `BuiltInIcons.ts` and `merge` in `SvgIcon.ts`, not on the `aekasha/ui` entry
  (as `streamingIcon`: the debugger reaches it by name through `registerBuiltInIcons`).
- The tab (`debug/_dbg__Merging.ts`, default world, nothing persisted, `refreshIntervalMs` 500,
  `keepOnSceneChange`: everything is read through getters, the rate restarts on a scene change):
  a summary pane of monitors (groups drawn and pending; members merged, waiting and queued; merged
  and wasted vertices; draws per pass, main and shadow, "N merged · M unmerged", with a note that
  they're before culling; builds and in-place updates in the last second with the totals; the
  last build; the refused count), the group list (`mergeGroups`, the tab's first list: the id as
  the title, `[entityId]`, an `AUTO` badge, the material and the `AUTO` cell, members, vertices
  and "pending"), and a titled pane "Refused entities", closed, holding a static list
  (`mergeRefusals`: newest first, those alive and in no group). The group rows' click is
  section 2's. Its reads are `debug/_dbg__MergingInfo.ts` (`getMergeSummary`,
  `createMergeRateMeter`: the counts since the newest sample at least a second old,
  `getStandingRefusals`, the names), which section 2's windows share.
- An entity's name is its fixed app id, else its debug name, else "Entity N": a mesh made in code
  without an id has its uuid as its mesh id (largeWorld's ruins have debug names only).
- Tests: `debug/_dbg__Merging.test.ts` (the counters through a build, a move, a disable and enable
  and a remove; the three kinds of refusal, newest first, a deleted or joined entity dropped; the
  cap; the summary's counts and texts, waste; the rate meter; the group and refusal rows; the
  tab's refresh). `yarn test`, both `tsc`, lint and the docs ratchet (merging 65 → 72 exports,
  100 %) pass.

As built, section 2 (2026-11-11):

- `debug/_dbg__MergingWindows.ts`: the kinds `mergeGroup` and `mergeMember` (registered at the
  module's load), opened by `toggleMergeGroupWindow(groupEntityId)` /
  `toggleMergeMemberWindow(entityId)` (`removeOnSceneChange`: entity ids don't outlive a scene,
  as the streaming cell window's), each a `createDebugWindowGrid` refreshed every 250 ms (the
  buttons' reasons, the notes) with live monitors.
  - Group: its state (built, pending, building in the worker, not built yet, no members), kind
    (`AUTO` with its cell, or explicit), material, both shadow flags (the mesh's, else the
    setting's, else "its first member's"), persistent, members (merged of all), vertices, wasted
    vertices, builds; Rebuild and Dissolve (reasoned buttons), a note; the members as a kit list
    (`createList`, read every 250 ms, at most 200 rows; a row's suffix is its state unless merged;
    activating a row opens the member's window); the entity's info rows. Dissolve closes the window
    and refreshes the tab.
  - Member: a note when it's deleted or left its group, "Merged into" with a button "Open the
    group's window" (a button, not a link: the grid's buttons are its controls), its state
    (merged, waiting for its group's build, disabled with its range collapsed), geometry, material,
    vertices, its part (`#n: vertices a-b, indices c-d`), its pose read-only (position, rotation in
    degrees, scale; the own mesh's, which `object3DSyncSystem` keeps synced while hidden), "Remove
    from group" (reasoned), the entity's info rows.
- The tab's group rows open the group window, their selection the open group windows (as LOD's).
- Undo (`debug/_dbg__MergingUndo.ts`, handlers registered at the module's load, per scene):
  `merge.dissolve` (undo makes the group again with its id, kind and settings, an `AUTO` one
  through `createGroup` as its bucket made it, and adds back the members still alive; redo
  dissolves) and `merge.removeMember` (undo adds the member back, making its group again when it
  went, as an emptied `AUTO` group does at its next build; redo removes). **Entries carry a scene
  visit token** (new on every page load and scene exit, `registerOnAllSceneExits`): members are
  named by entity id (they rarely have a stable app id), which means another entity after a reload
  or on another visit, so an entry from another visit warns and does nothing. A re-made `AUTO`
  group doesn't touch `MergeAuto.ts`' buckets (their counts are only a cap's).
- `_registerMergingWindowLinks()`, called by the tab's creation (the boot's debug step), not at
  the module's load: `registerEntityWindowOpener` is a no-op until the environment says the
  profiler loads. It registers `_registerManagerDebugInfo('MERGE', { label: 'Merge group', icon:
  'merge', tabId: 'mergingControls' })` and the openers (`mergeGroup` at the default priority,
  `mergeMember` at -1).
- Tests: `debug/_dbg__MergingWindows.test.ts` (the group window's figures, member rows opening
  their windows; dissolve, its window closed, undo and redo, an `AUTO` group made again as one;
  the member window's figures, part and group link; remove, undo and redo; no undo across a scene
  exit; the manager info and both openers). `yarn test` (3051), both `tsc`, lint and the docs
  ratchet pass.

As built, section 3 (2026-11-11):

- largeWorld's `debugger` entry (`scenes.config.ts`): the Merging tab and two windows, the group's
  (the tab's row 0, `auto:1k567so:-1,-1:0`) and the member's (then Enter on the group window's
  first member row: a kit list option is named by its text, `[3812]largeWorldRock1`, so the step
  names the entity id; it holds while the scene creates its entities in one order).
  `devTools/verify/CLAUDE.md` lists it.
- Dark (the runner, the default theme): the tab and both windows axe clean, shot. Light: a harness
  in the session's scratchpad (not committed; `AEK_debugTools`' `appearance.theme: 'light'`, then
  the same steps through the test bridge, axe with `UI_AXE_TAGS`): the tab and both windows axe
  clean, their roots `data-aek-theme="light"`. Read on the unmasked shots: 28 groups (all drawn),
  409 members merged, 12 180 merged vertices, none wasted, draws 28 merged · 409 unmerged in both
  passes, 28 builds, 0 refused (p372 Phase 4's largeWorld). The member window's link brought the
  open group window to the front.
- The profiler's Objects tab: one group mesh among the heaviest rows, its Edit button
  ("Merge group: Mesh": the profiler names a row's button by its object's name) opened its group's
  window (axe clean, light). The rows' second line already shows the entity's debug name.
- Found: an `AUTO` group of one member read "1 members"; the row says "1 member".
- `yarn verify:scenes --config debugger` (9 scenes): every scene's drawer tab order has
  `mergingControls` (the template lists `merging()`, so every scene has the tab), and
  testDebugScene's and the gym's `ALL` shoot it; `stats.panels` was p372 Phase 4's TFPS mask
  flake. Recorded with `--update` (9). Then the full matrix: 137 passed (the known warnings:
  `space`'s worker targets, assetCompare's load order).
- `yarn sbp --profile all`: unchanged against `bundle.json`, `_engine/features/merging` 7.0 kB in
  the first download (the debug figures fold away), every budget kept (its one note, `character`
  well under, isn't this plan's). `yarn verify:baselines`: no debug code in any build; `api.json`
  records `MergeState.ts`' seven debug exports (`@internal`) and `mergeIcon` in `BuiltInIcons.ts`
  (not on an entry); `docs.json` merging 65 → 72, 100 %. `bundle.json` left as it was (the rebuild
  moved gzip sizes by a few bytes only).

### Phase 2 — Overlay and A/B (D3)

**Exit:** highlighting a group outlines its members; "show unmerged" changes the draw count by the
member count and leaves the image unchanged.

Decided when it started (2026-11-11):

- **The overlay** (`debug/_dbg__MergingOverlay.ts`, as LOD's `_dbg__LodOverlay.ts`, default world):
  a palette of 8 colours, one 1px `THIN` line each (`persistent`, `FIXED`, created on the first
  use, `markDebugHelper`); a group's colour is `hashStringFNV1a(group.id)` (`utils/Hash.ts`) modulo
  8, so it's the same on every visit and after a rebuild. A member's box is its geometry's local
  bounding box oriented by the matrix it's drawn with (`_bakedMatrix` once built, its own world
  matrix while it waits), `writeBoxEdges`. Refilled every frame (`APP_RENDER_SYNC`, at
  `LOD_SELECTION`'s order: after the camera's final pose and culling, before the render) while
  something is highlighted, and once at a toggle (a paused app loop doesn't run the system). In
  view is the active camera's frustum (the debug camera's too: it's what the image shows): a
  built group whose world sphere is outside is skipped, then each member box outside.
- **The cap** (§5's risk): 1024 boxes per colour; a box past its colour's cap isn't written but
  counted, and the tab's summary says how many weren't drawn (no line warning).
- **What's highlighted:** "Highlight all groups" (the summary pane's checkbox) or a group by its id
  (the group list's row toggle, the group window's checkbox): by id, so a rebuild or an `AUTO` group
  made again keeps it. A row of a group drawn by "all" shows pressed; turning it off turns "all" off
  and keeps every other group of the world highlighted. The per-group ids are cleared on scene exit
  (a group id can come back on another visit); "all" stays (runtime, nothing persisted). Without
  `lines()`: one log line (`isLinesInstalledFor('merge group overlay')`) and the checkbox reads off
  again.
- **Show unmerged** (section 2): a debug-only set per world in `MergeState.ts` (the shown groups'
  entity ids). On: the group entity gets `TAG_DRAW_HELD` (the kernel's reconcile hides its mesh;
  only when nothing held it already, and only that hold let go), and its built members lose
  `TAG_MERGED` (drawn on their own, their own culling back). `applyBuild` adds `TAG_MERGED` to a
  shown group's members only behind `!(IS_DEBUG_ENV && …)` (folded in a build), and its first-merge
  guard reads the member's `partIndex !== -1` from before the build instead of `TAG_MERGED`, so a
  rebuild during the A/B keeps `_wasSpatialIndexed`. Off: `TAG_MERGED` back on the built members,
  the hold let go. Every view ends at scene exit (a persistent group's too); a dissolve, removal or
  deletion during it needs nothing (`releaseMember`). No undo (a view, not an edit). The tab's draw
  figures follow by themselves (`isGroupDrawn`, `isDrawnOnItsOwn`).
- Open question 1 ("colour by member") isn't built here: the boxes show the members.

Sections:

1. The highlight: `debug/_dbg__MergingOverlay.ts` (the lines, the system, the cap), the summary
   pane's checkbox and cap note, the group rows' toggle, the group window's checkbox, the scene
   exit; unit tests.
2. Show unmerged: `MergeState.ts`' set, `applyBuild`'s two changes, the toggle (row, group window
   with its state text), the scene exit; unit tests.
3. The checks: on largeWorld and testDebugScene in the browser, the highlight shot and show
   unmerged's draw count (the profiler's draws) and image (a diff against merged); `yarn sbp`,
   `yarn verify:baselines`, the scene runner's `debugger` configuration.

As built, section 1 (2026-11-11):

- `debug/_dbg__MergingOverlay.ts` as decided: `MERGE_OVERLAY_COLORS` (red, orange, yellow, green,
  cyan, blue, violet, pink), `MAX_BOXES_PER_COLOR` 1024, the lines `MERGE_DEBUG_OVERLAY_<n>`;
  `writeMergeOverlayBoxes(world, frustum, writers)` (the fill on plain writers, allocation-free,
  what the tests drive), `setMergeHighlightAll`, `setMergeGroupHighlighted(groupId, isOn, world?)`
  (each returning whether it's on now: false without `lines()`), `isMergeHighlightAll`,
  `isMergeGroupHighlighted`, `getMergeOverlayCounts` (the last fill's drawn and skipped boxes),
  `getMergeGroupColorIndex`. The scene exit is registered at the module's load (a `_dbg__`
  module, as `_dbg__MergingUndo.ts`' visit token). A disabled group or member isn't outlined.
- The tab: "Highlight all groups" (a `{ get, set }` checkbox, so a refusal without `lines()` reads
  off at the next refresh) and the cap's note (`getMergeOverlayNote`, empty unless boxes were
  skipped) at the end of the summary pane; the group rows' toggle "Highlight the members"
  (`objectsCubes`; the list refreshes itself after a toggle). The group window: a "Highlight
  members" checkbox after Builds, which refreshes the tab.
- Tests: `debug/_dbg__MergingOverlay.test.ts` (one group's boxes in its colour only, the colour's
  stability; a built member at its baked pose and a waiting one at its own; a rotation and scale;
  the frustum and a disabled member; the cap and the note; "all" and one turned off; the lines
  filled at once, marked, hidden when nothing's highlighted; the scene exit; a group made again
  under its id; off without `lines()`), and the group window's checkbox in
  `_dbg__MergingWindows.test.ts` (which now installs `lines()`). `yarn test` (3063), both `tsc`,
  lint and the docs ratchet pass. Not yet seen in a browser (section 3).

As built, section 2 (2026-11-11):

- `MergeState.ts`: `getMergeUnmergedViews(world)` (group entity → whether the view added its hold)
  and `isMergeGroupShownUnmerged(groupEntityId, world)`, both `@internal`. `applyBuild` reads the
  view once per build (`IS_DEBUG_ENV && …`) and its first-merge guard is `partIndex === -1` from
  before the build (a member already in a group is refused, so that is having `TAG_MERGED` outside
  the view). `MergeGroups.ts` is at 765 lines.
- `debug/_dbg__MergingUnmerged.ts`: `setMergeGroupUnmergedView(groupEntityId, isOn, world?)`
  (returns whether it's shown unmerged now), `isMergeGroupUnmergedView`, `getUnmergedViewRefusal`
  (gone, or not built yet) and `getUnmergedViewCount` (dropping a dissolved group's view); the
  scene exit at the module's load. **Only a built group** (one with a mesh): `OBJECT3D`'s add hook
  doesn't run the visibility reconcile, so a hold made before the first build wouldn't hide the mesh
  it adds. Views are by group entity (an `AUTO` group deleted at an empty build and made again
  starts merged).
- The tab: the group rows' second toggle "Show unmerged (A/B)" (`geometry`; hidden on a group not
  built), which refreshes the tab; the summary's groups line adds ", N shown unmerged". The group
  window: a "Show unmerged" checkbox after the highlight's (disabled while refused), its state "shown
  unmerged: its members are drawn on their own", a member's "merged, drawn on its own (shown
  unmerged)" (also its member list row's suffix).
- Tests: `debug/_dbg__MergingUnmerged.test.ts` (the mesh hidden and the members drawn with their
  parts kept, the summary's draws, the state texts, and back; a join and rebuild during the view
  keeping the members drawn and their `_wasSpatialIndexed`, checked to fail with the old guard; a
  disabled member and a hold made elsewhere; a group not built refused, its row's toggle hidden; a
  dissolve; the scene exit), the window's checkbox in `_dbg__MergingWindows.test.ts`. `yarn test`
  (3070), both `tsc`, lint pass; the docs ratchet: merging 72 → 74 exports, 100 % (`docs.json` to
  record in section 3).

### Phase 3 — Edit sessions, picking, undo (D4)

**Exit:** moving a merged member from its window moves it smoothly, merges it back without a
rebuild (rebuild count unchanged), and undo restores it; `getMergeMemberAtFace` returns the right
member for raycasts on 3 members of one group.

### Phase 4 — Docs and versioning

1. `features/merging/CLAUDE.md` (the tab, windows, edit sessions), the Hub's Mesh merging page (a
   debugging section with a shot of the tab) and the debug suite page's list of drawer tabs;
   `yarn hub:build`.
2. Engine minor; `CHANGELOG.md`.

## 4. Versioning

Engine minor (debug tab, public edit-session API).

## 5. Risks

| Risk                                                                              | Mitigation                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A session left open (window closed mid-drag, scene exit) leaves a member detached | Sessions end on window close and are cancelled on scene exit              |
| Overlay lines for thousands of members cost more than what they show              | Only groups in view, only toggled groups, capped line count with a notice |
| Moving a physics member's mesh without its body                                   | `endMergeMemberEdit` moves both (D4)                                      |

## 6. Open questions

1. "Colour by member" (D3): worth a debug-only attribute, or is the bounding-box overlay enough?
2. Should a member window exist for unmerged meshes too, as the start of a Meshes tab? Out of scope
   here; it would fit p150.
