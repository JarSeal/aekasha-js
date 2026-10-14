Status: stub — not-implemented
Category: Refactoring, Documentation, Rendering, Assets
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md

# Review: Rendering, Scenes and Assets — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- The renderer, `Scene.ts`, `SceneLoader.ts` (4 TODOs), `GroupManager`, `CameraManager`, `LightManager`, `MeshManager`.
- Geometry, material, texture, texture arrays and atlases, the assets API and worker, `Import/` (15 files).
- PostFX, viewports, snapshots, the property loader.
- **Leaves what p302 rewrites** (`p302_material-and-texture-system-refactor.md`, the terrain epic): those files are only moved and documented, not refactored, if p302 hasn't landed.

## Inputs

- p302, p600 §2.
- p605 Phase 5's `notExported` warnings in scope (`yarn hub:build` lists each with its file and line; export the type with a summary or change the signature): `CameraGUIModule` and `LightGUIModule` (the `_dbg__` modules' types behind the exported `cameraDebugGUI` / `debugGUI` refs) and `"three/tsl".Node` (our `types/three-node-material-helpers.d.ts`, named by `sampleAtlasCell`).

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
  fold.
- **`three.core.js` extras:** apart from the import path's, `TextureLoader` (`Texture.ts`) and the
  `Raycaster` (`Raycast.ts`, made at module load).
- **`three/webgpu` imports:** core classes imported through it keep 79.7 kB of `three.webgpu.js`'
  top-level code. No cost while the renderer is `WebGPURenderer`, but a renderer seam (if a lite
  profile is ever built, §7.3's shape) starts there.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
