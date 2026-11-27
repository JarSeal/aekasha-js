Status: implemented (Phases 1-5)
Category: Bug fix, Refactoring
Related: _DONE_p104_plan-references-out-of-jsdoc.md (the JSDoc item of the same list, split out: about 840 blocks), p105_themed-scrollbars.md (the scrollbar item of the same list, split out: tokens, a kit-wide rule, the Hub and the design doc)

# Small Bug Fixes and Tweaks — Plan

Eleven small bugs and tweaks, collected from using the app, the debugger and the Hub. Two of them
are large enough for their own plans (p104, p105), one is already gone (the ECS stress test keys),
and one is probably fixed already (the Rapier warning). The rest are small, local fixes, grouped into
phases by subsystem so each phase is a reviewable commit.

## The list, and where each item stands

| #   | Item                                                                                          | State                                         | Where   |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| 1   | Rapier's "using deprecated parameters for the initialization function" warning                | Probably fixed by Rapier 0.21.0: check, close | Phase 1 |
| 2   | three's "PCFSoftShadowMap has been removed" warning                                           | Cause found                                   | Phase 1 |
| 3   | A spatial domain's wireframe draws `Draw` with 0 vertices after a scene change                | Cause found                                   | Phase 1 |
| 4   | The debug camera records drags while the master loop is off, then jumps                       | Cause found                                   | Phase 1 |
| 5   | The top-down and gym scenes' player keys are listed under "All scenes"                        | Cause found (engine)                          | Phase 3 |
| 5b  | The gym's physics stress test key and the ECS test scene's ECS stress test keys               | Already scoped / gone (see 5)                 | —       |
| 6   | The on-screen tools' top-left buttons are two boxes with unequal spacing                      | Cause found                                   | Phase 3 |
| 7   | No plan references in JSDoc (they render on the Hub)                                          | Split out                                     | p104    |
| 8   | Hub: the A-Z index as its own page, "Versions & Issues", the changelog as its own page        | Designed                                      | Phase 4 |
| 9   | The app's favicon is invisible on a dark browser tab                                          | Cause found                                   | Phase 4 |
| 10  | Themed scrollbars for the UI kit and the Hub, in the design document                          | Split out                                     | p105    |
| 11  | skyShowcase: after light helpers off → on, the shadow camera helper is stuck, the line shakes | Causes found, one runtime check left          | Phase 2 |

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

### Phase 1: Runtime warnings and the paused debug camera (items 1-4) — done

1. Check the Rapier warning (item 1) and record the result.
2. PCFSoftShadowMap (item 2).
3. The spatial overlay's empty line (item 3).
4. `onMasterPlayChange`, the debug camera and the view cameras (item 4); a unit test for the listener
   (toggled on, off, and no notification without a change).
5. Check in the browser: the console free of the three warnings (a spatial custom domain's wireframe
   on, then a scene change; "PCF soft" picked in an older build's saved state, via localStorage), and a
   drag with the master loop off doesn't move the camera, from the on-screen tools and from the Loop
   controls tab.

As built:

- Item 1 (2026-11-25): gone, nothing to change. `@dimforge/rapier3d-compat` 0.21.0's `dist/rapier.mjs`
  calls wasm-bindgen's init as `EI({ module_or_path: … })`. The dev server's start scene, with
  `?isDebug=true` in Chromium (WebGL2 fallback), console of the page and its workers captured: no
  "using deprecated parameters" warning with `workerTarget` `WORKER_THREAD` or `MAIN_THREAD` (set
  through `AEK_debugPhysicsApiBoot`; the physics worker didn't start in the second).
- Item 2: the mapping is in `setRendererOptions` (which `createRenderer` calls), after the saved
  state's merge, so an app's own `PCFSoftShadowMap` is mapped too. The tab's key is `debugRenderer`
  (no `AEK_` prefix), and the tab hydrates its state from it at registration, so writing the options
  alone would put 2 back: a saved 2 is also rewritten as 1 in localStorage. Checked in Chromium (WebGL2
  fallback) with `{ "enableShadows": true, "shadowMapType": 2 }` saved: before, one "PCFSoftShadowMap
  has been removed" warning and the 2 kept; after, no warning and the saved value 1.
- Item 3: the two call-site hides weren't enough. `setOverlayEnabled` showed a line the moment its
  overlay was turned on (the tab's creation applies the saved settings), so a frame drew the new,
  empty line before its first refill: one 0-vertex warning while `largeWorld` loaded with the
  FOLIAGE overlay saved as on, with the two hides in place too. It now shows the line only when it
  holds segments (`enabled && line.segmentCount > 0`), and the refill shows it from then on. Chrome
  reports the warning once per page, so a check after a scene change sees nothing once the load
  warned. Checked on WebGPU (the scene runner's Windows Chrome, `launchVerifyChromiumAsync`):
  `largeWorld` with both FOLIAGE overlays saved as on, then `loadScene({ sceneId: 'scene01' })` in the
  page. Before: the warning during the load (the empty oversized line, FOLIAGE has no oversized
  members). After: none over the whole run; in `largeWorld` the cells line visible with 3420
  segments and the empty oversized line hidden, after the change both hidden and empty. With the
  overlays off there's no warning, before or after.
- Item 4: no `isMasterLoopOn` flag. The Loop tab hydrates `loopState.masterPlay` from its saved
  state without `toggleMainPlay`, so a flag seeded once could miss a page that starts paused.
  `MainLoop.ts` has `isMasterPlayOn()` (`@internal`, a cheap live read) beside
  `onMasterPlayChange`, and the cameras read it wherever they set `controls.enabled`
  (`_dbg__DebugCamera.ts`' `isCanvasInputAllowed()`: the editor view gate and the master loop;
  `_dbg__ViewCamera.ts`' `syncControlsEnabled`). The listener only applies it at once:
  `_dbg__DebugCamera.ts` registers one at module load (a `_dbg__` module, like its plugin), on
  `getECSWorld()` as `Camera.ts` does; each view camera adds its own and `dispose` removes it
  (no forwarding through `Views.ts`). The Loop tab's field is a `{ get, set }` binding whose `set`
  calls `toggleMainPlay` (a state-key binding writes the state before its `onChange`, so the call
  would see no change and notify nobody), and its `onChange` persists `masterPlay` at the gesture's
  end; `persistKeys` still hydrates it. OrbitControls (r187) ignores `pointermove` and the wheel
  while disabled but its `pointerup` doesn't check `enabled`, so a drag in progress stops moving the
  camera and still ends. `stopMainLoop` (an embed's unmount) still writes the state without a
  notification. The note went into `src/_engine/debug/editors/CLAUDE.md` (the view camera; the
  debug `CLAUDE.md` has no camera section), `src/_engine/kernel/render/CLAUDE.md` (Views, Input)
  and `src/_engine/kernel/ecs/CLAUDE.md` (the loop). Checked on WebGPU (the scene runner's Windows
  Chrome) in `scene01` with the debug camera on (F1): a horizontal drag moves it with the loop on,
  not with the loop off through the on-screen "Play the main loop" button or the Loop tab's field
  (a focused checkbox, Space; `AEK_debugLoop` saved `{"masterPlay":false}`, then `true`), and the
  camera doesn't jump when the loop comes back on; the material editor's view camera the same.
  The old code moved the debug camera in both paused cases.

### Phase 2: Light helpers (item 11) — done

1. The runtime check (which of the two causes) and its result under the phase.
2. The helper sync as above.
3. Check in skyShowcase with the cycle running: on, off → on, several times; the box follows the sun
   and keeps the sky's size; the line doesn't shake; a scene with `SunShadowFit` (search the app's
   scenes) shows its box on the fitted light.
4. `yarn verify:scenes --only skyShowcase` (helpers are off in the runner, so no change expected).

Step 1's result (2026-11-25, WebGPU in the scene runner's Windows Chrome, skyShowcase with the cycle
running, a scratch probe on the page's modules):

- **Not a stale reference.** Through on and two off → on cycles the sun stays the same entity, the
  helper's `light` is the entity's `OBJECT3D`, `camHelper.camera` is its `shadow.camera` and
  `camHelper.matrix` is that camera's `matrixWorld` (the same `Matrix4`).
- **Stuck = the night.** By day (`autoUpdate` true) the shadow camera's position equals the light's
  after every render (180 frames with a moving camera: 0 stale), so the box follows, after any number
  of off → on. Once the fade reaches 0 (`autoUpdate` false) the shadow camera keeps the last lit
  frame's pose while the light moves on below the horizon, and an off → on changes nothing; at day
  again it follows. So "the first on works, off → on doesn't" is day, then night.
- **The box's frustum is three's default** (±5, 0.5..500), never the sky's (±30, 0.5..200): the
  helpers are attached in the `TAG_IS_LIGHT` hook inside `createLightEntity`, before
  `applyDiscLight` sizes the shadow camera.
- **The target line doesn't lag at render.** Measured in MAIN it's one frame behind (the sun's turn
  per frame: 0.008°, 0.25° at 30×); measured in APP_RENDER_SYNC (after `lookAtSystem`) it's exact
  (< 1e-6°), with a static and with a moving camera, at 1× and 30×: `lookAtSystem` turns the light
  toward its target, and the helper's `matrix` is the light's `matrixWorld`, so the line's local
  rotation from last frame's `update()` turns with it. The plan's third defect doesn't reproduce.
- **The shake is the line ending in the eye.** The sun follows the active camera: its target is the
  camera's position, snapped to texels across the light and unsnapped along it, so the target line
  ends within a few centimetres of the eye (the target projects to NDC z 6.4, −14: behind the
  camera). The near plane clips it, and each texel snap of its end swings what's left across the
  screen: in a crop sequence with only the target line shown, it pointed a different way in every
  capture, while the light's square and 3D symbol moved smoothly. The matrices are right.

As built (step 2):

- One sync in MAIN at order −1 (after `object3DSyncSystem` and `debugCameraSystem`, order 0), not
  LATE_MAIN, and no APP_RENDER_SYNC pass or `DEBUG_HELPERS` order: a pose written later in the
  frame (`lookAtSystem`, `SunShadowFit`) shows a frame late, about 0.01° for the sky's sun, and a
  `SunShadowFit` frustum (a zoom or a resize) a frame late.
- No `light.shadow.updateMatrices` (the plan called it harmless; it isn't): it also writes
  `shadow.matrix`, which the shadow map is sampled with, so for a light whose map isn't re-rendered
  that frame (`autoUpdate` false, an app's static shadow) the shadows would shift. The box stays
  three's pose, where the map was rendered, and is hidden while `shadow.intensity` is 0 (the sky's
  sun at night: as asked in review), so it no longer stands still at night.
- The frustum: the component keeps `camProjection` (a clone at attach) and the sync calls
  `camHelper.update()` only when the shadow camera's `projectionMatrix` differs from it.
- The line: when the light's target is within 10 m of the active camera (`TARGET_LINE_EYE_GAP`),
  the drawn target line stops 10 m short, so it doesn't end in the eye.
- No re-creation of the helpers for a replaced light or camera: the check found none, and
  `refreshLightShadowsAsync` re-attaches its own.
- The registration-order comments in `Light.ts` and `Camera.ts` no longer name the light helpers'
  LATE_MAIN place.

Step 3's check (2026-11-25, WebGPU, the scene runner's Windows Chrome, a scratch probe):
skyShowcase by day: the box has the sky's frustum (±30, 0.5..200, was ±5, 0.5..500), shown and
within 7 cm of the light after every render (one frame of the sun's motion, 120 frames); at 23h
hidden for 120 frames, also after an off → on; at 9h shown and following again, also after an
off → on. The target line is 90 m (stops 10 m short of the camera at the target); a crop sequence
with only the line shown has nothing in it (from the camera it follows, what's left of the line
lies in the sun's direction, so it projects off-screen), where the old line pointed a different way
in each capture. topDownTestScene's `SunShadowFit` sun: the box has the fitted frustum (±39.71,
1..105.42) and its pose after every render (0 gap, 120 frames); its line keeps its full 65.71 m
(the target isn't at the camera). No new console warning in either scene.

Step 4: `yarn verify:scenes --only skyShowcase` failed only on the system order, in the three debug
configurations: `lightHelperSyncSystem` moved from LATE_MAIN@0 to MAIN@-1 (the probe hash, the
snapshot and `prodTest` passed). The scene baselines are local, so skyShowcase was recorded again
(`--update`: 4 recorded, hash `811c9dc5` unchanged). Every other scene's baseline records the old
place, so its next run shows the same two lines: record it again when that's all it shows.

### Phase 3: Scene-scoped player keys and the on-screen tools box (items 5, 6) — done

1. `sceneId` on the player brains, its test and docs; the app scenes' `sceneId`s.
2. Check the App key shortcuts dialog in the top-down scene and the gym: the player keys under "This
   scene", and they don't fire after switching to another scene.
3. The top-left wrapper box; screenshots in both themes, with and without an editor view.
4. `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene`. Their baselines still have
   `lightHelperSyncSystem` in LATE_MAIN (Phase 2 moved it to MAIN@-1): those two system order lines
   are expected; record the scenes again (`--update`) when nothing else differs.

As built:

- Item 5 as planned. `sceneId` on `PlayerBrainCommonParams` goes to `createActionMap`; a replay
  ignores a map's scene (`isMapActive` gates the devices only), so the input scripts and the brain
  tests are unaffected. The five app sites; `exampleCharacter.ts`' is inside the Hub region, so the
  example's walkthrough has a bullet for it, and the characters guide a sentence.
- Step 2 (2026-11-25, WebGPU, the scene runner's Windows Chrome, a scratch probe): in both scenes the
  brain maps have the scene's `sceneId` and are active, the App dialog lists every player action
  under "This scene" and "All scenes" is empty, and a held key still walks the player. After a
  switch to `scene01` the maps are gone and nothing of them is listed. The keys didn't fire after a
  switch before either (a scene exit deletes the characters and their maps): item 5's defect was
  the listing, and the scope now also covers a map that outlives its scene. The console's two
  "Debug key Ctrl+S / Ctrl+Shift+S is also bound by the action move / forward" warnings per scene
  were there before (`warnIfKeyChordReserved`: an `ignoreModifiers` map collides on the S key
  alone): not this plan's.
- Item 6: the Æ menu (p355) is the first tool since the plan was written, not an About button; it
  keeps `aboutTool`'s `space-3` margin. The box is `.onScreenToolBox` (global class
  `onScreenToolBox`, `getTopLeftBox()`, `display: none` while empty); the two toolbars in it take
  `isInBox` (`.onScreenToolGroupInBox`: no box). Its gap is `$clusterGap`, the group's `space-1`
  plus the Æ margin's `space-3`, so Æ → undo and redo → Runtime are the same in both densities
  (8 px compact; before, redo → Runtime was 16 px across two boxes). Unlike the plan, the inner
  toolbars drop the global `onScreenToolGroup` class and the box is in both lists of the
  click-through rule: it dims as one box (0.5, measured), where only the `pointer-events` list
  would have dimmed the buttons inside an opaque box. No divider between the clusters: the even
  gaps read as three clusters on screen. The material editor view is always registered in the
  debug env (`Boot.ts`), so the box always holds both toolbars there; "without an editor view" is
  the Runtime view. Checked on WebGPU at 2× in the dark and light debugger themes, in the Runtime
  view and in the material editor: the gaps 8 / 2 / 8 / 2 px in all four, no console error.
- Step 4: only the two expected system order lines, in the four debug configurations of both scenes
  (hashes `afd9f4c2`, `170fa4c7` and the gym's character paths `b32821e1` unchanged); both scenes
  recorded again (`--update`: 9 recorded).

### Phase 4: The favicon and the Hub navigation (items 8, 9) — done

1. The favicon's SVG, ICO and PNG; check both tab colours; `npx tsx devTools/toolkit/buildAekashaSymbol.ts`
   still builds the same GLB (compare it with the committed one; it shouldn't change, since only the
   fill did).
2. The A-Z page; the changelog page; "Versions & Issues" with `aek:navParent`, its tests.
3. `yarn hub:build` and `yarn hub:preview`: the menu, an issue page's active item, breadcrumbs and
   search label, the homepage's links, the header's breakpoints.

As built (step 1):

- `favicon.svg`: the `<style>` gone, `fill="#7d899b"` on the one `<path>`, its `d` unchanged.
- `favicon.ico` keeps its three sizes, 16, 32 and 48 px (`index.html`'s `<link>` names all three),
  PNG-in-ICO, rendered from the SVG with `sharp`, transparent, no halo (the old one's
  CHANGELOG entry mentions a white halo for dark tabs; a mid slate needs none).
  `apple-touch-icon.png`: 180 px, opaque white as before, the glyph about the same size and
  centred (119 px for the 32-unit viewBox, so the glyph is about 116 px wide).
- The colour checked at 16 and 32 px on Chrome's four tab colours (light active `#ffffff`,
  inactive `#dee1e6`, dark active `#35363a`, inactive `#202124`): readable on all four, contrast
  3.55:1 on white and 3.40:1 on `#35363a`, balanced, so not nudged.
- `buildAekashaSymbol.ts` writes a byte-identical GLB (git sees no change).

As built (step 2):

- `aek:navParent` re-parents the page in `discoverPages`' tree (`findParent`) instead of each
  reader following it: `renderNav`, `getPageTrail`, `getPageSection` (in `pages.ts`, not
  `searchResults.ts`), the body class and `::: cards` all walk the tree, so they follow it with
  no change of their own. Issues is in Versions & Issues' dropdown with the Changelog, and
  `::: cards version` lists both (no hand-written card, no cards option). A missing nav parent,
  the page itself or one under it is an error (the folder's page stands in), and a cycle is an
  error whose pages' parents are cut (`getPageTrail` would never end). Issues' `aek:order` is now
  10, the Changelog's 20 (their order under Versions & Issues).
- The search's crumbs came from the URL's folders, dropping the first as the group's: a page whose
  section isn't its first folder keeps it now (`issues/light-leak/` → Versions & Issues ›
  Issues). The group was already `getPageSection`'s.
- The changelog page (`version/changelog/`, its `file` `CHANGELOG.md`): the source's
  `# Changelog` line is blanked (the page's h1 stands in, the lines keep their numbers), entries
  are h2 and parts h3 (were h3 and h4), and the slot keeps only the entries in `env.headings`, so
  the TOC lists the 76 entries, not 291 headings; `.hubChangelog`'s rules moved with them
  (`_sections.scss`: the entry's rule on h2, the part's on h3), so the entries now take the h2
  size (step 3 looks at it). Its card's icon is a new `history.svg` (Lucide),
  through a new optional `HubGeneratedPage.icon`. The "not in the search" sentence moved to it.
- The A-Z page (`documentation/a-z/`, `API_AZ_PATH` in `api/model.ts`, order 50: the
  Documentation menu's direct children are `aekasha` (1), Architecture (60), Migration (70),
  Coding standards (80)): its own memo key, out of the search but for its title and description.
  `isApiPagePath` includes it (an unchecked link in `--no-api`, the dev plugin's rebuild page).
  Its `file` is a path with no file on disk: `errorPages.ts` sends a generated page's file's
  errors to it, so `tsconfig.json` or an entry file would have moved theirs. The landing keeps
  the "A–Z index" heading (`#a-z-index`) with a link to the page.
- The hero's Issues and Version buttons are one "Versions & Issues" button (the hero mirrors the
  nav); the homepage's Issues quick link stays.
- The docs went in with the change: `hub/CLAUDE.md` (the meta; What's new's link),
  `devTools/hub/CLAUDE.md` (the section, the changelog page, the A-Z page, the search's crumbs),
  `docs/techniques/hub-authoring.md`, and the two pages that named the Version page
  (`project/aekasha/workflow.md` → the Changelog, `features/toolkit/guide.md`).
- Tests: `navParent.test.ts` (the real `discoverPages` on a fixture folder: the tree, the top nav
  and the active item, the trail and breadcrumbs, the section, the three errors) and the nav-parent
  cases in `searchResults.test.ts`. `shell.test.ts`, `search.test.ts` and `devPages.test.ts` build
  their trees by hand, so a nav parent there would test nothing of it.

Step 3 (2026-11-25, `yarn hub:build`, then the preview, `yarn dev`'s Hub for the dev header, and
HEAD's Hub built in a scratch worktree for the comparison; Chromium through `launchChromium`):

- `yarn hub:build`: 136 pages, no error. Its search index warning (718 KiB gzipped, over 450) and
  the TypeDoc `{@link}` warnings were there before: HEAD's build gives 719 KiB and the same ones.
- The header, the nav's spare width at every 5 px from 960 to 1800: HEAD's public header had at
  least 40 px (at 960); "Versions & Issues" with its dropdown chevron took 34 px more than Issues
  and Version up to 1249 (no nav icons), leaving 6 px at 960 in the public header and 2 in the dev
  one. Up to 1099 px the nav items' side padding is now 0.375rem (0.5 from 1100 to 1249):
  at least 26 px public (46 at 1100, the tightest past 1099) and 22 dev. The version pill's
  `title` is "Versions & Issues" (was "Versions and changelog").
- The menu: Hub, Examples, Features, Documentation, Versions & Issues (its dropdown Issues and
  Changelog; Documentation's: `aekasha`, A–Z index, Architecture, Migration, Coding standards).
  On `issues/` and an issue page Versions & Issues is the active item, the breadcrumbs read
  Hub › Versions & Issues › Issues (› the issue), the body class `hubPage_version`; the search
  groups an issue's results under "Versions & Issues" with "Issues" (› the issue) as their crumbs,
  and finds the Changelog and A–Z index pages by title.
- The homepage: one "Versions & Issues" hero button, the Issues quick link, and "What's new"
  links `version/changelog/#<entry>`, an h2 on that page. The changelog page: one h1, 76 entry
  h2s, 215 part h3s, 76 TOC items; the entries at the h2 size read as the page's sections, kept.
  The Versions & Issues page shows the table and the two cards with their icons. The A–Z page:
  24 letters, 1809 names, every link to a built page and anchor. The mobile menu (390 px) has no
  horizontal scroll. No console error on any page.

### Phase 5: Docs, versions and the changelog — done

1. The nested `CLAUDE.md` files each phase named, and `readme.md` if a listed item changed (none
   expected).
2. Versions (`package.json`): engine minor (`sceneId` on the player brains' params, a new option);
   app patch (the scenes' `sceneId`s, the favicon); toolkit unchanged. A `CHANGELOG.md` entry with
   Engine, App and Project (the Hub's navigation) sections.
3. `yarn checkVersions --against main`, `yarn verify:baselines`, then mark the plan done.

As built:

- Step 1: every doc the phases named was already updated with its phase; `readme.md` and the root
  `CLAUDE.md` name nothing that changed. Only `_dbg__OnScreenTools.ts`' header comment, which
  Phase 3 left past 100 columns, was wrapped again.
- Step 2: engine 6.29.0, app 1.37.1, toolkit 3.8.1 kept. `src/index.ts`' shadow comment is in the
  App section, as earlier entries file that file; the Rapier warning is only in the entry's summary
  (nothing changed for it).
- Step 3: `yarn checkVersions --against main` passes. `yarn verify:baselines` showed only the two
  `@internal` functions Phase 1 added to `MainLoop.ts` (`isMasterPlayOn`, `onMasterPlayChange`),
  documented; the bundles unchanged within the check's threshold, no debug code in the production
  or embed builds. Recorded with `--update --no-build`.

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
