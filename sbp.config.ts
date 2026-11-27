/**
 * The Smallest Build Possible's profiles (p611 D2): the builds `yarn sbp` measures and the budgets
 * they must stay within (gzip bytes; `devTools/sbp/config.ts`' `SbpBudgets`): the template app,
 * and the embeds (p611 D7), each an entry module the gatherer writes its scenes' data for
 * (`src/generated/profiles/<id>/`) and `yarn sbp --profile <id>` builds into `dist-embed/<id>/`.
 *
 * A budget is the size it was set at plus about 4% (at least 1 KiB), rounded up to a whole KiB.
 * Over it fails `yarn sbp` and `yarn build`: shrink the build, or raise the budget in the same
 * change that explains the growth. Well under it is reported: lower it to the new size plus the
 * same margin.
 */
import fs from 'fs';
import { KIB, type SbpProfile } from './devTools/sbp/config';

/** Every engine feature's group (p607: a folder each in `src/_engine/features/`), so a new
 * feature is budgeted at 0 for the banner too */
const FEATURE_GROUPS = fs
  .readdirSync(new URL('./src/_engine/features/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `_engine/features/${entry.name}`);

const profiles: SbpProfile[] = [
  {
    // The template app: `src/index.html`, every scene
    id: 'app',
    entry: 'src/index.html',
    // Set from p611 Phase 1's report (initial 387.7 KiB gzip); p057 (three r187, `three/tsl`
    // tree-shakeable, unused maths classes dropped) lowered the initial and `assets/index.js` to
    // `suggestBudget` of 369.5 and 365.3 KiB. p372 Phase 3: `merging()`'s JSON, AUTO and scene
    // step took `assets/index.js` to 380.4 KiB: 380 → 381 KiB. p372 Phase 5: the mesh merging
    // example is the first shipping caller of `updateMergeMember` and `removeFromMergeGroup`, so
    // the in-place writes ship (initial 385.8, `assets/index.js` 381.6 KiB): 385 → 386 and
    // 381 → 382 KiB. p374 Phase 2: the kernel's `assetsLoaded` scene hook, `merging()`'s palette
    // guard (its material code is a lazy chunk) and the transfer's integer flag took the initial
    // to 386.0 KiB: 386 → 387 KiB. p374 Phase 3: palette groups (`MergePalettes.ts`, `AUTO`'s
    // palettes, their refusals and warnings) took `merging` 7.1 → 7.7 KiB and `assets/index.js` to
    // 382.6 KiB: 382 → 383 KiB (the initial, 386.8 KiB, stays within 387). p375 Phase 1:
    // `BatchedMesh` (+4.6 KiB of three) ships with `merging()` though only the lazy batch code
    // (`MergeBatch.ts`) names it: its class is a statement of `three.core.js`, one module, and
    // Rollup keeps a module's statements in its chunk, so no `import()` moves it
    // (docs/issues/i130_three-classes-ship-with-their-chunk.md); with `merging`'s growth the initial
    // is 392.8 and `assets/index.js` 388.6 KiB: 387 → 393 and 383 → 389 KiB. p375 Phase 2:
    // per-member LOD in batched groups (S1's scene graph detach, S2's level checks; S3-S4's
    // delegate and LOD-cull hooks are forwarding stubs, the batch side lazy): initial 393.2 KiB,
    // 393 → 394 KiB; with S3's delegate `assets/index.js` 389.1 KiB, 389 → 390 KiB. p377 Phase 3:
    // `streamingGrid`'s ruin kit (96 meshes in 16 cells, their far groups and cells; every
    // scene's JSON is in the first download) took the initial to 397.4 and `assets/index.js` to
    // 393.2 KiB: 394 → 398 and 390 → 394 KiB. p302 (the `setup` graphs, the input resolver
    // registry, the texture ref form) and p299 Phase 5 (the array and atlas forms' predicates and
    // dependency functions, and the kernel's fallback for them; the resolvers are a lazy chunk)
    // took the initial to 398.7 and `assets/index.js` to 394.5 KiB, about 0.5 of each p302's:
    // 398 → 399 and 394 → 395 KiB. p303 Phase 1: the `textureSets()` feature (its resolver,
    // the set lookup and load, 0.7 KiB; the template lists it) took the initial to 399.2 and
    // `assets/index.js` to 395.0 KiB: 399 → 400 and 395 → 396 KiB. p306 Phase 3: the toolkit's
    // terrain block generators registered from `appECSPlugins` (`registerTerrainGenerators`, with
    // the `terrain()` registry it calls; their code is a lazy chunk) took the initial to 400.04
    // KiB: 400 → 401 KiB (`assets/index.js`, 395.8 KiB, stays within 396). p307 Phase 1: the
    // `surfaceConditions()` feature (its state, simulation, uniforms and system, 1.7 KiB; the
    // template lists it) took the initial to 401.3 and `assets/index.js` to 397.1 KiB: 401 → 402
    // and 396 → 398 KiB. p307 Phase 6: the `rainOcclusion()` feature (the rain occlusion map,
    // 1.8 KiB; the template lists it) took the initial to 402.7 and `assets/index.js` to 398.4
    // KiB: 402 → 403 and 398 → 399 KiB. p310 (Phases 2-4): the `terrainShowcase` scene's data
    // (its four blocks' materials, set arrays, scatters and decal sets: 6.5 KiB of the
    // production data's gzip) and the `exampleTerrain` example's (1.5 KiB), with about 1 KiB of
    // other groups' drift since p309's baseline (no engine code of p310's in it), took the initial
    // to 410.3 and `assets/index.js` to 406.1 KiB: 403 → 411 and 399 → 407 KiB. Their code is
    // lazy: the terrain material, the wet response, the scatter and the rocks are chunks of their
    // own. p102: the physics world bounds (`physics`' 1.5 KiB below) took the initial to 412.5 and
    // `assets/index.js` to 408.2 KiB: 411 → 413 and 407 → 409 KiB. The light receiver fixes
    // (i090, i100: the frustum culling system's receiver pass, the static cells' and pools' flags,
    // `instancing` +143 B, `kernel/ecs` +127 B, `spatial` +51 B) and i110's release of a failed
    // load's assets (`kernel/scene` +123 B) took the initial to 413.01 and `assets/index.js` to
    // 408.8 KiB: 413 → 415 and 409 → 410 KiB (at least 1 KiB over each). p500: physics
    // snapshots (`physics`' 0.9 KiB below) took the initial to 414.0 and `assets/index.js` to
    // 409.8 KiB: 410 → 411 KiB (the initial stays within 415). p250 Phases 1-2: multibody joints
    // (`PhysicsMultibodyJoints.ts`, the registry's and the tiers' multibody handling; `physics`
    // +880 B) took the initial to 415.4 and `assets/index.js` to 411.2 KiB: 415 → 417 and
    // 411 → 413 KiB (at least 1 KiB over each). p106 Phase 1: the `fog()` feature (its state,
    // stable uniforms, graph and background system, 1.0 KiB; the template lists it) took the
    // initial to 416.4 and `assets/index.js` to 412.2 KiB: 417 → 418 and 413 → 414 KiB (at least
    // 1 KiB over each). p106 Phases 2-3: `updateFog` and the fog's sky sources (`fog` +0.3 KiB)
    // and the sky box's `getSkyHorizonColor` with its layers' CPU twins (`skybox` +0.5 KiB, the
    // app wires it) took the initial to 418.3 and `assets/index.js` to 414.1 KiB: 418 → 420 and
    // 414 → 416 KiB (at least 1 KiB over each). p106 Phase 7: zod (19.4 KiB) and
    // `_engine/schemas` (1.4 KiB) were in the first download, through the fog's runtime importing
    // `FogSchema.ts`; with its defaults moved out (`FogDefaults.ts`) the initial is 419.4 and
    // `assets/index.js` 415.2 KiB, within both. p392 Phase 1: the template lists `text()` (p391's
    // font load and the texts' install with the `TEXT` hooks, `_engine/features/text` 1.9 KiB;
    // `createText`, the handle and the layout ship only with a caller), with `assets/index.css`'
    // drift since its baseline (+0.5 KiB, no text CSS), took the initial to 421.4 and
    // `assets/index.js` to 416.7 KiB:
    // 420 → 423 and 416 → 418 KiB (at least 1 KiB over each)
    budgets: {
      initial: 423 * KIB,
      chunks: {
        'assets/index.js': 418 * KIB,
        // p613 D5: the draggable windows' styles left with the windows. p801: the UI kit's design
        // tokens (`ui/styles/tokens.css`, in every build) took it from 0.9 to 2.3 KiB. p808
        // Phase 8: 4 → 6 KiB (`suggestBudget` of 4.2 KiB): the game HUD example's minimap is the
        // first shipping caller of `createViewport` (the debug gizmo and ball were the only ones),
        // so the viewports' slot styles (`Viewports.module.scss`) ship with the feature
        'assets/index.css': 6 * KIB,
        // p250 Phase 0: Rapier 0.19.3 → 0.21.0 (multibody joints that don't panic on a delete,
        // i250's panic fixed) took it from 810.2 to 1605.2 KiB, its WASM's new soft bodies, convex
        // decomposition and compound shapes included (0.20.0 was ~1085 KiB): 843 → 1670 KiB
        // (`suggestBudget`)
        'assets/rapier.js': 1670 * KIB,
        // The physics worker's own file (`assets/PhysicsWorker.js` is its 0.1 kB `?worker` wrapper)
        'assets/PhysicsWorker.js@PhysicsWorker': 11 * KIB,
        'assets/AssetsSwitchGLTF.js': 53 * KIB,
      },
      // Set from p619's report (the modules minified, a group's code gzipped per chunk; three
      // 254.5 KiB, physics 23.5 KiB); p057 lowered three to `suggestBudget` of r187's 239.3 KiB
      groups: {
        three: 249 * KIB,
        // p102: `suggestBudget` of 2.7 KiB (2,766 B), reported well under 5 KiB
        '_engine/features/character': 4 * KIB,
        // p354: the instance sets' front (createInstanceSetAsync, on the entry; its backends are
        // lazy) took it to 3.9 KiB in Phase 1, and Phase 3's `maxSlots` option to 4.0 KiB (4,102 B):
        // 4 → 5 KiB, for Phase 5's removeInstances / setInstanceMatrices on the front too.
        // i090 / i100: the static cells' and pools' light receiver flags took it to 4.97 KiB
        // (5,087 B, 33 B under): 5 → 6 KiB
        '_engine/features/instancing': 6 * KIB,
        '_engine/features/lines': 6 * KIB,
        '_engine/features/lod': 7 * KIB,
        // p372 Phase 1: the merge groups' API, hooks and build system (1.9 KiB gzip, two modules);
        // the merge itself (`GeometryMerge.js`) loads with the first build. Phase 2's in-place
        // updates took it to 2.8 KiB, Phase 3's `merge` queue, AUTO buckets, scene settings and
        // scene step to 6.0 KiB (8 modules): 3 → 6 KiB. Keep `instanceof` of three classes out
        // (MergeEligibility.ts): `BatchedMesh` shipped with it for +4.6 KiB
        // Phase 5: 6.0 → 6.9 KiB, `MergeRanges` and `MergeInPlace` in full once the example
        // calls `updateMergeMember` and `removeFromMergeGroup` (only the debug-only
        // `testDebugScene` did): 6 → 7 KiB
        // p373: 7.0 KiB (7,173 B): Phase 1's debug figures and Phase 2's A/B fold away, but the
        // edit sessions' two guards ship (`applyBuild`, `restoreEnabledMember`: a member in a
        // session stays collapsed), 3 B over 7 KiB with Phase 2's growth. The sessions themselves
        // (`MergeMemberEdit.ts`) are tree-shaken unless an app calls them: 7 → 8 KiB
        // p375 Phase 1: 7.7 → 8.9 KiB (10 → 12 modules): the `BATCHED` mode, its refusals,
        // `AUTO`'s batched key, the builds' dispatch (`MergeBuild.ts`) and the batch code's loader,
        // leave and visibility hooks (`MergeBatchFront.ts`); the batch code is a lazy chunk: 8 → 9
        // KiB
        // p375 Phase 2: 8.9 → 9.2 KiB: S1's scene graph detach of a batched member's mesh, S2's
        // LOD level checks at a join and the later-LOD hook; S3-S4 add the LOD delegate's and the
        // LOD-cull hooks' forwarding stubs (the batch side is in the lazy batch chunk): 9 → 10 KiB
        '_engine/features/merging': 10 * KIB,
        // p102: the world bounds (`PhysicsWorldBounds.ts`, 1.2 KiB: the scene's and entities'
        // bounds applied in the held scene load, the worker's out-of-bounds records handled every
        // step, so not lazy) took it 24.7 → 26.2 KiB (26,822 B): 25 → 27 KiB. p500: physics
        // snapshots (`takePhysicsSnapshot`, `restorePhysicsSnapshot` on the entry, the restore's
        // entity follow-up: reaped entities, static bodies' sync, tiers) took it to 27.1 KiB
        // (27,784 B, +962 B): 27 → 29 KiB (at least 1 KiB over). p250 Phases 1-2: multibody
        // joints took it to 28.0 KiB (28,664 B, +880 B), within 29
        '_engine/features/physics': 29 * KIB,
        '_engine/features/postfx': 3 * KIB,
        '_engine/features/skybox': 19 * KIB,
        '_engine/features/spatial': 7 * KIB,
        // p353 Phase 1: the cells, the state machine and code content (3.2 KiB gzip, six modules;
        // the template lists every feature, so it's in the first download). Phase 2's priming
        // (1.4 KiB, needed by every streaming scene in play) and Phase 3's data-unit barrier took
        // it to 5.5 KiB: 5 → 6 KiB. Phase 3's JSON cell content loads on demand
        // (`StreamingDataContent.js`, 0.8 KiB, only for a scene with a cell manifest). Phase 5's
        // layers took it to 6.7 KiB, so the machine loads on demand with the first scene that
        // streams (`StreamingCells.js`, `StreamingLayers.js`, `StreamingPriming.js`, with the
        // bodies' chunk: 7.4 KiB): the first download is the API and the scene hooks, 2.3 KiB.
        '_engine/features/streaming': 4 * KIB,
        // p303 Phase 1: the `{ textureSet }` resolver, `getTextureSet` and the packing load
        // (0.7 KiB gzip, three modules). p304 Phase 4 section 3: the scene hook that starts a
        // scene's procedural set bakes (`import()` of `TextureSetBakes.js`, 3.6 KiB with the
        // set arrays' chunk, lazy; the baker with it) took it from 976 B to 1090 B: 1 → 1.25 KiB
        '_engine/features/texturesets': 1.25 * KIB,
        // p306 Phase 2: only the factory and its install (0.1 KiB gzip, one module); the spawner,
        // the generator registry and the collider load with the scenes that spawn blocks
        '_engine/features/terrain': 1 * KIB,
        // p307 Phase 1: the surface conditions' state, transitions, wet / dry simulation, stable
        // uniforms and system (1.7 KiB gzip, three modules); its debug tab is a lazy chunk. p307
        // Phase 6: the `rainOcclusion()` feature in the same folder (the map's render, its node,
        // its options' checks; the template lists it) took it to 3.6 KiB: 2 → 4 KiB
        '_engine/features/surface': 4 * KIB,
        // p106 Phase 1: the fog's state, stable uniforms, graph (LINEAR, EXP2) and background
        // system (990 B gzip, three modules; `suggestBudget`); Phase 2's HEIGHT factor, sun glow
        // and tweens and Phase 3's sky sources add to it, Phase 7 revisits it. Phase 2 (HEIGHT,
        // the glow, `updateFog` and its transitions, four modules) took it to 2.0 KiB: 2 → 3 KiB.
        // Phase 3's sky sources took it to 2.3 KiB, Phase 4's debug overrides and factor node to
        // 2.4 KiB, and Phase 7's `FogDefaults.ts` (the defaults and the resolve, out of the zod
        // schema's module) to 2.8 KiB in five modules, within 3
        '_engine/features/fog': 3 * KIB,
        '_engine/features/viewports': 3 * KIB,
        // p613 D4: the glTF import path loads on demand (`ImportRegistry.js`). p302 (12 → 15
        // modules: the material code split up, the resolver registry, the input refs) took it to
        // 13.5 KiB, p299 Phase 5's input forms and fallback to 13.7 KiB: 13 → 14 KiB. p308 Phase 2
        // moved the glTF extraction out of the main chunk (`lod()` reached it through
        // `getGLTFPrimitiveKey`), 11.8 KiB: 14 → 13 KiB
        '_engine/kernel/assets': 13 * KIB,
        '_engine/kernel/ecs': 9 * KIB,
        '_engine/kernel/input': 9 * KIB,
        '_engine/kernel/scene': 6 * KIB,
        // p613 D5: the draggable windows load only where they're used. p803 Phase 8: 5 → 7 KiB
        // (`suggestBudget` of 5.4 kB): the app's scene loader is the kit's loading overlay
        // (`src/index.ts`), with its spinner, its progress bar and their styles; every scene's
        // first load shows it, so it can't load later
        '_engine/ui': 7 * KIB,
        // p354 Phase 1: 14 → 15 KiB (14.06 KiB): the `instanceStress` verification scene's data
        // (every scene's JSON is in the first download; its code loads with it, `instanceStress.js`).
        // p377 Phase 3: 15 → 19 KiB (18.0 KiB): `streamingGrid`'s ruin kit, kept to 16 cells for it.
        // p310: 19 → 27 KiB (25.9 KiB): `terrainShowcase`'s data (6.5 KiB) and `exampleTerrain`'s
        // (1.5 KiB)
        app: 27 * KIB,
        toolkit: 7 * KIB,
      },
      modules: {
        // The built-in icons register only in the debug env (p611 D10)
        '_engine/ui/core/icons/BuiltInIcons.ts': 0,
        '_engine/ui/core/icons/svg/': 0,
        // p804 D12: the form fields load with the scenes that make them (the UI kit example's
        // settings and form), never in the first download
        '_engine/ui/forms/': 0,
        // p805 D13: the data display loads with what shows it, as the forms do
        '_engine/ui/data/': 0,
        // p808 D12: the game UI loads with the scene that makes it (the game HUD example), and
        // the device tracker only with an app that calls it
        '_engine/ui/game/': 0,
        '_engine/kernel/input/InputDevice.ts': 0,
      },
    },
  },
  // The banner profile's history: p611 D8 and Phase 4, p057, p613 D4-D5, p619, p801, p308, p808 D12
  // #region banner-profile (shown in the Hub: hub/pages/features/smallest-build/)
  {
    // The banner embed: one code-made scene, no feature, built into dist-embed/banner/
    id: 'banner',
    entry: 'src/app/profiles/banner/banner.embed.ts',
    scenes: ['banner'],
    // Set from the profile's first report (initial 300.6 KiB gzip): the measured floor; three r187
    // lowered the initial, the shared chunk and three to `suggestBudget` of 265.8, 263.7 and 231.1
    // KiB
    budgets: {
      initial: 277 * KIB,
      chunks: {
        // The entry only re-exports `mount` from the shared chunk
        'banner.embed.js': 2 * KIB,
        'assets/banner.embed.js': 275 * KIB,
        // The draggable windows' styles left with the windows; the UI kit's design tokens took it
        // from 0.1 to 1.5 KiB
        'assets/banner.css': 3 * KIB,
      },
      // Set from the report of the modules minified (the workers' code included), as the app's
      groups: {
        three: 241 * KIB,
        // The glTF import path loads on demand (`ImportRegistry.js`). The import extension member
        // for GPU instances (`spawnInstances`) took it 22 B past 11 KiB: 11 → 12 KiB
        '_engine/kernel/assets': 12 * KIB,
        '_engine/kernel/ecs': 8 * KIB,
        '_engine/kernel/scene': 5 * KIB,
        // The draggable windows load only where they're used
        '_engine/ui': 5 * KIB,
        app: 2 * KIB,
        // The floor's promise: no feature reaches the initial chunks
        ...Object.fromEntries(FEATURE_GROUPS.map((group) => [group, 0])),
      },
      modules: {
        // No game UI and no device tracker in the floor
        '_engine/ui/game/': 0,
        '_engine/kernel/input/InputDevice.ts': 0,
      },
    },
  },
  // #endregion banner-profile
  {
    // The UI kit in an embed (p801 D9): one code-made scene that opens a window with a button and
    // its tooltip, a toast, a dialog with a small form (p804 D12), a data window (p805 D13) and a
    // game window (p808 D12), no feature, built into dist-embed/uiKit/; `yarn verify:embed` checks the kit's sizes and
    // bounds in it
    id: 'uiKit',
    entry: 'src/app/profiles/uiKit/uiKit.embed.ts',
    // Not `uiKit`: a scene file named like the entry would emit a second `assets/uiKit.css` (its
    // chunk's styles), which no file key tells apart from the entry's
    scenes: ['uiKitEmbed'],
    // Set from p801 Phase 3's report (initial 285.8 KiB gzip): the banner's floor, the kit lazy;
    // p803 Phase 7 checked each against `suggestBudget` (initial 286.3 KiB): only the scene's two
    // chunks changed; p057 (three r187) lowered the initial, the shared chunk and three to
    // `suggestBudget` of 265.2, 263.1 and 230.0 KiB
    budgets: {
      initial: 276 * KIB,
      chunks: {
        // The entry only re-exports `mount` from the shared chunk
        'uiKit.embed.js': 2 * KIB,
        'assets/uiKit.embed.js': 274 * KIB,
        'assets/uiKit.css': 3 * KIB,
        // The scene's chunk: the kit's window, dialog, toaster, tooltip and button and their
        // styles, loaded with the scene: what a HUD of those costs an app (p800 D10). Set by p803
        // Phase 7 from `suggestBudget` (17.9 KiB: the overlay layer, the windows' keys and ARIA,
        // the searchable drop-down and the toaster's live regions from Phases 4-5; the button's
        // 1.8 KiB with its Kbd and key names from Phase 7). p804 Phase 7: 19 → 18 KiB (16.0 KiB:
        // the drop-down went into the dialog's form, below)
        'assets/uiKitEmbed.js': 18 * KIB,
        // The same pieces' styles, from `suggestBudget` (3.6 KiB: the button's 1.0 of it; the
        // drop-down's went with it)
        'assets/uiKitEmbed.css': 5 * KIB,
        // p804 D12: the dialog's form, a module its first open imports (`uiKitEmbedForm.ts`): a
        // property grid of a slider, a number field, a checkbox, a select (the drop-down) and a
        // colour field, with the binding, the scheduler and the field shell they share: what a
        // small form costs on top of the HUD. From `suggestBudget` (17.2 KiB)
        'assets/uiKitEmbedForm.js': 19 * KIB,
        // Its styles (3.8 KiB)
        'assets/uiKitEmbedForm.css': 5 * KIB,
        // The colour picker (`vanilla-colorful`'s HSVA picker), loaded on the colour panel's
        // first open (p804 D8, D12): 2.7 KiB, its budget `suggestBudget`'s at least 1 KiB over
        'assets/hsva.js': 4 * KIB,
        // p805 D13: the data window, a module its button's first press imports
        // (`uiKitEmbedData.ts`): tabs of a sortable, selectable table, a list with an action per
        // row, and a stat tile with a sparkline: what a few data pieces cost on top of the HUD.
        // From `suggestBudget` (19.3 KiB). p808 Phase 8: 21 → 20 KiB (18.6 KiB): the announcer and
        // the roving focus went into a chunk the game window shares (below)
        'assets/uiKitEmbedData.js': 20 * KIB,
        // Its styles (3.9 KiB)
        'assets/uiKitEmbedData.css': 5 * KIB,
        // The binding scheduler, which the form's fields and the data window's collections share
        // (a collection imports it for its `scheduler` prop), so the build makes it a chunk of
        // its own: 0.8 KiB, from the form's chunk (p805 Phase 7)
        'assets/BindingScheduler.js': 2 * KIB,
        // p808 D12: the game window, a module its button's first press imports
        // (`uiKitEmbedGame.ts`): a health bar, a hotbar of item slots with cooldowns, a
        // notification feed and an input prompt (with the gamepads' glyphs, 1.5 KiB of it): what
        // a small game HUD costs on top of the kit's HUD. From `suggestBudget` (7.6 KiB)
        'assets/uiKitEmbedGame.js': 9 * KIB,
        // Its styles (2.6 KiB)
        'assets/uiKitEmbedGame.css': 4 * KIB,
        // The announcer and the roving focus, which the hotbar and the data window's list and
        // table share, so the build makes them a chunk of their own: 1.2 KiB (p808 Phase 8)
        'assets/Announcer.js': 3 * KIB,
      },
      groups: {
        three: 240 * KIB,
        // p308's import extension member for GPU instances, as the banner's: 11 → 12 KiB
        '_engine/kernel/assets': 12 * KIB,
        '_engine/kernel/ecs': 8 * KIB,
        '_engine/kernel/scene': 5 * KIB,
        // The HUD root and CMP only: the components load with the scene
        '_engine/ui': 6 * KIB,
        app: 2 * KIB,
        // No feature reaches the initial chunks, as for the banner
        ...Object.fromEntries(FEATURE_GROUPS.map((group) => [group, 0])),
      },
      modules: {
        // p804 D12: the form fields load with the dialog's form
        '_engine/ui/forms/': 0,
        // p805 D13: the data display too: its data window loads it
        '_engine/ui/data/': 0,
        // p808 D12: the game UI too: its game window loads it; the device tracker isn't called
        '_engine/ui/game/': 0,
        '_engine/kernel/input/InputDevice.ts': 0,
      },
    },
  },
];

export default profiles;
