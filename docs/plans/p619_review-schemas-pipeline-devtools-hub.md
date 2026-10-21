Status: draft | not-implemented (expanded 2026-10-21, decisions to confirm)
Category: Refactoring, Documentation, Dev tooling
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p601_refactoring-safety-net-tests-and-baselines.md (the runner, the baselines, the light issue path), \_DONE_p602_architecture-and-target-structure.md (D3: the API reference on the entries), \_DONE_p605_coding-standards-and-documentation-tooling.md (the Zod JSDoc rule, the search index cut), \_DONE_p606_layering-inversion-and-public-entry.md (D3: TypeDoc on the entries left here), \_DONE_p608_engine-folder-restructure.md (D6: the devTools' deep imports; D7: the API URLs), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (`yarn sbp`), \_DONE_p612_review-ecs-loop-config-init.md (`ComponentDataMap`, the runner's reloads, the group sizes, the chunk keys), \_DONE_p613_review-rendering-scene-assets.md (D11: the schema / runtime type pairs, `ColorJSON`, `PostFxSchema.ts`), \_DONE_p614_review-physics.md (`CharacterBrainKinds`; D8: the proxy types), \_DONE_p618_review-debug-public-api.md (the plan this one follows; D3: devTools-only names off the entries), p302_material-and-texture-system-refactor.md (D1: named texture constants, D5 below), p620_review-toolkit-and-app-code.md (the toolkit's three leaked types, D6), p622_engine-6-major.md

# Review: Schemas, Data Pipeline, Dev Tools and Hub Generator

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to the asset JSON schemas
and to the dev tooling: the data pipeline (the gatherer), the asset pipeline, the dev file
server, the Hub generator and the verify commands. It records the findings per file group and
fixes or files them. Two structural items come with it: the Hub's API reference moves from source
modules to the public entries (p602 D3, left here by p606 and p608), and the devTools' deep
imports into the engine get a rule (p608 D6).

The tooling has no per-frame code, so p600 §5's performance item reads here as build and
dev-server time.

## 1. As found (2026-10-21, `main` at `baac01e`, after p618's merge, Engine 5.9.0)

### 1.1 The stub's scope, checked

| Stub | Now |
| --- | --- |
| "`schemas/` (19 files, 38 of 154 exports documented, 57 Zod-inferred types with 1 comment)" | 17 modules + 2 tests, 1,995 lines. `docs.json`: **47 / 121** (p605's Zod plugin counted 13 aliases as documented and removed the `*Schema` constants' own entries). Members 0 / 0: the inferred types are type aliases, so their fields aren't counted. The feature schemas (`features/{lod,skybox,postfx,spatial}/*Schema.ts`) are their features' (p613, p615, p616) and at 100 %. |
| "`devTools/gatherAppData.ts`" | 1,774 lines; `gatherSceneData` alone 1,288 (§1.4 G). Next to it, the gather's own modules: `gatherOutput.ts`, `engineSchemas.ts`, `sceneGathererPlugin.ts`, `assetOutputsBuildPlugin.ts`, `copyDecoders.ts`, `projectMetadata.ts`; and `checkVersions.ts`, `tagRelease.ts`. |
| "the asset pipeline (`devTools/assetPipeline/`)" | 28 files, 7,029 lines, plus `assets.ts`, `setupAssetTools.ts`; and `schemas/AssetsConfigSchema.ts` (454). No unit test. |
| "the dev files server" | `devTools/devFiles/` (7 files, 1,463 lines) and `devFilesPlugin.ts`; the protocol `debug/DevFilesProtocol.ts` (the client is p618's). No unit test; its self-check script isn't run by anything (§1.4 F1). |
| "the Hub generator (`devTools/hub/`)" | 38 files, 7,838 lines, plus `hubPlugin.ts`, `hubBuild.ts`, `hubPreview.ts` and the browser search `hub/_assets/ts/_search.ts`. `api/render.ts` is 1,211 lines. |
| "`devTools/verify/` (p601)" | 17 files, 2,947 lines. `scenes.ts` 839. `devTools/sbp/` (20 files, 2,435) isn't named but owns two of the Inputs (§1.2), and the two folders import each other. |
| "The Hub's API renderer adapted to the entry points (p602 D3)" | Not started: TypeDoc's entry points are still every source file (`typedocOptions`, `index.ts` excluded), and the pages are per module (§1.4 R). |
| Not named | `devTools/refactor/` (22 files, 6,593 lines): p602's move map and p608's codemod. Every one of the 813 map entries is a keep since p609, and `moveMap.ts --check` exits 1 on `main` (§1.4 X). |

### 1.2 The stub's inputs, checked

- **The search index** (p605 Phase 5): 1,776,765 B raw, 409,334 gzip (`dist-hub/` of
  2026-10-21). The stored `path` is 250,862 B, not 130 kB, over 376 page paths. §1.4 Q has the
  measured cuts: no low-risk cut takes it under 1 MB raw.
- **`ComponentDataMap`'s and `CharacterBrainKinds`' `notExported`:** both still in p618 Phase
  6's `yarn hub:build`, with `UnionToIntersection` and `SeededRandom.ts`' `{@link getRandomStream}`
  (p621's input). The search index warning is the fifth.
- **The scene runner's mid-run reloads** (p612 Phases 2-3): not reproduced since. §1.4 V3 has
  three causes consistent with "no file touched" and a fix.
- **`yarn sbp`'s group sizes before minification** (p612 Phase 8): confirmed. They come from
  rollup-plugin-visualizer's `gzipLength` of each module's rendered, unminified code, and the data
  holds lengths only, so the report can't minify afterwards. The app's groups sum to 832.0 KiB
  "gzip" against a real initial download of 379.2 KiB. §1.4 B1.
- **`keyFiles`' numbered chunk keys** (p612 Phase 8): confirmed, and the swap has happened. The
  committed `bundle.json` holds the worker's `EngineRapier` copy (36,634 B) under
  `assets/EngineRapier.js`, while today's `dist/` sorts the main build's (35,913 B) to that key.
  The same pairing breaks `sbp.config.ts`' `'assets/PhysicsWorker.js'` budget. §1.4 B2.
- **p613 D11's schema / runtime type swaps** (`schemas/RuntimeTypes.test.ts`): all four still
  there. `TexOptsSchema`'s constants are plain numbers and `image` is `unknown`. The light shadow
  tuples are `z.array().length(n)`, and a spot light's `map` is `string | unknown`. Materials are
  one object with a `type` enum, against the runtime's member per type. A scene's inline `meshes`
  and `importedAssets` are `record<string, unknown>`. **p302 D1** adds named enums for the texture
  constants (`"wrapS": "REPEAT"`), so tightening them to numbers here would be rewritten there
  (D5).
- **`ColorJSON`:** on no entry, named by `LightProps`' colours, `SceneData.backgroundColor` and the
  sky box. It is a union, `string` (hex) or `{ r, g, b }` (0-255).
- **`PostFxSchema.ts`' two comments** cite `_DONE_p070` and `_DONE_p071`, both gone.
  `_HelperSchemas.ts`' `ecsFrustumCullingEnabled` cites `_DONE_p080` (gone) and `meshSchema.ts`
  (now `MeshSchema.ts`).
- **`UnionToIntersection`** (`FeatureSchemas.ts:24`): still module-private, named by
  `FeatureSchemaShape`.
- **From p601 (not in the stub):** a light's bad field is reported on `lightProps` alone. Still
  true. A plain `z.union` reports a literal `type` mismatch at `['type']`, not at the root, so
  `expandUnionIssues` (`gatherAppData.ts:147`) sees all five branches as "matching" and can't
  narrow. A `z.discriminatedUnion` fixes it without touching the gatherer (D5).
- **From p608 D6 (not in the stub):** "the devTools keep their deep relative imports … moving them
  to the entries is p619's". About 30 imports (§1.4 I). The blockers p608 named (`LodChainGLTF`,
  `GeometryTransfer`) no longer hold: their names are on `aekasha/lod` and `aekasha`.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports | Members |
| --- | ---: | ---: |
| `engine/schemas` | 47 / 121 | 0 / 0 |
| `engine/utils` | 41 / 45 | 4 / 6 |

- **`schemas`:** the 74 undocumented are listed in `docs.json`. Of the 121, 53 are imported by
  nothing outside `schemas/` (§1.4 S6). Only 3 shape keys in the kernel's schemas have JSDoc, so
  the zod-expanded fields read "No description" on the API pages. The asset pipeline's
  `AssetsConfigSchema.ts` has `.describe()` on most fields but no JSDoc on any key.
- **`utils`** (`HALF_PI`, `QUARTER_PI`, `FOUR_PX_TO_8K_LIST`, `StorageValue`, two constructors) is
  in no review plan (p621 notes it), and p621's done criterion is 100 %.
- The devTools aren't in the documented API (TypeDoc reads `src/_engine` and `src/toolkit`), so
  their bar is p600 §5's "a summary on every export" without a ratchet.

### 1.4 Findings by file group

Numbered for the phases. Tags: **(bug)** wrong behaviour, **(loss)** deletes or overwrites data,
**(sec)** reachable from another device or page, **(race)**, **(perf)** build or dev-server time;
the rest is API shape, placement, size and hygiene. Read from the code by five read-only review
passes (2026-10-21); the ones marked ✔ were rechecked by hand. Phase 0 reproduces the rest
before fixing.

**Schemas (`src/_engine/schemas/`)**

- S1 The type swaps and the light issue path (§1.2).
- S2 Hand-copied override schemas: `CameraOverridesSchema` repeats every camera field,
  `GeoOverridesSchema` every geometry param. A field added to the props misses its overrides.
  Light's overrides spread the variants' shapes instead.
- S3 `DebugDataSchema` and `EntityDebugDataSchema` are the same object. `MaterailBaseProps` is
  misspelled. `z.any()` in `MaterialSchema.ts` (three's params) and in the scene's `comments` /
  `todo`. `MetaSchema.date`'s error message reads "UNIX tracking sign".
- S4 The scene schema's `AssetReferenceOrInline` lets any object through as an inline mesh or
  import (§1.2).
- S5 `SpatialDomainSchema.ts` repeats `DEFAULT_SPATIAL_DOMAIN` "so the schemas don't import the
  engine": still true and fine (a schema imports no feature code). Documented, not changed.
- S6 53 exports nothing imports outside `schemas/`. Of them, 13 schema constants and types are
  imported by nothing at all (`TextureCodecSchema`, `MeshSettingsSchema`, `AssetBudget`,
  `PackTarget`, …). The rest are building blocks the sibling schemas share.
- S7 Comments: §1.2's stale plan paths. `AssetsConfigSchema.ts:3-8`'s file header sits on
  `TextureCodecSchema`, so it is that export's doc. The `rdo` describe says "1 for normal / ORM /
  data", but the `data` slot's default codec is `none`.

**The data pipeline (`gatherAppData.ts` and its neighbours)**

- G1 **(bug)** ✔ A duplicate id (any type) is logged and skipped, but `hasError` stays false, so
  the gather "succeeds". For scenes it's worse: pass 2 re-reads every scene file, and the later
  file wins silently.
- G2 **(bug)** ✔ A malformed asset JSON (`catch { logJSONError }`, 12 places) is dropped without
  failing the gather. The `catch` also swallows every other throw in the loop body under "invalid
  or empty". With no `awaitWriteFinish` in the dev watcher, an editor's half-written save can drop
  an asset and reload the page without it.
- G3 **(bug)** ✔ `compileJsonSchemas()` runs at module load (`:444`). It rewrites the 14 tracked
  `.schemas/*.json` on every import: each Vite config load, each `vite build` (each SBP profile),
  the dev files' commit, `yarn assets`, and `gatherAppData.test.ts` (a test writing repo files).
  `copyDecoders.ts:86` copies at load the same way.
- G4 **(bug)** ✔ `gatherOutput.ts` quotes an id only when it starts with a digit (`toKey`), and a
  scene key not at all. An id with `-`, `.` or a space writes invalid TS. A file path with `'`
  breaks the `import()`.
- G5 **(bug, latent)** A scene's own `__saveData` is validated but never applied in pass 2, and
  ships in the output. Production strips `debugData`, then spreads a save entry over it, which can
  bring it back (textures, materials, PostFX, imports). No repo JSON triggers either today.
- G6 **(bug, low)** `cameras: []` gets no auto camera (a missing key does). Every non-TSL material
  ships `nodes: {}`. Debug scenes' TSL material and PostFX loaders ship in production builds (a
  lazy chunk each).
- G7 **(perf)** Each dev save re-reads, re-parses and re-validates every asset JSON. That's 13
  `filter` passes over the tree, scenes parsed twice, and `includes` on id arrays. Every gather
  rewrites the generated files even when nothing changed, which reloads open pages (and is one of
  V3's causes).
- G8 `engineSchemas.ts`' `ENGINE_SCHEMA_PARTS` is kept by hand, and zod strips unknown keys. A new
  feature part missing from it drops that feature's scene fields from the generated data
  silently. Its exported `SceneAsset` / `MeshAsset` clash with the engine's names.
- G9 `sceneGathererPlugin`: a burst straddling the end of a run becomes two gathers. A failed
  pipeline start doesn't mark the gather failed. Its `configureServer` is 181 lines.
- G10 **(size)** `gatherAppData.ts` 1,774 lines: `gatherSceneData` 1,288, its scene pass 394. The
  12 pass-1 loops are copies of one read → validate → id → register sequence.
- G11 Small ones: `projectMetadata.ts`' two missing `?.`; `checkVersions`' bump rules untested and
  tangled with git; `getBasePath` dead branch and separators; `p112` cited in a user-facing
  warning (`:259`).

**The asset pipeline (`devTools/assetPipeline/`)**

- A1 **(loss)** ✔ `yarn assets`' prune runs unless a result is `status: 'error'`. Without `ktx`,
  an asset whose key missed comes back `encoderMissing` (or `skipped` for an array or atlas slot)
  with no output. `removeStaleOutputs` then deletes its committed output and `cache.prune()` its
  lock entry. Worst case: a clone without `ktx` after a `PIPELINE_VERSION`, ktx, sharp or
  gltf-transform bump. Every key misses, and `yarn assets` deletes every committed output and
  every lock entry, which that machine can't rebuild.
- A2 **(loss)** An asset JSON that fails its schema (a typo mid-edit), a source that doesn't
  resolve, or an array or atlas whose layout fails is dropped before the run, so the prune deletes
  its outputs too. The gather that runs after fails, but the files are already gone.
- A3 **(race)** `removeStaleOutputs` against a dev server in another process deletes its
  `*.<pid>.tmp` files mid-write, and outputs encoded under keys this run never saw. `cache.save()`
  merges the lock without a lock.
- A4 **(bug)** ✔ A public file name like `/..%2F..%2Fx.png` escapes `src/public/`. `new URL()`
  normalises before `decodeURIComponent`, so the output's logical path holds `../..` and
  `writeOutput` writes outside `aek-assets/`. A stray `%` throws a `URIError` that aborts the run.
- A5 **(bug)** The `importedAsset` cache key lacks `three`'s version, though `LodSimplify` welds
  with three's `mergeVertices`. `writeOutput` never rewrites a present file of the wrong size. The
  `ktx` install's temp folder leaks on a throw, and two installers race. `spawnSync` / `execFile`
  of `ktx` have no timeout, so a hung `ktx` blocks the dev server's queue.
- A6 **(bug, medium confidence)** `gltfJson.ts`' `hasColliderNodes` reads node extras only, but a
  glTF mesh's extras reach `userData` too. A `colliderType` authored on the mesh gets quantized and
  reordered (breaks a HEIGHTFIELD).
- A7 **(size)** `pipeline.ts` `runAsset` 222 lines, `textureAtlases.ts` `encodeTextureAtlasSlot`
  180. `phase1Variants.ts` (855) and `p299ArraySpike.ts` are scene fixture generators (the
  `assetCompare` and `textureArrays` scenes load their outputs), not pipeline library code.
- A8 **(perf)** Each GLB's JSON is read twice per run, every source byte is re-hashed by every
  gather (the key memo is per process), and the source walk includes `src/public/aek-assets` and
  `src/generated`.
- A9 No unit test. About 25 pure functions (the settings resolver, the cache key, the packer, the
  atlas layout, alpha coverage, `getKtxCreateArgs`' byte-critical argument order, the archive
  readers) and a golden-hash test that would catch a forgotten `PIPELINE_VERSION` bump.

**The dev file server (`devTools/devFiles/`, `devFilesPlugin.ts`)**

- F1 **(bug)** ✔ The self-check's save scene is `./scene01.ts` (`selfCheck.ts:51`), moved to
  `scenes/scene01/` by p609. Its two save-entry checks time out and fail. Nothing runs it (no
  script, hook or CI), which is how it went unnoticed.
- F2 **(sec)** ✔ `isLoopbackHostName` treats any name starting `127.` as loopback, so
  `Host: 127.attacker.com` passes. For dev files writes it isn't exploitable today: the token is
  only in `index.html`, which Vite's own host check refuses. The Hub's dev routes use the same
  check (`hubPlugin.ts:385`) and serve pages carrying the HMR token.
- F3 **(sec, medium confidence, to reproduce)** The allowed extensions admit `package.json`,
  `tsconfig.json`, `jsconfig.json` anywhere under the roots. A write of
  `src/app/x/package.json` with a `"prettier"` key makes the next commit into that folder load the
  named module through Prettier's `resolveConfig` (code execution in the dev server). With
  `AEK_DEV_FILES_LAN=true` any LAN device can write (the LAN mode has no authentication beyond
  the token every LAN page gets).
- F4 **(sec, low)** "Local" means a loopback socket, so a localhost tunnel (ngrok, VS Code
  forwarding) makes every client local once its host is in `allowedHosts`.
- F5 **(race)** The conflict hash is checked before Prettier, temp writes and backups, and an
  editor save in between is overwritten. `createStage` empties the shared stage folder on every
  server start, so a second server (the self-check's, `dev:https`) breaks the first's staged
  commits. `MAX_FILE_BYTES` is checked after formatting, so a 100 MB body is formatted first.
- F6 Small ones: a dangling symlink answers 500 instead of `FORBIDDEN_PATH`; `sceneId: 'toString'`
  reads an inherited property; the client's missing hash header becomes `BAD_REQUEST` instead of
  `CONFLICT`; `NOT_FOUND` means both a missing file and an unknown route; the protocol summary
  lacks `historySize`; `checkHostAndOrigin` is generic but lives in `devFiles/` (the Hub uses it).

**The Hub generator (`devTools/hub/` without `api/`, the plugin, build and preview)**

- H1 **(loss)** ✔ `yarn hub:build --out <dir>` takes any path, and a public build then runs
  `fs.rmSync(outDir, { recursive: true, force: true })`. `--out .` deletes the repo. The `rmSync`
  also runs before `copyHubEmbeds` and `writeImages` can still fail, so "any error writes nothing"
  (CLAUDE.md) isn't true: a failure leaves a half-written `dist-hub/`.
- H2 **(bug)** `hubPreview.ts` dies on a malformed escape or `%00` (uncaught in the handler), binds
  every interface while logging localhost, and has no stream error handler. The shell's
  `{{constructor}}` / `{{toString:x}}` hit `Object.prototype` (`key in`). A `%` in an `api:` or
  `repo:` link throws the whole build instead of a diagnostic. Two issue files that slug alike
  overwrite each other.
- H3 **(race)** Edits during the dev plugin's first build are lost (the watchers start after it).
  A request waits through every queued rebuild. Editor temp files reload every tab. The `fs.watch`
  isn't closed in middleware mode. Removed static assets keep being served.
- H4 **(perf)** A one-page edit in dev redoes everything: sass, a Vite `build()` of the TS, shiki
  over every fence, image hashing, minisearch over 4,080 documents, three git processes and about
  380 page writes. CLAUDE.md's "tens of ms" is stale.
- H5 **(size)** `buildHub` 321 lines, `hubPlugin`'s `configureServer` 259.
- H6 About 73 citations of the deleted p550-p555 (§ numbers), one in a user-facing warning
  (`build.ts:486`). `formatBytes` labels KiB as kB. 14 runtime exports nothing imports. The
  directive registry is filled by side-effect imports (`import './cards'`, which is why
  `package.json`'s `sideEffects` lists `./devTools/**`).

**The Hub's API reference (`devTools/hub/api/`)**

- R1 **Per module, not per entry** (§1.1). The model holds 2,512 exports in 322 modules, and 838
  names are on the 16 entries (281 on `aekasha`). Each module gets a page, so every internal export
  has one too, and an `api:` link or `{@link}` to an internal name resolves.
- R2 **64 internal types named by public exports** (a walk of the model, 2026-10-21), invisible
  today because each has a module page. With per-entry pages each one is a dead link. 19 are
  physics (`WorldAPI`, `ColliderAPI`, `JointAPI` — `getPhysicsWorld()` returns a type
  `aekasha/physics` doesn't export — `PhysicsState`, the config enums on `AppConfig`), 5 character,
  5 sky box, about 18 kernel (`ECSStorageMode`, `ViewCameraRig`, `ImportExtension`, …), 7 schemas
  (`ShadowQuality`, `DebugData`, `TextureAtlasSlotInfo`, …), 3 toolkit, and the `ComponentDataMap`
  members. TypeDoc's `notExported` can't see them: it checks against every module, not the
  entries.
- R3 `ComponentDataMap` and `CharacterBrainKinds` (§1.2): a reference to an interface merged by
  `declare module 'aekasha'` points at the merged symbol, which has no reflection.
- R4 **(size)** `render.ts` 1,211 lines: pages, symbol rendering and the search documents in one
  file.

**The search index (`search.ts`, `searchProtocol.ts`, `_search.ts`)**

- Q1 Measured (§1.2): stored fields 59 % of the raw size (API summaries 330 kB, page text 245 kB
  stored whole although the dialog shows 180 characters, `path` 251 kB, `anchor` 116 kB), the
  inverted index 35 %. Gzipped, 409 kB.
- Q2 The cuts, measured by rebuilding the index:

  | # | Cut | Raw | Gzip | Risk |
  | --- | --- | ---: | ---: | --- |
  | 1 | The document id carries `<path index>#<anchor>` (a path table); `path` and `anchor` not stored | −304 kB | −19 kB | low |
  | 7 | No stored summary on module documents (each repeats its first symbol's) | −32 kB | −3 kB | low |
  | 9 | No stored page `heading` (read from `hub-data.js`' headings) | −9 kB | small | low |
  | 2 | Page text stored clipped to 400 characters (still indexed whole) | −115 kB | −38 kB | medium: a match past 400 characters shows the section's start unmarked |
  | 4 | Summaries clipped to 80 characters, not 120 | −45 kB | −12 kB | medium |
  | 10 | No class member documents | −308 kB | −30 kB | high: a feature lost |

  1 + 7 + 9 give about 1.43 MB raw. Under 1 MB raw needs cut 10.
- Q3 `hub-data.js` (61.6 kB, 14 kB gzip) is loaded by every page, but only the search reads it
  (`nav`, `pages`).

**The verify commands (`devTools/verify/`)**

- V1 **(size)** `scenes.ts` 839 lines, `runOne` 189. `void main()` at load makes its pure logic
  untestable.
- V2 **(bug)** An unreadable or other-format baseline reads as "no baseline", so every run is NEW
  and exits 0. `baseline.json`, `last-run.json` and the committed baselines are written in place.
  `readInputScript` exits mid-run without writing the run or closing the browser. A scene renamed
  in the data silently loses its `scenes.config.ts` entry. `VITE_APP_ENV=production` in the shell
  makes every page wait 120 s for a bridge that never installs.
- V3 **(race)** The mid-run reload (§1.2), three causes:
  1. A new bare import found at runtime re-optimizes deps, and Vite sends a `full-reload` once.
  2. The runner shares `node_modules/.vite` with every `yarn dev*`. `dev:https` adds a plugin,
     which changes the config hash and re-optimizes under it.
  3. Any gather rewrites the generated files (G7), and nothing accepts them, so the page reloads.

  `logLevel: 'warn'` hides Vite's "optimized dependencies changed. reloading" line.
- V4 **(race)** No timeout on the snapshot, path and system order `evaluate`s. A hung SwiftShader
  readback hangs the run.
- V5 `verify:embed`: fixed port 8093, the ready wait outside the scenario's `try`, fixed 400 ms
  settles before draw checks.
- V6 `systemOrder.ts` doesn't see a system registered twice (`includes`). `moduleSideEffects.test.ts`
  still carries the empty `NOT_YET_INSTALLED` machinery. `debugInProduction.ts`' fixtures use
  `core/Debug/`.
- V7 **The worker builds aren't measured:** the visualizer runs in the main build only (no
  `worker.plugins`), so a debug module inside the physics or assets worker is caught only by its
  file name or the `onDebug(` text. verify/CLAUDE.md's "a debug module with rendered code in any
  chunk" overstates it. The SBP lazy groups miss the workers' code the same way.

**`yarn sbp` (`devTools/sbp/`; correctness and §1.2's two items only)**

- B1 The group sizes (§1.2). Design from the review: a `moduleSizesPlugin` (build, `post`) that
  minifies each chunk's module code with esbuild and writes per-group minified bytes and the gzip
  of each group's concatenated minified code (`dist-stats/module-sizes.json`). Also in
  `worker.plugins` (V7). About 1-2 s per build. Upper bounds from esbuild: `kernel/ecs` 16.3 →
  ≤ 8.4 KiB, physics 41.6 → ≤ 27.9.
- B2 The chunk keys (§1.2). Design: a base held by one file keeps it. In a collision, the
  manifest's chunk keeps the plain base, a worker build's copy gets `@<worker>`, found from the
  `?worker` wrappers and a text crawl (`embedBuild.ts`' `findReachableFiles`, shared). Manifest
  files with the same base get `@<source folder>` (the two Draco folders). An ambiguous key throws,
  never a hash order.
- B3 **(bug)** A `groups` budget key matching no group measures 0 and always passes, and so does a
  `modules` path that doesn't exist. A typo checks nothing.
- B4 `buildAppBundle` has no caller. A failed build's `closeBundle` masks its error. The dev
  gather in `finally` can replace the build's error. `verify/` and `sbp/` import each other both
  ways.

**`devTools/refactor/`**

- X1 Dormant: `applyMoveMap.ts`, `moveApply.ts`, `moveSplit.ts`, `moveText.ts`, `moveEdits.ts`,
  `moveJson.ts`, `moveTree.ts`, `compareBaselines.ts`. About 3,160 lines plus 1,570 of tests, run
  by `yarn test` on every Stop hook. `compareBaselines.test.ts` re-verifies p608's move commit from
  git history, and `moveTree.test.ts` reads all 1,484 tracked files (366 MB) for a skipped test.
- X2 Live: `importGraph.ts` (`verify/baselines.ts` imports it), `moveRules.ts` + `moveMap.ts` (the
  layout as rules and its report), `migrateToEntries.ts` + `entryImports.ts` (shipped to apps by
  the migration guide, and p622 wants "a codemod as p606's").
- X3 ✔ `moveMap.ts --check` exits 1 on `main`: `layoutReport.md` and `entryExports.json` are out
  of date. CLAUDE.md's "`moveMap.ts` fails on a file outside them" holds only when someone runs it.

**The devTools' imports from `src/` (I)**

- I1 Schemas (gatherer, asset pipeline): every name is on `aekasha/schemas`, imported by deep path
  (`schemas/CameraSchema`, …). `engineSchemas.ts` already imports the entry file by relative path.
  The bare alias isn't known to resolve in Vite's bundling of `vite.config.ts` (Phase 0 checks).
- I2 The gatherer's non-schema values: `isLegacySkyBoxProps`, `LEGACY_SKYBOX_WARNING`,
  `mergeSkyBoxPreset` (sky box), `getImpostorDefSlots`, `IMPOSTOR_EXPORT_FORMAT_VERSION` (LOD),
  `deepMerge` (`aekasha`). Their entries load the whole feature (three/webgpu, TSL) into the Vite
  config process; their modules are already in the schemas entry's import graph, `deepMerge` aside.
- I3 The asset pipeline's LOD values (`resolveLodChainOptions`, `GLTF_LOD_FORMAT_VERSION`,
  `LOD_SIMPLIFY_VERSION`) from the import-free `LodChainOptions.ts`. `lodChains.ts` imports the
  assets worker's `LodChainGLTF` (three/webgpu) for one string constant.
- I4 `DevFilesProtocol.ts` (import-free for Node by design) and the test bridge types, by path.
  p618 deprecated their devTools-only names on `aekasha/debug` (D3 there), so by path is the
  intended route.
- I5 Type-only: `AppConfig` (`kernel/config/Config`), `TransferableAttribute`.

**Hygiene across the tooling**

- K1 About 15 `eslint-disable` lines without `-- reason` (mostly file-wide `no-console`), and 5
  `no-unused-vars` on rest-omit destructures. No `any`, no `@ts-`, no TODO in scope (one implicit
  `any` from `JSON.parse` in `phase1Variants.ts`).
- K2 `const fail = (…): never =>` doesn't narrow, so callers add `as string` and `!`. The function
  form (`function fail(…): never`) does.
- K3 `ROOT` is defined in four places (`assetPipeline/sources.ts`, used by 15 unrelated modules;
  `hub/paths.ts`; two spike scripts). `sha256`, `stableStringify` and the git helpers are
  duplicated.
- K4 The devTools' promise-returning functions don't end in `*Async`. The coding standard names
  the engine, the toolkit and the app (D11).

## 2. Decisions (to confirm)

### D1. Scope

- **Full review (p600 §5):** `src/_engine/schemas/`; the data pipeline (`gatherAppData.ts`,
  `gatherOutput.ts`, `engineSchemas.ts`, `sceneGathererPlugin.ts`, `assetOutputsBuildPlugin.ts`,
  `copyDecoders.ts`, `projectMetadata.ts`, `checkVersions.ts`, `tagRelease.ts`); the asset
  pipeline (`assetPipeline/`, `assets.ts`, `setupAssetTools.ts`); the dev file server; the Hub
  generator with `api/`, the plugin, build, preview and `_search.ts`; `verify/`.
- **Correctness and §1.2's items only:** `devTools/sbp/` (B1-B4), `devTools/refactor/` (D9).
- **Added:** `engine/utils`' four exports and two members (§1.3: no plan has them, p621 needs
  100 %).
- **Not in scope:** the feature schema files' fields (their features' plans did them), the debug
  client of the dev files (p618), the toolkit's three leaked types of R2 (p620's input), the Hub's
  hand-written pages beyond what a change here touches (p621).

### D2. Versions

- **Engine minor** (5.9.0 → 5.10.0): names added to entries (D5's `ColorJSON`, D6's leaked types,
  D8's helpers on `aekasha/schemas`), the schema types tightened (D5).
- **Toolkit:** none expected (R2's three are p620's).
- **App patch** only if an app file changes (G6's fixes may change no app file).
- **Project:** the devTools, in `CHANGELOG.md`'s Project section.

### D3. Behaviour changes, and what waits for engine 6.0.0

Nothing is removed from an entry, so nothing waits for p622. The behaviour changes, each in the
changelog:

- The gather now fails on a duplicate id, a malformed asset JSON (G1, G2) and an invalid inline
  mesh or import in a scene (D5). Today each is a log line and a reload.
- `yarn assets` refuses to prune after an incomplete run (A1, A2).
- The API URLs move to the entries (D6).
- `yarn sbp`'s group numbers and budgets change (D12).

### D4. The bugs first, with tests

The loss and security items first, each with a Node test that fails before the fix:

- **A1, A2:** the prune runs only when every selected asset has an output or a cache hit, and
  nothing was dropped. `collectPipelineAssets` returns what it dropped. Anything else keeps the
  outputs and says why.
- **A3:** a run lock file (`.cache/asset-pipeline/run.lock`, `O_EXCL`) held by the prune and
  `save()`, which the dev plugin waits on. The prune skips `*.tmp` and files newer than the run.
- **A4:** the public branch checks containment, as the relative branch does. A `URIError` is that
  asset's error.
- **H1:** `--out` refuses the repo root, any ancestor of it, `src/` and a non-empty folder that
  isn't a Hub output. The public build writes into `<out>.tmp-<pid>` and renames it over `<out>`
  only when nothing failed.
- **F1:** the self-check uses a scene file it owns (a fixture in its temp root) and runs as
  `yarn verify:devFiles`, named in `devFiles/CLAUDE.md`.
- **F2:** loopback only for `localhost`, `*.localhost` and loopback IPs (`net.isIP`).
- **F3:** reproduced first in a temp folder, never under `src/`. Then the server refuses the
  config basenames (`package.json`, `tsconfig.json`, `jsconfig.json`, `.prettierrc*`), and
  `resolveConfig` resolves against the repo root's config only.
- **F4:** a request with `Forwarded`, `X-Forwarded-For` or `Via` isn't local, documented.
- **Then the rest:** G1-G6, A5, A6 (after Phase 0 confirms GLTFLoader's extras), F5, F6, H2, H3,
  V2, V4, V5, V6, B3, B4, each with its test where Node runs it.

### D5. The schemas

- **Discriminated unions** for lights, cameras and geometries (`z.discriminatedUnion('type', …)`).
  The light issue lands on `lightProps.intensity` (p601's test tightened). The JSON Schemas change
  `anyOf` to `oneOf`.
- **Materials:** one variant per `type` literal, built from the two type lists (TSL with
  `tslFile`, non-TSL without), so the inferred type is the runtime's member per type. The
  `PerType` swap leaves `RuntimeTypes.test.ts`. Phase 0 checks the JSON Schema it writes stays
  usable in the editor (25 variants).
  - **Alternative:** keep the object with an enum, plus the test's swap.
- **The light tuples** become `z.tuple`, and a spot light's `map` `z.string()` (a texture id). Both
  swaps go.
- **`TexOptsSchema`:** `image` is dropped from the JSON schema, since a JSON can't hold one. The
  runtime's `TexOpts` is its own type. The constants stay numbers here: p302 D1 adds the named
  enums, and its plan gets a "From p619" note. The test keeps that swap, commented as p302's.
- **Inline scene entries:** `createSceneAssetSchema(parts)` validates an inline mesh with the mesh
  schema composed from the same parts, and an inline import with `ImportedAssetSchema`. Phase 0
  lists what the repo's scenes hold inline and what the gatherer accepts. The test's import pair is
  added.
- **Overrides derived from the props** (`.partial()` over the variants' shapes, as lights do)
  instead of the hand copies (S2). `EntityDebugData` becomes an alias of `DebugData`. The typo and
  the message are fixed (S3).
- **`ColorJSON` on `aekasha/schemas`**, with a summary (the runtime types name it). The schemas'
  other names R2 lists (`ShadowQuality`, `DebugData`, `TextureAtlasSlotInfo`,
  `SceneSpatialDomainEntry`, `CoreEntityOptsSchema`'s type, `FeatureSchemaShape`) are decided in
  D6's pass.
- **Exports (S6):** the 13 that nothing imports are no longer exported. The shared building
  blocks stay exported, `@internal`, each with a summary naming its user. `UnionToIntersection` is
  exported `@internal`.
- **Docs:** every export at 100 %. JSDoc on every shape key (the API pages' field tables). A
  one-line `.describe()` on every field authored in a JSON file, so the generated JSON Schemas'
  editor tooltips change. §1.2's stale citations are replaced by what they explained.

### D6. The API reference per entry (R1-R4)

- **The model stays per source file.** TypeDoc converts every source module once, as today. The
  renderer builds the public reference from the entries: each entry file's named re-exports
  (`collectEntries`' parse) map to their source reflections. `api.json`'s modules and the docs
  ratchet stay per folder, so the 1,674 internal exports keep their summaries enforced.
  - This differs from p602 D3's wording ("TypeDoc's entry points become the entry files"). With
    the entries as TypeDoc's entry points, the internal exports leave the model, and the ratchet
    and `notExported` lose them.
  - **Alternative:** TypeDoc on the entry files, as p602 D3 says, with a second ratchet over the
    internal exports from the TS AST.
- **Pages:** one per entry at its import specifier: `documentation/aekasha/`,
  `documentation/aekasha/physics/`, `documentation/aekasha/toolkit/ecs/`. On it, a section per
  source module (its summary and path), each export as today's h3, the entry's coverage at the
  top. An entry over 150 names (only `aekasha`, 281) gets a page per source folder below it
  (`documentation/aekasha/scene/`, …), and its page lists the folders.
- **Internal exports have no page.** A `{@link}` to one renders as code with a warning, as three's
  do. An `api:` link to one fails with "not on an entry". The A-Z index and the search hold public
  names only.
- **R2's check:** a public export whose signature names a type no entry exports warns at its line.
  Each of the 64 is decided in Phase 5: added to its entry with a summary (the default, eg.
  `WorldAPI`, `ColliderAPI`, `JointAPI`, `PhysicsState`, the `AppConfig` enums), or the signature
  changed not to name it. The toolkit's three go to p620's Inputs.
- **R3:** `extract.ts` maps a reference to an interface merged by `declare module 'aekasha'` to
  the engine's declaration's reflection (a post-conversion pass, tested). Both warnings go.
- **URLs change again, without redirects** (p608 D7's reasoning). This is the layout the entries
  keep. The 30 `hub:documentation/…` links are rewritten. The `api:` links mostly stand: names are
  unique across entries, `createSeededRandom`'s deprecated toolkit re-export aside.
- **`render.ts` splits** into pages (`render.ts`), symbols (`renderSymbol.ts`) and search
  documents (`apiSearch.ts`).
- `yarn docs` (TypeDoc's own theme, the fallback) stays per module.

### D7. The search index

- The warning measures gzip, as `yarn sbp` does: over 450 kB (409 today).
- **Cuts 1, 7 and 9** (Q2), with a build → `loadJS` → search round-trip test.
- `hub-data.js` keeps the index URL only; `nav` and `pages` move into the lazily loaded search
  payload (Q3), saving 61.6 kB on every page.
- **Alternative:** also cut 2 (−38 kB gzip, a late match shows the section's start unmarked).

### D8. The devTools' imports from the engine (I1-I5)

The devTools are tools, not app code. They import the engine by path, under one rule that a test
keeps:

- **Schemas and what tools need to read the asset JSONs:** from the schemas entry file
  (`src/_engine/schemas/index.ts`, by relative path; or the alias, if Phase 0 finds it resolves in
  Vite's config bundle). `aekasha/schemas` is "the asset JSON schemas, for tools", so the
  gatherer's sky box and impostor helpers go on it (I2: five names, the two legacy ones already
  `@deprecated` until 6.0.0). `deepMerge` moves into the sky box schema's own save merge
  (`applySkyBoxSaveEntry`).
- **Import-free modules no entry should carry:** `DevFilesProtocol.ts`, `LodChainOptions.ts`, the
  test bridge types, by path. `GLTF_LOD_EXTRAS_KEY` and its type move into `LodChainOptions.ts`
  (I3).
- **Types:** `import type … from 'aekasha'` (erased, safe in the config bundle).
- **`devTools/engineImports.test.ts`:** every devTools import from `src/` is on that list (the
  schemas entry, the named import-free modules, type-only entry imports), so a new deep import
  fails the test with the rule.

### D9. `devTools/refactor/` (X1-X3)

- The dormant codemod and `compareBaselines` go, with their tests (§1.4 X1). The last commit that
  has them is named in `CHANGELOG.md`, for p800's possible move.
- `importGraph.ts`, `moveRules.ts` and the layout half of `moveMap.ts` move to `devTools/layout/`.
  The layout check becomes a Vitest test (every file under a rule, no kernel runtime import of a
  feature, no feature cycle), so CLAUDE.md's "fails on a file outside them" holds in `yarn test`.
- The report becomes on demand: `npx tsx devTools/layout/layoutReport.ts` writes
  `.cache/layout/layoutReport.md`, which isn't committed. `entryExports.json` (p606's input, unread
  since) goes.
- `migrateToEntries.ts` and `entryImports.ts` stay (in `devTools/layout/`), as p622's codemod
  base.
- **Alternative:** keep everything, refresh the two outputs, and add `moveMap.ts --check` to the
  Stop hook.

### D10. Size

- `gatherAppData.ts` splits into `devTools/gather/`: types and validation, log, sources, the
  pass-1 registries (one generic reader for the 12 loops), textures and atlases, the scene pass,
  the ship checks. `gatherAppData.ts` keeps the orchestration (about 150 lines). The log text and
  pass order stay. `gatherSceneData` takes `isProduction`, `srcDir` and `outDir`, so the gather
  becomes testable.
- **Split by their parts:** `buildHub`, `hubPlugin`'s run state machine (`createHubDevRunner`),
  `sceneGathererPlugin`'s queue, `scenes.ts` (CLI, run, baseline), `runAsset`,
  `encodeTextureAtlasSlot`, the self-check's two functions.
- `phase1Variants.ts` and `p299ArraySpike.ts` move to `devTools/assetPipeline/fixtures/`, headed
  as their scenes' fixture generators.

### D11. Hygiene

- K1: every `eslint-disable` gets its reason. `ignoreRestSiblings: true` on `no-unused-vars`
  (`eslint.config.js`, the whole repo; a warning rule) replaces the five rest-omit disables.
- K2: `function fail(…): never` and the casts it needed go.
- K3: one `devTools/paths.ts` (`ROOT`), one `sha256`, one `stableStringify` in `utils/` (the
  engine's two copies too), one git helper.
- **Comments:** the p550-p555, p101 and p112 citations are replaced by what they explained. A
  plan id stays only where it's history.
- **Dead exports** removed (§1.4 H6, A, F, B4).
- **K4: no renaming pass.** The `*Async` rule stays the engine's, toolkit's and app's; new devTools
  code follows it.

### D12. `yarn sbp` (B1-B3)

- B1's plugin in both the main and the worker builds. `bundle.json`'s groups become
  `{ modules, minified, gzip }` (`BUNDLE_FORMAT_VERSION` 2), and the report's format 3.
- `sbp.config.ts`' `groups` and `modules` budgets are re-set from the first new report, and the
  "a group counts its comments" notes go. `initial` and `chunks` don't change.
- B2's keys come in the same format bump. `bundle.json` and `bundle.banner.json` are re-recorded in
  that commit, and the `'assets/PhysicsWorker.js'` budget is renamed to the worker's key.
- B3: `checkSbpProfiles` refuses a `groups` key that names no possible group, and a `modules` path
  that doesn't exist.
- V7: the debug check reads the worker modules from the same data.

### D13. The scene runner (V1-V6)

- **V3:** the runner's server gets its own `cacheDir` (`node_modules/.vite-verify`), and
  `vite.config.ts` gets `optimizeDeps.entries` covering the worker entries (the hand-kept
  `include` list goes if the scan finds them). Vite's optimize and reload lines go to the progress
  log. A page that navigates mid-run is rerun once in a fresh context, with a note. The generated
  files are written only when changed (G7). The run warns when `generatedAppData.json` changed
  under it.
  - **Alternative:** `optimizeDeps.force` on every run (a few seconds per run) instead of the
    entries.
- V2, V4, V5, V6 as §1.4. The runner's server binds `localhost`.

### D14. Tests (Node)

- `devTools/devFiles/*.test.ts`: the path check, the host and origin checks (F2's case), the
  request parse, the save entry write (trim, unchanged, inherited ids), the commit's rollback with
  faults.
- `devTools/assetPipeline/*.test.ts`: A1-A4, the settings resolver, the cache key, the atlas
  layout, the packer and alpha coverage on synthetic images, `getKtxCreateArgs` (snapshot), the
  archive readers, a golden hash over a tiny resize, pack and coverage.
- `devTools/gather/*.test.ts`: G1-G6 on an in-memory tree (D10's options), `expandUnionIssues`,
  the stale save data warning.
- `devTools/hub/*.test.ts`: `resolveHubRoute`, H1's guard, the shell, the snippets, the search
  round trip, the per-entry link resolution and R2's check on a small model.
- `devTools/verify/` and `sbp/`: `scenes.ts`' pure logic after the split, `diffApi` / `diffDocs`,
  `systemOrder`'s duplicate, B2's keys (a hash swap gives the same keys), B3.
- `checkVersions`' bump rules as a pure function.

### D15. The Hub and `CLAUDE.md`

- **The Documentation section:** `intro.md` per entry. The coding standards say how devTools import
  the engine (D8), and that the layout check is a test (D9).
- **Other pages:** the SBP guide's "before minification" text goes (D12), and the
  asset-optimization page gets the prune's new rule (A1).
- **Nested `CLAUDE.md` files:** the devTools' five (hub, devFiles, assetPipeline, verify, sbp),
  current against the code (§1.4's stale statements).
- **The root `CLAUDE.md`:** the commands (`yarn verify:devFiles`, refactor → layout), the data
  pipeline's lines, the Documentation lines.
- **No example scene:** the plan is tooling and documentation, with nothing new to run in a scene.

### D16. Build and dev-server time (p600 §5.4)

- The gather: files bucketed by suffix once, `Set`s, scenes parsed once, the generated files
  written only when changed (G7).
- The dev Hub: sass and the Vite build skipped unless a changed file is under `hub/_assets/`, shiki
  output memoized by fence, the search index memoized by its documents' hash, image hashes by
  mtime and size. Measured before and after in Phase 6, and CLAUDE.md gets the number.
- The asset pipeline: a persisted source hash memo (path, size, mtime), the walk skipping outputs
  and generated data.
- `perf-auditor` doesn't apply: there is no per-frame code in scope.

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs in Phase 0 (`--update`, on `main`) and in Phase 8 for Phases
1-7 together (snapshots, hashes and system order unchanged; nothing edited while it runs). Each
phase ends with its "As built" list, its files' JSDoc at 100 % where the ratchet counts them, and
`docs.json` updated. Branch `review-schemas-pipeline-devtools-hub` from `main`.

### Phase 0: baselines, repros and the open checks

1. `yarn verify:scenes --update` on `main`, then `yarn verify:baselines`, `yarn sbp --profile all`
   and `yarn hub:build` (warnings, the index size).
2. Repro as `it.fails` tests: G1-G4, A1 and A2 (in a temp asset tree with a fake `ktx` lookup),
   A4, F2, H1 (the guard, without deleting anything), H2's shell and preview cases, V6, B3.
3. Repro by hand in a temp folder (not the repo's `src/`): F3's Prettier chain.
4. The checks the decisions depend on:
   - whether the `aekasha/schemas` alias resolves in Vite's config bundle (D8);
   - what the repo's scenes hold inline under `meshes` and `importedAssets` (D5);
   - the JSON Schema the material variants write (D5);
   - GLTFLoader's mesh extras on `userData` (A6);
   - R2's list from the current model, each type's proposed fix (D6).
5. Timings: a dev Hub rebuild after a page edit, a dev gather after an asset save (D16's before).

### Phase 1: loss and security (D4's first list)

A1-A4, H1, F1-F4, each with its test, and the self-check run (`yarn verify:devFiles`) passing.

### Phase 2: the other bugs (D4's second list)

G1-G6, A5, A6, F5, F6, H2, H3, V2, V4-V6, B3, B4, with D14's tests for them.

### Phase 3: the schemas (D5)

The unions, the tuples, the inline entries, the derived overrides, the exports, `ColorJSON`, the
docs (with `utils`' six, D1). `RuntimeTypes.test.ts` loses its swaps but p302's. The generated
JSON Schemas are checked in an asset JSON in the editor.

### Phase 4: the data pipeline and the asset pipeline (D8, D10, D11, D16)

The gather's split and its options, the imports rule and its test, the generated files written
when changed, the asset pipeline's splits, fixtures folder and memo, D14's tests for both, the
hygiene in both.

### Phase 5: the API reference per entry (D6)

The renderer on the entries, R2's check and the 64 decisions (each added type documented), R3's
pass, `render.ts`' split, the `hub:documentation/` links. `yarn hub:build` with no `notExported`,
no R2 warning outside p620's three, no dead link. `yarn verify:baselines`' `api.json` records the
added entry names.

### Phase 6: the rest of the Hub generator and the search (D7, D10, D11, D16)

The search cuts and `hub-data.js`, `buildHub`'s and the plugin's splits, the dev rebuild costs
(measured against Phase 0), the citations and the dead exports, the generator's tests.

### Phase 7: verify, sbp and refactor (D9, D12, D13)

The runner's split and reload handling, the sizes plugin, the keys, the budgets re-set,
`bundle.json` re-recorded, `refactor/` → `layout/`. Checked: a `--config quick` run with a
`yarn gatherAppData` run alongside (no reload), and the V3 optimizer case from §1.4 (a new bare
import in a scene, then a `--only` run).

### Phase 8: the Hub, CLAUDE.md, versions and done (D15, D2)

1. D15's pages and files; `readme.md` where it names a command or the refactor tools.
2. `yarn verify:scenes` (Phases 1-7), `yarn verify:baselines`, `yarn verify:embed`, `yarn build`,
   `yarn hub:build`.
3. `package.json` (D2), the `CHANGELOG.md` entry (D3's behaviour changes, the URL change, the
   removed refactor files' last commit), `yarn checkVersions --against main`.
4. Mark the plan done; p621's `Blocked by`, p620's Inputs (R2's toolkit types), p302's "From
   p619" note (D5).

## 4. Risks

1. **Scope.** About 30k lines of tooling. The phases are split so each is a reviewable section,
   and the fixes that lose data land first (Phase 1).
2. **The API URLs move again** (D6). Bookmarks break; the changelog says so. The entries are the
   layout that lasts, so this is the last move.
3. **R2's 64 types grow the entries.** Each addition is a public promise. Phase 5 lists them with
   the alternative per type before adding.
4. **Stricter gathers fail data that passed** (D3). Every repo JSON is gathered in each phase's
   tests, and an app's data gets a clear message.
5. **`yarn sbp`'s numbers change** (D12). The budgets are re-set in the same commit, and the Hub's
   SBP numbers come from the report.
6. **Deleting the codemod** (D9). git keeps it, and the changelog names the commit.
7. **The dev server's behaviour** (the plugins' queues, the watcher, the run lock): checked by hand
   in `yarn dev` and `yarn dev:https` in each phase that touches them.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a
  plan item).
- JSDoc coverage of the scope's public exports at 100 % (`docs.json`), the ratchet raised.
- The API reference per entry, with no `notExported` or leaked type left outside p620's.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated),
  `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify
  commands run for minutes to hours: when one starts, give the watch command,
  `tail -f .cache/verify/progress.log`.
- The Hub pages of the tooling checked against the code, the nested `CLAUDE.md` files current.
