Status: in progress | Phases 0-2 implemented
Category: Refactoring, Documentation, Rendering, Assets
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p612_review-ecs-loop-config-init.md (D2's rule for the type-only seams; `Camera.ts`' main-camera lookups are its D7), p302_material-and-texture-system-refactor.md (rewrites part of `Material.ts`, `Texture.ts` and `SceneLoader.ts`: D2), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the embed's seams and the lazy import path, "From p611" below), p614_review-physics.md (owns `Raycast.ts` and gets `MeshUserData.ts`, D13), p617_review-input-ui-hud.md (owns `DraggableWindow.ts` and the HUD, D5), p618_review-debug-public-api.md (owns the `_dbg__` modules)

# Review: Rendering, Scenes and Assets

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group in an "As found" list, and fixes them or files them. It also
lands p611's recommendation for the glTF import path (loaded on demand) and applies p612 D2's rule
to the 15 type-only seams in these files.

## 1. As found (2026-10-15, branch `review-rendering-scene-assets` at `99b58f4`, = `main` after p612's merge)

### 1.1 The stub's paths moved

The stub was written before p608's move. Its names map to:

| Stub | Now |
| --- | --- |
| "the renderer" | `kernel/render/` (`Renderer.ts` 215 lines, `CanvasSize.ts`, `RenderHooks.ts`, `ThreeMath.ts`, `Object3DHelpers.ts`, `LodFade.ts`) |
| `Scene.ts`, `SceneLoader.ts` | `kernel/scene/` (`Scene.ts` 764, `SceneLoader.ts` 710, `SceneHooks.ts`, `AppData.ts`) |
| `GroupManager` | `kernel/scene/Group.ts` |
| "the property loader" | `kernel/scene/PropertyLoader.ts` |
| `CameraManager` | `kernel/camera/Camera.ts` (619; the main-camera lookups are p612 D7's) |
| `LightManager` | `kernel/light/` (`Light.ts` 544, `LightHelpers.ts`) |
| `MeshManager` | `kernel/mesh/` (`Mesh.ts` 477, `MeshUserData.ts`) |
| geometry, material, texture, arrays, atlases | `kernel/assets/` (`Geometry.ts`, `Material.ts` 809, `Texture.ts` 866, `TextureArray.ts`, `TextureAtlas.ts`, `AssetFiles.ts`, `AssetOwners.ts`, `AssetUrl.ts`, `Disposal.ts`, `SceneAssetRelease.ts`) |
| "the assets API and worker" | `kernel/assets/AssetsAPI.ts`, `AssetsAPITypes.ts`, `kernel/assets/worker/` (4 files) |
| `Import/` (15 files) | `kernel/assets/import/` (15 modules and a test) |
| PostFX | `features/postfx/` (`PostFX.ts`, `PostFXFeature.ts`, `PostFXSchema.ts`, `PostFXTypes.ts`, `index.ts`) |
| viewports | `features/viewports/` (`Viewports.ts` 644, `ViewportsFeature.ts`, `Viewports.module.scss`, `index.ts`) |
| snapshots | `kernel/render/Snapshot.ts` |

Not in scope: `kernel/render/Raycast.ts` and `RayDebugTypes.ts` (p614's: "raycast"), `Views.ts`
(p612's), every `_dbg__` module and `debug/` folder (p618's), the schemas (p619's).
`kernel/render/LodFade.ts` is in: it's a kernel file that LOD and instancing share (p616's scope
is `features/lod/` and the others).

### 1.2 The stub's inputs, checked

- **p302 hasn't landed** (`draft | not-implemented`). What it rewrites in these files: `Material.ts`'
  TSL path (`createMaterial`'s `tslFile` block, `:374-515`, the input wrapping), `getMaterialVariant`
  (`:574`), `MatProps`' node-material members; `Texture.ts`' `setTextureOpts` (D1) and the texture
  schema; `SceneLoader.ts`' texture-id resolution of material params (`:319-333`) and the scene's
  texture list (D6). It also owns two bugs here: **A** (`Material.ts:434-442`, a missing texture
  becomes `texture(undefined)` after the warning) and **B** (`SceneLoader.ts:330`, the resolved
  texture objects are written back into the cached generated params). D2 decides.
- **`notExported`, the three the stub names, still there** (`.cache/hub/typedoc.json`, 19 in
  all): `CameraGUIModule` (`Camera.ts:41`, `cameraDebugGUI`'s type), `LightGUIModule`
  (`Light.ts:522`, `debugGUI`'s), and `"three/tsl".Node` (`types/three-node-material-helpers.d.ts`,
  named by `sampleAtlasCell` at `TextureAtlas.ts:119`).
- **The type-only seams: 15 in these files** (the layout report's "Kernel → feature"), each one of
  p612 D2's kinds:
  - the assets worker's messages: `AssetsAPI.ts:39`, `AssetsAPITypes.ts:7-8`,
    `worker/AssetsSwitchGLTF.ts:24` (LOD's `ResolvedLodChainOptions`, `SimplifiedLodChain`,
    `TransferableLodChain`);
  - import params: `import/CustomProps.ts:1`, `import/ImportTypes.ts:1,7` (physics'
    `ColliderParams` / `RigidBodyParams`, LOD's `LodChainOptions`),
    `import/ImportExtensions.ts:4-5`, `import/GLTFExtract.ts:4`, `import/ImportRegistry.ts:22`
    (LOD's chain types);
  - mesh definitions: `Mesh.ts:31` (`LodAutoDef`, `LodDef`, `MeshLodDef`);
  - scene definitions: `Scene.ts:15,20,24` (`SkyBoxDef`, `ImpostorDef`, `PostFxPassProps`).

  All stay; nothing to change. The two `import()`s of the assets worker's LOD job modules are
  dynamic (the layout report lists them apart).
- **The four `SceneLoader.ts` TODOs** are there (`:153`, `:154`, `:182`, `:446`), plus an
  `@CONSIDER` (`:651`). Elsewhere in scope: `Scene.ts:119,733`, `Geometry.ts:162,235`,
  `PropertyLoader.ts:27`, `ThreeMath.ts:32`, `Mesh.ts:45` (`@CONSIDER`), `Light.ts:439` (`@Note`).
  No `any` and no `eslint-disable` in scope.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports undocumented | Members undocumented |
| --- | ---: | ---: |
| `kernel/assets` | 32 of 140 | — |
| `kernel/assets/import` | 11 of 66 | — |
| `kernel/assets/worker` | 2 of 4 | 1 of 1 |
| `kernel/camera` | 22 of 32 | 10 of 11 |
| `kernel/light` | 12 of 20 | — |
| `kernel/mesh` | 5 of 13 | — |
| `kernel/render` | 15 of 91 | — |
| `kernel/scene` | 27 of 88 | 1 of 1 |
| `features/postfx` | 0 of 28 | — |
| `features/viewports` | 4 of 16 | — |

126 exports and 12 members. (`kernel/render`'s 91 count `Raycast.ts` and `Views.ts` too; their
undocumented exports are 0.) Beyond the count, most of the older summaries use the pre-p605 form
`@param id (string) scene id` / `@returns (object) {@link X}`, which the lint can't see (H2).

### 1.4 Findings by file group

Numbered for the phases to reference. **(bug)** marks wrong behaviour, **(SBP)** bytes,
**(perf)** per-frame cost; the rest are hygiene, placement and API shape. Read from the code, not
reproduced, unless a finding says so.

**Renderer and render helpers (`Renderer.ts`, `CanvasSize.ts`, `RenderHooks.ts`, `ThreeMath.ts`, `Object3DHelpers.ts`, `LodFade.ts`)**

- R1 **(bug)** `isWebGPURenderer()` / `RendererOptions.currentApi` say WebGPU whenever
  `'gpu' in navigator`, but three's `WebGPURenderer.init()` falls back to its WebGL2 backend when
  no adapter comes back (a Firefox or Linux Chromium with `navigator.gpu` and no adapter). Readers:
  `Geometry.ts`' pre-warm, the About dialog, the light GUI. The truth is
  `renderer.backend.isWebGPUBackend` after `init()`.
- R2 `setRendererOptions` sets `antialias = Boolean(opts?.antialias)`, so the default
  `antialias: true` in `options` is dead (an embed's `renderer` without `antialias` gets none). It's
  `async` without an `await`, and the debug LS's saved `shadowMapType` is ignored
  (`if (rendererOpts.shadowMapType)` reads the caller's options, not the merged ones).
- R3 `RendererOptions` mixes what a caller sets with resolved state (`currentApi`,
  `currentApiIsWebGPU`, `currentApiIsWebGL`), all required in the type, so a caller passes them
  through `Partial`. `deleteRenderer` keeps `canvasParent` (a mount's removed element).
  `getRenderer(throwOnError?)` is a positional boolean. Undocumented: `RendererOptions`,
  `isWebGPURenderer`, `isWebGLRenderer`, `createRendererDebugGUI`.
- R4 `ThreeMath.ts`: exported shared scratch objects (`ThreeVector3`, `ThreeQuoternion` (sic),
  `ThreeEuler`) that `Mesh.ts`, `Group.ts` and `MeshUserData.ts` write; `slerp` allocates and has a
  rename TODO (one caller, `PhysicsEntity.ts`); `RENDERER_SHADOW_OPTIONS` is the renderer debug
  tab's list in a shipping file; `GRAVITY_DOWN_NORMAL` has no user; `smoothDampVec3` (on the entry)
  has an optional `maxSpeed` before the required `deltaTime`. None of them documented except
  `smoothDampVec3`.
- R5 `CanvasSize.ts`, `RenderHooks.ts`, `Object3DHelpers.ts` and `LodFade.ts` are clean and
  documented. `Object3DHelpers.ts`' comment names `helpers.ts` (gone in p608).

**Snapshots (`Snapshot.ts`)**

- N1 Placement: imports `DEBUG_HELPER_USER_DATA_KEY` from `debug/Profiler.ts` (the debugger
  framework's entry) for a shipping feature; the key belongs next to `markDebugHelper`'s readers in
  the kernel, with `Profiler.ts` re-exporting it.
- N2 Clean otherwise: state saved and restored in `finally`, the readback after the restore, so
  overlapping snapshots can't interleave. `SnapshotOpts` and `SnapshotBlobOpts` lack summaries
  (their fields have docs); `SnapshotOpts.height` has none.

**Scenes (`Scene.ts`, `SceneHooks.ts`, `AppData.ts`)**

- SC1 **(bug)** `deleteScene` (no caller): deletes entities and removes groups inside
  `scene.traverse`, which skips the next sibling of each removed child; reads `geo.userData.id`
  right after warning that `geo` is missing; one missing material id skips the rest of an array.
  Its `sceneDeleted` hook's one user is the sky box. D7.
- SC2 **(bug)** Scene resizers (`issues/scene-loopers-registered-on-the-previous-scene.md`'s
  "Also seen", still open): never deleted on a scene exit, so a revisit adds them again;
  `deleteSceneResizer` with an array filters with the filter's own index (`i !== index[i]`) and
  shifts the later indexes. `createSceneResizer` and `deleteSceneResizer` have no callers; only
  `MainLoop.ts` reads `getSceneResizers`. D7.
- SC3 **(bug, edge)** `setCurrentScene` ignores `backgroundColor: 0` (black as a number is falsy).
- SC4 The scene listener registries (`registerOnSceneEnter`, `registerOnSceneExit`,
  `registerOnAllSceneEnterings`, `registerOnAllSceneExits`, on the entry, used by scene files, the
  toolkit and debug modules): one
  function per key, replaced silently, no way to remove one (`@TODO: add deletion methods`), and
  "Enterings" misspelled. Undocumented, with their `runOn*` counterparts. D8.
- SC5 The looper functions: three copies of the same create / delete code (main, late, app), an
  index-and-`null` scheme instead of a remover, and positional optionals
  (`createSceneMainLooper(looper, sceneId?, isLateLooper?)`). On the entry and in the Hub's guides.
  D9.
- SC6 Dead code: `getAllScenes`, `setSceneOpts`, `getCurrentSceneOpts`, `getSceneMainLoopers`,
  `getSceneAppLoopers`, `getSceneMainLateLoopers` have no caller. `getScene(id, silent?,
  throwOnError?)` takes two positional booleans (on the entry). `registerScenesFromGeneratedData` is
  `async` without an `await`. The commented-out `comments` / `todo` fields, the
  `@TODO: remove this old implementation`, the stale "initEngine (initApp)".
- SC7 `SceneData` is a hand-written copy of the scene schema's shape (`schemas/SceneSchema.ts`),
  undocumented, as are `SceneOptions` and `Looper`. D11.
- SC8 `SceneHooks.ts` and `AppData.ts` are clean and documented.

**The scene loader (`SceneLoader.ts`)**

- SL1 **(bug)** A failed load leaves the page dead: the `.catch` only clears the loading scene id
  and the draggable windows, so the inputs stay off (`setAllInputsEnabled(false)`), the canvas
  keeps `pointer-events: none`, the loader container stays on the HUD, the debugger stays disabled,
  and `currentlyLoading`, `loopState.isLoading` and `nextSceneId` stay set (`isCurrentlyLoading()`
  is true from then on, which p612 I3's boot warning reads). The throws before the load starts (no
  scene data, no scene file, no loader) leave `currentlyLoading` true too. The promise resolves
  either way, so a caller can't tell (`@CONSIDER: should this throw an error?`). D3.
- SL2 **(bug, race)** Overlapping `loadScene` calls aren't guarded: a second call (a scene key
  pressed twice, the debugger's scene list, a mount handle's `loadScene`) runs every phase
  interleaved with the first: both run the exit hooks, both create cameras and load assets, and the
  later `setCurrentScene` wins while the earlier's hooks still run. D3.
- SL3 **(bug B, p302's)** `loadNextSceneAssets` writes the texture objects into the generated
  data's cached `material.params` before copying them (`params[texKey] = texture`), so a revisit
  sees objects, not ids, and reuses a texture the release may have disposed. Its loop also runs
  the inner `textureMapKeys` loop once per key (`for j < textureMapKeys.length`, the `j` unused).
  D2.
- SL4 **(SBP)** `ImportRegistry` is imported statically here and by `SceneAssetRelease.ts`, so the
  glTF import path ships in every initial chunk (p611 measured −15.5 KiB gzip on the banner when
  folded: "From p611" below). D4.
- SL5 **(SBP)** The loader imports the UI kit and the debugger's entries statically:
  `DraggableWindow.ts`' scene-change handling, `HUD.ts`, `DebuggerGUI.ts`, `DebugTools.ts`,
  `OnScreenTools.ts`. The banner embed (no UI) carries `_engine/ui` at 13.4 KiB gzip. Phase 0:
  `DraggableWindow.ts` (with `Window.ts` and `SvgIcon.ts`) ships only because of the loader's two
  ungated calls (`Boot.ts`' is debug-gated and folds): 30.6 kB rendered, 7.8 kB gzip before
  minification, in the banner and the app. `HUD.ts` and `CMP.ts` stay either way (the boot builds
  the HUD root). D5.
- SL6 `loadScene` is about 250 lines (the limit is 150): the debug start-scene resolution, the
  loader resolution and the phases in one closure. `createCameras` (exported, used by physics'
  hook order) has no doc; `createNextSceneObject3Ds` and `createSceneLoader` are `async` without an
  `await`; `LoadSceneProps.updateLoaderStatusFn` is never read; `createSceneLoader(loader,
  isCurrent?)` takes a positional boolean; the `void ecsWorld.getEntitiesWith(…).next().value` in
  the debug branch does nothing (its comment says it saves the debug camera's state).
- SL7 The four TODOs and the `@CONSIDER` (§1.2): `deleteSceneLoader`, the debugger loader
  override, disabling the previous scene's input, a next-scene camera. Undocumented:
  `SceneLoader` (the type, members partly), `ScenePrimitiveAssets`, `UpdateLoaderStatusFn`,
  `setCurrentSceneLoader`, `getCurrentSceneLoader(Id)`, `getNextSceneId`,
  `hasFirstSceneBeenLoaded`.

**Groups and the property loader (`Group.ts`, `PropertyLoader.ts`)**

- G1 **(bug)** `removeFromGroupEntity`'s `deleteMeshes` fallback disposes the child's geometry,
  which is usually a registered (shared, ref counted) one; its `deleteGeometries`,
  `deleteMaterials` and `deleteTextures` options are declared and ignored.
- G2 **(bug, edge)** `disposeGroup` and `removeFromGroupEntity` find a child's entity with
  `getEntityIdByAppId(id)` in the default world, not the group's (and by app id, though every
  engine object carries `userData.entityId`).
- G3 `createGroupEntity` repeats `createMeshEntity`'s transform-from-props code (position,
  rotation, quaternion through the shared scratch objects). `[Group Manager]` log prefixes.
  Undocumented: `GroupProps` (is `rotation` radians?), `getGroupByAppId`.
- G4 `PropertyLoader.ts`: the "load from a file" TODO with its `savedProps = {}` placeholder;
  `LoadableProps` undocumented. It imports `SceneLoader.ts` for `getNextSceneId` (a cycle through
  `Camera.ts`).

**Cameras (`Camera.ts`, minus the main-camera lookups)**

- CA1 **(bug)** `camera.zoom` is set after `applyCameraProjection` has updated the projection, so
  a `zoom` other than 1 takes effect only at the next resize.
- CA2 **(bug, edge)** `setActiveCamera` and the "first camera becomes active" check read the
  default world: a camera created in another world (`createCameraEntity(…, world)`) makes
  `setMainCamera` look its id up in the default world, where it's another entity or none (throws).
- CA3 **(SBP)** Half the file is debug-only and ships: the debug camera's LS types and key,
  `toggleAllCameraHelpers`, `syncCameraHelpersFromLS`, `isAnyCameraHelperVisible` (their callers are
  `_dbg__` modules only). `cameraDebugGUI` is an exported `let` with an unexported type (the
  `notExported`).
- CA4 API: `getCurrentCamera` / `getCurrentCameraId` duplicate `getActiveCamera` /
  `getActiveCameraId` (one caller, `MainLoop.ts`; the second none); `setCurrentCamera(appId)`
  scans every `APP_ID` instead of `getEntityIdByAppId` (one caller, the on-screen tools);
  `disposeCamera`'s stale comment; "Load light properties". 22 exports and 10 members
  undocumented.

**Lights (`Light.ts`, `LightHelpers.ts`)**

- LI1 `LightProps` here and `LightProps` in `schemas/LightSchema.ts` are two types with one name
  (the runtime one takes three's colours and a texture object, the schema's is the JSON). D11.
- LI2 `setLightFrustumCullingEnabled`'s 15-line comment explains a circular import through
  `LightManager.ts` and `MeshManager.ts`. The cycle is still there (Phase 0: `Light.ts` →
  `ObjectFrustumCullingSystem.ts` → `ECSCoreSystems.ts` → `Light.ts`), so the wrapper stays and
  the comment is cut down to the current names. `debugGUI` is an exported `let` named like every other module's private ref, with an
  unexported type (the `notExported`).
- LI3 API: `createLightEntity` takes an optional world, the setters (`setLightEnabled`,
  `setLightShadowEnabled`, …) a required one. `'castShadow' in light` is always true. Undocumented:
  `LightProps`, `ShadowQuality`, `SHADOW_PRESETS`, `createLightEntity`, `getLightByAppId`, the
  setters, the helper toggles. `[Light Manager]`, the `@Note`, `LightHelpers.ts`' plan path.

**Meshes (`Mesh.ts`, `MeshUserData.ts`)**

- M1 **(bug)** `MeshUserData.ts`' `setMeshCreatePropsToUserData` has no `break` after `CAPSULE`
  and `CONE` (a capsule falls through into the cone's and the cylinder's code). Its one caller is
  physics' `import/MeshColliderGeometry.ts`, and what it writes is mostly never read (Phase 0):
  it writes `radius`, `halfHeight` and `orientation` into the scratch geometry's
  `userData.props.params`, and `PhysicsEntity.ts`' `deriveColliderDimensionsFromMesh` reads
  `createGeometry`'s names (`height`, `radiusTop` / `radiusBottom`). So an imported node's
  `CAPSULE`, `CONE` or `CYLINDER` collider gets no derived `halfHeight` (the Physics API's default
  applies), and a cone or cylinder no derived radius either; boxes and spheres work. No template
  asset has one (every GLB's colliders are boxes, trimeshes, convex hulls and heightfields), and
  the code-made cylinder colliders (the gym's carousels, `scene01`) take `createGeometry`'s path,
  which works. D13.
- M2 **(bug)** `MeshProps.mat` has no `string` in its type, though `createMeshEntity` handles one
  (the `@CONSIDER` above it asks for what's already there for `geo`).
- M3 `preWarmMesh` makes a camera per call and leaves `compileAsync`'s promise unhandled (a
  rejected compile is an unhandled rejection).
- M4 Placement: `MeshUserData.ts` is physics' collider derivation in the kernel. `[MeshManager]`
  log prefixes. Undocumented: `MeshProps`, `createMeshEntity`, `disposeMesh`, `getMeshByAppId`,
  `setMeshCreatePropsToUserData`.

**Asset registries (`Geometry.ts`, `Material.ts`, `Texture.ts`, `AssetFiles.ts`, `Disposal.ts`)**

- A1 **(bug)** `getGeometry(id)` throws a `TypeError` for an unknown id (`geometries[id].resource`),
  so `createMeshEntity`'s `existsOrThrow(getGeometry(…), message)` never shows its message, and
  `loadNextSceneAssets`' string geometries crash the load instead of skipping.
- A2 **(bug)** `loadTexture` without an id registers its texture twice: `createTexture` saves it
  under its uuid, then `loadTexture` saves it again under its `fileName` (setting `userData.id` to
  the file name), so the uuid entry is orphaned and a release disposes it twice.
- A3 **(bug)** The synchronous loaders' error callbacks `throw` inside three's loader callbacks
  (`createTexture`, `loadTextures`): `throwOnError` becomes an uncaught error, never the caller's.
  `loadTextures`' `EMPTY_TEXTURE` stand-ins aren't registered.
- A4 **(bug A, p302's)** `Material.ts:434-442`. D2.
- A5 **(bug, edge)** `decMaterialRef` releases the material's registered textures when the last
  material holding them goes (`deleteTexturesFromMaterial` without `keepRegistered`), but checks
  only other materials: a texture the scene background, a spot light's cookie or the sky box also
  uses is disposed mid-scene. `releaseSceneOwnedAssets` consults `retainedTextures`; this path
  doesn't.
- A6 `prewarmGeometry` leaks its `MeshBasicNodeMaterial`, makes a camera per call, and its promise
  isn't handled; WebGPU only (R1 makes that check wrong too); the `@TODO`s.
- A7 Dead code (no caller, none on an entry): `Disposal.ts` (the whole file), `isJPG`, `isPNG`,
  `freeGeometryGPUMemory`, `getAllGeometries`, `setGeometryPersistence`, `setMaterialPersistence`,
  `setTexturePersistence`, `incTextureRef` / `decTextureRef` (textures are released by owner and by
  material use, so their `count` is never raised), `updateAllMaterials`, `getMaterials`,
  `getAllMaterials`, `getTextures`. D7.
- A8 API and types: `Materials` is a 30-member union that `THREE.Material` already covers
  (`MeshMatcapNodeMaterial` twice); `TextureMapKeys` repeats `utils/Constants.ts`' untyped
  `textureMapKeys`; `GeoProps`, `MatProps`, `TextureProps` are hand-written next to their schemas
  (D11); `createGeometry` / `createMaterial` / `saveBufferGeometry` with a registered id return the
  registered one and drop the argument silently (a leak for `saveBufferGeometry`'s caller); two
  copies of the FNV-1a hash (`Material.ts`, `TextureArray.ts`). Undocumented: 32 exports (the ref
  count functions, the registries, `GeoProps`, `MatProps`, `TexOpts`, `TextureProps`, …).
- A9 Size: `Texture.ts` 866 lines (over 800); `createMaterial` ~280 lines (over 150), most of it
  the TSL path p302 rewrites; `loadTextures` ~115. The legacy synchronous loaders (`loadTexture`,
  `loadTextures`, `createTexture`: TextureLoader on the main thread, no asset pipeline URL, no
  worker) sit next to `loadTextureAsync`, which does all of that. `loadTexture` /
  `loadTextures` are on the entry; 3 app scenes use them. D12.
- A10 `[Material Manager]` log prefixes, `@param mat Target material asset.` style.

**Texture arrays and atlases (`TextureArray.ts`, `TextureAtlas.ts`)**

- TA1 **(bug)** `buildTextureArray`'s `build` loads every member with `Promise.all` before its
  `try`: when one fails, the members that loaded are never released (their worker ImageBitmaps
  stay open).
- TA2 **(bug, race)** A queued `setTextureArrayLayer` swap of an array that was deleted meanwhile
  (a scene release) writes into the disposed array: nothing re-checks after the member's `await`.
- TA3 Otherwise well documented (p299's). Undocumented summaries: `BuildTextureArrayProps`,
  `SampleAtlasCellOpts`, `RemapUVsToAtlasCellOpts`; the `"three/tsl".Node` `notExported`.

**The assets API and worker (`AssetsAPI.ts`, `AssetsAPITypes.ts`, `worker/`)**

- AW1 Clean: requests capped and queued, timeouts fall back, late replies free what they carry, a
  failed start never retried, all documented in the file's header. Undocumented: 7 protocol types
  (`AssetsDownProtocol`, `AssetsUpProtocol`, `AssetsProtocolType`, …), the two job functions, and
  `AssetsSourceError`'s constructor.
- AW2 `worker/AssetsWorker.ts`' capability test cites "three 0.183.2" (r186 now: check the test
  still matches GLTFLoader's).

**Import (`kernel/assets/import/`)**

- IM1 **(bug, edge)** `getKTX2Loader` and `getMeshoptDecoder` cache their `import()`'s promise: a
  failed chunk load (a flaky network) poisons KTX2 or meshopt for the rest of the page.
  `GLTFSource.ts`' and `DracoDecoder.ts`' loaders retry.
- IM2 `GLTFTextures.ts`' `applyTexOpts` is `setTextureOpts` done right (`!== undefined`): one of the
  two goes once p302's D1 fixes `setTextureOpts`. `MeshoptDecoder.ts`' comment says the worker
  "can't be code-split" (it is since p607). Undocumented: 11 types (`ImportAssetParams`,
  `ImportedAssetManifest`, `SpawnImportedParams`, … the entry's).
- IM3 Otherwise clean: shared fetches, cached and pending imports, ids reused per source, the
  worker and main thread producing the same manifest.

**PostFX (`features/postfx/`)**

- PF1 **(bug, race)** The `created` hook awaits the chain's files, then builds the chain: a load
  that overlaps it (SL2) builds the old scene's chain after the new scene's `exit` disposed it.
  Goes with D3.
- PF2 Clean and fully documented otherwise; the old `@param id (string)` form; the stale plan
  paths (H1).

**Viewports (`features/viewports/`)**

- VP1 A throw in a viewport's `onBeforeRender` (or its render) leaves the renderer's tone mapping,
  colour space, target and viewport changed for the rest of the frame (no `finally`).
- VP2 The layer's `MutationObserver` on `<body>` is never disconnected (one per page; a mount's
  `unmount()` keeps it).
- VP3 `deleteSceneViewports` has two JSDoc blocks (a stale one above). Undocumented: `Viewport`,
  `ViewportAnchor`, `ViewportProps`, `ViewportRect` (the summaries; the fields are documented).
- VP4 No per-frame allocation; the slot boxes are read only when dirty.

**Across the scope**

- H1 Comments name plan files that are gone: `_DONE_p070_post-fx-system.md`,
  `_DONE_p071_post-fx-debugger-ui.md`, `p080_multi-viewport-rendering-and-axis-gizmo.md`,
  `_DONE_p080_object3d-frustum-culling.md`, `light-culling.md` (in `PostFX.ts`, `PostFXTypes.ts`,
  `Viewports.ts`, `Light.ts`, `LightHelpers.ts`, `Mesh.ts`). A path that leads nowhere says nothing:
  keep what it explained, drop the path. (The same in `ObjectFrustumCullingSystem.ts` and
  `Config.ts` is p612's area, done: left.)
- H2 The pre-p605 tag form (`@param x (type) text`, `@returns (type)`) in most older summaries.
- H3 The `[… Manager]` log prefixes (four modules).
- H4 Positional `world` parameters: required on the light setters, optional on the creators
  (`createXEntity(props, entityOpts?, ecsWorld?)`); kept as the engine's shape (on the entry, the
  Hub's examples), documented.

## 2. Decisions (confirmed 2026-10-15)

### D1. Scope: §1.1's files

`Raycast.ts`, `RayDebugTypes.ts`, `Views.ts`, the `_dbg__` modules and the schemas stay with their
plans. The `_dbg__` modules are touched only where a decision moves code into them (D6) or a
caller changes.

### D2. p302: its rewrites wait, its two bugs are fixed here

p302 is a terrain prerequisite with no date. Bugs A and B are live (B reuses disposed textures on a
revisit), and each fix is a few lines. **Recommended:** fix A (a missing texture input warns and
gets a 1×1 white texture, so the socket keeps a sampler, p302's preferred form) and B (resolve into
the copy, never into the cached params; the `j` loop goes), with p302's revisit check as a test or
a scene runner case, and update p302: its Phase 2 then only adds what's left. Everything else p302
names (the TSL input wrapping, variants, `setTextureOpts`, the texture schema, the scene's texture
list) is documented, not refactored; `createMaterial`'s size (A9) waits for p302's resolver
registry, and the plan says so in the file's header.

### D3. `loadScene`: one at a time, and a failure cleans up

- A call while a load runs waits for it, then runs; a third call meanwhile replaces the waiting
  one (the last request wins, the ones between are dropped and resolve `false`). No load ever
  interleaves with another.
- A failed load undoes what the load started (inputs, pointer events, the loader container and
  group, the debugger, `currentlyLoading`, `isLoading`, `nextSceneId`), in a `finally` that the
  early throws reach too.
- `loadScene` resolves `true` when the scene is current, `false` when it failed or was dropped:
  `Promise<void>` → `Promise<boolean>` doesn't break a caller. It doesn't reject (a rejection
  would fail `InitEngine`'s `start` for a scene error, where today the page stays up).

**Behaviour change, on purpose:** a second `loadScene` during a load used to run at once; now it
waits. The changelog says so.

### D4. The glTF import path loads on demand (p611's recommendation)

`loadNextSceneAssets` imports `import/ImportRegistry.ts` with an `import()` when the scene's data
names an imported asset; `SceneAssetRelease.ts` releases imports only once that module has loaded
(a module-level ref the `import()` sets). `importAssetAsync` and the rest stay on the entry as
they are (an app that calls them imports them). Measured before and after in the banner and the
app (`yarn sbp`); the expected banner initial is about −15 KiB gzip.

### D5. The draggable windows' scene-change handling leaves the loader

Phase 0 measured it: `SceneLoader.ts`' calls to `handleDraggableWindowsOnSceneChangeStart` /
`…End` are what ship `DraggableWindow.ts` in every production build. They become scene hooks
(`exit`, `entered`, and the failed load's end) that the draggable windows add on their first
registration, so the loader names neither; the order inside a load stays (Phase 3 checks it
against today's: after the exit hooks and the groups, after the enter hooks). `HUD.ts` stays (the
boot builds the HUD root). `DraggableWindow.ts` itself is p617's: only its two functions'
callers and a hook registration change here.

### D6. Debug-only camera code leaves `Camera.ts`

`toggleAllCameraHelpers`, `syncCameraHelpersFromLS`, `isAnyCameraHelperVisible` and the debug
camera's LS types move into the camera's `_dbg__` modules (their callers are `_dbg__` modules
already). `cameraDebugGUI` and `Light.ts`' `debugGUI` become `@internal` with their module types
exported `@internal` (the two `notExported`); `debugGUI` is renamed `lightDebugGUI`. Shipping code
keeps only what it calls.

### D7. Dead code goes

Removed (no caller, not on an entry): §1.4's A7 list, SC6's getters, `deleteScene` (SC1: 100 lines
with three bugs and no caller) and the scene resizers (SC2: `createSceneResizer`,
`deleteSceneResizer`, `getSceneResizers` and `MainLoop.ts`' call, the issue file's "Also seen"
closed). `SceneHooks.sceneDeleted` is a member of a public type: it gets `@deprecated` (never
called from this minor, removed in engine 6.0.0), and the sky box's hook goes.

### D8. The scene listeners return their remover

`registerOnSceneEnter`, `registerOnSceneExit`, `registerOnAllSceneEnterings` and
`registerOnAllSceneExits` return a remover (removes the function only if it's still the one under
its key; today they return the function itself, and Phase 2 checks that no caller reads it). A new
`registerOnAllSceneEnters` is the correct name; `registerOnAllSceneEnterings` gets `@deprecated`
(removed in 6.0.0) and the engine, toolkit and app move to the new name. The one-per-key
replacement stays (scene code registers again on every visit) and is documented.

### D9. The loopers keep their signatures

`createSceneMainLooper(looper, sceneId?, isLateLooper?)` and the others are on the entry and in
the Hub's guides; an options object would be a breaking change for little. The three copies become
one internal helper over the three lists, and the JSDoc says what the index is for.

### D10. Renderer: the backend decides the API

After `renderer.init()`, `currentApi` and the two flags are set from
`renderer.backend.isWebGPUBackend`; the dead `antialias: true` default goes (the behaviour stays:
off unless asked for), the LS's `shadowMapType` applies, `setRendererOptions` stops being `async`.
`RendererOptions` stays one type (it's on the entry); the resolved fields get docs saying a caller
doesn't set them.

### D11. Runtime props and their schemas: a type test, not a merge

The runtime types are wider on purpose (they take three's colours, textures, materials and
geometries), so they stay. A type-level test per pair (`LightProps`, `CameraProps` already shares
the schema's, `GeoProps`, `MatProps`, `TextureProps`, `MeshProps`, `SceneData`) checks that the
schema's inferred type is assignable to the runtime one, so a field the JSON allows can't be one
the runtime doesn't take. The two `LightProps` keep their names (one per entry: `aekasha` and
`aekasha/schemas`), each documented as which it is.

### D12. The synchronous texture loaders are deprecated

`loadTexture` and `loadTextures` get `@deprecated` (use `loadTextureAsync`, removed in engine
6.0.0), after A2 and A3 are fixed. The app's three scenes move to `loadTextureAsync`. They move with
`createTexture` into `kernel/assets/TextureSync.ts`, which takes `Texture.ts` under 800 lines.

### D13. `MeshUserData.ts` and its bug go to p614

Phase 0 showed the bug is the two halves of physics' collider derivation disagreeing on the param
names (M1), and the fix belongs in physics' files (`PhysicsEntity.ts`' reader,
`MeshColliderGeometry.ts`' writer). **Recommended:** hand the whole of it to p614 (its Inputs get
M1 and the move of `MeshUserData.ts` into `features/physics/import/`), and leave the file here
documented only. No template scene uses the broken path, so no hash waits on it.

### D14. Versions

Engine **minor** (5.3.0 → 5.4.0): `loadScene` resolves a boolean, `registerOnAllSceneEnters`, the
deprecations (D7's hook, D8, D12), D3's behaviour change. Toolkit **patch** if a toolkit
file moves to `registerOnAllSceneEnters` or loses a removed import; app **patch** (D12's three
scenes, D8's renames). Project = engine.

### D15. No example scene

A review plan adds no feature to show. The Hub's rendering, scenes and assets, and viewports pages
are checked against the code (Phase 8).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs at the end of Phases 3, 5 and 7 and in Phase 9 (snapshots and
hashes unchanged unless a phase says otherwise; no file is edited while it runs). Each phase ends
with its "As built" list, its folders' JSDoc at 100% (exports and members, the H2 form rewritten),
and the updated `docs.json` (`yarn verify:baselines --docs --update`).

### Phase 0: baselines and measurements — done

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `yarn sbp --profile banner --why _engine/ui` and `--why _engine/kernel/assets/import` (D4, D5),
   and the app's numbers for both.
3. Which scenes derive a capsule collider from a mesh (D13), and whether `LI2`'s import cycle is
   still there (`devTools/refactor/layoutReport.md` or a madge-style check of the three files).
4. Record the numbers here and confirm D1-D15.

**As built** (2026-10-15, at `99b58f4`):

- **Scene baselines:** 104 runs recorded (`.cache/verify/scenes/webgpu/`), 407.0 s, exit 0.
- **`yarn verify:baselines`:** all unchanged (`bundle.json`: main chunk 833.9 kB gzip, 168
  modules; `bundle.banner.json` 690.3 kB, 80 modules; `api.json` 2447 exports; `docs.json`
  exports 1707 / 2332, members 330 / 445); no debug code in either production build.
- **What keeps the UI kit in the banner** (`yarn sbp --profile banner --no-build --why <module>`,
  per module of `ui/`): `DraggableWindow.ts`, `Window.ts` and `SvgIcon.ts` through
  `SceneLoader.ts` only; `HUD.ts` and `CMP.ts` through the loader and the boot; `DialogWindow.ts`,
  `DropDown.ts`, `Toaster.ts` and `BuiltInIcons.ts` tree-shaken. Sizes (the app's visualizer data,
  `dist-stats/bundle-stats.html`, before minification): `DraggableWindow.ts` 30.0 kB rendered /
  7.4 kB gzip, `SvgIcon.ts` 0.4 / 0.3, `Window.ts` 0.2 / 0.1, `CMP.ts` 21.6 / 4.8, `HUD.ts` 0.9 /
  0.4. D5 rewritten on it.
- **The import path in the app's main chunk** (same data): `kernel/assets/import/`'s 13 shipped
  modules 37.0 kB rendered / 12.5 kB gzip before minification (`ImportRegistry.ts` 10.5 / 3.1,
  `CustomProps.ts` 5.1 / 1.5, `GLTFExtract.ts` 4.3 / 1.5, …), plus the three classes p611 measured
  in `three.core.js`. D4 stands; Phase 3 measures the result.
- **The capsule collider (D13):** no template asset has a `CAPSULE`, `CONE` or `CYLINDER` collider
  on an imported node, and the code-made ones take the working path; M1 rewritten (the bug is the
  param names, not only the `break`s), D13 hands it to p614.
- **LI2's import cycle** is still there: the wrapper stays.
- **`notExported` in scope:** the three of §1.2, unchanged.

### Phase 1: rendering (`Renderer.ts`, `CanvasSize.ts`, `RenderHooks.ts`, `Snapshot.ts`, `ThreeMath.ts`, `Object3DHelpers.ts`, `LodFade.ts`) — done

1. D10 (R1, R2); R3's docs.
2. N1: the debug helper key into the kernel (`Object3DHelpers.ts`, with `markDebugHelper`'s
   readers), re-exported by `Profiler.ts`.
3. R4: `RENDERER_SHADOW_OPTIONS` into the renderer's `_dbg__` module, `GRAVITY_DOWN_NORMAL` gone,
   `slerp` documented as allocating (renamed `slerpQuat` only if p614 agrees: its one caller), the
   scratch objects `@internal` with a "never across a call" remark; `ThreeQuoternion`'s spelling
   fixed (internal).
4. JSDoc for the folder (our files).

**As built** (one commit per section):

- **Section 1 (steps 1-2):**
  - **D10:** `createRenderer` sets `currentApi` and its two flags from
    `renderer.backend.isWebGPUBackend` once `init()` resolves (unless a `deleteRenderer` came
    first); before that they're the `navigator.gpu` guess, which `onRendererCreated`'s JSDoc says.
    `setRendererOptions` isn't `async`; the dead `antialias: true` default is `false` (the
    behaviour was already off unless asked for).
  - **R2's shadow map type:** the default is `PCFShadowMap` (three r186's own, which a caller that
    didn't pass one got before too) and is always applied, so the Renderer tab's saved value now
    applies in any app, and the tab no longer shows "Basic" while PCF renders.
  - **R3:** `deleteRenderer` clears the canvas parent it kept; `RendererOptions` has a summary and a
    doc per field (the resolved ones say a caller doesn't set them); `getRenderer`,
    `isWebGPURenderer` documented; `getRendererOptions`, `isWebGLRenderer` and
    `createRendererDebugGUI` `@internal` (none is on an entry).
  - **N1:** `DEBUG_HELPER_USER_DATA_KEY` and one predicate, `isDebugHelperObject`, are in
    `Object3DHelpers.ts` (`@internal`); `Snapshot.ts` and the profiler's census use the predicate
    (they had a copy each), `Profiler.ts`' `markDebugHelper` imports the key. `Snapshot.ts` imports
    nothing from `debug/` any more. `Object3DHelpers.ts`' stale `helpers.ts` comment.
  - Left to Phase 8: the rendering guide's "`isWebGPURenderer` tells you which one runs" gets "once
    `createRenderer` has resolved".
- **Section 2 (steps 3-4):**
  - **R4:** `slerp` removed, not renamed: it had no caller (§1.4 was wrong: `PhysicsEntity.ts`
    calls three's `Quaternion.slerp`), so p614 gets nothing. `GRAVITY_DOWN_NORMAL` removed;
    `RENDERER_SHADOW_OPTIONS` moved into `_dbg__Renderer.ts`, its one user. `ThreeQuoternion` is
    `ThreeQuaternion` (`Mesh.ts`, `Group.ts`); the scratch objects, `DIRECTIONS` and
    `LEVEL_GROUND_NORMAL` are `@internal` with a summary (the scratch ones with the "within one
    synchronous call" remark).
  - **Not in the plan, a bug:** `smoothDampVec3` (on the entry) wrote the caller's `target`
    whenever `maxSpeed` clamped (`target.x = current.x - changeX`, never restored). The clamped
    target is in locals now; the result is the same. Its callers are the toolkit's follow camera
    rig, which recomputes `idealPos` every frame, so only an `afterLookAtFn` reading `idealPos`
    after the step sees a difference (the real ideal position now). Tests
    (`kernel/render/ThreeMath.test.ts`, 3): the target untouched under a clamp, no overshoot, the
    speed cap. `getQuatFromAngle` and `smoothDampVec3` documented (its `maxSpeed` before the
    required `deltaTime` stays: on the entry, a `@remarks` says to pass `Infinity`).
  - **Snapshots:** `SnapshotOpts` and `SnapshotBlobOpts` have summaries, `height` and `Snapshot`'s
    fields docs, the old `({@link X})` tag forms rewritten, an `@example` on `takeSnapshotAsync`;
    `readRenderTargetRGBA8Async` `@internal` (the texture preview is its other user).
  - **JSDoc:** `kernel/render` exports 76 / 91 → 90 / 90; `engine/debug` 147 / 200 → 146 / 199 (the
    moved key). `docs.json` updated.
  - **Checks:** lint, `tsc`, `yarn test` (58 files); `yarn verify:scenes --only
    topDownTestScene,thirdPersonGymScene,exampleCharacter` (the rig's scenes, for the
    `smoothDampVec3` fix): 12 passed, hashes and snapshots unchanged (70.1 s).

### Phase 2: scenes (`Scene.ts`, `SceneHooks.ts`, `AppData.ts`, `Group.ts`, `PropertyLoader.ts`) — done

1. D7's scene part (SC1, SC2, SC6), D8, D9 (one looper helper), SC3.
2. G1 (`deleteMeshes` deletes the child's entity, or detaches an unmanaged child without
   disposing what a registry owns; the unread options removed or implemented, Phase 0 decides by
   their callers), G2 (by `userData.entityId`, in the group's world), G3 (one transform-from-props
   helper shared with `Mesh.ts`).
3. G4: the TODO filed or removed; `LoadableProps` documented.
4. Tests: the looper helper (add, delete by index, the current scene's list refreshed), the
   listener removers, `backgroundColor: 0`.

**As built** (one commit per section):

- **Section 1 (step 1, and step 4's tests for it):**
  - **D7 (scenes):** `deleteScene`, `getAllScenes`, `setSceneOpts`, `getCurrentSceneOpts`, the
    three `getScene*Loopers` and the scene resizers (`createSceneResizer`, `deleteSceneResizer`,
    `deleteSceneResizers`, `getSceneResizers`, `MainLoop.ts`' call) removed; the issue file's
    "Also seen" closed. `SceneHooks.sceneDeleted` `@deprecated` (never called), its runner
    `runSceneDeletedHooks` and the sky box's hook gone, with what only they used:
    `isCurrentScene` and the sky box's `getSceneSkyBoxTextureIds`. Not in §1.4, also dead:
    `SceneOptions`' `isCurrentScene`, `mainLoopers`, `mainLateLoopers`, `appLoopers` and `skyBox`
    (its one creator, `registerScenesFromGeneratedData`, passes none) and `createScene`'s
    `isCurrentScene` path. `SceneOptions` and `createScene` `@internal` (on no entry).
  - **D8:** the four listener registries return a remover (one `addListener`); no caller read the
    old return (each a statement). `registerOnAllSceneEnters` on the entry,
    `registerOnAllSceneEnterings` a `@deprecated` alias of it; the engine's 8 callers and the
    app's `_dbg__exampleHub.ts` moved (no toolkit file used it). A run skips a listener another
    one removed during it.
  - **D9:** one `LooperList` per kind and four helpers (`addLooper`, `deleteLoopers`,
    `clearLoopers`, `runLoopers`). Beyond the plan: the indexes no longer restart at 0 when a
    scene's loopers are cleared on its exit (a per-scene `base` moves past them), so an index kept
    from an earlier visit (the character state window keeps one) can't delete a looper of the
    next visit, and an index out of range no longer writes a hole into the list. A run reads its
    list once, so a create or delete during it takes effect next frame.
  - **SC3:** `backgroundColor !== undefined`. **SC6:** `registerScenesFromGeneratedData` not
    `async` (`Boot.ts`' `await` gone); the commented fields, the old-implementation TODO and the
    stale names gone. `getScene`'s two positional booleans stay (on the entry, no decision
    changes them), documented with an `@example`.
  - **JSDoc:** every `Scene.ts` export (`SceneData`'s fields, `Looper`, `@example`s on the entry's
    looper and listener functions), the H2 forms rewritten, everything on no entry `@internal`.
    `kernel/scene` 61 / 88 → 60 / 73 (the rest is `SceneLoader.ts`, Phase 3; `Group.ts` and
    `PropertyLoader.ts`, section 2); `docs.json` not yet updated (end of the phase).
  - Docs: the sky box's `CLAUDE.md` and the root's hook list; `PhysicsEntity.ts`' comment that
    named `deleteScene`.
  - **Tests:** `kernel/scene/Scene.test.ts` (12): the lists apart and only the current scene's
    running, the refresh on create and delete, delete without shifting, an earlier visit's index
    skipped, the loading scene's default, -1 without a scene, the removers (a replacing listener
    kept, one removed mid-run skipped), the deprecated alias, `backgroundColor: 0`.
  - **Checks:** `tsc` (both), the changed files' lint (the whole-repo `yarn lint` ran over 13
    minutes and was stopped), `yarn test` (59 files, 507 passed), the docs ratchet clean.
- **Section 2 (steps 2-3, and step 4's tests for them):**
  - **G1:** `removeFromGroupEntity`'s `deleteMeshes` deletes a removed mesh's entity (in the
    group's world), and only detaches a mesh without one: nothing a registry owns is disposed.
    It has no caller, so the three unread options weren't implemented: `@deprecated` (never read,
    removed in engine 6.0.0; `deleteMeshes` already releases an entity's geometry, materials and
    their textures), not removed (on the entry: a removal would break a caller's types in a
    minor).
  - **G2:** a child's entity is its `userData.entityId` in the group's world, checked against
    that entity's `OBJECT3D` (`getChildEntityId`), in `disposeGroup` and `removeFromGroupEntity`;
    every child leaves the group (not every entity kind's deletion detaches its object).
  - **G3:** `setTransformFromProps` (`kernel/ecs/ECSHelpers.ts`, `@internal`, its own scratch
    Euler and quaternion) for `createMeshEntity` and `createGroupEntity`; `ThreeMath.ts`'
    `ThreeEuler` gone (no user left) and `ThreeQuaternion` private (only its own helper uses it).
    `ThreeVector3` stays exported for `MeshUserData.ts` (D13). The `[Group Manager]` prefixes
    gone; `GroupProps` documented (`rotation` in radians).
  - **Not in §1.4, bugs:** `deleteAllGroupEntities` (every scene exit) deleted persistent groups
    too: it skips `PERSISTENT` ones now. `getGroupByAppId` read entity id 0 as "not found"
    (`if (entityId)`).
  - **G4:** the "load from a file" TODO and its `savedProps = {}` removed: the file layer is the
    gatherer's `__saveData`, already in the props the loader creates from. The cycle through
    `SceneLoader.ts` is gone: the scene id comes from `Scene.ts`' new `getLoadingSceneId()`
    (`@internal`) or the current one, not `getNextSceneId()`. Same scene for every camera and
    light a load creates; after a failed load (SL1, `nextSceneId` left set) it's now the current
    scene's, not the failed one's. `PropertyLoader.ts` ↔ `Camera.ts` / `Light.ts` (the debug GUI
    refs) stay: Phase 4's D6 renames `debugGUI`. Everything in the file `@internal` (on no entry).
  - **JSDoc:** `Group.ts` (`@example`s on the four entry functions) and `PropertyLoader.ts` at
    100%: `kernel/scene` 64 / 74, the 10 left all `SceneLoader.ts`' (Phase 3). `docs.json`
    updated (`kernel/ecs` 81 / 81, `kernel/render` 88 / 88).
  - **Tests:** `kernel/scene/Group.test.ts` (6): the transform props, `objects` and
    `getGroupByAppId`, `deleteMeshes` (a managed mesh's entity deleted, an unmanaged one's
    geometry not disposed), removal by index keeping the entity, a deletion in another world
    leaving the default world's namesake, persistent groups kept.
  - **Checks:** `tsc` (both), the changed files' lint, `yarn test` (60 files, 513 passed), the
    docs ratchet recorded.

### Phase 3: the scene loader (`SceneLoader.ts`)

1. D3 (SL1, SL2, and PF1's re-check), D2's bug B (SL3).
2. D4 (SL4); D5 by Phase 0's measurement (SL5).
3. SL6: `loadScene` split into named steps (start-scene resolution, loader resolution, teardown,
   load, enter) under 150 lines each; the unread option, the dead debug line, the `async`s.
4. SL7: each TODO done, filed, or removed with its reason; JSDoc.
5. Tests: the queue (a call during a load waits, a third replaces the second), a failed load's
   cleanup (inputs, flags), the lazy import loaded only for a scene that names an import.
6. `yarn verify:scenes`, `yarn verify:embed`, `yarn sbp` (D4's numbers recorded).

**As built** (one commit per section):

- **Section 1 (step 1, and step 5's tests for it):**
  - **D3:** `loadScene` returns `Promise<boolean>` and never rejects. One load runs at a time
    (`runQueuedLoadAsync`): a call during a load waits, a later call replaces the waiting one
    (which resolves `false` at once). The waiting load starts as soon as the running one settles,
    before its caller's `await` resumes. A `@remarks` says never to await it from scene code or a
    scene hook (the call would wait for the load it runs in).
  - **The load in four steps** (step 3's split, started here because D3 needed it):
    `resolveLoadTarget` (the start-scene and loader resolution, throws before anything changes, so
    an unknown scene, scene code or loader resolves `false` with the state untouched: it used to
    reject, with `currentlyLoading` and the asset owner left set), `beginLoad` (the state a load
    sets), `runLoadPhasesAsync` (async/await, no `.then` nesting) and `finishLoad`, one end for
    both outcomes. A failed load also undoes the inputs, the canvas's pointer events, the
    debugger, the suspended windows (`handleDraggableWindowsOnSceneChangeEnd(true)`), the loading
    scene id and, beyond D3's list, the asset owner (back to the current scene: registrations
    after a failure were tagged with the failed scene's id, which no later load released). A
    promise chain, not a `try` (the debug-gated calls stay foldable). The settled hooks run for
    every load that began. Not done: a failure's own assets aren't released (the previous scene,
    torn down or not, stays current; the next load releases it as before).
  - **PF1:** nothing to change: with the queue no load's `exit` can run while another's `created`
    hook awaits its files.
  - **Bug B (SL3):** `resolveTextureParams` resolves a material's texture ids into a copy; the
    unused `j` loop is gone.
  - **The mount (not in the plan):** `AekashaMount.loadScene` returns the boolean (`false` after
    `unmount()` and on a fallback handle), and a first scene that fails throws in the mount's
    `start`, so the fallback image shows instead of a dead canvas (before, only a missing scene
    did, by the rejection D3 removed). Phase 8: the embed walkthrough.
  - **Callers (Risk 1):** the debugger's scene list and the on-screen tools' scene switch skip
    while `isCurrentlyLoading()` (unchanged: they never queue); `textureAtlases` /
    `textureArrays`' `leaveTo` and the mount handle queue; `src/index.ts` awaits the first load.
  - **Tests:** `kernel/scene/SceneLoader.test.ts` (5): the queue (B dropped, C after A), a failed
    load's cleanup and the next load after it, an unknown scene and an unknown loader, bug B over
    a revisit (the cached params keep the id, each visit's material gets its own texture).
  - **Checks:** `tsc` (both), the changed files' lint, `yarn test` (61 files, 518 passed).

### Phase 4: cameras, lights, meshes (`Camera.ts`, `Light.ts`, `LightHelpers.ts`, `Mesh.ts`, `MeshUserData.ts`)

1. CA1, CA2 (the active camera keyed to the default world: a camera of another world never becomes
   it), D6, CA4 (`getCurrentCamera*` removed, `setCurrentCamera` through the app id map).
2. LI1 (docs), LI2 (the wrapper kept or removed per Phase 0), LI3.
3. M2, M3; `MeshUserData.ts` documented only (D13).
4. JSDoc for the three folders; tests for CA1 (zoom applied at creation) and CA2.

### Phase 5: asset registries (`Geometry.ts`, `Material.ts`, `Texture.ts`, `TextureArray.ts`, `TextureAtlas.ts`, `AssetFiles.ts`, `AssetOwners.ts`, `AssetUrl.ts`, `SceneAssetRelease.ts`, `Disposal.ts`)

1. A1, A2, A3, D2's bug A (A4), A5 (`decMaterialRef` keeps what `retainedTextures` and the scene's
   background name: the same rule as the scene release), A6.
2. D7's asset part (A7), D12 (with `TextureSync.ts`), A8's types (`Materials` as
   `THREE.Material`, `TextureMapKeys` from `textureMapKeys as const`, one FNV-1a helper in `utils/`),
   a debug warning for a dropped `saveBufferGeometry` argument.
3. TA1 (`Promise.allSettled`, release what loaded), TA2 (re-check the array after the await).
4. D11's type tests (all the pairs, here, as one test file next to the schemas' entry).
5. JSDoc; the `notExported` `"three/tsl".Node` (export the alias `@internal` from
   `three-node-material-helpers.d.ts`, or name three's own type).
6. `yarn verify:scenes` (A2, A5 and bug A can change what a scene shows: any diff explained).

### Phase 6: the assets API, worker and import (`AssetsAPI.ts`, `AssetsAPITypes.ts`, `worker/`, `import/`)

1. IM1 (a failed `import()` is retried by the next call), AW2, IM2's comment.
2. JSDoc: the protocol types, the job functions, the import types on the entry.

### Phase 7: PostFX and viewports (`features/postfx/`, `features/viewports/`)

1. VP1 (`try` / `finally` around the per-viewport render: no allocation), VP2 (disconnected with
   the layer, if the layer can go: check `unmount()`), VP3.
2. H1 for the two folders; JSDoc.
3. The `perf-auditor` agent over `renderViewports`, `getActivePostFxPipeline` and the camera
   resizer (the per-frame code in scope); its findings fixed or listed here.
4. `yarn verify:scenes`.

### Phase 8: the Hub, CLAUDE.md, readme, and what's filed

1. The rendering, scenes and assets, and viewports feature pages and the examples that include
   these files' regions, checked against the code (`loadScene`'s result and queue, the scene
   listeners, `registerOnAllSceneEnters`, the deprecated loaders, the snapshot paths).
2. Root CLAUDE.md: the Bootstrap flow and the data pipeline where D3 and D4 change them, the
   Snapshots section; `readme.md` if its `createSceneLoader` / `loadScene` example changes.
3. The findings this plan files rather than fixes (`docs/issues/` or the other plans' Inputs: p302,
   p614, p617), each named in §1.
4. `yarn hub:build`: no new warning, no dead link; the three `notExported` gone.

### Phase 9: versions and done

1. D14's bumps, a `CHANGELOG.md` entry (D3's behaviour change called out, the
   deprecations with their replacements), `yarn checkVersions --against main`.
2. `yarn test`, `yarn verify:scenes`, `yarn verify:baselines` (no unexplained growth), `yarn build`
   (the SBP budgets: a group budget moved only with its reason, p612's lesson), `yarn hub:build`.
3. Mark the plan done (`docs/plans/CLAUDE.md`), update p302 (bugs A and B done here), p614
   (D13: M1 and `MeshUserData.ts`), p617 (D5's hook in `DraggableWindow.ts`).
4. Time for a PR: this branch into `main` (p600's "Branches and PRs").

## 4. Risks

1. **D3's queue.** Code that relies on a second `loadScene` starting at once (none known; Phase 3
   checks the callers: the debugger's scene list, the scene keys, the mount handle) now waits. The scene runner loads
   scenes one at a time, so its baselines don't move.
2. **D2's bug A.** A material whose texture input is missing renders white instead of failing its
   shader build; a scene that has one today shows it (the warning names it).
3. **D4.** A scene whose imports are listed by id only (`importedAssets: ["id"]`) and loaded by
   another scene still finds the registry: the `import()` runs for either form.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.

## From p611 (2026-10-14)

The embed's seams (p611 Phase 3, D6), each defaulting to the full-page boot's behaviour:

- **The canvas's size source** (`kernel/render/CanvasSize.ts`): `getCanvasSize()` (public) reads the
  window, or a mounted container's box through a `ResizeObserver` (`createElementSizeSource`,
  `setCanvasSizeSource`, `onCanvasResize`, `@internal`). The renderer, the canvas resizer and the
  cameras' aspect read it; the draggable windows and the drawer keep `getWindowSize`.
- **`createRenderer`'s `parent` and `canvas` (`{ id, className, style }`)**, kept out of the
  options it saves to LS; `getCanvasParentElem` returns the parent it used, `getCanvasElem` the
  renderer's canvas.
- **The asset base** (`kernel/assets/AssetUrl.ts`, `@internal`): `setAssetBaseUrl`,
  `getAppBaseUrl` (the app's `aek-assets/`, `basis/`, `draco/`) and `resolveFileUrl` (a file name
  the way three's loaders resolve it), used by `toAppUrl`, KTX2's and Draco's paths, `Texture.ts`
  (the legacy synchronous loads and the cube's `setPath` too) and `GLTFSource.ts`. The debug-only
  Assets tab still resolves against the document. `stopAssetsWorker()` ends the assets worker.
- **The styles:** `ui/styles/page.scss` (normalize, `html`, `body`, `*`, `#mainCanvas`,
  `#guiContainer`) only through `InitEngine.ts`; `index.scss` holds the components' (debugger,
  editor views, icons, stats). The dev server doesn't tree-shake, so an embed served by it still
  gets `page.scss`; a build doesn't.

The lite-renderer study (p611 §7, Phase 5) recommends no second material path now. It measured the
engine's own share of the banner embed, 62.9 KiB gzip over three's WebGPU and TSL alone (300.6 vs
237.7), which helps every profile when it shrinks. This plan's part of it:

- **The glTF import path in every initial chunk:** `SceneLoader.ts` (the scene's
  `importedAssets`) and `SceneAssetRelease.ts` (`releaseImportsOwnedBy`) import `ImportRegistry`
  statically, which brings `kernel/assets/import/` (11.4 kB before minification in the banner,
  which has no model). Measured in a scratch build with both branches folded (p611 Phase 5 §2):
  the banner's initial 300.6 → **285.1 KiB gzip** (`kernel/assets` 23.9 → 13.2 kB, `three.core.js`
  183.4 → 158.9 kB, three's animation tracks `KeyframeTrack`, `PropertyBinding`, `Interpolant` among
  them), and its lazy files 752.9 → 729.3 KiB (`GLTFLoader`, `DRACOLoader` and the meshopt decoder
  no longer named by shipped code, so the embed's prune drops them). **Recommended:** load the
  registry with an `import()` when a scene's data names an imported asset (the load already waits
  for `GLTFLoader`'s chunk and the worker), and make the release a no-op until it has loaded. It
  moves the same bytes out of the app's initial chunk too, into a chunk its first scene
  (`sceneTestECS`, with an imported asset) loads next to its other assets: the app's other users of
  the import API are scene files, lazy already. p612's "From p611" has why this beats a manifest
  fold. (D4.)
- **`three.core.js` extras:** apart from the import path's, `TextureLoader` (`Texture.ts`) and the
  `Raycaster` (`Raycast.ts`, made at module load; p614's file).
- **`three/webgpu` imports:** core classes imported through it keep 79.7 kB of `three.webgpu.js`'
  top-level code. No cost while the renderer is `WebGPURenderer`, but a renderer seam (if a lite
  profile is ever built, §7.3's shape) starts there.
