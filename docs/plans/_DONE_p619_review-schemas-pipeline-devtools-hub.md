Status: implemented (Phases 0-8)
Category: Refactoring, Documentation, Dev tooling
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p601_refactoring-safety-net-tests-and-baselines.md (the runner, the baselines, the light issue path), \_DONE_p602_architecture-and-target-structure.md (D3: the API reference on the entries), \_DONE_p605_coding-standards-and-documentation-tooling.md (the Zod JSDoc rule, the search index cut), \_DONE_p606_layering-inversion-and-public-entry.md (D3: TypeDoc on the entries left here), \_DONE_p608_engine-folder-restructure.md (D6: the devTools' deep imports; D7: the API URLs), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (`yarn sbp`), \_DONE_p612_review-ecs-loop-config-init.md (`ComponentDataMap`, the runner's reloads, the group sizes, the chunk keys), \_DONE_p613_review-rendering-scene-assets.md (D11: the schema / runtime type pairs, `ColorJSON`, `PostFxSchema.ts`), \_DONE_p614_review-physics.md (`CharacterBrainKinds`; D8: the proxy types), \_DONE_p618_review-debug-public-api.md (the plan this one follows; D3: devTools-only names off the entries), p302_material-and-texture-system-refactor.md (D1: named texture constants, D5 below), \_DONE_p620_review-toolkit-and-app-code.md (the toolkit's three leaked types, D6), p622_engine-6-major.md

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
- S8 **(bug, latent; found in Phase 3)** `CoreEntityOpts.persistent` is read only by `createLines`
  and by a directional or spot light's target entity: `ECSWorld.createEntity` doesn't add
  `PERSISTENT`, so a camera, light or mesh entity whose JSON (or code) says `persistent: true`
  isn't kept on a scene switch (the debug camera adds the component itself). Documented on the
  field (`@remarks`); the fix (`createEntity` adds it) is a kernel behaviour change for the ECS's
  owner, not done here. Filed as `docs/issues/entity-persistent-flag-not-applied.md` (p620 N3).

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
- G13 **(bug, latent; found in Phase 3)** A mesh save entry's `geo` or `mat` is a partial (the
  schema's `PartialGeoProps` / `PartialMatProps`), but pass 2 spreads the entry over the props, so
  it replaces the whole field: `{ "geo": { "params": { "radius": 2 } } }` ships a geometry without
  its `type`. No repo save entry gives either. Phase 3 typed the result with a cast that names it.

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
- A10 **(found in Phase 4)** A clean encode isn't reproducible across machines: three of the
  repo's outputs (`p299TestArray`, `largeWorldTreeCross`'s `normal` slot, `p299TestAtlas`'s
  `mask` slot, each with a resized or upscaled source) encode to other bytes on this machine than
  the lock's, with the same `ktx` 4.4.2 and sharp, and `HEAD`'s code gives the same other bytes.
  The keys are the inputs', so cache hits don't change; only a re-encode (a `PIPELINE_VERSION`
  bump) gives each machine its own outputs. Likely sharp's decode or resize. Not fixed: noted in
  `assetPipeline/CLAUDE.md`, and the golden hash test leaves sharp out.
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

### Phase 0: baselines, repros and the open checks — done

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

As built (2026-10-21, on the branch at `de92474`, whose code is `main`'s `baac01e`):

- **Step 1.** `verify:scenes --update` (WebGL2 on SwiftShader, 63.6 min): 105 of 108 recorded; the
  3 failures are `thirdPersonGymScene`'s debug configurations ("the physics probe didn't reach
  step 600 in 300 s"), this machine's, as in p615-p618 (its baseline still holds a 120-step entry
  of 2026-10-09). `space` notes `mainThread` hashing apart from the workers (`f9619ec1` /
  `35fbc0e9`), not a failure. `verify:baselines` exits 1 on B2 alone: the committed
  `assets/EngineRapier.js` (9.5 kB gzip) and `#2` (9.3 kB) swapped; `bundle.banner.json`,
  `api.json` (2,512 exports in 322 modules, 838 on 16 entries) and `docs.json` (2,319 / 2,416)
  unchanged, no debug code. `sbp --profile all` within every budget (the app's initial 379.2 kB
  gzip against its groups' 832.0 kB, B1; `assets/index.css` 0.9 kB of 3.0 kB "well under").
  `hub:build`: the four `notExported` / link warnings and the index warning; `hub-search.js`
  1,779,249 B raw, 403,961 B `gzip -9`. The warning's "1.69 MB" is MiB (H6's `formatBytes`) and
  cites the deleted p552.
- **Step 2,** 31 `it.fails` tests, each checked to fail on its own assertion (as an `it`), in
  `459abf0`: `gatherSceneData.test.ts` (G1 ×3, G2 ×2, G3; the gather can't take a source folder
  yet, D10, so fake files are added to its walk through `fs` spies and `writeGeneratedOutput` is
  replaced by a recorder; a cut-off scene JSON already fails, kept as an `it`),
  `gatherOutput.test.ts` (G4 ×5, through `ts.transpileModule`'s syntax errors),
  `assetPipeline/prune.test.ts` (A1 ×2, A2 ×2: `sources.ts`' own `fileURLToPath` result is
  redirected into a temp root, so `ROOT` and every path under it is there; `ktx` stubbed missing),
  `assetPipeline/sources.test.ts` (A4 ×2), `devFiles/security.test.ts` (F2 ×2),
  `hub/buildGuard.test.ts` (H1: `rmSync` throws on the repo root, its parent and `src/`; the build
  reaches `rmSync(<repo root>)` in 1.8 s), `hub/shell.test.ts` (H2 ×4), `hub/preview.test.ts` (H2
  ×3: `resolveHubRoute` throws on a NUL byte, and `/%E0%A4%A` or `/%00` each kill the spawned
  preview), `verify/systemOrder.test.ts` (V6), `sbp/config.test.ts` (B3 ×3). Each fixing phase
  turns its `it.fails` into an `it`. Not reproduced: H1's second half (by reading), the rest of
  H2 (Phase 2), `copyDecoders.ts`' copy at load (only its script runs it).
- **Step 3, F3 confirmed.** In one folder under a root: a staged `evil.png` holding JavaScript (no
  content check on images), a committed `package.json` `{ "prettier": "./evil.png" }` (allowed:
  `.json`, no dot segment, `validateGatheredJson` has no type for it), then any JSON commit there:
  `formatJson` → Prettier 3.2.5's `resolveConfig` loads the config with `require()`, which runs an
  unknown extension as JavaScript, in the dev server's process. Reproduced against the repo's
  Prettier on Node 22.13.0 (the payload's options were used and its marker file written);
  `resolveDevFilePath` allows `package.json`, `evil.png`, `tsconfig.json` and refuses
  `.prettierrc.json` (a dot file). Reachable with the token: this machine by default, any LAN
  device under `AEK_DEV_FILES_LAN=true`. **D4's F3 fix gains a third part (to confirm):** staged
  images are checked by their magic bytes per extension.
- **Step 4.**
  - D8: `aekasha/schemas` doesn't resolve in Vite's config bundle (`loadConfigFromFile` on a temp
    config: "Cannot find package 'aekasha'"; Vite externalises the bare id). D8's relative path
    to `src/_engine/schemas/index.ts` it is.
  - D5 inline entries: no scene, and no save entry, holds an inline mesh or import (3 meshes and
    2 imports, all by id), so validating them fails no repo data. **New finding G12:** the scene
    pass returns an inline entry as it is (no validation, no generated fields, no shipped-output
    check for an inline import), and an id with no asset JSON as the raw string ("Fallback to raw
    string ID"), without an error. Fixed with G1-G2 (Phase 2): an unknown id fails the gather.
  - D5 materials, measured: the 25 literal variants write a 152 KB JSON Schema (today 13 KB) and
    give ajv 33-58 errors per mistake; `z.discriminatedUnion('type', [tsl, plain])` over today's
    two branches (zod 4 takes enum discriminators) gives the same zod issue paths (`tslFile`,
    `params`, `type`, never the root) at 13 KB (`oneOf` × 2). **Proposed (to confirm), replacing
    D5's materials bullet:** the two-branch discriminated union, and the runtime's member per type
    from `RuntimeTypes.test.ts`' `PerType`, moved onto the exported `MaterialAsset` type.
  - A6 confirmed from three's GLTFLoader: a node with one single-primitive mesh is that mesh
    object, `loadMesh` assigns the mesh's extras to its `userData` and the node's extras go over
    them (the node wins), so `parseCustomProps` sees a mesh's `colliderType` and
    `hasColliderNodes` (node extras only) doesn't.
  - R2: **60** internal types named by public exports (not 64), from a walk of
    `.cache/hub/typedoc.json` over the 838 entry names (each entry's `export { … } from` mapped to
    its module's reflection; every `reference` in their signatures and members followed; TypeDoc's
    back-links `implementedBy`, `extendedBy`, `inheritedFrom`, `overwrites` skipped, which took
    the two rigid body proxy classes off; `Error.*` and `Iterable` are lib symbols). Phase 5's
    check starts from this walk. Per folder:
    - character: `CharacterInputOpts`, `CharacterBodyKindField`, `CharacterBodyPlan`,
      `CharacterProbes`, `LocomotionState`
    - lines: `LineEntityBinding`, `LineWriteTarget`; LOD: `IMPOSTOR_KINDS`
    - physics: `PhysicsProbeReport`, `PhysicsSimTierData`, `PhysicsTierPolicyMemberData`,
      `PoseArray`, `RigidBodyTypeAPI`, `ColliderAPI`, `ShapeParams`, `PhysRotation`,
      `PhysicsBackgroundBehavior`, `PhysicsEngine`, `PhysicsInterpolationMode`, `PhysicsState`,
      `PhysicsWorkerTarget`, `TempContactForceEvent`, `JointAPI`, `WorldAPI`
    - sky box: `LegacySkyBoxParams`, `SkyBoxDefSchema`, `SkyBoxBaseDef`, `SkyBoxEnvDef`,
      `SkyBoxOverrides`
    - kernel/assets: `AssetLoadReport`, `AssetsWorkerTarget`, `GeoDebugData`,
      `AllowTextureStrings`, `TextureMapKeys`, `ImportExtension`, `ImportPhysicsParams`,
      `ParsedCustomProps`, `QuatLike`, `Vector3Like`
    - kernel/config: `DebugPhysicsWireframeConfig`, `PhysicsWireframeColors`; kernel/init:
      `FeatureUnmountHook`; kernel/render: `ViewCameraRig`
    - kernel/ecs: `ECSStorageMode`, `CoreComponentData`, `LifetimeData`, `EntityDebugData`,
      `ManagedByData`, `TypedArrayTransformStore`
    - schemas: `FeatureSchemaShape`, `SceneSpatialDomainEntry`, `ATLAS_MIP_CHAINS`,
      `TextureAtlasSlotInfo`, `CoreEntityOptsSchema`, `DebugData`, `ShadowQuality`
    - toolkit (4, p620's): `MovingPlatformControls`, `AsteroidCraterOptions`,
      `AsteroidNoiseOptions`, `TerrainNoiseOctave`

    Proposed per group (decided in Phase 5): **43** added to their entry with a summary (the
    feature's for its types, `aekasha` for the kernel's; `ParsedCustomProps`, `TextureMapKeys`,
    `GeoDebugData` and `AllowTextureStrings` checked for a signature change first); **4**
    constants behind a derived type (`IMPOSTOR_KINDS`, `ATLAS_MIP_CHAINS`, `SkyBoxDefSchema`,
    `CoreEntityOptsSchema`): the type written out with a type test against the constant, the
    constant stays off the entry; **7** `ComponentDataMap` member types (`PhysicsSimTierData`,
    `PhysicsTierPolicyMemberData`, `PhysicsWireframeColors`, `CoreComponentData`, `LifetimeData`,
    `EntityDebugData`, `ManagedByData`) with R3, `EntityDebugData` as D5's alias;
    `TypedArrayTransformStore` (a public `ECSWorld` method's return union) by a signature change
    to `IComponentStorage`; `PhysicsProbeReport` (only through p618 D3's deprecated
    `TestBridgeProbeResult`) an accepted exception until 6.0.0; the toolkit's 4 to p620.
- **Step 5, D16's before** (`yarn dev`, this machine): the dev Hub's lazy first build 5.1 s; a
  rebuild after a page edit 837-983 ms (six edits, median about 880 ms, plus the 100 ms debounce),
  not "tens of ms". **New finding (H3):** every rebuild reported `version/` as the changed page
  (the edits were to `documentation/intro.md`), so each one reloads an open Version tab. A dev
  gather after an identical asset save: 118-150 ms from the save to `generatedAppData.json`
  rewritten (100 ms of it the debounce), the same for a camera and a texture JSON; each rewrites
  the generated files and logs its lines (G7).

### Phase 1: loss and security (D4's first list) — done

A1-A4, H1, F1-F4, each with its test, and the self-check run (`yarn verify:devFiles`) passing.

As built (2026-10-21; section A committed as `93f2edf`, H1 and F after it):

- **A1, A2.** `readAssetJsons` and `collectPipelineAssets` return `{ …, dropped }` (`DroppedAsset`:
  the JSON and why: not JSON, its schema's first issue, a use's unresolved source, an array's
  layers, an atlas's layout). `getPruneBlockers` (`command.ts`) keeps the outputs and the lock on
  an `error`, an `encoderMissing`, a `skipped` public source that's missing (its output may be the
  only copy of the image) or anything dropped, and the run lists each reason. A remote source
  and an array or atlas slot whose textures side is off (`src/CONFIG.ts`) have no output by
  design and don't block. The old "an asset failed" note is one of the blockers.
- **A3.** `runLock.ts`: `withRunLockAsync` around the prune and `cache.save()` in every
  `runAssetsCommand` (so the dev server's save waits on `yarn assets`' prune), `O_EXCL`, the
  owner's pid in the file, taken over when that pid is gone, 30 s then an error naming the file.
  `removeStaleOutputs(urls, publicDir, { since })`: a file changed since the run started stays;
  a `*.<pid>.tmp` stays while its pid runs and is deleted otherwise (the old cleanup of
  leftovers kept). Not handled: two waiters both taking over a dead owner's lock at once.
- **A4.** `resolveAssetSource`'s public branch returns `{ error }` for a decoded path outside
  `src/public` and for a malformed escape; every caller already reports it, and under A2 it
  blocks the prune.
- **H1.** `devTools/hub/outDir.ts`: `getHubOutDirError` takes a missing or empty folder or an
  earlier Hub output (one holding `_headers`, `404.html` and `_assets/`: no marker file, so
  today's `dist-hub/` passes), and refuses the repo root and every folder above it, `src/`,
  `hub/`, `devTools/`, `docs/`, `node_modules/`, `.git/`, a file and any other non-empty folder.
  The CLI checks before the embeds' `yarn sbp`, `buildHub` before its work and again before the
  swap. A public build writes into `<out>.tmp-<pid>` (a sibling: a rename can't cross disks) and
  `commitHubStagingDir` swaps it in (old output moved aside, put back if the rename fails); a
  diagnostic or a throw in a write step leaves the last output and removes the staging folder.
  `buildGuard.test.ts` runs one full build with a failing embed copy (about 2 s).
- **F1.** The self-check writes its scenes' own `selfCheckScene.ts` into its folder (directly:
  dev files never write code), runs as `yarn verify:devFiles` (`package.json`, `readme.md`, the
  root `CLAUDE.md`), and prints through `verify/progressLog.ts`' `out`. 60 checks pass, with new
  ones for F2-F4 and the image check. No hook runs it.
- **F2.** A host name is loopback only as `localhost`, `*.localhost` or a loopback IP
  (`net.isIP`).
- **F3.** Three parts: `DEV_FILES_DENIED_NAMES` refuses `package.json`, `tsconfig*.json` and
  `jsconfig*.json` in any folder; `devFiles/format.ts` formats with the root's `.prettierrc` only
  (`resolveConfig(file, { config })`), shared with the self-check; and (confirmed) a staged image
  must start with its format's signature (`imageCheck.ts`, PNG, JPEG, WebP), else the new code
  `INVALID_IMAGE` (422) on `DevFilesErrorCode` (`aekasha/debug`: an engine minor item for D2).
  `config.test.ts` replays Phase 0's chain in a temp folder.
- **F4.** `isLocalRequest` also needs no proxy header: the plan's `Forwarded`, `X-Forwarded-For`
  and `Via`, plus `X-Forwarded-Host` and `X-Real-IP`. A developer behind their own local reverse
  proxy needs `AEK_DEV_FILES_LAN=true` to write; the refusal says so.
- **Docs:** the prune rule in the root `CLAUDE.md`, `assetPipeline/CLAUDE.md`,
  `asset-optimization.md` and the Hub's asset optimization guide (D15's page item, done here); the
  `hub:build` lines in the root and `hub/CLAUDE.md`; the dev files rules in `devFiles/CLAUDE.md`.
- `yarn test`: 22 `it.fails` left (Phase 0's 31 less A1 ×2, A2 ×2, A4 ×2, H1, F2 ×2), each for a
  later phase. `yarn hub:build` passed with Phase 0's five warnings.

### Phase 2: the other bugs (D4's second list) — done

G1-G6, A5, A6, F5, F6, H2, H3, V2, V4-V6, B3, B4, with D14's tests for them.

As built (2026-10-21; uncommitted at the end of the session, in five sections: the gatherer,
the asset pipeline, the dev files, the Hub, verify and sbp):

- **G1, G2, G12.** Every duplicate id sets the error (the first file keeps it; pass 2 skips the
  duplicate's file, `registeredSceneFiles`). A file that doesn't parse, or any other throw while
  reading it, fails the gather with the parser's message (`logJSONError` sets the error; a scene
  file no longer aborts the whole gather). An id a scene lists that no asset JSON has fails it
  (`reportUnknownId`, all nine kinds; unlisted impostors still only warn: they bake). No repo data
  tripped either.
- **G3.** `writeJsonSchemas` (exported, writes a file only when it changed, logs only then),
  called by `yarn gatherAppData`, `yarn assets` and `sceneGathererPlugin`'s `configureServer`
  (each restart). `copyDecoders.ts` copies only when run as a script.
- **G4.** `gatherOutput.ts`: `toKey` quotes any non-identifier (scene ids too), paths go through
  `toStringLiteral`.
- **G5.** Pass 2 applies the scene's own latest save entry and drops `__saveData` from the output;
  production strips `debugData` after the merge (textures, materials, imports, PostFX).
- **G6.** `cameras: []` gets the auto camera; a material without nodes ships no `nodes: {}` (the
  generated data loses two lines, dev and production); a debug scene isn't counted for the
  production TSL / PostFX loaders (no repo loader changed: compared in a scratch worktree).
- **A5.** three's version in a `lodChain` GLB's key only (`getPackageVersion`, `cache.ts`; no
  repo asset has a chain, so no key changed); `writeOutput` rewrites a present file of another
  size; the `ktx` install's staging folder goes on any throw, and a working copy another process
  installed meanwhile is kept (`--force` still replaces it); `ktx --version` 15 s and `ktx create`
  15 min, then killed. No test for the install race and the timeouts.
- **A6.** `hasColliderNodes` reads the mesh's extras under the node's (node wins), as
  GLTFLoader merges them.
- **F5.** Each target is checked again right before the renames (the backup's hash, or still
  missing): a change after the plan is `CONFLICT` (a plain JSON write without `expectedHash`
  included, a small window). A server's stage is `.cache/dev-files/stage/<pid>-<id>/`, removed
  on close or by a later server once the pid is gone. A JSON whose compact form is over 32 MB is
  refused before Prettier.
- **F6.** A broken symlink folder is `FORBIDDEN_PATH`; `__saveData` read by own keys, `__proto__`
  refused; the client (`_dbg__DevFiles.ts`, p618's file) uses a zero hash when the read has no
  hash header, so the write is a `CONFLICT`; an unknown route is `BAD_REQUEST`; `historySize` in
  the protocol summary. The Host / Origin check moved to `devTools/hostCheck.ts`
  (`getHostAndOriginError`), wrapped by `devFiles/security.ts` and used by `hubPlugin.ts`.
- **H2.** The shell's placeholders by own keys; `resolveHubRoute` 404s a NUL byte;
  `hubPreview.ts` answers a bad escape with 400, catches any throw (500), handles stream errors
  and listens on `localhost`; `tryDecodeURI` makes a bad escape in `api:`, `repo:` or an image an
  error at its line; issue files whose slugs collide are an error and the second gets no page.
- **H3.** The watching starts with the first build (Vite's events during it are checked against
  its sources after it); a request waits for the run in progress only (`currentRun`); editor
  temp files and dot files trigger no run; a removed static asset's copy is removed; the watcher
  also closes on `closeBundle` (middleware mode). Phase 0's `version/` reload: the page's "local
  changes" comes from `git status`, which an edit and its undo flip; the plugin keeps the first
  build's commit, local changes and time (`buildHub`'s `buildTime` option became `build`). Checked
  on a real dev server; no unit test until Phase 6's `createHubDevRunner`.
- **V2.** A baseline that's there but unreadable or of another format stops the run (`RunAbort`:
  exit 2 after the run so far is written and the browser closed), unless `--update`; an input
  script problem fails its scene; a `scenes.config.ts` entry naming no scene of the data, and a
  `VITE_APP_ENV` other than development / test, fail the start; `baseline.json`, `last-run.json`
  and the committed baselines are written atomically (`devTools/files.ts`' `writeFileAtomic`,
  which the asset cache now uses too: K3's start).
- **V4.** Every `page.evaluate` in `runOne` has a timeout (`withTimeout`: the bridge's own plus
  60 s, or 60 s).
- **V5.** `verify:embed` takes a free port on `localhost`, loads and waits for the page inside the
  scenario's `try`, and polls each state for up to 10 s instead of fixed 400 ms settles (the
  pause check keeps its 400 ms window: it measures).
- **V6.** `diffSystemOrders` counts, so a system registered twice shows; `NOT_YET_INSTALLED` is
  gone from `moduleSideEffects.test.ts` (no allow-list); `debugInProduction`'s fixtures use
  today's paths.
- **B3.** A `groups` key must name a possible group (an installed package, an existing engine
  folder, `app`, `toolkit`, `vite`, `other`) and a `modules` key an existing file or folder.
- **B4.** `buildAppBundle` removed; `buildBundles` rethrows the build's error and only reports a
  failed dev gather after it; both build plugins skip `closeBundle` after a failed build
  (`buildEnd` / `renderError`). `sbp/` imports nothing of `verify/`: the progress log moved to
  `devTools/progressLog.ts`, `bundleGrowth.ts` into `sbp/`, `BuildModule` / `EmittedAsset` into
  `sbp/bundleModel.ts`.
- **Checks:** `yarn test` 996 passed, no `it.fails` left. `yarn verify:devFiles` 61 / 61.
  `yarn verify:embed --no-build` 3 / 3. `yarn verify:baselines`: B2's `EngineRapier.js` swap
  alone (Phase 7), no debug code. `yarn verify:scenes --only scene01 --config quick` passes on
  Phase 0's baseline. `yarn hub:build` with Phase 0's warnings. `yarn assets` all cache hits.
- **Docs:** the root `CLAUDE.md` (data pipeline steps 2 and 4, the side effects test, the
  progress log), the nested `CLAUDE.md` of assetPipeline, devFiles, hub, verify and sbp, the
  Hub's scenes-and-assets guide and `asset-optimization.md`.

### Phase 3: the schemas (D5) — done

The unions, the tuples, the inline entries, the derived overrides, the exports, `ColorJSON`, the
docs (with `utils`' six, D1). `RuntimeTypes.test.ts` loses its swaps but p302's. The generated
JSON Schemas are checked in an asset JSON in the editor.

As built (2026-10-21; sections 1-2 committed as `5254323` and `104682b`, 3-4 after them):

- **Unions.** Lights, cameras and geometries are `z.discriminatedUnion('type', …)`; a bad field is
  reported at the field (`lightProps.intensity`), an unknown type at `lightProps.type`.
  `gatherAppData.test.ts` now requires the issue at the broken path or inside it, never above,
  with cases for a tuple length, a spot `map`, a camera and a geometry field, the materials and
  the inline entries. The JSON Schemas have `oneOf`.
- **Materials: Phase 0's proposal, confirmed.** `z.discriminatedUnion('type', [tsl, plain])` over
  the two enums (13 KB JSON Schema); `MaterialAsset` is `PerType<…>` (exported `@internal`, which
  `RuntimeTypes.test.ts` imports), one member per type. The enums' own error messages went: the
  union reports the discriminator.
- **Tuples and `map`.** The light tuples are `z.tuple`, a spot `map` a texture id. zod writes a
  draft-07 tuple as `items` alone: `writeJsonSchemas`' `override` adds `minItems`, `maxItems` and
  `additionalItems: false` (every tuple, the atlas and pack ones included).
- **`reused: 'ref'`** in `writeJsonSchemas` (not in the plan; to confirm in review): a sub-schema
  used twice is written once under `definitions` (`__schema0`, …, renumbered when one is added).
  The inline mesh took `scene.schema.json` from 489 KB to 653 KB; with refs it is 137 KB, and
  164 KB with the descriptions.
- **Overrides (S2).** Camera and light save entries are every variant's fields `.partial()`, `type`
  an enum built from the literals; geometry's `params` merge every variant's. Key orders as the
  hand copies had them, so `src/generated/` didn't change (checked after every edit).
- **`TexOptsSchema`** has no `image`; the test keeps the constants' swap, commented as p302 D1's.
- **Inline entries.** `createSceneAssetSchema(parts)` validates an inline mesh with
  `createMeshAssetSchema(parts)`' `props` and `entityOpts` (through `createKernelSceneShape`:
  `.extend()` on the generic shape lost its keys in the type), an inline import with the new
  `InlineImportedAssetSchema` (no `optimize`, no generated fields, a `src/public` file). The test
  checks both pairs. **G13** (a mesh save entry's partial `geo` / `mat` replaces the whole field)
  surfaced in the gatherer's types: cast with a comment naming it, for Phase 4.
- **S3.** `EntityDebugDataSchema` went; `ECSRegistry.ts`' `EntityDebugData` stays written out (its
  file takes no local import) with a type test equal to `DebugData`. The typo, the `__meta.date`
  message, the scene's `comments` / `todo` (`DebugData`'s shapes, not `z.any()`). `z.any()` stays
  on three's material params, with the reason (a record of `unknown` doesn't fit `MatProps`).
- **Exports (S6): 41, not 13.** 19 schema constants unexported, 18 type aliases deleted (the save
  entry types, `Vector3`, `UserData`, the schema-side `LightProps` and `TexOpts`, …),
  `PackTarget` private. `AssetOptimize` is the type of the new `OptimizeObjectSchema`
  (`@internal`), which the three per-type optimize schemas build on. 32 building blocks are
  `@internal` with their users named; R2's names stay internal for Phase 5. `ColorJSON` on
  `aekasha/schemas`; `UnionToIntersection` exported `@internal` (its `notExported` went).
- **Docs.** JSDoc on every shape key of the kernel's schemas (shared fields documented once:
  `LIGHT_FIELDS`, `MESH_FIELDS`, `TEXTURE_FIELDS`, a `pick` keeping the key order; the TypeDoc
  model carries the docs through the `Pick`), a `describe` on every field of the kernel's schemas
  (a scan of `.schemas/` finds none missing outside the feature parts' fields, D1's), the shared
  `JsonSchemaRefSchema` and `SourcePathSchema`. Defaults read from the code (three's
  constructors, `createCameraEntity`, the asset pipeline's built-in defaults: the `rdo` text is
  fixed). The plan citations replaced; `LodChainSchema`'s "until p348" made current; the atlas
  and assets config file headers moved off the first export (S7). S8 found (§1.4).
- **`utils`:** `HALF_PI` and `QUARTER_PI` removed (on no entry, no user); the other four exports
  and two constructors documented.
- **API page limits, for Phase 5:** the field table doesn't expand a union's members
  (`lightProps` reads `{ … } | …`, though the model has every member's docs), and a cross-module
  `{@link}` resolves only names in scope (`createCameraEntity` is in backticks).
- **Checks:** `yarn test` 1008 passed; `docs.json` recorded, `engine/schemas` 89 / 89 and
  `engine/utils` 43 / 43, members 6 / 6; `yarn hub:build` with Phase 0's warnings less
  `UnionToIntersection`'s; ajv: the 115 repo asset JSONs and `assets.config.json` pass, the bad
  cases fail. `yarn verify:baselines --no-build`: the intended API changes (the removed and added
  exports, `ColorJSON` on the entry) and B2's swap; `api.json` not recorded (an `--update` would
  also record `bundle.json` from a stale build): Phase 8's full run records it. Not done: the
  hand check in VS Code (an asset JSON's hovers and a bad tuple).

### Phase 4: the data pipeline and the asset pipeline (D8, D10, D11, D16) — done

The gather's split and its options, the imports rule and its test, the generated files written
when changed, the asset pipeline's splits, fixtures folder and memo, D14's tests for both, the
hygiene in both.

Sections: 1. D8's rule and test; 2. the gather's split (D10) with D16's gather items and G13;
3. the generated files written when changed (G7) and the plugin's queue (G9); 4. the asset
pipeline's splits, fixtures, memo and tests; 5. the hygiene (D11) in both, the docs.

As built (2026-10-21; sections 1-4 committed after `2c9bdc6`, 5 after them):

- **Section 1, D8.** `devTools/engineImports.test.ts` keeps the rule: a devTools import into
  `src/` names a listed module (each with its reason), and an `aekasha*` entry only with
  `import type` (`import { type X }` and `export { type X } from` count as value imports: under
  `verbatimModuleSyntax` they stay as `import {}`, which loads the module). Each module listed for
  its values may load, through its value imports, no package but zod and its own (`LodSimplify.ts`:
  three and meshoptimizer); the list can't hold a module nothing imports. The schemas entry's graph
  is 27 modules, zod alone. The asset pipeline and the gatherer import the schemas from the entry
  file; `AppConfig` and `TransferableAttribute` are `import type … from 'aekasha'`.
  - **I2, differs from D8 (confirmed in review):** the five gatherer helpers are already on
    `aekasha/skybox` and `aekasha/lod`, so putting them on `aekasha/schemas` too would give each name
    two entries (D6 counts on unique names). Instead their three import-free modules are on the list
    by path: `LegacySkyBox.ts`, `Presets.ts`, `ImpostorFormat.ts`. No entry changed for them.
  - `deepMerge` → `applySkyBoxSaveEntry(def, entry?)` (`SkyBoxSchema.ts`, on `aekasha/schemas`:
    the deep merge, without the entry's `__meta`).
  - I3: `GLTF_LOD_EXTRAS_KEY` and `GLTFLodChainsExtras` moved into `LodChainOptions.ts` (still on
    `aekasha/lod`), so `lodChains.ts` no longer imports `LodChainGLTF.ts` (three/webgpu).
  - `LodSimplify.ts` is listed with its packages: a GLB's prebuilt chain is the runtime's
    simplifier's output, by design (I3 didn't name it).
  - The generated data, dev and production, is the same as before (compared).
- **Section 2, D10 (the gather) with D16's gather items and G13.** `gatherAppData.ts` is the
  orchestration and the CLI (194 lines): `gatherSceneData({ pipeline?, profiles?, isProduction?,
  srcDir?, outDir? })`, each defaulting to the repo's. Its steps are in `devTools/gather/`:
  `gatheredJson.ts` (`GATHERED_SUFFIXES`, the schemas, `validateGatheredJson`,
  `isGatheredJsonFile`, which replaces `isFilePathValid`), `log.ts` (`GatherLog`: an error fails
  the gather), `context.ts` (`GatherContext`, the registries and id spaces, `claimIds`, and
  `readAssetJsons`, the one pass-1 reader for every type), `registries.ts` and `textures.ts`
  (pass 1), `scenePass.ts` and `sceneAssets.ts` (the scenes, one resolver per list),
  `shipChecks.ts`, `saveEntries.ts` (`getSaveEntry`, the stale entry warning), `sources.ts`,
  `jsonSchemas.ts`. `gatherOutput.ts` and `engineSchemas.ts` moved in as `output.ts` and
  `engineSchemas.ts`, and the tests with them (`gatheredJson.test.ts`, `gather.test.ts`).
  `devTools/paths.ts` (`ROOT`, `SRC_DIR`, `PUBLIC_DIR`, `GENERATED_DIR`) is K3's start.
  - The log text and the pass order are kept, apart from the legacy sky box warning's "(p112)".
    `getBasePath` (split on `/src/`) is `getTopFolder(srcDir, file)`.
  - D16: the walk is bucketed by suffix once, the ids are `Set`s, the scenes are parsed once
    (pass 1 keeps them for the scene pass), and the shipped scenes' material and PostFX ids are
    `Set`s. The gather itself was already fast: median 20.5 → 19.3 ms (12 runs, the repo's data).
  - G8: `engineSchemas.ts`' types are `EngineSceneAsset` / `EngineMeshAsset` (no clash with the
    engine's), and its test fails on an engine `*SchemaPart` missing from `ENGINE_SCHEMA_PARTS`.
  - G13: a mesh save entry's `geo` or `mat` props of the mesh's own type merge over them (`params`
    key by key, a material's `nodes` too); an id, or another type, replaces them. The merged props
    are validated with the mesh schema, so partial props over an id fail the gather. The schema's
    JSDoc and the Hub's per-scene overrides section say how every entry merges.
  - `gather.test.ts` gathers small trees in a temp folder (and the repo's data into a temp output,
    both modes): G1-G3, G5, G6, G12, G13 and "a failed gather writes nothing". The G13 cases fail
    on the old replace-whole behaviour (checked).
  - The generated data, dev and production, is byte for byte the same (production compared with
    `HEAD`'s, gathered in a worktree).
- **Section 3, G7 and G9.** `writeGeneratedOutput` writes a file only when its content changed
  (`devTools/files.ts`' `writeFileIfChanged`, atomic: Vite never reads one half written), and
  `gatherSceneData` returns `{ isGathered, changedFiles }`; its log line says ", the generated
  data unchanged" when nothing was written. V3's third cause goes with it.
  - The plugin reloads the page when the gather changed the generated data, when a source file
    changed (one served as it is changes no `__url`), or when its error overlay is up (a fix that
    gives the data as it was still closes it). `willReload` says so (`DevFilesProtocol.ts`' doc).
  - G9: the queue is `devTools/gather/devQueue.ts` (`createWorkQueue`, tested on fake timers): a
    burst straddling the end of a run becomes one more run (the run in progress takes no pending
    work while the debounce timer is set; the test fails on the old loop), and the queue closes
    with the server. A pipeline that can't start marks the gather failed, so the next file that
    comes or goes runs again. The plugin's `configureServer` is 50 lines: `getWorkUpdate` (an
    event → its work), `createWorkRunner` (the switches, the pipeline, the gather and its events).
  - Checked on a dev server (a WebSocket on Vite's HMR socket): a save of the same bytes gathers
    with `willReload: false` and no reload; a changed `fov` reloads; a burst of three saves is one
    gather; a save cut off mid-write fails with the overlay, and its fix reloads.
    `yarn verify:devFiles` 61 / 61.
- **Section 4, the asset pipeline (D10, D16, D14).**
  - D10: `runAsset` (222 lines) is `runPassThroughAsync`, `planEncode` (one plan per kind:
    `planArrayEncode`, `planTextureEncode`, `planGLTFEncode`, each the settings, the key's inputs
    and the texture settings), `encodeAsync` and `getEncodingKtxVersionAsync`; it is 45 lines.
    `encodeTextureAtlasSlot` (180) is `probeAtlasSources`, `getStoredLevels`,
    `composeAtlasLevel0` and `createAtlasCoverageScaler`, and 60 lines. Checked by a clean
    re-encode of all 18 assets (empty cache): the outputs' content-hashed names are `HEAD`'s,
    asset for asset (15 are the lock's; three are A10's, the same with `HEAD`'s code).
  - Fixtures: `phase1Variants.ts` → `fixtures/assetCompareVariants.ts`, `p299ArraySpike.ts` →
    `fixtures/textureArraysFiles.ts`, each headed as its scene's fixture generator, `ROOT` from
    `devTools/paths.ts`. The app files naming them (both scenes' JSON and code, the "run this"
    message) follow: an app patch item for D2; the generated data's two descriptions change.
  - D16: the key memo is kept across processes (`.cache/asset-pipeline/key-memo.json`,
    `saveKeyMemo` at the end of `runAssetsCommand`; the entries looked up since the last save, so
    it holds today's assets). Its stamp adds ctime and inode to size and mtime: a write always
    changes ctime. The key's derivation didn't change (a new one would miss every lock entry,
    A1's hazard). The up-to-date lookup of `yarn gatherAppData`: 37-41 ms → 25-33 ms here. A GLB's
    JSON is parsed once while it doesn't change (`readGLTFJson`'s memo, A8). The asset JSON walk
    and the gather's skip `generated/` and `public/aek-assets/` (`listSourceFiles`, in
    `readdirSync`'s recursive order, so the gather's output order stands; 6.4 → 2.1 ms).
  - D14: `settings.test.ts` (the levels, the slot, the pass-through reasons, the switches, the
    collider default, unknown profiles), `cache.test.ts` (the key's inputs, the memo across a
    module reload, a same-size same-mtime write, a broken memo file; the ctime case fails without
    ctime), `textureAtlases.test.ts` (the shelf packer, explicit rects, every error, the levels),
    `images.test.ts` (the packer on PNGs sharp writes, the alpha coverage, a golden hash of the
    resize, mip chain and coverage floats with `PIPELINE_VERSION`), `ktxEncode.test.ts`
    (`getKtxCreateArgs` for three settings), `archives.test.ts` (ar, tar plain and gzipped,
    cpio, xar, built byte by byte). `yarn assets`: 18 cache hits, the lock unchanged.
- **Section 5, the hygiene (D11) in both, and the dev files' (no later phase has them).**
  - K3: `devTools/paths.ts` is the one `ROOT` (`SRC_DIR`, `PUBLIC_DIR`, `GENERATED_DIR`):
    `assetPipeline/sources.ts` no longer exports it, its 36 importers, `ktxTool.ts`,
    `checkVersions.ts`, `sbp/config.ts` and `engineImports.test.ts` import it, and `hub/paths.ts`
    re-exports it. The tests that move `ROOT` into a temp root (`prune.test.ts`, `cache.test.ts`,
    `devFiles/commit.test.ts`) redirect `devTools/paths.ts`' URL now. One `sha256`
    (`devTools/files.ts`: the dev files, the self-check, `ktxTool.ts`, `getContentHash`,
    `hub/hash.ts`). One `stableStringify`, `src/_engine/utils/StableStringify.ts` (`@internal`,
    tested, on `engineImports.test.ts`' list): the impostor source hash's semantics, its colours
    through a `replace` hook; the material variants and the asset cache keys use it too
    (`yarn assets`: 18 cache hits, so no key changed). One git helper, `devTools/git.ts` (`git`,
    `readGit`): `checkVersions.ts`, `tagRelease.ts`, `projectMetadata.ts` (which ran git in the
    process's folder).
  - K1: `ignoreRestSiblings: true` on `no-unused-vars` (the whole repo); the six rest-omit
    disables it made unused are gone (no other in the repo was one). Every file-wide
    `no-console` disable in the scope, `devFilesPlugin.ts` and `progressLog.ts` has its reason.
  - K2: the dev files' four `never` helpers are `function` declarations, so their calls narrow
    (`paths.ts`' `root as string` and `commit.ts`' `w.path as string` went).
  - G11: `projectMetadata.ts`' missing `?.` (and `devDependencies?.`); `checkVersions`' bump rules
    are `checkBumps` (pure: the package, the ref's, each part's changed files), tested in
    `checkVersions.test.ts` with `checkAlwaysRules`.
  - Summaries on the scope's 47 undocumented exports; ten runtime exports nothing else uses are
    module-private (`GATHERED_SCHEMAS`, `getGatheredJsonType`, `GENERATED_INDEX_FILENAME`,
    `getPruneBlockers`, `ASSETS_LOCK_FILE`, `CACHE_STORE_DIR`, `MIN_KTX_VERSION`, `KTX_TOOL_DIR`,
    `findKtx`, `installLocalKtx`). Every plan the scope's comments cite still exists.
  - The root `CLAUDE.md`'s coding standards have the devTools' line (D8's rule, K3's helpers,
    K2).
- **For D2:** engine minor items: `applySkyBoxSaveEntry` on `aekasha/schemas`; `GLTF_LOD_EXTRAS_KEY`
  and `GLTFLodChainsExtras` moved within `aekasha/lod` (no entry change). App patch items: the
  two scenes naming the fixture generators. Project: the gather's split and its options, the
  plugin's reload rule, the key memo, the fixtures folder, the helpers.
- **For D3's changelog list:** a mesh save entry's `geo` / `mat` props merge (G13), and partial
  props over an id fail the gather; the dev server reloads only when the generated data or a
  source changed (G7).
- **Left for Phase 6:** the Hub's file-wide `no-console` disables without a reason
  (`hubBuild.ts`, `hubPlugin.ts`, `hubPreview.ts`) and its `fail` helpers (`hubBuild.ts`,
  `hub/embed.ts`, `hub/api/extract.ts`), `hub/repoFiles.ts`' git call (→ `devTools/git.ts`).
  **For Phase 7:** `verify/scenes.ts`' git calls (→ `devTools/git.ts`); `refactor/`'s `ROOT`
  copies go with D9.
- **Checks:** `yarn test` 1066 passed (131 files); lint and both `tsc` clean; `yarn hub:build`
  with Phase 0's warnings; `docs.json` recorded (`engine/utils` 44 / 44, `features/skybox`
  178 / 178); the Vite config loads. `api.json` not recorded (Phase 8's full run).

### Phase 5: the API reference per entry (D6) — done

The renderer on the entries, R2's check and the 64 decisions (each added type documented), R3's
pass, `render.ts`' split, the `hub:documentation/` links. `yarn hub:build` with no `notExported`,
no R2 warning outside p620's three, no dead link. `yarn verify:baselines`' `api.json` records the
added entry names.

Sections: 1. the entry map, R2's check and R3's pass (`api/entries.ts`, `extract.ts`), with their
tests, giving today's list; 2. R2's decisions (the engine's types added to entries, the derived
types, the signature changes); 3. `render.ts`' split (R4), the output unchanged; 4. the pages per
entry, the links (internal `{@link}`, `api:`, the `hub:documentation/` links), the A-Z index and
the search on public names; 5. the checks and the docs.

As built (2026-10-21, on `aece8b0`):

- **Section 1, the entry map, R2's check and R3's pass.**
  - The model carries the entries: `ApiModel.entries` (`ApiEntry`: each entry's names with their
    module and name there), read by `extract.ts`' `readEntries` with the conversion, through
    `importGraph.ts`' parser (TypeScript is loaded then anyway; the Hub's builds, in the Vite
    config process too, never load it). A name re-exported from another entry
    (`createSeededRandom`) resolves through that entry. The entry files are in the model's hash
    and `isApiInputFile`; `EXTRACT_VERSION` 4. `verify:baselines`' `collectEntries` reads the
    model's list (one parse), and fails on a model error.
  - `api/entries.ts`: `indexEntries` (each name → its declaration, a module's re-export followed;
    a name the model lacks is an error) and `findLeakedTypes` (R2). **Transitive (not in the
    plan):** a leaked type's own types are leaked too, reported with the leaked type that names
    them, so a build shows the whole set rather than one layer per fix (`ComponentDataMap`'s
    member types are only reached through `CoreComponentData`, since its members are inherited
    copies). Skipped: private and inherited members, type parameters, `{@link}`s, other packages.
  - `yarn hub:build` warns once per leaked type at its first namer's reference, naming up to
    three more; memoized per model.
  - **TypeDoc's validation no longer runs (not in the plan):** `notExported` checked against
    every module, R2's check against the entries covers it. `locateValidationMessages` and its
    regexes went.
  - R3: `linkNamedReferences` (after `projectToObject`): a reference by name to a declaration the
    model has (`symbolIdMap`, kinds a module declares) gets its id; type parameters (`K`) and
    other packages stay. It links `ComponentDataMap` (23) and `CharacterBrainKinds` (4), and both
    `notExported` warnings went.
  - Tests: `entries.test.ts` (6, a hand-built model; the private / inherited skip and the
    transitive walk each fail when removed), `extract.test.ts` (R3).
  - **Today's list: 97** (58 named by public exports, 39 through leaked types), against Phase 0's
    60: Phase 3's `OptimizeObjectSchema`, `UnionToIntersection` and `PerType` are new, and the
    transitive ones (12 under `WorldAPI`, 8 under `FeatureContext.registerImportExtension`'s
    `ImportExtension`, 6 character input mappings, 5 character body types, …).
  - Checks: `yarn test` 1073 passed; `yarn hub:build` with the 97, `{@link getRandomStream}`
    and the index size warning.
- **Section 2, R2's decisions** (section 1's three proposals taken: the constants on their
  entries, `@internal` members skipped, an accepted list). **79 names added** to six entries
  (838 → 919 with Phase 3's `ColorJSON` and Phase 4's `applySkyBoxSaveEntry`), each documented
  already; no name clashes with another entry's:
  - `aekasha` (19): `AllowTextureStrings`, `AssetsWorkerTarget`, `CoreComponentData`,
    `DebugPhysicsWireframeConfig`, `ECSStorageMode`, `EntityDebugData`, `FeatureUnmountHook`,
    `GeoDebugData`, `ImportPhysicsParams`, `LifetimeData`, `ManagedByData`, `ParsedCustomProps`,
    `PhysicsWireframeColors`, `QuatLike`, `TextureMapKeys`, `TypedArrayTransformStore` (type
    only), `Vector3Like`, `ViewCameraRig`, and the value `textureMapKeys`.
  - `aekasha/character` (16): the seven input scheme types (`CharacterInputOpts`, its mappings,
    `CharacterInputHoldMode`) and nine of `CharacterTypes.ts` (`CharacterProbes`,
    `CharacterBodyPlan` and theirs, `LocomotionState`).
  - `aekasha/physics` (28): `WorldAPI`, `ColliderAPI`, `JointAPI` and every type they name (the
    query, event and hook types, `ShapeParams`, `HeightFieldData`, `JointMotorModel`), the config
    and state types (`PhysicsState`, `PhysicsEngine`, `PhysicsWorkerTarget`,
    `PhysicsBackgroundBehavior`, `PhysicsInterpolationMode`), the tier component data, `PoseArray`,
    `PhysRotation`; the enums `RigidBodyTypeAPI`, `ShapeType`, `SolverFlags`, `FeatureType`,
    `QueryFilterFlags` as values, as `JointAxesMask` is.
  - `aekasha/schemas` (11): `ATLAS_MIP_CHAINS`, `CoreEntityOptsSchema`, `OptimizeObjectSchema`,
    `SkyBoxDefSchema` (values; Phase 0's written-out types not done), `DebugData`,
    `ShadowQuality`, `SceneSpatialDomainEntry`, `TextureAtlasSlotInfo`, `FeatureSchemaShape`,
    `UnionToIntersection`, `PerType`. `aekasha/skybox` (4): `SkyBoxBaseDef`, `SkyBoxBaseInput`,
    `SkyBoxEnvDef`, `SkyBoxOverrides`. `aekasha/lod` (1): `IMPOSTOR_KINDS`.
  - The 14 of them tagged `@internal` lost the tag (summaries checked; `@template` on the three
    generic helpers). A new warning: a name on an entry tagged `@internal` (none today).
  - **Differs from Phase 0:** `TypedArrayTransformStore` goes on `aekasha` instead of
    `getTypedTransformStore()` returning `IComponentStorage`: the toolkit's `HoverEffect`,
    `FollowTool` and `SunShadowFit` read its typed methods on their hot paths.
  - **Taken off the public surface instead (`@internal` members):**
    `FeatureContext.registerImportExtension` (one provider per member, physics' and LOD's: its 10
    `ImportExtension` types stay internal) and `LodChain.report` (debug info: `AssetLoadReport`,
    `AssetsFallbackCause`).
  - **Accepted until 6.0.0** (`ACCEPTED_LEAKS`, `entries.ts`; a key that no longer leaks warns):
    `PhysicsProbeReport` (through `TestBridgeProbeResult`) and `LegacySkyBoxParams` (through
    `LegacySkyBoxProps`), each a deprecated name's only type.
  - Left: the toolkit's 4 (p620): `MovingPlatformControls`, `AsteroidNoiseOptions`,
    `AsteroidCraterOptions`, `TerrainNoiseOctave`.
  - Not in the plan: `cache.test.ts`' ctime case (Phase 4) failed 2 runs in 5: the kernel's ctime
    clock is coarse, so a write in the stamp's tick kept the ctime. The test touches until the
    ctime moves on (12 / 12).
  - Checks: `yarn test` 1074 passed, lint, `tsc`; the docs ratchet unchanged (99 % / 97 %);
    `yarn hub:build`: the toolkit's 4, `{@link getRandomStream}` and the index size warning.
- **Section 3, `render.ts`' split (R4).** `render.ts` (599 lines): the memo, the pages, the
  section, the build's reports (`{@link}`s, R2, TypeDoc's messages) and the source links.
  `renderSymbol.ts` (630): the render context (`Ctx`, the links from the page being rendered,
  the headings), the coverage bar, the summaries, the comments, the tables and a symbol's
  rendering. `apiSearch.ts` (98): the search documents, memoized per model. Checked: `dist-hub/`
  before and after, with the build commit, the `?v=` hashes and the build time normalized, is the
  same but for the Version page's build time (and its words' counts in the search index).
- **Section 4, the pages per entry.**
  - `api/publicApi.ts` (`buildPublicApi`): a page per entry at its specifier
    (`documentation/aekasha/physics/`), an h2 per source module (`#module-<Name>`, its path and its
    summary over its public names), each name an h3 as before (functions, classes, interfaces,
    types, enums, constants, then by name). `aekasha` (300 names, over `MAX_ENTRY_PAGE_NAMES`
    150) has a page per source folder (a kernel area or `utils`: 12, `documentation/aekasha/scene/`,
    titled `aekasha · scene/`, `scene/` in the menu, before the other entries under it); its own
    page lists them. **Not in the plan:** `documentation/aekasha/toolkit/`, a group page listing
    the three toolkit entries (the menu needs a parent page). A name on two entries (the toolkit's
    `createSeededRandom`) is documented on the first and listed on the second as a re-export
    linking to it. A page URL two pages give is an error.
  - `model.ts` keeps the modules and the reflections only (the module pages, folders, targets and
    per-module coverage went); `ApiTarget` is `{ pagePath, anchor }`; `isApiPagePath` covers
    `documentation/aekasha/`. `getApiPagePath` (the old URLs) stays for p608's dormant codemod
    until D9. `HubGeneratedPage.order` (menu order) is new.
  - Links (`links.ts`): ids and names resolve against the public targets only. An `api:` link to
    an internal name fails with "is internal (<module>): it's on no entry, so it has no page" (no
    page had one). Every `{@link}` is collected; one in a public comment to an internal export is
    code with a warning. **The 18 such names (24 links, 15 engine files) became code spans**, so the
    build has no new warning (`DEBUG_KEYS_ACTION_MAP_ID`, `createRigidBodyWithColliders`,
    `RUNTIME_VIEW_ID`, `MAX_SNAPSHOT_SIZE`, `DebugDataSchema`, …).
  - The A-Z index and the search hold public names only, an entry page being a search document of
    kind `entry` (named by its specifier, `apiSearchName`). **The index went from 1.70 MB to
    985 kB** (3,677 → 1,281 API documents), under the 1 MB warning before Phase 6's cuts.
  - The symbol's `internal` badge moved to `@internal` members of public types (an `@internal`
    name on an entry warns since section 2).
  - The landing page lists each subtree's entries (names, folders, coverage), then the A-Z index.
    `hub:build`'s line: "16 entries, 920 names" (declarations: a value and a type of one name are
    two).
  - The 30 `hub:documentation/…` links (15 feature guides' "The API reference" bullets) point at
    the entry pages, or at `aekasha`'s folder pages for the kernel's areas; `intro.md`'s text and
    its entry table link the pages.
  - Tests: `publicApi.test.ts` (6: the pages and the group page, the re-export's home target, the
    sections' order, the folder split, an internal `api:` name, the nearest public owner); the
    model builder is `testModel.ts`, shared with `entries.test.ts`. Writing them found a re-export's
    `target` set to its own page, not its home's (fixed).
  - Checks: `yarn test` 1080 passed, lint, both `tsc`; `yarn hub:build`: 84 pages (436 before), no
    dead link, the toolkit's 4 and `{@link getRandomStream}` only.
- **Section 5, the checks and the docs.**
  - `yarn verify:baselines` (a build): the API changes are Phases 3-5's (the removed and added
    schema exports, `GLTF_LOD_EXTRAS_KEY`'s move, `stableStringify`, the 79 entry names plus
    `ColorJSON` and `applySkyBoxSaveEntry`); `docs.json` unchanged; no debug code. **`api.json`
    recorded alone** (919 names on 16 entries): `bundle.json` and `bundle.banner.json` were put
    back, for Phase 7's B2 re-record. Their diff besides B2's key swaps (`EngineRapier.js`, the
    banner's `AssetsWorker.js`): `_engine/utils` +1 module, +0.4 kB gzip (app) and +0.3 (banner),
    Phase 4's `StableStringify.ts` (the impostor hash), for Phase 7 to record.
  - The dev Hub (`vite serve`): the entry, folder and group pages serve with editor source links;
    an engine save gives the API page a 503, then the page after the child process's 8 s; other
    pages serve meanwhile.
  - A search round trip on `dist-hub/`' index: `createPhysicsEntity` and `WorldAPI` find their
    entry page anchors, `aekasha physics` the entry, the internal `createRigidBodyWithColliders`
    nothing.
  - Docs: `devTools/hub/CLAUDE.md` (Documentation: the entry list in the model, R3's pass, the
    pages, the links, the search, R2's checks replacing TypeDoc's validation, the upgrade check);
    `docs/techniques/hub-authoring.md` (`api:` to an internal name, `{@link}` in backticks, the
    search, two error rows); the root `CLAUDE.md`'s `yarn docs` line and JSDoc rule (`{@link}`
    only to public names), and the Hub's JSDoc standard the same.
  - Checks: `yarn test` 1080 passed, lint, both `tsc`; `yarn hub:build`: the toolkit's 4 and
    `{@link getRandomStream}` only.
- **For later phases.** Phase 6: the search index is 1,009,470 B raw, 259,575 B `gzip -9` (D7's
  gzip warning at 450 kB); its cuts 1, 7 and 9 still apply (Q2's module documents are gone:
  cut 7 now means the entry documents, which store no summary). Phase 8 (D2): engine minor items:
  the 79 entry names, the API URLs per entry (D3's changelog item), `FeatureContext`'s
  `registerImportExtension` and `LodChain.report` now `@internal`; p620's Inputs get the
  toolkit's **4** leaked types (`MovingPlatformControls`, `AsteroidNoiseOptions`,
  `AsteroidCraterOptions`, `TerrainNoiseOctave`), not 3. D15's "`intro.md` per entry" is done
  (the text and the entry table's links).

### Phase 6: the rest of the Hub generator and the search (D7, D10, D11, D16) — done

The search cuts and `hub-data.js`, `buildHub`'s and the plugin's splits, the dev rebuild costs
(measured against Phase 0), the citations and the dead exports, the generator's tests.

Sections:

1. **The search (D7).** From Phase 5's 1,009,470 B raw / 259,575 B `gzip -9` (`hub-data.js`
   55,615 / 13,364). Cut 1: a document's id is `<path index>#<anchor>` into a path table, and
   `path` and `anchor` aren't stored. Cut 9: a page section's `heading` isn't stored, the dialog
   reads it from its page's headings (the round-trip test checks every one matches). Cut 7 is
   done already (Phase 5: the entry documents store no summary). `hub-search.js` becomes the
   whole payload (`{ index, paths, pages, nav }`), and the decoding is `searchProtocol.ts`'s,
   shared by the build's test and the dialog. **`hub-data.js` (to confirm, beyond D7):** with
   `nav` and `pages` gone, nothing in the browser reads its other fields (`versions`, `build`,
   `latestChange`: the pages render them), so it goes, and the shell carries the index's URL
   in a `<meta>` (one request less per page; `diffBuilds` ignores its `?v=` as it did
   `hub-data.js`'). The warning measures gzip, over 450 kB, and `hub:build`'s line gives both
   sizes (`formatBytes` in KiB, H6). Tests: `search.test.ts` (the round trip on a small build:
   a page section, a heading, an API name, an entry, the decoded results; `splitSections`).
2. **The splits (D10).** `buildHub` (338 lines) into its steps: the page render and link check,
   the shell's page values, the dev error pages, the writes; `buildHub` keeps the order. The
   plugin's run state into `createHubDevRunner` (`devTools/hub/devRunner.ts`, with `diffBuilds`),
   on Phase 4's work queue (moved to `devTools/workQueue.ts`, shared with the gatherer's plugin),
   which also fixes the straddling burst here (G9's case: the loop took a debounced burst
   early). Tests on fake timers with a fake build: a save during the first build, a request
   waiting for the run in progress only, a straddling burst, the API's stale → rebuilding →
   `api` event, a failed run's `api` event. `dist-hub/` the same before and after (the build
   time normalized, as Phase 5 compared).
3. **The dev rebuild (D16).** Measured first, per step, against Phase 0's 837-983 ms. Then: the
   styles and scripts reused unless a changed file is under `hub/_assets/` (or there's no last
   build), shiki's output memoized per fence, the search index per documents' hash, the static
   asset hashes per file stamp across runs, and whatever else the measurement shows (the git
   processes, the page writes). Measured after; `devTools/hub/CLAUDE.md` and the plugin's
   header get the number instead of "tens of ms".
4. **The hygiene (D11) and the docs.** The plan citations (108 of p550-p555 and others in the
   generator, the Hub's TS and SCSS) replaced by what they explained; the 23 runtime exports
   nothing else imports made module-private or removed; the three file-wide `no-console`
   disables get their reason; `hubBuild.ts`' `fail` a `function … never`; `repoFiles.ts`' git
   call through `devTools/git.ts`; `buildPublicApi` (163 lines) split. H6's directive registry:
   the directives become an explicit list `createHubMarkdown` takes (no `import './cards'`), and
   `package.json`'s `sideEffects` loses `./devTools/**` if the Vite config bundle and the dev Hub
   work without it. D14's snippets test. Docs: `devTools/hub/CLAUDE.md`, `hub-authoring.md`,
   the root `CLAUDE.md` where a line changes. Checks: `yarn test`, lint, both `tsc`,
   `yarn hub:build`, the dev Hub by hand (a page edit, an SCSS edit, an engine save).

As built (2026-10-21, uncommitted):

- **Section 1, the search (D7).**
  - `hub-search.js` is the payload `HubSearchPayload` (`searchProtocol.ts`): `{ index, paths, nav,
    pages }`. A document's id is `toHubSearchId(pathIndex, anchor)` (`3#setup`); `path` and
    `anchor` aren't stored (cut 1). The heading is indexed, and stored (as `storedHeading`) only
    when the page's headings don't give the same text for its anchor (cut 9): on today's pages
    none needs it. `createHubSearchReader` decodes a result, the dialog's and the test's. The
    entry documents stored no summary already (cut 7, Phase 5). Empty `heading` and `text` are no
    longer stored.
  - **`hub-data.js` removed (beyond D7, to confirm):** nothing in the browser read its
    `versions`, `build` or `latestChange` (the pages render them), so with `nav` and `pages` in
    the payload it held one URL. The shell has `<meta name="aek-hub-search" content="…?v=…">`
    instead of the `<script defer>`, which the dialog resolves against `document.baseURI` (the
    404 page's `<base>`); `diffBuilds` ignores its `?v=` as it did `hub-data.js`'. `data.ts` went
    (`getPageSection` is in `pages.ts`, the nav and page list in `search.ts`), with its dead
    `HUB_DATA_GLOBAL`.
  - Sizes (`dist-hub/`, `--no-embed`): the payload 978,532 B raw, 263,529 B `gzip -9`, against
    Phase 5's index 1,009,470 / 259,575 plus `hub-data.js` 55,615 / 13,364. So every page load
    is 13.4 kB gzip and a request lighter; the first search downloads 3.9 kB gzip more (the menu
    and pages moved in), the two together 9.4 kB less. In it: the
    inverted index 444 kB, the stored fields 396 kB (`text` 245, `summary` 115, `kind` 20), the
    ids 49 kB, `pages` 49 kB, `nav` 5 kB, `paths` 2.5 kB. Cut 2 (the alternative) would act on
    `text`.
  - The warning is on gzip, over 450 KiB (`SEARCH_INDEX_WARN_GZIP_BYTES`); `hub:build`'s line
    reads "Search index: 256 KiB gzipped (954 KiB), 372 page sections and 1281 API docs".
    `formatBytes` says KiB / MiB (H6). The warning's text no longer cites p552.
  - `search.test.ts` (9): the payload's tables, nothing of `path` / `anchor` stored and only the
    markup heading stored, then round trips through the built module (imported as a `data:` URL,
    as the browser imports it, so the quoting is tested too): a page by its title with its
    description first, a heading read back from its page, a camelCase code part, the markup
    heading, an API name and an entry with `apiSearchName`, the homepage and an API page left
    out; `splitSections`.
  - Checked in Chromium on `yarn hub:preview`: `createPhysicsEntity` from a feature page, `fixed
    step` from Documentation, `sky box` from the 404 page (`/no/such/page/`), groups, crumbs and
    links as before; a page load fetches the font, `hub.css`, `hub.js` and its images, no
    `hub-data.js`. On a dev server: a Markdown edit and its undo each "Updated: 1 page
    (documentation/)" (891 and 837 ms, section 3's subject).
  - Docs: `devTools/hub/CLAUDE.md` (Search, Output, Version, the API's search line),
    `hub-authoring.md` (the output sketch, the search's loading, the warning row, the Version
    page), the comments naming `hub-data.js`.
  - Checks: `yarn test` 1089 passed (135 files), lint, both `tsc`; `yarn hub:build` with Phase 5's
    warnings (the toolkit's 4, `{@link getRandomStream}`).
- **Section 2, the splits (D10).**
  - `buildHub` (338 lines → 149; `build.ts` 693 → 281) keeps the order and the options; its
    steps are modules: `renderPages.ts` (`createMarkupHelpers`, the markup and slot fills,
    `renderHubPages` with the page images first, `checkLinks`), `shellPages.ts`
    (`createShellPages`: a page, the 404 page, the rebuilding page and an error page in the
    shell; `rebaseNotFoundPage`), `errorPages.ts` (`applyErrorPages`, the owner lookup),
    `writeOutput.ts` (`writeHubOutputAsync`: the writes, the images, the staging swap), and in
    `build.ts` `createSectionsAsync` and `collectSourceFiles`. The search's size check and
    `formatBytes` moved into `search.ts`. `dist-hub/` before and after (`--no-embed`): the same
    bytes in every file but the Version page's build time and status, and the search payload's
    `?v=` that follows from them.
  - `createHubDevRunner` (`devTools/hub/devRunner.ts`, 144 lines): the first build, the runs, the
    API's stale and rebuilding state, the reports and `diffBuilds`, with its dependencies
    injected (`buildAsync`, `extractApiAsync`, `start`, `watch`, `send`, `log`, `isApiInput`,
    `outDir`). `hubPlugin.ts` (458 → 187 lines, `configureServer` 291 → 117) wires the
    watchers, the HMR socket and the middleware.
  - The runs go through Phase 4's queue, moved to `devTools/workQueue.ts` (and its test; the
    gatherer's plugin imports it there), so the burst straddling a run's end is one more run here
    too. An API conversion's end is queued like a save (a 100 ms debounce, where it ran at once).
    **Not in the plan:** the saves during the first build, `hub/`'s and the watcher's, are queued
    as one run when it ends (the old loop ran `hub/`'s at once, then the others in a second run).
    A first build that throws is tried again on the next request, as before.
  - `devRunner.test.ts` (21, fake timers, a fake build per call): the first build once with the
    watching first, a save during it (one run after it, and none before the first request),
    editor temp files, a request waiting for the run in progress only, the straddling burst, the
    API's stale → rebuilding → `api` (one conversion), a failed run's `api`, a stale model from
    the first build, a first build that threw, `close`, a removed page's output deleted;
    `diffBuilds` (the volatile `?v=`s, `css`, `all`), `isEditorTempFile`.
  - On a dev server: a Markdown edit and its undo, each "Updated: 1 page (documentation/)"
    (906 / 816 ms); an engine save (`features/lines/Lines.ts`), then `aekasha/lines/` answered
    503 while `examples/` answered 200, "API docs rebuilt (TypeDoc 7.7 s)", "Updated: the API
    docs", then 200. (A save of `utils/StableStringify.ts` restarts the server instead: the Vite
    config imports it through the asset pipeline's cache keys, Phase 4.)
  - Docs: `devTools/hub/CLAUDE.md` (the build's steps, the dev plugin and its runner), the root
    `CLAUDE.md`'s queue path.
  - Checks: `yarn test` 1110 passed (136 files), lint, both `tsc`.
- **Section 3, the dev rebuild (D16).**
  - `HubBuildResult.steps`: each step's time (`meta`, `sections`, `discover`, `styles`,
    `scripts`, `render`, `search`, `shell`, `write`). Measured with `buildHub` in `dev` as the
    plugin calls it, in one process (a line appended to `documentation/intro.md` per run,
    restored after). **Before**, a page edit's median 815 ms: render 372 (shiki: highlighting
    every fence again, the issues' included), search 229 (the page sections 55, the index 40, its
    JSON 40, `gzip -9` 96), scripts 66, styles 39, write 38, meta 23 (two git processes the dev
    build's info made useless), shell 27, discover 18.
  - What a rebuild reuses now:
    - shiki's output per fence (`code.ts`' `highlightFence`, keyed by language, meta and code;
      cleared past 4,000 entries): render 372 → 60;
    - the search: each body's sections, and the serialized payload while its documents' hash
      holds (a text edit rebuilds the index, a style or script edit doesn't); `gzip -9` only in
      `public` (`isGzipMeasured`; the size warning is `yarn hub:build`'s): 229 → 91;
    - the styles and scripts (`reuseAssets`, which the runner asks for when no changed file is
      under `hub/_assets/`; only assets that built clean, `HubBuildAssets.isClean`, so an SCSS
      or TS error stays listed until fixed), and with them the static assets' and favicons' copy
      (`isStaticCurrent`): 105 → 0, and about 10 ms of the writes;
    - the static asset hashes per file stamp (size, mtime, ctime) across builds (`assets.ts`);
    - `getProjectMetadata(build)` runs no git when given the build info: 23 → 0.
  - **After:** a page edit's median 233 ms (search 92, render 60, write 32, shell 30, discover
    15), a rebuild with nothing changed 156. On a dev server: six Markdown edits and the undo
    211-274 ms, against Phase 0's 837-983; an SCSS edit and its undo 334 / 274 ("Updated:
    styles"); a TS edit and its undo 370 / 291 ("every page reloads"); a trailing comment in a TS
    file gives the same bundle, so no event. The first build stays about 3.7 s.
  - Not done (an option, not in D16): the dev search built on its request instead of in every
    run (the dev server ignores `?v=` and sends `no-cache`), which would take the 90 ms off a page
    edit.
  - Not in the plan: a process's first import of rollup spends 3.6 s in
    `process.report.getReport()` (rollup's `isMingw32`, slow under WSL); once per process, before
    the dev server's first request.
  - `dist-hub/` (`--no-embed`) the same as section 2's, file for file, but the build time, status
    and commit (section 2 committed in between).
  - Tests: `search.test.ts` (+2: the payload reused for the same documents and rebuilt for a
    changed page; no gzip when not asked), `devRunner.test.ts` (+1: `reuseAssets` false for the
    first build and an SCSS save, true for a page save).
  - Docs: `devTools/hub/CLAUDE.md` (the times, what a rebuild reuses, the gzip in `public` only).
  - Checks: `yarn test` 1113 passed (136 files), lint, both `tsc`.
- **Section 4, the hygiene (D11) and the docs.**
  - Citations: the 81 of the deleted p550-p555 in the generator, the plugin, `hubBuild.ts`, the
    Hub's TS, SCSS and `hub.config.ts` (most were bare `(p553 §2.5)`s; the few that said
    something, like "p552's 1 MB", now say it), and the four in `hub/CLAUDE.md` and
    `devTools/hub/CLAUDE.md`. The other plans the generator cites still exist (p601, p605, p606,
    p608, p611, p612, p618, p619) and stay. Stale text they sat in was fixed: `render.ts`'
    header and `_api.scss` still described module pages. **For Phase 8:** the root `CLAUDE.md`
    still cites p550, p551 and p554 (five places, the start scene, the Æ symbol, the Hub tab).
  - Exports: 18 runtime exports nothing else imports are module-private (`hashApiInputs`,
    `printType`, `parseFenceMeta`, `isHubLink`, `isRepoLink`, `parseHubLink`, `sortPages`,
    `dedent`, `HUB_LAYOUT_DIR`, `HUB_CONTENT_TYPES`, …). **Not in the plan:** the 19th,
    `HUB_CODE_PALETTES`, was exported "for the contrast check" that was never written:
    `codeThemes.test.ts` is it (every colour of both themes at WCAG AA on `--hub-code-bg` and on
    the four line tints, read from `_tokens.scss`, and the palettes' `bg` equal to it). It passes.
  - Summaries on the scope's 112 undocumented exports (p600 §5's bar for the devTools; not
    listed in the section, Phase 4 did the same for its scope).
  - K1: the three file-wide `no-console` disables (`hubBuild.ts`, `hubPreview.ts`,
    `hubPlugin.ts`) and the browser side's four `no-console` lines have their reasons. K2:
    `hubBuild.ts`' `fail` is `function fail(…): never` (no cast depended on it; `embed.ts`' and
    `extract.ts`' `fail`s return values, so they stay). K3: `repoFiles.ts` lists the nested
    CLAUDE.md files through `devTools/git.ts`' `readGit`.
  - `buildPublicApi` 163 → 132 lines: `addGroupPages` and `addCoverage`.
  - **H6, the directive registry:** each directive is a `HubDirective` its module exports
    (`codeGroupDirective`, `sceneDirective`, `embedDirective`, `cardsDirective`,
    `claudeMdDirective`); `build.ts`' `HUB_DIRECTIVES` lists them, and `createHubMarkdown` takes
    them over its own (the callouts and `dev-only`, now a table). `registerHubDirective` and
    `import './cards'` are gone, so nothing in the Hub registers at load, and **`package.json`'s
    `sideEffects` lost `./devTools/**`** (the root `CLAUDE.md`'s line says why it's not needed).
    Checked without it: every directive renders on the dev server (cards, scene, embed,
    code-group, claude-md, the callouts), a save gathers, `yarn verify:devFiles` 61 / 61, and
    `vite build` of the app is the same bytes with and without the entry.
  - D14: `snippets.test.ts` (18: the spec's parse; a region with nested markers, any comment
    style, lines numbered as in the file and not when a dropped marker shifts them, a whole file,
    JSON whole and by lines; each error: no such region (with the names), twice, unclosed, a
    line range out of the file, a JSON region, empty, missing, not text, a symlink out of the
    repo, absolute, outside, none given; a missing file's path kept for the watcher), in a folder
    under `.cache/`.
  - `dist-hub/` the same as section 3's, file for file (the build time, status and commit aside).
  - Docs: `hub/CLAUDE.md` (the directives, the contrast test), `hub-authoring.md` (a new
    directive), the root `CLAUDE.md` (`sideEffects`).
  - Checks: `yarn test` 1134 passed (138 files), lint, both `tsc`; `yarn hub:build` with Phase
    5's warnings only (the toolkit's 4, `{@link getRandomStream}`).
- **For Phase 8 (D2, D3):** Project items: the search payload (`hub-data.js` removed, the
  `<meta>`, the gzip warning), the generator's split and the dev runner, the dev rebuild times,
  the shared work queue, the directives as a list and `sideEffects` without `./devTools/**`, the
  contrast test. No engine, toolkit or app file changed in Phase 6 (the `eslint-disable` reasons
  in `hub/_assets/ts` are the Hub's).

### Phase 7: verify, sbp and refactor (D9, D12, D13) — done

The runner's split and reload handling, the sizes plugin, the keys, the budgets re-set,
`bundle.json` re-recorded, `refactor/` → `layout/`. Checked: a `--config quick` run with a
`yarn gatherAppData` run alongside (no reload), and the V3 optimizer case from §1.4 (a new bare
import in a scene, then a `--only` run).

Sections:

1. **`refactor/` → `layout/` (D9).** Deleted with their tests: `applyMoveMap.ts`, `moveApply.ts`,
   `moveSplit.ts`, `moveText.ts`, `moveEdits.ts`, `moveJson.ts`, `moveTree.ts`,
   `compareBaselines.ts`, and the generated `moveMap.json`, `layoutReport.md`, `entryExports.json`
   (the last commit that has them goes into Phase 8's changelog entry: the parent of this
   section's commit). Into `devTools/layout/`: `importGraph.ts` (+ test; `hub/api/extract.ts`
   imports it), `moveRules.ts` as `layoutRules.ts` (every rule is a keep since p609, so the
   move, delete, merge and split machinery goes: a rule says which folder a file belongs to),
   `migrateToEntries.ts` and `entryImports.ts` (+ test). `moveMap.ts`' layout half becomes
   `layout.ts` (the zones, the edge checks, the cycles; no file system but what the caller
   hands it) with `layout.test.ts` on the tracked tree: every engine, toolkit and app file under a
   rule, module names PascalCase, no engine → toolkit / app / generated import, no runtime
   kernel → feature import (the assets worker's job `import()`s apart), no feature cycle, the
   `utils/`, `schemas/` and `ui/` boundaries as the report has them (the type-only edges are
   listed, not failed), plus cases on a small in-memory tree for each check. The report on
   demand: `npx tsx devTools/layout/layoutReport.ts` writes `.cache/layout/layoutReport.md`.
   `ROOT` from `devTools/paths.ts`, git through `devTools/git.ts`. References follow: the root
   `CLAUDE.md` (the three refactor commands become two, the Three-folder split's
   `moveRules.ts` / `moveMap.ts` mentions), `sbp/CLAUDE.md`, `eslint.config.js`' comment, the
   coding standards' layout report line, the engine-5 migration page's codemod path,
   `docs/techniques/` where named. Checks: `yarn test`, lint, both `tsc`, `yarn hub:build`
   (the migration page), the report written.
2. **The scene runner's split (V1) and `verify/`'s tests and hygiene.** `scenes.ts` (918 lines)
   into `scenes.ts` (the CLI: arguments, the server, the browser, the loop, the summary; `main()`
   only when run as a script), `sceneRun.ts` (`runOne` and its compares, `runOne` split into the
   page setup, the probe and paths, the snapshot and the system order), `sceneBaseline.ts`
   (paths, read, record, the Firefox lookups) and `sceneSelect.ts` (the pure parts: `parseArgs`
   returning its errors instead of exiting, `appliesTo`, `selectScenes`, `buildUrl`,
   `checkCrossTargetHashes`). `getCommit` through `devTools/git.ts`; the `fail` helpers of
   `scenes.ts`, `embed.ts` and `baselines.ts` become `function … never` (K2). D14's tests:
   `sceneSelect.test.ts` (arguments, sets, Firefox's limits, globs, URLs, the cross-target
   check), `sceneBaseline.test.ts` (a missing, unreadable and other-format baseline, with and
   without `--update`; the record merge; Chromium's entry for Firefox), `baselines`' `diffApi` /
   `diffDocs` on small inputs. Summaries on `verify/`'s undocumented exports, the `eslint-disable`
   reasons. The runner's output unchanged (a `--only scene01 --config quick` run before and
   after).
3. **The runner's reloads (V3, D13).** The runner's server: `cacheDir: node_modules/.vite-verify`,
   `server.host: 'localhost'`, a `customLogger` whose Vite info lines about optimizing and
   reloading go to the progress log (`logLevel` stays `warn` for the rest). `vite.config.ts`:
   `optimizeDeps.entries` with `index.html` and the two worker entries; the hand-kept `include`
   list goes if a cold start (an empty cache folder) then a load of every worker-using scene
   shows no re-optimize, else it stays with a comment saying why. A page whose main frame
   navigates after its first load (a reload) is run once more in a fresh context, with a note
   naming it; a second navigation is a failure. The run hashes `generatedAppData.json` at its
   start and end and warns when it changed. Checks: a `--config quick` run with
   `yarn gatherAppData` (and a no-op asset save) alongside: no reload, no warning but the
   gather's; the V3 optimizer case (a bare import of a not-yet-optimized dep added to a scene,
   then `--only` that scene: the rerun note, or no reload with the entries); undone after.
4. **The sizes and the keys (B1, B2, V7).** `devTools/sbp/moduleSizesPlugin.ts` (build, `post`,
   `renderChunk`): each module's rendered code per chunk minified with esbuild, summed per group
   and chunk, and the gzip of each group's concatenated minified code per chunk; in the main build
   and in `worker.plugins` (one collector, written by the main build's `writeBundle` to
   `dist-stats/module-sizes.json`, an embed's next to its visualizer report). Each module's record
   says which build it's from (`main`, or the worker's name). `bundleModel.ts` reads it:
   `mainGroups` become `{ modules, minified, gzip }`, the split groups the same,
   `BUNDLE_FORMAT_VERSION` 2, `REPORT_FORMAT_VERSION` 3 (the Hub's reader follows); the
   visualizer stays for the import graph (`--why`) and the treemap. The debug check reads its
   modules from the new file, so the worker builds' modules are checked (V7). B2's keys
   (`keyFiles` replaced): a base one file has keeps it; in a collision the manifest's chunk keeps
   the plain base, a worker build's copy is `<key>@<worker>` (`assets/EngineRapier.js@PhysicsWorker`;
   the worker's files found by `findReachableFiles` from the file its `?worker` wrapper names),
   manifest files of one base are `<key>@<source folder>` (`assets/draco_decoder.wasm@gltf`), and
   any other collision throws. Tests: the keys (a hash swap gives the same keys, the Draco pair,
   an ambiguous one), the plugin on `testBuild.ts`' fixture build or a tiny real `vite build` with
   a worker, the debug check on a worker module. Nothing recorded yet.
5. **Re-recorded, the budgets and the docs (D12).** `bundle.json` and `bundle.banner.json`
   recorded with the new format and keys (Phase 5's `StableStringify.ts` growth with them);
   `sbp.config.ts`' `groups` and `modules` budgets re-set from the first new report
   (`suggestBudget`), its "a group counts its comments" notes gone, the `'assets/PhysicsWorker.js'`
   budget renamed to the worker's key, `initial` and `chunks` as they are. `sbp/`'s hygiene
   (`sbp.ts`' `fail`, summaries, `eslint-disable` reasons). Docs: `sbp/CLAUDE.md` and
   `verify/CLAUDE.md` (the sizes, the keys, the workers in the debug check, the runner's server
   and reloads), the root `CLAUDE.md`'s lines, the Hub's SBP guide's "before minification"
   (D15's page item, done here with its numbers). Checks: `yarn verify:baselines` (passes after
   the record), `yarn sbp --profile all` (within every budget), `yarn verify:embed`,
   `yarn hub:build`, `yarn test`.

As built (2026-10-22; sections 1-4 committed as `b1083be`, `07e486a`, `85dab64` and `7464a5a`, 5 after them):

- **Section 1, `refactor/` → `layout/` (D9).**
  - Deleted: the codemod (`applyMoveMap.ts`, `moveApply.ts`, `moveSplit.ts`, `moveText.ts`,
    `moveEdits.ts`, `moveJson.ts`, `moveTree.ts`), `compareBaselines.ts`, their seven tests, and
    `moveMap.json`, `layoutReport.md`, `entryExports.json`. **For Phase 8's changelog:** the last
    commit that has them is `057cbae` (Phase 6 section 4).
  - `devTools/layout/`: `importGraph.ts` (+ test, its rules block moved out), `layoutRules.ts`
    (was `moveRules.ts`: a rule is `{ from, note? }` and `findLayoutRule` the longest match; the
    `to`, `action`, `plan` and `split` fields and `applyMoveRules` went, since every rule was a
    keep), `layout.ts` (the check, no file system: `checkLayout` and `getLayoutErrors`, the zones
    and edge categories of `moveMap.ts`, with the target mapping gone), `layoutTree.ts` (the
    working tree: `git ls-files --cached --others --exclude-standard`, existing files only, so a
    new file counts before it's added and an ignored one never), `layoutReport.ts` (the report
    on demand into `.cache/layout/layoutReport.md`; exits 1 on a layout error after writing it),
    `entryImports.ts` (+ test) and `migrateToEntries.ts`. `hub/api/extract.ts` imports the
    parser from there.
  - `layout.test.ts` (11): the working tree passes (577 modules of `src/`, 3,898 imports, 0.75 s
    for the file), and on small trees: a file outside the rules, a camelCase module, a case
    clash; a kernel `import type` of a feature passes and a runtime one through an entry alias
    fails; the assets worker's job `import()` and a kernel debug module's import pass; a feature
    cycle fails, not through types or debug code; an engine `import type` of the app fails; a
    package in `utils/`, a runtime ui → kernel import, a type-only schemas → kernel import
    listed but not failed; an unresolved relative import. A new untracked file outside the rules
    fails the tree test (checked with a stray `src/app/zz/Stray.json`).
  - **What fails (decided here, not in D9's text):** any runtime or dynamic edge of a boundary,
    type-only edges only where the lint refuses `import type` too (engine → app, toolkit,
    generated data), a feature cycle, a package imported by `utils/` (not a test), an unresolved
    relative import, and the three file checks. Today's type-only edges stay listed: kernel →
    feature 27, schemas → kernel 10 (8 in the old report: two `RuntimeTypes.test.ts` imports
    since). The old report's sections that described moves (split, merged and deleted files'
    imports, the paths outside the import graph, the entry exports) went with them.
  - **Not in the plan:** `src/app/x/new.json` (`{ "a": 1 }`), committed in Phase 4 section 5, is
    deleted: a dev files test's write that reached the repo while that section moved `ROOT` (today's
    `commit.test.ts` writes only into its temp root: its run leaves the file's mtime alone). The
    old `moveMap.ts --check` already reported it; the new test fails on it.
  - References: the root `CLAUDE.md` (the move map and codemod lines become the layout check's
    line, the codemod's path, the Three-folder split's three rule mentions, the lint line's
    report), `sbp/CLAUDE.md`, `ui/CLAUDE.md` (`UI_KERNEL_HOOKS`' home), `eslint.config.js`'
    comment, the coding standards' layout line (the test and the report), the engine-5 migration
    page's codemod commands. `readme.md` names the codemod by file name only, unchanged.
  - Checks: `yarn test` 1091 passed (132 files), lint, both `tsc`; the report written (0 errors,
    37 boundary imports, no feature cycle); `yarn hub:build --no-embed` with Phase 5's warnings
    only (the toolkit's 4, `{@link getRandomStream}`).
- **Section 2, the scene runner's split (V1) and `verify/`'s tests and hygiene.**
  - `scenes.ts` 918 → 289 lines: the CLI (the server, the browser, the loop, the printing, the
    Firefox baseline check, the summary), `main()` only when run as a script. `sceneRun.ts`
    (439): `runOne` (75 lines) over `openPage`, `loadScene`, `runProbe` (the probe, both hashes,
    the snapshot) and the system order; `compareHash` and `comparePathHash` are one
    `compareRunHash`, the same messages. `sceneBaseline.ts` (211): the result and baseline types,
    the paths (`getResultPaths(dir, cacheDir?)`), `readBaseline` (returns the `--update` problem
    instead of printing it; the context's `onProblem` prints), `getBaseline`, the Firefox lookups,
    `recordBaseline({ paths, baseline, results, commit, now })`. `sceneSelect.ts` (141):
    `parseSceneRunArgs` and `selectScenes` return their error instead of exiting, `appliesTo`,
    `buildSceneUrl`, `checkCrossTargetHashes`.
  - `getCommit` through `devTools/git.ts`' `readGit`; the `fail`s of `scenes.ts`, `embed.ts` and
    `baselines.ts` are `function … never` (no cast depended on them).
  - **Not in the plan:** `baselines.ts` runs `main()` at load too, so its types, `formatShare`,
    `diffApi` and `diffDocs` moved into `baselinesDiff.ts` (as `sbp/bundleDiff.ts` holds the
    bundle's), which the test imports; `baselines.ts` 541 → 395 lines.
  - Tests (+29): `sceneSelect.test.ts` (the defaults, options, a set with configurations, each
    error, Firefox's limits, globs in the data order, a literal `.`, `appliesTo` with and without a
    configuration, both URL modes, the cross-target check), `sceneBaseline.test.ts` (a missing,
    good, cut-off and other-format baseline, `--update` over a bad one; a backend read once;
    Firefox's webgl-then-webgpu lookup; the backend mismatches at the same steps; the record's
    merge, snapshot copy and statuses, in a temp folder), `baselinesDiff.test.ts` (a move, a
    removal, an addition, a kind change, the entries; the ratchet's growth with its line, a new
    folder, better coverage, a lower share, a swap, a gone folder, a name counted twice).
  - Summaries on `verify/`'s 13 undocumented exports (`scenes.config.ts`' 7, the snapshot, embed
    and example types); no `eslint-disable` without a reason was left in `verify/`.
  - Checks: `yarn test` 1120 passed (135 files), lint, both `tsc`; the argument errors exit 2 with
    their messages; `--only scene01 --config quick` before and after: the same output and the
    same `last-run.json` results (hash `7788c6ec`), the timings aside.
- **Section 3, the runner's reloads (V3).**
  - The runner's server: `cacheDir: node_modules/.vite-verify` (cause 2: no more sharing with
    every `yarn dev*`), `server.host: 'localhost'`, and a `customLogger` (Vite's at `warn`) whose
    `info` sends Vite's dependency, optimize and page reload lines to the progress log as
    `[vite] …`.
  - **Differs from D13: no `optimizeDeps.entries`, and the `include` list went.** A server on an
    empty cache folder, its scan's `_metadata.json` read: the 22 deps, the five the `include`
    named among them, with the worker files as entries and without them (Vite 6.4.3's scan follows
    the workers now). Entries would add a list that changes nothing (and drop the default HTML
    discovery); `vite.config.ts` says why there's no `optimizeDeps`.
  - A page whose main frame navigates more than once (`framenavigated`), or whose page call
    Playwright cuts off with "Execution context was destroyed … navigation" (the reload rejects
    the call before the next document's navigation is seen: the first try counted
    `domcontentloaded` and missed it), runs once more in a fresh context with
    `RELOAD_RERUN_NOTE`; a reload in that second run fails it.
  - The run hashes `generatedAppData.json` at its start and end and warns when it changed.
  - Checks:
    - `--config quick`, all 27 scenes on the empty `.vite-verify` (1,192 s): 26 passed;
      `thirdPersonGymScene` failed as on this machine in Phase 0 (the probe didn't reach step 600
      in 300 s). After the third scene, a camera JSON written with its own bytes and
      `yarn gatherAppData`: the dev server's gather ran, "the generated data unchanged", no
      `[vite]` line, no rerun, no warning.
    - A reload mid-run (a comment added to `src/AppECSPlugins.ts` 20 s in, no HMR boundary):
      `[vite] page reload AppECSPlugins.ts`, then `scene01` passed in its second run with the
      note and its hash `7788c6ec`.
    - The optimizer case (a bare `import 'three/addons/math/ImprovedNoise.js'` added to
      `scene01.ts`, the cache warm, `--only scene01`): `[vite] ✨ new dependencies optimized`,
      `✨ optimized dependencies changed. reloading`, then the rerun passed with the note and
      `7788c6ec`. Vite didn't scan again at start with a warm cache, so cause 1 needs the rerun
      even with a perfect scan. Both edits undone after.
    - Both reloaded runs' second runs noted "snapshot within tolerance (mean 0.002, changed
      0.01 %, max 116)", which the runs without a reload don't: within the tolerance, not chased.
    - `yarn test` 1120 passed, lint, both `tsc`. The first Stop hook run had
      `FeatureFactories.test.ts` time out at 5 s while SwiftShader ran beside it; alone 1.4 s, and
      the full suite passed after.
  - Docs (`verify/CLAUDE.md`'s runner text) are section 5's.
- **Section 4, the sizes and the keys (B1, B2, V7).**
  - `sbp/moduleSizesPlugin.ts`: `createModuleSizesPlugins({ file, root? })` gives `plugin()` (in
    `plugins`) and `workerPlugin()` (in `worker.plugins`, a new one per worker build), one
    collector: each build's chunks measured in **`generateBundle`, not `renderChunk`** (the final
    file names; `renderChunk` has hash placeholders, and `RenderedModule.code` is the same
    pre-minification code in both). Each module's rendered code minified with esbuild (`format:
    'esm'`, `treeShaking: false`, `charset: 'utf8'`, the build's target; a parse error counts it
    unminified with a warning), a group's gzip is its modules' minified code concatenated per
    chunk, and each module's own gzip is kept too. The main build's `buildStart` resets it, its
    `writeBundle` writes `dist-stats/module-sizes.json` (an embed's
    `dist-stats/embed-<id>/module-sizes.json`, `getEmbedSizesFile`). A worker build is named by its
    entry chunk (`PhysicsWorker`, `AssetsWorker`). **Not in the plan:** Rapier and the two meshopt
    chunks are one file both the main and a worker build emit (the same code, so the same name);
    the main build's record keeps it and the worker's records of it are dropped at the write
    (`dropSharedChunks`), or a `modules` budget would count them twice. Cost: 0.5-2.5 s per app
    build (two timed builds each way, noisy); the plugin's test build (a worker, two `shared`
    chunks) 0.4 s.
  - `bundleModel.ts`: `BUNDLE_FORMAT_VERSION` 2; `GroupSize` is `{ modules, minified, gzip }`,
    `main` is `{ chunk } & GroupSize` (its groups summed); the sizes file's types,
    `MODULE_SIZES_FORMAT_VERSION`, `MAIN_BUILD` and `readModuleSizes` live here (the plugin imports
    `getModuleGroup`, so no runtime cycle). `BuildLocation` gains `sizesFile`. `collectBundle`
    throws on a missing or other-format sizes file, and on sizes or visualizer data with no module
    in the main chunk; it returns `sizes` (the build's files only: an embed's pruned ones dropped).
    `findMainChunkFile` takes the files' measured gzip, `measureMainChunk`, `measureSplitGroups`
    and `measureModulesUnder` (a `modules` budget: the modules' own gzip summed, a little over a
    group's) read the sizes. The visualizer stays for `--why`, the emitted files' importers and the
    treemap. `REPORT_FORMAT_VERSION` 3 (`hub/sbp.ts` follows through the import; its comment says
    "minified").
  - **B2's keys, `sbp/bundleKeys.ts`** (`stripHash`, `findReachableFiles` moved from
    `embedBuild.ts` with its test, `keyBuildFiles`). **Differs from the plan:** a worker's files
    are its chunks from the sizes file plus what they reach by name, not a crawl from the file the
    `?worker` wrapper names: a static `?worker` import inlines the wrapper (no manifest key), which
    the plan's way couldn't follow. The rest as planned: a name one file has is its key; in a
    collision the manifest's file (a chunk, its CSS or assets) keeps it, a worker's copy is
    `<key>@<worker>`, two manifest files are `<key>@<source folder>`; a file outside the manifest
    reached by no worker or by two, a manifest file without a source, and two equal keys throw.
    Today's build: `assets/EngineRapier.js@PhysicsWorker`, `assets/PhysicsWorker.js@PhysicsWorker`
    (the 134 B wrapper keeps `assets/PhysicsWorker.js`, so section 5 renames the budget to the
    worker's key), `assets/AssetsWorker.js@AssetsWorker`, `assets/three.module.js@AssetsWorker`, and
    `assets/draco_decoder.wasm@draco` / `@gltf`, `assets/draco_wasm_wrapper.js@draco` / `@gltf`.
  - V7: `BuildModule` gains `build`; `listBuildModules` reads the sizes file, so the debug check
    sees the workers' modules (372 in the app's build, 59 from the two workers), and a finding in
    a worker says so (`… in assets/w.js (the w worker)`).
  - The report: a feature with lazy code only and no scene needing it read "scenes: " with
    nothing after (the banner's `lod`, the assets worker's LOD jobs, now measured): it says "no
    scene's data needs it (lazy only …)".
  - Numbers (not recorded): the app's initial groups sum to about 388 kB against the 378.3 kB
    `assets/index.js` (832 kB before); `three` 254.5 kB (642 kB budget), physics 23.5 (44),
    skybox 17.6 (30), `kernel/ecs` 7.0 (17). Every budget passes, 18 of the app's and 6 of the
    banner's well under, and `'assets/PhysicsWorker.js'` now measures the wrapper: section 5's
    re-set. `verify:baselines --no-build`: `bundle.json` and `bundle.banner.json` read as no
    baseline (format 2), `api.json` and `docs.json` unchanged, no debug code in either build.
  - Tests: `bundleKeys.test.ts` (the crawl; the app's collisions, a hash swap giving the same keys,
    three throws), `moduleSizesPlugin.test.ts` (a real `vite build` of a tiny app with a worker in
    a temp folder: both builds measured and minified, the `shared.js` / `shared.js@w` keys through
    `collectBundle`, the worker's `_dbg__` module found), `debugInProduction.test.ts` (a worker's
    debug module), `bundleSplit.test.ts` (groups from the sizes, a worker chunk lazy),
    `bundleDiff.test.ts` reads temp baselines (the committed one is format 1 until section 5), the
    fixture `testBuild.ts` gains `SIZES`. `yarn test` 1126 passed, lint, both `tsc`.
- **Section 5, re-recorded, the budgets and the docs (D12).**
  - `bundle.json` and `bundle.banner.json` recorded in format 2 (`verify:baselines --update`;
    `api.json` and `docs.json` unchanged, no debug code). Against the format-1 files, besides the
    keys (`#2` → the plain key or `@<worker>` / `@<folder>`; the banner's `AssetsWorker` pair was
    numbered the other way round from the app's, B2's swap): `assets/index.js` +75 B gzip and
    `assets/banner.embed.js` +80 B (Phase 4's `StableStringify.ts`, Phase 5's note), and
    `assets/LodChainGLTF.js` −20 B (Phase 5's `GLTF_LOD_EXTRAS_KEY` move to `LodChainOptions.ts`).
  - `sbp.config.ts`: every `groups` budget re-set with `suggestBudget` from the new report (app:
    `three` 642 → 265 KiB, physics 44 → 25, skybox 30 → 19, `kernel/ecs` 17 → 9, …; banner:
    `three` 633 → 262, `kernel/ecs` 17 → 8, …), one note per profile saying so; the "a group counts
    its comments" notes (p612's, p614's, p615's) went, p613's D4 / D5 notes stayed.
    `'assets/PhysicsWorker.js'` → `'assets/PhysicsWorker.js@PhysicsWorker'` (9.3 kB of 11 KiB,
    unchanged), with a note that the plain key is the wrapper. `initial`, `chunks` and the
    `modules` budgets (the icons at 0) as they were; `assets/index.css` stays well under (3 KiB),
    as D12 says.
  - `sbp/`'s hygiene: `sbp.ts`' `fail` a `function … never`; summaries on its 30 undocumented
    exports (`testBuild.ts`' fixture included); `embedBuild.ts`' `eslint-disable` has its reason;
    `bundleGrowth.ts`' header no longer names the deleted `compareBaselines.ts`.
  - Docs: `sbp/CLAUDE.md` (the groups' text; new bullets for the module sizes and the keys; the
    `modules` budgets; the debug check's workers), `verify/CLAUDE.md` (`bundle.json`'s keys and
    sizes; the debug check's workers; section 3's runner server, reruns and the generated data
    warning), the root `CLAUDE.md` (`yarn sbp`'s line, the build config's plugin line, the map's
    sbp line), the Hub's SBP guide (the features' table now minified, the groups about 2 % over the
    chunk).
  - Checks: `yarn test` 1126 passed, `yarn lint`, both `tsc`; `yarn verify:baselines` (a fresh
    build): all four baselines unchanged, no debug code in either build; `yarn sbp --profile all
    --no-build` on that build: every budget within (the app's `assets/index.css` well under, as
    kept), both diffs unchanged; `yarn verify:embed --no-build` 3 / 3; `yarn hub:build` 84 pages
    with Phase 5's warnings only (the toolkit's 4, `{@link getRandomStream}`); the guide's table
    reads physics 23.5 KiB, sky box 17.6 KiB.


### Phase 8: the Hub, CLAUDE.md, versions and done (D15, D2) — done

1. D15's pages and files; `readme.md` where it names a command or the refactor tools.
2. `yarn verify:scenes` (Phases 1-7), `yarn verify:baselines`, `yarn verify:embed`, `yarn build`,
   `yarn hub:build`.
3. `package.json` (D2), the `CHANGELOG.md` entry (D3's behaviour changes, the URL change, the
   removed refactor files' last commit), `yarn checkVersions --against main`.
4. Mark the plan done; p621's `Blocked by`, p620's Inputs (R2's toolkit types), p302's "From
   p619" note (D5).

As built (2026-10-22; step 1 committed as `633005f`, steps 2-3 as `fe84504`, 4 after them):

- **Step 1, D15.** Most of D15's pages were done in their phases (the asset optimization guide in
  Phase 1, `intro.md` per entry in Phase 5, the SBP guide in Phase 7). Left for here:
  - The Hub's coding standards: "No internals in public types" named TypeDoc's `notExported`
    check, which Phase 5 replaced (now: the warning at the reference, with the types it names, and
    the three fixes), and a new **Dev tools** section (D8's imports, K3's helpers, nothing run at
    load, K2's `function … never`, K4's `*Async` for new code). The root `CLAUDE.md`'s Dev tools
    line says the same.
  - `readme.md`: the `yarn test` row (the tooling and the structural checks), the `yarn assets`
    row (the prune rule), the content pipeline row (the stricter gather), the `devTools/` tree
    line, the API reference line (a page per entry).
  - **The five devTools `CLAUDE.md` files and the root's tooling sections checked claim by claim
    against the code** (three agents, each finding confirmed before the fix). Not in the plan,
    found that way: the dev Hub rebuilds on more sources than listed (`repo:` targets, the
    `CLAUDE.md` files, `generatedAppData.json`, the scenes' `.hub.png`, page images), TypeScript
    loads in `yarn hub:build` on a cache miss, `yarn docs` still runs TypeDoc's validation,
    `verify:baselines` diffs four files and builds the embeds, the ports fall back to the next
    free one, `sbp`'s group list and its 3 % (not 2 %), the banner's renderer options,
    `embedPaths.ts`' stale reason (its header too, and `baselines.ts`' "three files"),
    `commit.test.ts` missing from the dev files' tests, the `yarn assets` suffixes, `yarn sbp`'s
    own progress log, the gather's module list. The root lost Phase 6's five p550 / p551 / p554
    citations, and gained `yarn copyDecoders` and the build config's other plugins.
  - **K3 leftovers (code):** `copyDecoders.ts`, `projectMetadata.ts` and
    `toolkit/buildAekashaSymbol.ts` worked out the repo root themselves; they import
    `devTools/paths.ts` now.
- **Step 2.** All on the branch at `633005f`, one after another (`yarn build` regathers
  `src/generated/`, so it ran before the scene run):
  - `yarn verify:baselines` (a fresh build): the four baselines unchanged, no debug code in either
    build. `yarn verify:embed --no-build` 3 / 3.
  - `yarn build` (33 s): `yarn sbp --profile all` within every budget (`assets/index.css` well
    under, as kept), `yarn hub:build` 84 pages with Phase 5's warnings only (the toolkit's 4,
    `{@link getRandomStream}`), the search 256 KiB gzip (957 KiB), 373 page sections.
  - `yarn verify:scenes` (64.5 min, WebGL2 on SwiftShader, against Phase 0's baseline): 105 passed,
    3 failed, 0 new. The failures are `thirdPersonGymScene`'s three debug configurations ("the
    physics probe didn't reach step 600 in 300 s"), as in Phase 0 and Phase 7 on this machine;
    they have no baseline system order for the same reason. Every other hash and system order
    matches, the 15 changed snapshots are within the tolerance, `space`'s `mainThread` hash apart
    from the workers as in Phase 0, no rerun, no reload, the generated data unchanged.
  - Not in the plan: the Stop hook's `yarn test` ran during the chain's `yarn build`, and
    `buildGuard.test.ts`' full Hub build failed early (that build swaps `src/generated/` to the
    production data and rewrites the `yarn sbp` report, both the Hub's sources). Alone after it:
    9 / 9. Don't run `yarn test` beside a `yarn build`.
- **Step 3, D2.** Engine and project 5.9.0 → 5.10.0 (Golden Hour), app 1.13.1 → 1.13.2 (the two
  scenes naming the fixture generators), the toolkit unchanged (no toolkit file changed).
  `api.json` against `main`'s: no name left an entry; 79 added, plus `ColorJSON` and
  `applySkyBoxSaveEntry`. The `CHANGELOG.md` entry has D3's behaviour changes (the API URLs under
  Engine; the gather's failures, G13's merge, the prune, `yarn sbp`'s numbers and keys and G7's
  reloads under Project, which the Engine intro points to), `057cbae` as the removed refactor
  files' last commit, and the engine's JSDoc at 100 % (2,321 / 2,321 exports, 890 / 890 members).
  `yarn checkVersions --against main` passes; `yarn hub:build` renders the entry on the homepage
  and the Version page.
- **Step 4.** p621's `Blocked by` is p620 alone; p620's Inputs list the toolkit's four leaked
  types (not three, Phase 5); p302 has a "From p619" section (the numeric constants and the test's
  swap for D1, the two documentation layers, the tuples, the material union, the gather's checks);
  the references to this file follow its rename (p600, p605, p608).

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
