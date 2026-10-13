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

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
