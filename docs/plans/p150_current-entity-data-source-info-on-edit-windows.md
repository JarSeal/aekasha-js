Status: draft | not-implemented
Category: Debugger
Related: p355_save-menu-and-file-server-settings.md (saves the same camera and light edits into the asset JSONs)

# Current Entity Data Source Information on Edit Windows — Plan

Shows, on the Camera and Light debug edit windows, where an entity's current values actually came from (scene config JSON vs. scene TypeScript code) and whether a saved localStorage debug override is currently active — plus tags every entity with its origin, and extends the existing localStorage override mechanism so it also applies in `?isProdTest=true` mode, not just `?isDebug=true`.

The edit windows are on the UI kit (p806): each is a property grid built with `createDebugWindowGrid` (`debug/_dbg__DebugWindowGrid.ts`), whose info rows (`getInfoRowItem`, `getEntityInfoItems`) and notes (`getNoteItem`) this plan's rows are. Line numbers below are as of 2026-11-04 and move; the names don't.

---

## 1. Goal

- Every Camera/Light edit window shows an **"Origin"** (Scene Config JSON vs. Scene Code), a **"Persistable"** flag (whether the entity has an `appId` and can therefore have a saved debug override at all), and a **"Local storage override"** status (Active/None for the current scene), plus a short note describing the precedence order.
- Entities are tagged at creation time with where their config came from, so this is derived from real data, not guessed.
- The existing localStorage → entity-creation override merge (already implemented, see §2.3) is extended to also run under `?isProdTest=true`, not just `?isDebug=true`, without pulling the edit windows' debug modules into prod-test sessions.

---

## 2. Current state (grounded in the actual code)

### 2.1 The three data sources

- **Scene config JSON**: `.camera.json`/`.light.json` asset files (e.g. `src/app/scenes/largeWorld/largeWorldOverview.camera.json`, `largeWorldSun.light.json`: a scene's own assets sit in its folder, shared ones in `src/app/<type>/`), referenced by id from a `*.scene.json`'s `cameras`/`lights` arrays. Gathered into `src/generated/generatedAppData.json` (the gatherer applies the asset's `__saveData` entry for the scene there, see §2.3), and instantiated by `kernel/scene/SceneDataLoader.ts`: `createCameras()` (called by `SceneLoader.ts`' load before the scene's own `.ts` code runs) and `createNextSceneObject3Ds()` (called after it) loop the scene's resolved camera/light props and call `createCameraEntity(props.camProps, props.entityOpts)` / `createLightEntity(props.lightProps, props.entityOpts)`. A string entry in `cameras` is a camera that already exists (persistent), not created again.
- **Scene TypeScript code**: entities created directly inside a scene's own module by calling `createCameraEntity`/`createLightEntity` with hand-written props, bypassing the JSON pipeline entirely. `largeWorld` mixes both: its JSON names `largeWorldOverview`, `largeWorldAmbient` and `largeWorldSun`, and `largeWorld.ts` adds the lantern point lights (`largeWorldLantern<i>`) and `largeWorldDynamicCamera`. `textureArrays.ts` and `textureAtlases.ts` make all theirs in code.
- **localStorage debug override**: saved by the debug edit windows themselves, see §2.2/§2.3.

### 2.2 localStorage storage shape and read/write points

- Camera — `kernel/camera/debug/_dbg__CameraDebugState.ts` (the state the Cameras tab, the edit window `_dbg__CameraEditWindow.ts` and the debug camera share): LS key `AEK_debugCams` (`LS_KEY`), shape `{ [sceneId]: { cams: { [appId]: CamEntityDebugState }, debugCam } }`. A field's change calls `saveCameraToLS(entityId, key, value)`, gated by `appIdComp?.isFixed` — non-`appId` entities are silently never saved. Read: `loadCameraDebugData(appId, sceneId?)`, keyed by the scene (default the current one) + `appId`.
- Light — `kernel/light/debug/_dbg__LightDebugState.ts` (with `_dbg__LightEditWindow.ts`): mirrors Camera. LS key `AEK_debugLights` (`LS_LIGHTS_KEY`), `saveLightToLS` (gated by `isFixed`, and refusing a light with `MANAGED_BY`), `loadLightDebugData(appId, sceneId?)`.
- Both edit windows end with `getEntityInfoItems({ entityId, appId, type, name, description })` (Entity ID, App ID or 'None', Type, Name, Description) after their buttons, and their "Clear local storage" button is already disabled while `load*DebugData(appId)` returns nothing: the natural place for §4's rows, not a new UI section.
- A managed light (one with `MANAGED_BY`, eg. a sky box's sun) gets its own content (`createManagedLightContent` in `_dbg__LightEditWindow.ts`): it takes no persisted overrides (`createLightEntity` skips `loadPersistentProps` for it), its manager owns its values.
- Both state modules import the debugger's tab and window refreshes (`updateDebuggerTab`, `updateDraggableWindow`, the on-screen tools), so the readers can't be imported from shipping code as they are.

### 2.3 The existing merge point (already works for both JSON and code entities)

`kernel/scene/PropertyLoader.ts`' `loadPersistentProps(initProps, 'CAMERA' | 'LIGHT')` is called identically from `createCameraEntity` (`kernel/camera/Camera.ts`) and `createLightEntity` (`kernel/light/Light.ts`, unmanaged lights) — **regardless of whether the entity came from JSON config or scene code**. It reads the loading scene's data (`getLoadingSceneId() ?? getCurrentSceneId()`: cameras and a scene's code run before it becomes current). Precedence: `Hardcoded (JSON or code) < the asset's __saveData entry for the scene (JSON assets only, applied by the gatherer, so already in initProps) < Saved LS Props`.

This means: **a scene-code entity's hardcoded initial values are already overridable by saved localStorage debug data today**, exactly like a JSON-config entity — no new override mechanism is needed. The one hard requirement is an explicit `appId` on the entity (`entityOpts.appId` or `camProps.appId`/`lightProps.appId`), which sets `APP_ID.isFixed = true` (`ECSWorld.createEntity`, `kernel/ecs/ECS.ts`); without it, `loadPersistentProps` has nothing to key a lookup on and the save functions refuse to write (§2.2). This — not "JSON vs. code" — is the most likely actual cause of the reported "sometimes it doesn't survive a refresh" confusion, and is exactly what §4's "Persistable" indicator surfaces.

### 2.4 `IS_DEBUG_ENV` vs `IS_PROD_TEST_MODE` gating

`kernel/config/Config.ts`: `IS_DEBUG_ENV` requires a dev/test build **and** `?isDebug=true`; `IS_PROD_TEST_MODE` requires a dev/test build **and** `?isProdTest=true` — independent flags, neither implies the other, both set by `initEnvironment` and folded to `false` in a production build (`__AEK_DEBUG__`, so the code behind them leaves the bundle).

The LS-override merge is gated **exclusively on `IS_DEBUG_ENV`**, at every layer:
- `PropertyLoader.ts` — `if (IS_DEBUG_ENV) { ... }` around the actual merge.
- `getSavedCameraDebugProps` (`Camera.ts`) / `getSavedLightDebugProps` (`Light.ts`), which the merge reads through, call the edit-window modules (`_dbg__CameraGUI.ts` / `_dbg__LightGUI.ts`) through `useDebug(ref)`, and those refs are loaded with `loadDebugModuleAsync(…)` without `includeInProdTestMode` (`kernel/config/DebugModules.ts`), so in prod test mode they're never loaded and `useDebug` returns `undefined`.

`DEBUG_DATA` itself is already stored in prod test mode (`ECSWorld.addComponent` drops it only outside both modes). So today, a `?isProdTest=true` session (no `?isDebug=true`) never applies saved debug overrides — it only ever sees JSON-config/scene-code values. This is a gap relative to the intent of prod-test mode (a production build with a *subset* of debug features) and should be closed for the read side.

---

## 3. Design — Phase 1: Tag entities with their config origin (non-breaking, isolated)

Add an optional `source` field to the entity's debug data, defaulted generically, tagged explicitly for the JSON path:

- `EntityDebugData` (`kernel/ecs/ECSRegistry.ts`): add `source?: 'sceneConfig' | 'sceneCode'`, with its JSDoc. Not in `DebugDataSchema` (`schemas/_HelperSchemas.ts`): that one is the asset JSONs' `debugData` too, and the loader sets the field, not a JSON author.
- `ECSWorld.createEntity` (`kernel/ecs/ECS.ts` — the single generic entity-creation entry point shared by every kind, camera/light/mesh/group alike): default it when absent —
  ```ts
  this.addComponent(id, ComponentType.DEBUG_DATA, {
    ...opts?.debugData,
    source: opts?.debugData?.source ?? 'sceneCode',
  });
  ```
  `'sceneCode'` becomes the implicit default for anything created without an explicit source — correct for hand-written scene `.ts` entities, and generic enough to cover Mesh/other entity types later at no extra cost. (`DEBUG_DATA` is dropped outside the debug env and prod test mode, so production stores nothing.)
- `kernel/scene/SceneDataLoader.ts`: tag `entityOpts.debugData.source = 'sceneConfig'` (on a copy: the scene data is reused on every visit) before the call, in both JSON-driven loops:
  - `createCameras()`, at its `createCameraEntity(props.camProps, props.entityOpts)` call.
  - `createNextSceneObject3Ds()`, at its `createLightEntity(props.lightProps, props.entityOpts)` call.

No change needed in `createCameraEntity`/`createLightEntity` — `entityOpts` already flows straight through to `world.createEntity(entityOpts)` unmodified.

This phase alone is invisible (no UI change yet) and safely committable on its own.

## 4. Design — Phase 2: Show origin + precedence on the edit windows

Add rows next to the entity info rows (after `getEntityInfoItems`, or as `DebugEntityInfo` fields it renders):

- `kernel/camera/debug/_dbg__CameraEditWindow.ts` — `createEditCameraContent`.
- `kernel/light/debug/_dbg__LightEditWindow.ts` — `createEditLightContent` (not the managed light's content: say "Managed by <owner>" there instead, from `MANAGED_BY`, as its info rows already name the manager).

Per window, as grid items:

- **Origin** (`getInfoRowItem`): "Scene Config (JSON)" / "Scene Code", from `debugData.source`.
- **Persistable** (`getInfoRowItem`): "Yes" / "No — no appId set" from `appIdComp.isFixed`; when "No", a `getNoteItem` warning that edits here won't survive a refresh.
- **Local storage override**: "Active" / "None" — from whether `loadCameraDebugData(appId)`/`loadLightDebugData(appId)` returns data for the current scene. It changes with the window's edits and the "Clear local storage" button, so it's read on every refresh (a `getNoteItem` with a function, or an info row through `{ get }` with `interval: 'refresh'`), not fixed at the build as `getInfoRowItem`'s text is.
- A short precedence note (`getNoteItem`): `Scene Config / Scene Code → the asset's saved entry for this scene (JSON only) → Local Storage (debug override, highest precedence)`.

Depends on Phase 1 for `Origin`; independently committable otherwise.

## 5. Design — Phase 3: Extend the localStorage override to `?isProdTest=true`

Read-only extension — writing remains `IS_DEBUG_ENV`-only (the edit windows are the only writer, per §2.2). To avoid loading the edit-window modules in prod test mode just to read two localStorage keys, extract the plain read functions into small, dependency-free modules:

- New `kernel/camera/debug/CameraDebugStorage.ts` (not `_dbg__`-prefixed: `PropertyLoader.ts` imports it statically, which the lint allows only for a non-`_dbg__` module): move `CamEntityDebugState`, `DebugCamLSProps`, `CamSceneDebugState`, `CamDebugLSData`, `LS_KEY` and `loadCameraDebugData()` here from `_dbg__CameraDebugState.ts`. Only deps: `lsGetItem` (`utils/LocalAndSessionStorage.ts`), `getCurrentSceneId` (`kernel/scene/Scene.ts`) — no UI kit or debugger imports.
- New `kernel/light/debug/LightDebugStorage.ts`: same treatment for `LightEntityDebugState`, `LightSceneDebugState`, `LightDebugLSData`, `LS_LIGHTS_KEY` and `loadLightDebugData()` from `_dbg__LightDebugState.ts`.
- A `debug/` folder holds nothing that ships (`yarn verify:baselines` fails on any module of one with rendered code in the production build): every call of the new modules must stay behind `IS_DEBUG_ENV || IS_PROD_TEST_MODE`, which fold to `false` there, so they leave the bundle. The production check is the proof.
- `_dbg__CameraDebugState.ts`/`_dbg__LightDebugState.ts` re-import/re-export these from the new modules — every existing call site (`saveCameraToLS`, `clearCameraFromLS`, the edit windows, the tabs) keeps working unchanged; pure extraction, no behavior change to the debugger.
- `kernel/scene/PropertyLoader.ts`: read through the lean modules (`loadCameraDebugData`/`loadLightDebugData` directly, replacing `getSavedCameraDebugProps`/`getSavedLightDebugProps`' `useDebug` path, which can then go), and widen its gate from `if (IS_DEBUG_ENV)` to `if (IS_DEBUG_ENV || IS_PROD_TEST_MODE)`.
- No change to how `Camera.ts`/`Light.ts` load the edit-window, helper and debug camera modules — they remain `IS_DEBUG_ENV`-only exactly as today; only the LS-read side becomes available in prod-test mode.

Independently committable; benefits from (but doesn't strictly require) Phases 1-2.

---

## Verification

1. `yarn test`, `tsc` (the Stop hook) — the `EntityDebugData` field, the `ECS.ts` default, the `SceneDataLoader.ts` tagging and the new storage modules type-check; `_dbg__CameraDebugState.ts`/`_dbg__LightDebugState.ts` still compile after re-exporting. The edit windows' tests (`_dbg__CameraEditWindow.test.ts`, `_dbg__LightEditWindow.test.ts`) get the new rows.
2. `yarn dev` with `?isDebug=true`, load `largeWorld` (mixes JSON-config `largeWorldOverview`/`largeWorldSun` with scene-code `largeWorldDynamicCamera`/`largeWorldLantern0`…):
   - Open each entity's edit window — confirm "Origin" reads correctly, "Persistable: Yes" for all (all have `appId`s), "Local storage override: None" initially.
   - Edit a value on both a JSON-origin and a code-origin entity, refresh — confirm both persist and the window now reports "Local storage override: Active"; "Clear local storage" turns it back to "None" without reopening the window.
   - Create/inspect an entity without an `appId` (eg. from the console) — confirm "Persistable: No" with the warning, and that an edit to it does not survive refresh.
3. Reload with `?isProdTest=true` (no `?isDebug=true`) after saving overrides in step 2 — confirm camera/light entities pick up the previously-saved localStorage values, and (Network tab) that `_dbg__CameraGUI`/`_dbg__LightGUI` and the edit-window modules are *not* loaded in this mode.
4. `yarn verify:baselines` — no debug code in the production build (the new `debug/` modules folded away), the bundle unchanged.
5. `yarn lint` — Stop hook runs lint + type-check; confirm clean.
