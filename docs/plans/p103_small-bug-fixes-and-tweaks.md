Status: draft | not-implemented
Category: Bug fix, Refactoring
Related: p104_plan-references-out-of-jsdoc.md (the JSDoc item of the same list, split out: about 840 blocks), p105_themed-scrollbars.md (the scrollbar item of the same list, split out: tokens, a kit-wide rule, the Hub and the design doc)

# Small Bug Fixes and Tweaks — Plan

Eleven small bugs and tweaks, collected from using the app, the debugger and the Hub. Two of them
are large enough for their own plans (p104, p105), one is already gone (the ECS stress test keys),
and one is probably fixed already (the Rapier warning). The rest are small, local fixes, grouped into
phases by subsystem so each phase is a reviewable commit.

## The list, and where each item stands

| #   | Item                                                                                       | State                                         | Where      |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------- |
| 1   | Rapier's "using deprecated parameters for the initialization function" warning             | Probably fixed by Rapier 0.21.0: check, close | Phase 1    |
| 2   | three's "PCFSoftShadowMap has been removed" warning                                        | Cause found                                   | Phase 1    |
| 3   | A spatial domain's wireframe draws `Draw` with 0 vertices after a scene change             | Cause found                                   | Phase 1    |
| 4   | The debug camera records drags while the master loop is off, then jumps                    | Cause found                                   | Phase 1    |
| 5   | The top-down and gym scenes' player keys are listed under "All scenes"                     | Cause found (engine)                          | Phase 3    |
| 5b  | The gym's physics stress test key and the ECS test scene's ECS stress test keys            | Already scoped / gone (see 5)                 | —          |
| 6   | The on-screen tools' top-left buttons are two boxes with unequal spacing                   | Cause found                                   | Phase 3    |
| 7   | No plan references in JSDoc (they render on the Hub)                                       | Split out                                     | p104       |
| 8   | Hub: the A-Z index as its own page, "Versions & Issues", the changelog as its own page     | Designed                                      | Phase 4    |
| 9   | The app's favicon is invisible on a dark browser tab                                       | Cause found                                   | Phase 4    |
| 10  | Themed scrollbars for the UI kit and the Hub, in the design document                       | Split out                                     | p105       |
| 11  | skyShowcase: after light helpers off → on, the shadow camera helper is stuck, the line shakes | Causes found, one runtime check left        | Phase 2    |

## Fixes

### 1. Rapier's deprecated init parameters warning

The warning comes from wasm-bindgen's init: it warns when called with anything but a plain object.
Rapier fixed its own call (dimforge/rapier#811), and `@dimforge/rapier3d-compat` 0.21.0 (since p250
Phase 0) calls it as `EI({ module_or_path: <bytes> })` in `node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs`,
a plain object, so the warning's branch is never reached. The engine's only init call is
`RAPIER.init()` without arguments (`src/_engine/features/physics/backends/Engines.ts`, `RAPIER.init`).

- Load the app (dev server, both worker targets: `AppConfig.physics.workerTarget`) and check the
  console. Gone: record it under the phase as built, nothing else to do.
- Still there: it comes from another copy of Rapier. `@types/three` carries its own
  `@dimforge/rapier3d-compat` 0.12.0 (`node_modules/@types/three/node_modules/`): make sure no
  runtime import resolves to it (it's types only, so it shouldn't), then search the built chunks for
  the warning's text.

### 2. PCFSoftShadowMap

three r187 still exports `PCFSoftShadowMap` (deprecated since r186), but WebGPU's shadow node has no
filter for it (`nodes/lighting/ShadowNode.js`: `null /* PCFSoftShadowMap, removed */`), and the
renderer warns on every render while it's set, then uses `PCFShadowMap`. WebGPU supports
`BasicShadowMap`, `PCFShadowMap` and `VSMShadowMap`.

The engine never defaults to it (the kernel's default is `PCFShadowMap` in
`src/_engine/kernel/render/Renderer.ts`, the app passes `VSMShadowMap` in `src/index.ts`). It gets
there through the debugger: the Renderer tab offers "PCF soft shadow map" (`RENDERER_SHADOW_OPTIONS`
in `src/_engine/kernel/render/debug/_dbg__Renderer.ts`) and saves the choice (`AEK_debugRenderer`),
which `setRendererOptions` merges over the app's options on the next load, so a value picked once
stays.

- Remove the option from `RENDERER_SHADOW_OPTIONS`.
- In `createRenderer`, map `PCFSoftShadowMap` to `PCFShadowMap` before applying it, and write it back
  into the options, so a saved value from before and the tab's list agree (the list would show a blank
  value for 2).
- The comment at `src/index.ts` listing three's shadow types: `PCFShadowMap` (its default) and
  `BasicShadowMap`.
- `RendererOptions.shadowMapType`'s JSDoc: one sentence that `PCFSoftShadowMap` is mapped to
  `PCFShadowMap` (three removed it for WebGPU).

### 3. The spatial domain wireframe draws nothing, with a warning

`refillOverlay` in `src/_engine/features/spatial/debug/_dbg__SpatialGridOverlays.ts` keeps the
overlay's line visible when its domain is gone (the `!grid` branch empties it) or has no occupied
cells yet (`count` 0), which is what a scene change leaves. The THIN line backend sets
`setDrawRange(0, 0)` (`features/lines/LineBackendThin.ts`), and three r187 only skips a draw with a
negative count (`renderers/common/RenderObject.js`), so WebGPU gets a `Draw` with 0 vertices.

Every other debug overlay hides an empty line at its call site (`_dbg__LodOverlay.ts`,
`_dbg__MergingOverlay.ts`, `_dbg__WorldBoundsDraw.ts`, `_dbg__StreamingOverlay.ts`,
`_dbg__CharacterGizmos.ts`). Do the same:

- The `!grid` branch: `line.setVisible(false)` after emptying it.
- After `endWrite`: `line.setVisible(count > 0)`.

`setOverlayEnabled` keeps setting the toggle's visibility, and a disabled overlay isn't refilled, so
the toggle still wins. Not done here: making `LineObject` hide every empty THIN line itself (it would
change what `object3D.visible` means to callers); a note in `src/_engine/features/lines/CLAUDE.md`
that the caller hides an empty line is enough.

### 4. The debug camera moves while the master loop is off

OrbitControls moves the camera in its own pointer handlers, outside the frame. `controls.enabled` is
refreshed only by `debugCameraSystem` (`src/_engine/kernel/camera/debug/_dbg__DebugCamera.ts`, MAIN),
and with the master loop off no frame runs (`runFrameWork` in `kernel/loop/MainLoop.ts` stops
requesting them), so drags keep moving the camera unseen and the next frame shows the sum. The editor
views' cameras have the same gap (`src/_engine/debug/editors/_dbg__ViewCamera.ts`,
`syncControlsEnabled` reads only `isEntered && !isControlsSuspended`).

There's no change event for the master loop: `toggleMainPlay` (`MainLoop.ts`) is called by the
on-screen tools, the debug keys, physics single-stepping, the device calibration, `Mount.ts` and the
test bridge, and the Loop controls tab (`kernel/loop/debug/_dbg__MainLoop.ts`) writes
`loopState.masterPlay` itself.

- `MainLoop.ts`: `onMasterPlayChange(listener)` (`@internal`, returns the remover), notified by
  `toggleMainPlay` when the value changes. The Loop controls tab's `onChange` calls `toggleMainPlay`
  instead of writing the state (it also requests the frame).
- `_dbg__DebugCamera.ts`: an `isMasterLoopOn` flag next to `isSceneInputEnabled`, seeded from
  `getReadOnlyLoopState().masterPlay` and set by the listener, which applies it to the controls at
  once (like `setSceneDebugCameraInputEnabled`). Disabling the controls also ends a drag in progress.
- `_dbg__ViewCamera.ts`: the same flag in `syncControlsEnabled`, through the same listener (or
  forwarded by `Views.ts` if that's the simpler seam: decide when reading it).
- The listener registry lives in `MainLoop.ts`; the loop never imports the camera modules.

Orbiting is then also blocked during physics single-stepping and the device calibration, which pause
the master loop too. That's consistent (nothing renders the move), and it's recorded in the camera's
section of `src/_engine/debug/CLAUDE.md` and `src/_engine/kernel/render/CLAUDE.md` (views).

### 5. Scene-scoped player keys

The App key shortcuts dialog (`getAppSections` in `src/_engine/debug/_dbg__DebugKeyShortcuts.ts`)
lists a binding or an action map with a `sceneId` under "This scene" and one without under "All
scenes". The leaking keys are the player characters': each player brain creates its own action map
in `createPlayerBrain` (`src/_engine/features/character/brains/PlayerBrains.ts`) without a `sceneId`,
and the brain factory receives only its params and the character's id, so a scene can't scope them
today.

- Engine: `sceneId?: string` on `PlayerBrainCommonParams`, passed to `createActionMap`. Plain data,
  like the rest of a brain's params (saves, network messages). JSDoc: the map is active only while
  that scene is current; leave it out for a character that lives across scenes. A test in
  `PlayerBrains.test.ts` (`getActionMap(getPlayerBrainActionMapId(id))?.sceneId`).
- App, one `sceneId` in each player's `brain.params`:
  - `src/app/scenes/topDownTestScene/topDownTestScene.ts` (the `WORLD_FIXED` player)
  - `src/app/scenes/thirdPersonGymScene/thirdPersonGymScene.ts` (`topDownChar`, `TANK`; `arrowKeysChar`,
    `CAMERA_RELATIVE`)
  - and the same leak elsewhere: `src/app/scenes/terrainShowcase/showcasePlayer.ts`,
    `src/app/examples/character/exampleCharacter.ts`, `src/app/examples/gameHud/exampleGameHud.ts`
- Docs: `src/_engine/features/character/CLAUDE.md` (the player brains), the Hub's character feature
  page and the example's snippet if it shows the params.
- Not a default: `createPlayerBrain` could take the loading scene's id when none is given (as
  `ECSStressTest.ts` does), but a character meant to persist across scenes would then be scoped
  wrongly. Explicit only.

Already fine, no change:

- The gym's physics stress test (J): `_dbg__PhysicsStressTest.ts` passes the gym's scene id to its
  action map.
- The ECS test scene's ECS stress test keys (K, L): nothing registers them any more. Commit `ca93a166`
  removed `initECSStressTest` from the ECS test scene, and the ECS tab's benchmark spawns its batches
  without keys. A build from before that commit showed them. Dropped from this plan.

Check after the change: `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene` (the input
scripts play after the load, when the scene is current, so the hashes shouldn't move).

### 6. One box for the on-screen tools' top-left buttons

`src/_engine/debug/_dbg__OnScreenTools.ts` puts two toolbars into the top-left row: `UNDO` (About,
undo, redo) and `VIEW` (the exclusive view switch, shown only while an editor view is registered;
`Views.ts` calls `updateOnScreenTools('VIEW')`). Each is its own `.onScreenToolGroup` box
(`OnScreenTools.module.scss`), the row's gap is `space-4` and the About button has its own
`space-3` margin, so About → undo and redo → first view button are spaced differently and sit in two
boxes.

- One wrapper box in the top-left row (`getRow` returns it for `UNDO` and `VIEW`), carrying the box
  styles: padding, border, background. The two toolbars inside lose their own box (a modifier class)
  and are spaced so every gap between buttons is the same, with About's separator kept or made one
  even gap (decide on screen).
- Keep two toolbars: merging them into one `createButtonGroup` with exclusive mode would set
  `aria-pressed` on About, undo and redo (`src/_engine/ui/components/ButtonGroup.ts`), and two tab
  stops (actions, then the view switch) is right for a radio-like group.
- Traps: the wrapper doesn't get the global `onScreenToolGroup` class (the disabled rule's opacity
  would compound on the nested groups); add its class to the row's `pointer-events: none` list only.
  It gets no `role="toolbar"`: `_dbg__OnScreenTools.test.ts` expects three rows and the toolbars
  labelled `Debugger`, `Play`, `Scene and camera`.
- With no editor view registered the wrapper holds `UNDO` alone and looks as today.
- Docs: the on-screen tools item in `src/_engine/debug/CLAUDE.md`, the views' line in
  `src/_engine/kernel/render/CLAUDE.md`, the file's header comment.

No `verify:ui` or `verify:scenes` baseline covers the top-left row; check it with a screenshot in
both themes and with an editor view open (the material editor) and without.

### 8. Hub navigation

Today (`devTools/hub/shell.ts` builds the top nav from the homepage's children by `aek:order` and
`aek:icon`): Examples, Features, Documentation, Issues (`bug`), Version (`tag`). The A-Z index is the
last section of the Documentation landing page (`renderAzIndex` / `renderLanding` in
`devTools/hub/api/render.ts`), and `CHANGELOG.md` is rendered on the Version page
(`devTools/hub/generated/version.ts`, its `generated-changelog` slot, `hubSearchSkip`), whose latest
entry is the homepage's "What's new".

**(a) The A-Z index as its own page.** A generated page `documentation/a-z/` in the API section (next
to the entry pages `render.ts` makes), its slot calling `renderAzIndex` with its own memo key;
`renderLanding` stops calling it and links to it instead. Its `order` goes after the reference pages
and before Architecture (60): pick it by looking at the menu. Nothing links to `#a-z-index` today.

**(b) "Versions & Issues", one menu item.** The Issue pages keep their URLs, `issues/<name>/`, as
`docs/plans/CLAUDE.md` promises (every `hub:issues/…` link and bookmark keeps working):

- `hub/pages/version/index.html`: title and `aek:menu` "Versions & Issues", the Versions icon (`tag`),
  updated `aek:tags` and `aek:description`. Its body: the versions table, then `::: cards` for Issues
  and Changelog. Cards list only in-nav children (`devTools/hub/cards.ts`), so the Issues card is
  written by hand or the cards directive gets an option for it: whichever is smaller.
- `hub/pages/issues/index.html` gets a new meta, `aek:navParent="version/"`, read in
  `devTools/hub/pages.ts`. A page with it isn't in the top nav (`shell.ts` `renderNav`), and its nav
  parent's item is the active one on it and its children; the breadcrumbs (`getPageTrail`) and the
  search's section label (`getPageSection`, `devTools/hub/searchResults.ts`) follow the nav parent, so
  an issue reads "Versions & Issues › Issues › …". The meta is documented in `hub/CLAUDE.md` and
  `devTools/hub/CLAUDE.md`.
- The homepage's Issues quick link stays (`devTools/hub/generated/home.ts`); the hero's buttons
  (`hub/pages/index.html`) become one "Versions & Issues" button or keep Issues: decide on the page.
- The nav loses an item: re-measure the header's breakpoints (`hub/_assets/scss/_header.scss`;
  `hub/CLAUDE.md` asks for it on any header change).
- Tests: `shell.test.ts`, `search.test.ts`, `searchResults.test.ts` and `devPages.test.ts` build fake
  pages with `isInMenu`; add the nav-parent cases (not in the nav, the parent active, the trail, the
  search label).

**(c) The changelog as its own page.** A generated page `version/changelog/` in the version section
(`version.ts`), taking the changelog slot from the Version page and keeping `hubSearchSkip`. The
homepage's "What's new" links point at it (`home.ts`; the entry anchors are slug-based, so they still
resolve). The section's docs in `devTools/hub/CLAUDE.md` and `hub/CLAUDE.md`.

`yarn hub:build` fails on a dead `hub:` link, so a missed link shows there.

### 9. The app's favicon on a dark tab

`src/public/favicon.svg` is black, white under `prefers-color-scheme: dark`. That media query follows
the OS (or Chrome's own appearance setting), not Chrome's theme colour, so a dark Chrome theme on a
light OS gets a black glyph on a dark tab.

- One fill for both, no media query: `#7d899b`, a mid slate (the light theme's
  `--aek-border-control` in `src/_engine/ui/styles/tokens.css`), not the accent (the Hub's favicon
  keeps its accent colours). About 3.6:1 against a white tab and 3.3:1 against Chrome's dark tab
  (`#35363a`). Check it on both tab colours at 16 px; nudge lighter or darker if one side is weak.
- Keep the SVG a single `<path>` with the same `d`: `devTools/toolkit/buildAekashaSymbol.ts` reads
  this file for the 3D symbol's glyph (fill colour and `<style>` are ignored there; another shape
  would be extruded).
- `src/public/favicon.ico` and `src/public/apple-touch-icon.png` in the same colour, made from the
  SVG with `sharp` (a dev dependency): the PNG directly, the ICO as a PNG-in-ICO (a 22-byte header
  around 32 px and 16 px PNGs). A one-off script in the scratchpad is enough; commit only the outputs.
  The apple-touch icon keeps whatever background it has now (iOS draws no transparency).

### 11. Light helpers in skyShowcase

The toggle (on-screen tool → `toggleAllLightHelpers` → `_toggleAllLightHelpers` in
`src/_engine/kernel/light/debug/_dbg__LightDebugState.ts`) only flips the helpers' `visible`; each
light's helpers are made once (`_dbg__LightHelpers.ts`: a `DirectionalLightHelper` and a
`CameraHelper` on `light.shadow.camera`), and `lightHelperSyncSystem` (LATE_MAIN) updates a visible
one with `helper.update()` only. The sky's sun (`src/_engine/features/skybox/SkyLights.ts`) moves its
light and target every frame while the day-night cycle runs (snapped to shadow texels along axes that
turn with the sun), resizes the shadow camera in `applyDiscLight` after the helpers exist, and sets
`shadow.autoUpdate = fade > 0`.

Defects in the helper code:

- **The CameraHelper is never updated per frame.** It draws with `matrix = camera.matrixWorld`, and
  three refreshes the shadow camera's `matrixWorld` only while it renders that shadow
  (`LightShadow.updateMatrices` from `ShadowNode`). When it doesn't (the sun's fade at 0 turns
  `autoUpdate` off, or three skips the shadow that frame), the box stays where it was.
- **Its frustum is the one at creation.** Only the light edit window and undo call
  `camHelper.update()`, so the sky's 60 m shadow box shows as three's default.
- **The sync runs after the render.** `DirectionalLightHelper` takes the light's live `matrixWorld`
  but computes its plane and target line in `update()`, so the line is drawn for the previous frame's
  target at the current light position: with the target snapping by a texel along turning axes, the
  line's far end jumps every frame (the shaking).

Why the first "on" works and off → on doesn't isn't proven yet. The likeliest cause is the first point:
the box follows only while the shadow keeps re-rendering. The other is a stale reference: the sky
re-creates the sun when its `castShadow` changes, and `refreshLightShadowsAsync` clones a light when
a light edit window changes the shadow map size. First step of the phase: in the running scene, after
an off → on, compare `camHelper.camera === light.shadow.camera` and the helper's light with the
entity's `OBJECT3D` (the test bridge or a console breakpoint in the sync system).

Fix, in `_dbg__LightHelpers.ts`:

- Run the sync in MAIN, before the render, with an order after `object3DSyncSystem` (MAIN still runs
  while the app loop is paused).
- For each visible helper: the light's and its target's `updateMatrixWorld`, then for a shadow-casting
  light with a `CameraHelper`, `light.shadow.updateMatrices(light)` and `camHelper.update()` only when
  the shadow camera's projection changed (keep its last `projectionMatrix.elements` in the helper
  component and compare: no per-frame allocation or buffer rewrite; the light helpers already
  allocate 9 kB/s, `p990_follow-ups-from-done-plans.md`'s "The 3D debug symbols and the light helpers
  allocate every frame", so don't add to it), then `helper.update()`.
- When the helper's camera or light isn't the entity's any more, re-create the helpers (the
  `attachMissingLightHelpers` path, after disposing the old ones).
- Lights moved later in the frame by the toolkit's `SunShadowFit` (APP_RENDER_SYNC at
  `APP_RENDER_SYNC_ORDER.SHADOW_FIT`, -0.75, in `src/_engine/kernel/loop/SystemStages.ts`; orders run
  high to low): a second pass of the same update in APP_RENDER_SYNC at an order below it, only for
  visible helpers, as a new named order in `APP_RENDER_SYNC_ORDER` (`DEBUG_HELPERS`).
- `shadow.updateMatrices` writes the shadow camera's pose; three recomputes the same pose before each
  shadow render, so it's harmless.

## Phases

Each phase is one commit; run `yarn test` and `yarn lint` after each.

### Phase 1: Runtime warnings and the paused debug camera (items 1-4)

1. Check the Rapier warning (item 1) and record the result.
2. PCFSoftShadowMap (item 2).
3. The spatial overlay's empty line (item 3).
4. `onMasterPlayChange`, the debug camera and the view cameras (item 4); a unit test for the listener
   (toggled on, off, and no notification without a change).
5. Check in the browser: the console free of the three warnings (a spatial custom domain's wireframe
   on, then a scene change; "PCF soft" picked in an older build's saved state, via localStorage), and a
   drag with the master loop off doesn't move the camera, from the on-screen tools and from the Loop
   controls tab.

### Phase 2: Light helpers (item 11)

1. The runtime check (which of the two causes) and its result under the phase.
2. The helper sync as above.
3. Check in skyShowcase with the cycle running: on, off → on, several times; the box follows the sun
   and keeps the sky's size; the line doesn't shake; a scene with `SunShadowFit` (search the app's
   scenes) shows its box on the fitted light.
4. `yarn verify:scenes --only skyShowcase` (helpers are off in the runner, so no change expected).

### Phase 3: Scene-scoped player keys and the on-screen tools box (items 5, 6)

1. `sceneId` on the player brains, its test and docs; the app scenes' `sceneId`s.
2. Check the App key shortcuts dialog in the top-down scene and the gym: the player keys under "This
   scene", and they don't fire after switching to another scene.
3. The top-left wrapper box; screenshots in both themes, with and without an editor view.
4. `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene`.

### Phase 4: The favicon and the Hub navigation (items 8, 9)

1. The favicon's SVG, ICO and PNG; check both tab colours; `npx tsx devTools/toolkit/buildAekashaSymbol.ts`
   still builds the same GLB (compare it with the committed one; it shouldn't change, since only the
   fill did).
2. The A-Z page; the changelog page; "Versions & Issues" with `aek:navParent`, its tests.
3. `yarn hub:build` and `yarn hub:preview`: the menu, an issue page's active item, breadcrumbs and
   search label, the homepage's links, the header's breakpoints.

### Phase 5: Docs, versions and the changelog

1. The nested `CLAUDE.md` files each phase named, and `readme.md` if a listed item changed (none
   expected).
2. Versions (`package.json`): engine minor (`sceneId` on the player brains' params, a new option);
   app patch (the scenes' `sceneId`s, the favicon); toolkit unchanged. A `CHANGELOG.md` entry with
   Engine, App and Project (the Hub's navigation) sections.
3. `yarn checkVersions --against main`, `yarn verify:baselines`, then mark the plan done.

## Non-goals

- The JSDoc plan references (p104) and the themed scrollbars (p105).
- Re-adding the ECS stress test keys to the ECS test scene.
- Hiding every empty THIN line in `LineObject` itself.
- Orbiting the debug camera while paused (it would need `renderFrameWhileMasterPaused` on every
  control change; ask if wanted).

## Risks

- Item 11's off → on cause is unproven until the runtime check; the fix covers both candidates, but
  if it's a third (a helper registered twice), the phase grows by the re-creation path.
- Blocking the controls while paused also blocks them during single-stepping physics, which someone
  debugging a step may notice.
- `aek:navParent` touches the Hub's nav, breadcrumbs and search together: one of the three missed
  shows the wrong section, which the tests in Phase 4 cover.

## Verification

- `yarn test`, `yarn lint`, `tsc` (the Stop hook), `yarn verify:baselines`.
- `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene,skyShowcase`.
- `yarn hub:build`, `yarn hub:preview`.
- The browser checks of each phase above.
