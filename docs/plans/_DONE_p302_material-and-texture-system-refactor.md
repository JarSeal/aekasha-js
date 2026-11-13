Status: implemented (Phases 1-7; Phase 2 by p613)
Category: Materials, Assets, Refactoring
Blocks: p303_texture-sets-and-terrain-texture-library.md, p305_terrain-material-generator.md
Epic: p301_terrain-texturing-epic.md
Related: p299_texture-arrays-and-atlases.md (its Phase 5 registers two resolvers of D4; the review of rendering, scenes and assets, p613, fixed bugs A and B and moved the scene's asset loading: "From p613" below; the schemas' review, p619: "From p619" below)

# Material & Texture System Refactor (terrain prerequisites)

Engine changes the terrain epic needs. Each is general-purpose:

1. Fill the texture JSON gaps.
2. A **multi-socket TSL `setup` entry** with shared inputs, so one graph can drive colour, normal, roughness and AO together.
3. **Runtime registration** of TSL graphs from code (toolkit modules).
4. A **material input resolver registry**, so new input kinds (texture sets, arrays) plug in without editing `Material.ts` again.
5. Material variants that can override the new inputs.
6. **Per-scene dependency closure** in the gather, so a scene doesn't have to list every texture its materials use.
7. Two existing bugs (fixed by p613: "From p613" below; only an optional in-browser check is left).

Nothing here is terrain-specific, and nothing breaks existing JSON.

---

## Context (grounded 2026-10-02, re-grounded 2026-11-04)

- **TSL materials** (`kernel/assets/Material.ts`, `createMaterial`'s `tslFile` block):

  - Each key of `props.nodes` is a socket (`colorNode`, `normalNode`, …) and is built **independently** by the TSL file's export of that name, with its own inputs (cached as `mat.userData.uniforms[`${socket}_${input}`]`, which the material editor's Params tab edits: `debug/editors/material/_dbg__MaterialEditorParams.ts`).
  - Work shared between sockets (blend weights, hex-tiling coordinates, the texture fetches themselves) is therefore built once per socket. TSL only reuses a node object, not equal expressions built twice, so a terrain shader would sample everything 2–5 times.
  - Two toolkit materials already work around this:

    - `toolkit/materials/asteroid/asteroid.tsl.ts` sets `material.roughnessNode` and `material.normalNode` from inside its `colorNode` function, so every input lives in one block;
    - `toolkit/materials/triplanarGrid/triplanarGrid.tsl.ts` makes `normalNode` read the `colorNode` block's uniforms from `material.userData.uniforms`, and so depends on the order of the JSON keys (it throws naming the missing `colorNode` inputs).

    `setup` (D2) replaces both workarounds. Migrating those two materials is optional (Phase 3). The socket contract (`(inputs, material, staticDefines)`, uniforms named `<socket>_<input>`) is documented on the Hub's toolkit page, "Writing a TSL material" (`hub/pages/features/toolkit/guide.md`).

- **TSL files load on demand** (p607 D11): the gather emits one loader per material id, `tslMaterialFileObjects[id] = () => import('<tslFile>')` in `src/generated/generatedAppFns.ts` (`devTools/gather/output.ts`; a production build has only the materials its scenes list). `loadTslMaterialFileAsync(id)` (`Material.ts`) imports the **whole module** and keeps its exports; a scene load calls it for its materials (`kernel/scene/SceneDataLoader.ts`' `loadNextSceneAssets`), other code awaits it before `createMaterial`, which throws naming the file when it isn't loaded. So a `setup` export needs no gather change: the module's exports already reach `createMaterial`. There is still no way to register a TSL graph from code: `createMaterial` looks only in the loaded files.
- **Input wrapping** (`createMaterial`, the `nodes` loop): non-`#` string → `texture(getTexture(id))`; `#hex` → colour uniform; number/boolean → uniform; 2–4 arrays and `{x,y,z,w}` / `{r,g,b,a}` objects → vector/colour uniforms; key `staticDefines` → merged defines. Anything else throws. `createMaterial` is over the 150-line limit; its file header says it waits for D4's registry, which rewrites this path.
- **Bugs A and B are fixed** (p613, see "From p613"): a missing texture samples one shared white texel (`getMissingTexture`), and a scene's material params are resolved into a copy (`resolveTextureParams`, `SceneDataLoader.ts`).
- **Variants** (`getMaterialVariant`, `Material.ts`) override `params`, `staticDefines` (shallow) and `nodes` (per socket), and are cached by a stable hash of the overrides. `MaterialVariantOverridesSchema` (`schemas/MaterialSchema.ts`) mirrors that. Mesh JSON `matOverrides` uses it.
- **A taken id** returns the registered material and ignores the new props (`docs/issues/create-with-a-taken-id-ignores-props.md`): D3's duplicate-id rule is the same for graphs.
- **Texture JSON** (`schemas/TextureSchema.ts`, `TexOptsSchema` and `TEXTURE_FIELDS`):
  - `texOpts` has `mapping`, `wrapS`/`wrapT`, `magFilter`/`minFilter`, `type`, `anisotropy` and `colorSpace`, the constants as raw three.js numbers; the top level has the relative `fileName`, `optimize` and `pack` (p300).
  - Missing: `repeat`, `offset`, `rotation`, `flipY`, `generateMipmaps`, `format` (in the runtime `TexOpts`, `kernel/assets/Texture.ts`, but not the schema) and `isPersistent` (runtime `TextureProps` only).
  - `setTextureOpts` (`Texture.ts`) applies only truthy values, so `anisotropy: 0` and `flipY: false` are ignored.
- **Scene loading** (`SceneDataLoader.ts`' `loadNextSceneAssets`): textures listed in the scene's `textures` load in parallel with imports and TSL files, then materials resolve texture ids against them (or the registry). A material's textures must be listed in the scene by hand; the material editor works around that by loading the textures that aren't registered yet (`debug/editors/material/_dbg__MaterialEditorAssets.ts`). The gather already adds ids to a scene's `textures` in one case: an impostor's atlas slots (`devTools/gather/sceneAssets.ts`), and expands a listed atlas id to its slots (`expandAtlasIds`).

---

## Design

### D1 — Texture JSON completion

- **Add to `TexOptsSchema`:**
  - `repeat` / `offset` (`[x, y]`), `rotation`, `center`;
  - `flipY`, `generateMipmaps`, `premultiplyAlpha`, `format`;
  - `anisotropy` may be `"MAX"` (resolved with `renderer.getMaxAnisotropy()`).
- **Add at top level:** `isPersistent` (`TEXTURE_FIELDS`, so a save entry takes it too). The relative `fileName`, `optimize` and `pack` are there since p300.
- **Named enums.** Accept string names next to the numbers: `"wrapS": "REPEAT"`, `"minFilter": "LINEAR_MIPMAP_LINEAR"`. They map in one table, and the existing numeric JSON still validates. `colorSpace` is a string already (`"srgb"`, `"srgb-linear"`, `""`: `ColorSpaceSchema`, `schemas/_HelperSchemas.ts`), so it keeps three's names; the plans' `"SRGB"` examples read `"srgb"`.
- **Fix `setTextureOpts`** to apply every defined value, not only truthy ones.
- **Live edits:** since three r187 the material observer tracks a texture's `offset`, `repeat`,
  `rotation` and matrix (#35062), so these fields changed after the first render (the material
  editor, a variant) take effect without a rebuild. Before r187 they didn't.

### D2 — Multi-socket `setup` entry

- A TSL material file may export:
  ```ts
  export const setup = (inputs: Record<string, Node | ResolvedInput>, material: NodeMaterial, staticDefines: Record<string, unknown>) => void;
  ```
- `setup` assigns any sockets it wants (`material.colorNode = …; material.normalNode = …; material.aoNode = …`) from **one** shared graph.
- **Inputs** come from a new top-level `inputs` object in the material JSON, wrapped with the same rules as `nodes` inputs. They are cached at `mat.userData.uniforms[`setup\_${key}`]`, so the material editor's Params tab (`debug/editors/material/_dbg__MaterialEditorParams.ts`, which reads ``${socket}\_${input}``) finds them once it lists `inputs`under a`setup` pseudo-socket (Phase 3).
- **Order:** `setup` runs first. Then any `nodes` sockets run and may override a socket `setup` set. Existing per-socket materials are unaffected.
- **The gather:** nothing to emit. The generated loader imports the whole TSL module (Context), so `createMaterial` finds `setup` among its exports and runs it when it's there (a file without one is a per-socket file as today); no `"tslEntry"` flag.
- **Schema:** `inputs` on the TSL branch of `MaterialAssetSchema`; `inputs` in `MaterialOverridesSchema` and `MaterialVariantOverridesSchema`.
- **Variants:** `getMaterialVariant` merges `inputs` shallowly. `staticDefines` stay shallow, and that is documented: an override of a nested define object replaces the whole object.

- **Variants as material instances (three r187, to decide in Phase 3).** r187's
  `NodeMaterialInstance` (core, `materials/nodes/NodeMaterialInstance.js`, on `three/webgpu`, both
  backends; #34684, renamed from `ProxyNodeMaterial` in #35269) wraps a base `NodeMaterial`: every
  instance shares the base's one node build (`customProgramCacheKey` is the base's uuid and
  version), its node sockets are the base's (read-only), and its plain properties (`color`,
  `roughness`, `map`, any custom property) are its own, read by the shared graph through
  `materialReference(name, type)`, textures included. Upstream's first-render benchmark: 2,038 →
  161 ms. Today `getMaterialVariant` (`kernel/assets/Material.ts`) calls `createMaterial` again
  with fresh `uniform()` nodes, a full node build per variant. With instances, D2's `inputs` (and
  the per-socket inputs) become material properties read through
  `materialReference('<socket>_<input>')` instead of captured `uniform()`s, and a variant that
  changes only `params` or input values is `new NodeMaterialInstance(base)` with those
  properties; a `staticDefines` or `nodes` override still makes a new material. Limits: instances
  still split builds where the render object's key does (a texture's presence, sampler settings,
  enums, numbers reduced to zero / non-zero: `RenderObject.getMaterialCacheKey`), `userData` is
  cloned one level deep (so `userData.uniforms` would be shared between instances: the material
  editor would edit instance properties instead), and the API is young (renamed within r187, a
  UBO cost still open in its PR).

### D3 — Runtime TSL registration

- `registerTslMaterial(id: string, fns: { setup?: SetupFn; [socket: string]: SocketFn | undefined })` in `kernel/assets/Material.ts`, on the `aekasha` entry.
- `createMaterial` looks in the runtime registry first, then in the TSL files loaded so far (`loadTslMaterialFileAsync`); a runtime id needs no file load.
- **Duplicate ids:** a duplicate id with different functions warns in dev and keeps the first, matching how texture ids behave.
- **Purpose:** toolkit modules (the terrain generator, decal material, …) register their graph once, on their first call (eg. `createTerrainMaterial`'s), never at module load: nothing registers at load outside `_dbg__` modules (`moduleSideEffects.test.ts`, the root `CLAUDE.md`'s Build config notes), and a top-level `registerTslMaterial(…)` would also keep the graph in every build that imports the entry. Code can then call `createMaterial({ id, type: 'STANDARDNODEMATERIAL', tslFile: '<runtime>', tslMaterialId: 'aek.terrain', inputs, staticDefines })` and get variants, ownership, release and editor support like a JSON material.
- **Schema:** `tslFile` stays required for JSON materials (the TSL member of the material union, see "From p619"). Code-created materials may omit it when `tslMaterialId` names a runtime registration: a type-level union on `MatProps`, not a third schema member.

### D4 — Material input resolver registry

- `registerMaterialInputResolver({ kind, match(value) => boolean, resolve(value, ctx) => ResolvedInput, dependencies?(value) => AssetRef[] })`.
- **Before** the built-in rules, `Material.ts` asks the resolvers in registration order.
- **Registration** is never at module load (as D3): the kernel's own (the object-form texture ref) from its install (`installKernel`, `src/_engine/kernel/init/CLAUDE.md`), a feature's from its install through its `FeatureContext`, a toolkit module's on its first call.
- **`ResolvedInput`** may be a node or a plain object of nodes (a bundle). Bundles are passed to `setup` and socket functions as is, and each node inside is cached at `userData.uniforms[`${socket}_${key}\_${field}`]`.
- **`dependencies`** feeds D6, so a resolver can tell the loader which textures a value needs.
- **Built-in resolver for object-form texture refs:** `{ "texture": "id", "channel": "a" }` → a texture node (optionally swizzled). The bare-string form keeps working.
- **p303 registers two:**
  - `{ "textureSet": "sand01" }` → a set bundle;
  - `{ "textureSetArray": ["sand01", …] }` → an array bundle.
- **p299 registers two** (its Phase 5): `{ "textureArray": id, "layer": … }` and `{ "atlas": id, "slot": …, "cell": … }`.

### D5 — Bug fixes (done by p613)

- **A:** `else` branch. A missing texture becomes `uniform(1)` as the warning says, or, better, a 1×1 white `DataTexture` shared per colour space, so the socket keeps a sampler type. Prefer the texture: a uniform where the graph expects a sampler breaks `.sample(uv)` calls.
- **B:** resolve into a copy of `params`; never write texture objects into cached props. Add a revisit test (`sceneTestECS` or `testDebugScene`): enter → leave → enter, no "destroyed texture" or disposed-texture warnings.

### D6 — Per-scene dependency closure

- **In the gather's scene pass** (`devTools/gather/sceneAssets.ts`, next to the impostor slots it already adds to a scene's `textures`): for each scene, compute the textures (and, after p303, texture sets) that its materials need, from:
  - `params` texture keys (`textureMapKeys`);
  - `nodes` / `inputs` strings that are texture ids;
  - `matOverrides` in mesh JSONs;
  - resolver `dependencies`: the gather can't run browser code, and the dev tools import the engine only through the schemas entry and the modules `devTools/engineImports.test.ts` lists with their reasons (each loads zod at most). So each resolver's dependency function lives in a module of that kind (plain data in, ids out), which both the runtime resolver and the gather import.
- **Output:** a `__dependencies: { textures: string[] }` per scene. `loadNextSceneAssets` (`kernel/scene/SceneDataLoader.ts`) loads the union of `textures` and `__dependencies.textures`. The simpler alternative, decided in Phase 5: append the closure to the scene's `textures` as the impostor slots are (no loader change, no new key; the Assets tab can't tell listed from derived then). A new scene key goes into `SceneSchema.ts`, documented twice ("From p619").
- A closure id no asset JSON has fails the gather like a listed one (p619 G12).
- An explicit `textures` list stays valid; the closure only adds to it.
- **Code-created materials** (D3) declare their dependencies at runtime: `await ensureMaterialDependencies(props)` loads missing textures before `createMaterial`. The toolkit terrain generator calls it.

## From p613 (2026-10-16)

p613 (the review of rendering, scenes and assets, D2) fixed this plan's two bugs and left its
rewrites to it. The Context above is re-grounded after it.

- **Bug A, fixed** (`Material.ts`, the TSL input wrapping): a texture input whose id isn't
  registered warns and samples one white texel (`getMissingTexture`: one `DataTexture`, made on
  first use, shared, not registered, never disposed), D5's preferred form. Three r186's
  `texture(undefined)` didn't fail the build as the Context assumed: it sampled three's image-less
  `EmptyTexture`. Not done: one texture per colour space (D5's "shared per colour space"; white is
  the same in both). Test: `kernel/assets/Material.test.ts`.
- **Bug B, fixed:** what a load builds from the scene's data moved out of `SceneLoader.ts` into
  `kernel/scene/SceneDataLoader.ts` (`@internal`): `loadNextSceneAssets` loads the scene's
  textures, imports and TSL files, and `resolveTextureParams` resolves a material's texture ids
  into a copy of its params, never into the cached generated ones (the unused inner `j` loop went).
  Test: `kernel/scene/SceneLoader.test.ts` (over a revisit: the cached params keep the id, each
  visit's material gets its own texture). D6's union goes into `loadNextSceneAssets` there.
- **The texture release keeps more** (p613 A5): a material's last release
  (`deleteTexturesFromMaterial`) and the scene's release (`releaseSceneOwnedAssets`) keep what
  `getKeptTextures` (`Material.ts`) names: the `retainedTextures` scene hooks' textures and the
  root scene's background and environment. **A gap for D6's closure to keep in mind:** a spot
  light's cookie texture (`map`) isn't kept, so one shared with a material is released with that
  material's last use while the light still shows it. Covering it needs a scene walk per release,
  or the lights registering their textures as kept.
- **`setTextureOpts`** (`Texture.ts`, D1) still skips falsy values. The import path's
  `applyTexOpts` (`import/GLTFTextures.ts`) does it right (`!== undefined`); once D1 fixes
  `setTextureOpts`, one of the two goes (its summary says so).
- **The legacy loaders** (`loadTexture`, `loadTextures`, `createTexture`) moved to
  `kernel/assets/TextureSync.ts` and the first two are deprecated (use `loadTextureAsync`, removed
  in engine 6.0.0): D1's texture options need only follow `loadTextureAsync`'s path.
- `createMaterial` is still over 150 lines: its file header says it waits for D4's resolver
  registry, which rewrites the TSL path.

## From p619 (2026-10-22)

p619 (the review of the asset JSON schemas and the data pipeline, D5) tightened the schemas this
plan extends and left D1's named constants to it:

- **`TexOptsSchema`'s constants stay numbers** (`wrapS`, `minFilter`, …), for D1's named enums to
  map. `schemas/RuntimeTypes.test.ts` still swaps `texOpts` for the runtime's type before comparing
  the two, with a comment naming D1: D1 replaces that swap with the mapping table's types.
- **`TexOptsSchema` has no `image`** (a JSON can't hold one); the runtime's `TexOpts` is its own
  type and adds it.
- **Every field is documented twice:** a JSDoc comment on the shape key (the Hub's API field
  tables) and a `.describe()` (the editor's tooltips in an asset JSON), each with three's default
  read from the code. D1's new fields need both. The fields the texture, texture array and atlas
  schemas share are `TEXTURE_FIELDS` (`TextureSchema.ts`), documented once.
- **Tuples are `z.tuple`,** and `writeJsonSchemas` (`devTools/gather/jsonSchemas.ts`) adds
  `minItems`, `maxItems` and `additionalItems: false` to every tuple in the JSON Schemas: D1's
  `repeat`, `offset` and `center` get them by being tuples.
- **Materials are a discriminated union on `type`** (TSL with `tslFile`, plain without), and
  `MaterialAsset` is one member per material type (`PerType`): D2's `setup` entry and D4's
  resolvers keep both, or the gather reports errors above the field again.
- **The gather fails on bad data** (an invalid file, an id given twice, an id a scene lists that
  no asset JSON has): D1's "every existing `*.texture.json` still validates" is checked by
  `devTools/gather/gatheredJson.test.ts` in `yarn test`, which gathers every repo JSON.
- A spot light's `map` is a texture id in the schema now, which D6's closure and the light cookie
  gap above can rely on.

---

## Phases

### Phase 1 — Texture JSON (D1) — done

1. Schema additions + named enums; `setTextureOpts` fix.
2. Recompile `.schemas/texture.schema.json`; check that every existing `*.texture.json` still validates.

**Exit:** `testTexture.texture.json` with `"repeat": [4, 4]`, `"anisotropy": "MAX"` and `"flipY": false` renders as expected on WebGPU and the WebGL2 fallback.

As built (2026-11-13; section 1 is commit `55425421`):

- **Drift found:** `kernel/assets/TextureSync.ts` is gone (engine 6 removed the legacy loaders), so
  `loadTextureAsync` is the only path. `isPersistent` was already in the runtime `TextureProps`.
- **Named constants map at gather time.** `TEXTURE_CONSTANTS` (`TextureSchema.ts`, `@internal`) is
  the one table: each constant field of `TexOptsSchema` is a name or a number, parsed to the number
  by a zod transform, and the gather writes the parsed output, so the runtime sees three's numbers
  only (no bytes for the names). The numbers are three's valid ones only (literal unions), so the
  schema's output types are three's and `RuntimeTypes.test.ts`' `texOpts` swap went.
  `TextureSchema.test.ts` checks the table against three's constants. The runtime `TexOpts` stays
  numeric (code passes `THREE.RepeatWrapping`); its `mapping` widened to `THREE.AnyMapping`.
- **The JSON Schemas:** `writeJsonSchemas` (`devTools/gather/jsonSchemas.ts`, `toJsonSchema`)
  writes a transform's pipe as its input (`io: 'input'` would have dropped every object's
  `additionalProperties: false`) and still throws on any other type JSON Schema can't hold
  (`jsonSchemas.test.ts`). The `.schemas/` diff is mostly the `__schemaN` renumbering.
- **New `texOpts`:** `repeat`, `offset`, `center` (`[x, y]` tuples), `rotation`, `flipY`,
  `generateMipmaps`, `premultiplyAlpha`, `format`, `anisotropy` an integer ≥ 1 (WebGPU rejects 0)
  or `"MAX"`; `isPersistent` in `TEXTURE_FIELDS` (the texture schema's only: the array and atlas
  schemas have their own fields, without it).
- **`applyTexOpts`** (`Texture.ts`, `@internal`) applies every defined value; `setTextureOpts` is
  it plus the userData, and `GLTFTextures.ts`' copy went. `"MAX"` is the renderer's
  `getMaxAnisotropy()`, 16 before it's initialised. It marks a texture that has data (version > 0)
  for upload again; one without (version 0) isn't, as three warns about an image-less upload.
  `getNoFileTexture` builds through it.
- **`flipY` and `premultiplyAlpha` were baked in on two paths, which D1 didn't say:**
  - The assets worker decoded every bitmap flipped (`texture.flipY` false after). Now
    `loadTextureFileAsync(url, { useHDRLoader, texOpts })` sends `flipY` and `premultiplyAlpha` in
    the `LOAD_TEXTURE` request and the worker bakes what they ask; `applyTexOpts` leaves both alone
    on a worker bitmap and on a compressed texture.
  - The asset pipeline stores a standalone texture's KTX2 output flipped. A texture with
    `texOpts.flipY: false` is now its own encode (`isUnflipped` on the use and the
    `PipelineAsset`, `:unflipped` on the key and `isUnflipped` in the cache key params, both only
    when set, so no existing key or lock entry changed), stored as the source is; the run's line
    says "unflipped". A texture array's and an atlas slot's own `texOpts` refuse `flipY: false`
    (`StoredFlippedTexOptsSchema`: stored flipped), and a merge palette fails on a member texture
    with it (`resolveSlotSampler`). `docs/techniques/asset-optimization.md`' Orientation says so.
- **The exit check** (Apple M2, Chrome, `sceneTestECS` through the test bridge; `testTexture` is a
  pipeline output, a `CompressedTexture`): with `"wrapS"/"wrapT": "REPEAT"`, `"repeat": [4, 4]`,
  `"anisotropy": "MAX"`, `"flipY": false` the texture loaded with repeat `[4, 4]` and anisotropy
  16 on WebGPU and the WebGL2 fallback, the sphere's rust tiled 4×, no new console message. The
  unflipped KTX2 output's level 0 matched the source row for row (mean abs diff 2.2 of 255) and the
  flipped output mirrored (0.4). `testTexture.texture.json` keeps only the named `"REPEAT"` (same
  generated data); the exit's other options were reverted, so the scene baselines don't change.

### Phase 2 — Bugs (D5) — done by p613

1. Fix A and B.
2. Add the revisit check.

**Exit:** scene revisit and missing-texture cases are clean in the console.

p613 did both fixes and their tests (see "From p613"); what's left is the in-browser revisit check
(enter → leave → enter in `sceneTestECS` or `testDebugScene`, no disposed-texture warning), optional
now that the unit test covers the cached params: run it with Phase 1's exit check if at all.

### Phase 3 — `setup` entry + runtime registration (D2, D3) — done

1. `Material.ts` setup path, `registerTslMaterial` (summary and `@example`: it's on the `aekasha` entry), and `createMaterial` split below the 150-line limit as its file header promises (the TSL path into its own functions).
2. Schema `inputs` (both documentation layers, "From p619"), variant merge of `inputs`. No gather change (D2).
3. The material editor's Params tab lists a `setup` material's `inputs` (`setup_<key>` uniforms) as it lists a socket's (`debug/editors/material/_dbg__MaterialEditorParams.ts`, `src/_engine/debug/editors/CLAUDE.md`'s Material editor).
4. Convert the app's `testTslMat` (`src/app/scenes/sceneTestECS/testTslMat.material.json` and `.tsl.ts`) to a `setup` material as the reference example (keep a per-socket example too: `toolkit/materials/triplanarCheckerboard/`).

**Exit:**

- A `setup` material sets 3 sockets from one graph.
- The generated WGSL samples each texture once. Check it in the browser devtools shader source, or with `renderer.debug.getShaderAsync(scene, camera, object)` (there in three r187: the vertex and fragment code of the object's render object).
- `getMaterialVariant` overriding an input works.
- **Spike (D2's variants as instances):** count node builds and pipelines for 10 variants of one
  `setup` material made with `createMaterial` (today) and as `NodeMaterialInstance`s; decide
  whether variants become instances in this plan or a follow-up.

As built (2026-11-13; section 1 is commit `3f084323`):

- **Drift found:** `Material.ts` was 860 lines (over the file limit too, its header naming only
  `createMaterial`'s length), and `MatProps` already typed `tslFile` optional on every node member,
  so D3's type-level union was there; what was missing was a way into the TSL path without one.
  NodeMaterial has a `setup(builder)` method, so `'setup' in mat` is true: a `nodes.setup` would
  have replaced three's method (now skipped, warned).
- **`kernel/assets/MaterialTsl.ts`** holds the TSL path: the loaded files, the registry,
  `loadTslMaterialFileAsync` (moved, still on `aekasha`), `registerTslMaterial`, the input
  wrapping (`createTslInputNode`, where D4's resolvers go first) and `applyTslGraph` (`@internal`).
  `Material.ts` (613 lines) keeps `createMaterial` (44 lines: a class table for the `switch`,
  `resolveMaterialParams`); `MatProps`' node members share `TslMaterialProps` (`tslFile`,
  `inputs`, `nodes`, `staticDefines`, documented per key). New on `aekasha`: `registerTslMaterial`,
  `TslMaterialProps`, `TslMaterialFns`, `TslSetupFn`, `TslSocketFn`, `TslInputs`.
- **When the TSL path runs:** a node material only (a plain one whose id names a registration
  gets none), with a `tslFile` or a registration under `tslMaterialId` (default `id`): looked up in
  the registry first, then the loaded files; neither with a `tslFile` throws, neither without one
  is a plain node material (warned when it has `nodes` or `inputs`). `tslMaterialId` alone can't
  be the trigger: the material editor passes it for every material. Any export that isn't a
  function throws (before: only `''` / `' '`). A variant passes `tslMaterialId` only when its base
  got a graph (`userData.hasTslFile`, set for a registration too).
- **Order and warnings:** `setup` runs with `inputs` (uniforms `setup_<key>`; an input named
  `staticDefines` merges over the material's, as in a socket), then the `nodes` sockets; the debug
  env warns when a socket function replaces a socket `setup` set, and when an id is registered
  again with other functions (the first stay; the same functions are silent). `inputs` without a
  `setup` warns.
- **Typing (differs from D2's signature):** `TslInputs` is `Record<string, unknown>`, and a function
  types its inputs by key (`{ tint: Node<'color'> }`, `Node` from `three/webgpu`, as
  `asteroid.tsl.ts` does): three r187's untyped `Node` takes no `TextureNode` (`Node<any>`), so
  `Record<string, Node>` rejected real functions. The functions' types are methods' (bivariant
  parameters), and a socket function returns `unknown`. D4's bundles fit `unknown` as they are.
- **Schema and variants:** `inputs` on the TSL member, `MaterialOverridesSchema` and
  `MaterialVariantOverridesSchema` (both documentation layers); `getMaterialVariant` merges it
  shallowly, and `staticDefines`' shallow merge is documented (a nested define object replaces the
  base's). **A gather change after all:** `mergeMaterialProps` (`devTools/gather/sceneAssets.ts`)
  replaced any field it didn't list, so a save entry's `inputs` would have dropped the material's
  others; it merges them key by key now (`gather.test.ts`). The gather emits nothing new. The
  three docs of that merge rule (`devTools/gather/CLAUDE.md`, `MeshSchema.ts`' `mat`, the Hub's
  scenes-and-assets guide) name `inputs`.
- **The material editor:** `inputs` are the group `SETUP_INPUTS` (`'setup'`, "setup (inputs)",
  first) beside the sockets, so the per-socket functions take their `setup_<key>` uniforms as
  they are; `toNodeInputGroups` / `fromNodeInputGroups` convert for the copy's props and the LS
  record (`overrides.inputs`, the schema's shape; an undo path is `setup.<key>`). The textures to
  load and the selector's swatch read `inputs` too. `_dbg__MaterialEditorParams.test.ts`;
  `src/_engine/debug/editors/CLAUDE.md`.
- **`testTslMat`** is a `setup` material: one sample of `testTexture` drives the colour, the
  roughness and the emissive (the brightest specks glow, `glow` input). `testTexture` has no colour
  space, so the sample is its stored sRGB values (luminance 0.28-0.45): the thresholds are in that
  space. `triplanarCheckerboard` stays the per-socket example. sceneTestECS looks different: its
  scene baselines need `--update`.
- **The exit checks** (Apple M2, Chrome, WebGPU, the dev server's `sceneTestECS` through the test
  bridge): testTslMat's material has `colorNode`, `roughnessNode` and `emissiveNode` from one
  graph; its fragment WGSL (`renderer.debug.getShaderAsync`) samples `testTexture` once (the other
  samples are the BRDF LUT, the sun's shadow map and the environment cube twice); a variant with
  `inputs: { glow: 3 }` has `setup_glow` 3 and the base 0.6; the editor's Params tab lists the
  setup group, an ArrowUp on `glow` set the copy's uniform to 1.6 and `overrides.inputs.glow`, and
  undo put back 0.6 and removed it. No new console message (Rapier's init deprecation is
  pre-existing). The WebGL2 fallback wasn't checked.
- **The spike** (same setup; node builds counted with `renderer.debug.onNodeBuilderCreated`,
  pipelines and programs from `renderer._pipelines`): 10 `getMaterialVariant`s differing by one
  input: 11 node builds, 1 new pipeline, 1 fragment and 1 vertex program (the variants share one);
  a `NodeMaterialInstance` base reading the input through `materialReference`: 1 build and 1
  pipeline, then 10 instances: 1 build, no pipeline or program (4 ms). A variant with another
  texture id: 1 build, no new pipeline or program (the Risks table's question: variants differing
  by texture share a pipeline). So instances save the CPU node builds only (about one per
  variant), not GPU pipelines. **Recommended: a follow-up, not this plan:** the pipelines are
  shared already, and instances need the inputs as material properties read through
  `materialReference` instead of `uniform()`s (a rewrite of the input wrapping that D4 replaces
  next), `userData` cloned one level (the editor's `userData.uniforms` would be shared), and an
  API renamed within r187. **Decision (confirmed in review, 2026-11-13): a follow-up,** in
  `p990_follow-ups-from-done-plans.md`'s Rendering, with these figures and limits. Variants stay
  full materials (`createMaterial` again) in this plan.

### Phase 4 — Input resolvers (D4) — done

1. Registry, built-in object-form texture ref, bundle caching in `userData.uniforms`.
2. Unit tests in `Material.test.ts` (the registry's order, a bundle's cached keys), and a dummy resolver in `testDebugScene` returning a bundle of two uniforms.

**Exit:** a material JSON using `{ "texture": "testTexture", "channel": "r" }` works.

As built (2026-11-13):

- **Drift found:** the input wrapping D4 puts in `Material.ts` is `MaterialTsl.ts`' since Phase 3
  (`createTslInputs`, `createTslInputNode`); the resolvers are asked there, before the built-in
  rules. The schemas' input values were `z.any()` / `z.unknown()` already, so the object form
  validates without a schema change (only both documentation layers name it).
- **Two modules.** `kernel/assets/MaterialInputRefs.ts` is import-free (D6's risk): the texture
  ref's type and `isTextureInputRef`, `MaterialInputDependency` (`{ type: 'texture', id }`; p303
  widens the union) and `getTextureInputDependencies` (a bare id and the object form). Phase 5's
  gather imports it, and lists it in `devTools/engineImports.test.ts` then.
  `kernel/assets/MaterialInputResolvers.ts` is the registry: `registerMaterialInputResolver` (on
  `aekasha`, with `MaterialInputResolver`, `MaterialInputContext`, `ResolvedInput`,
  `ResolvedInputNode`, and `MaterialInputDependency` and `TextureInputRef` from the refs module),
  `resolveRegisteredInput` and `getMaterialInputDependencies` (`@internal`: the first matching
  resolver's `dependencies`, else the built-in forms'; `ensureMaterialDependencies`, Phase 5,
  builds on it).
- **The resolver:** `{ kind, match(value), resolve(value, ctx), dependencies?(value) }`, typed by
  its value (`MaterialInputResolver<T>`, method parameters, so bivariant). `ctx` is `{ materialId,
group ('setup' or the socket), key, material, getTexture(id) }`; `getTexture` falls back to the
  shared white texel with the bare id's warning, so p303's and p299's resolvers miss a texture the
  same way. A result that's neither a node (`isNode`) nor a non-empty object of nodes throws naming
  the kind. A kind registered again with the same functions is silent, with others the first stay
  (debug env warns), as `registerTslMaterial`. `ResolvedInputNode` is `{ isNode }`: three r187's
  untyped `Node` rejects a `TextureNode` (Phase 3).
- **Caching:** a node at `<group>_<key>`, each node of a bundle at `<group>_<key>_<field>`, the
  bundle itself not kept; the function gets the bundle as is. The material editor shows a
  resolver's value read-only (kind `OTHER`), and loads its textures through
  `getMaterialInputDependencies` (`getMaterialTextureIds`), an object ref's included.
- **The texture ref** (kind `'texture'`): `{ texture }` is the texture node the bare id makes (so
  `.sample(uv)` works); `{ texture, channel }` (one to four of `r`, `g`, `b`, `a`, else it throws)
  is TSL's swizzle of the sample at the default uv (a `SplitNode`, its components stored as
  `xyzw`).
- **Registration:** `FeatureContext.registerMaterialInputResolver` (the public function), which
  `installKernel` calls last (`installMaterialInputResolvers`), so the kernel's resolver comes
  before any feature's or the app's. No engine feature registers one yet: an app's own feature is
  the place for one its JSON materials use, since a scene's JSON materials are created before its
  scene code runs. `src/_engine/kernel/init/CLAUDE.md` says so.
- **Tests:** `kernel/assets/MaterialInputResolvers.test.ts` (next to the registry, not
  `Material.test.ts`): the order and resolvers before the built-in rules, a bundle's keys in a
  `setup` and a socket group, a variant overriding a resolved input, a bad result, a duplicate
  kind, the texture ref with and without `channel`, a missing texture, a bad channel, the
  dependencies.
- **testDebugScene:** beside the top row, `p302ChannelMat` (the scene folder's JSON material, a
  `setup` with `albedo: { "texture": "testTexture" }` and `mask: { "texture": "testTexture",
"channel": "r" }`: the texture on its left half, the red channel in grey on its right; the scene
  lists `testTexture`) and `p302_gradientMat` (code: the scene file registers a dummy `{ gradient:
[from, to] }` resolver returning a bundle of two colour uniforms, and a graph, on its call; navy
  to amber, bottom to top). Its scene baselines need `--update`. Since Phase 5 the scene no longer
  lists `testTexture`: the gather's texture closure adds it.
- **The exit check** (Apple M2, Chrome, a dev server of its own, `?isDebug=true&aekTest=true`,
  `whenSceneReady`): on WebGPU and the WebGL2 fallback both planes render as described;
  `p302ChannelMat`'s uniforms are `setup_albedo` (a `TextureNode` of `testTexture`, not the
  missing texel) and `setup_mask` (a `SplitNode`, `x`), the gradient's `setup_band_from` /
  `setup_band_to` (`1c233a`, `ffaa00`). No new console message (Rapier's init deprecation and the
  WebGL2 fallback's notice are pre-existing).

### Phase 5 — Dependency closure (D6) — done

1. Closure computation in `devTools/gather/sceneAssets.ts` (with a case in `devTools/gather/gather.test.ts`), and its output: `__dependencies` with the union in `SceneDataLoader.ts`' `loadNextSceneAssets`, or the append to `textures` (D6 decides here).
2. `ensureMaterialDependencies`.
3. Remove now-redundant explicit `textures` entries from one app scene to prove it, keeping the others.

**Exit:** a scene that lists only a material loads that material's textures.

As built (2026-11-13; section 1 is commit `f2aea472`, section 2 `2eb4cbae`):

- **Decision: the closure is appended to the scene's `textures`**, no `__dependencies` key, no
  loader or `SceneSchema` change. A scene's generated `textures` holds each texture's resolved
  data (its file, `__url`, `texOpts`, save entry), not an id, and a production build's data has no
  texture table to look an id up in: `__dependencies` would have had to carry that data too. The
  append gets the save entries, the ship checks, the atlas expansion, the unknown-id failure and
  the streaming cell cut of a listed texture for nothing. The cost D6 named: the Assets tab can't
  tell a listed texture from an added one.
- **`devTools/gather/textureClosure.ts`** (`addTextureClosure`; its own module, as
  `mergedGeometries.ts` and `mergeMaterials.ts`, not inline in `sceneAssets.ts`): the textures the
  scene's resolved data names and its `textures` doesn't give (listed by id, inline, or a listed
  atlas's slots), each once, in the order named, after the listed ones. From the listed materials,
  a mesh's inline `mat` and its `matOverrides`: their `params` texture slots (`textureMapKeys`) and
  their `inputs` and each `nodes` socket's values (`staticDefines` aside) through
  `INPUT_DEPENDENCY_FNS`, the runtime's import-free `getTextureInputDependencies`
  (`MaterialInputRefs.ts`, now on `devTools/engineImports.test.ts`' list); p303's and p299's
  resolvers add their functions there. **Beyond D6:** a spot light's cookie (`map`) and the
  `backgroundTexture` too (both `getTexture` lookups, "From p619"). An id no asset JSON has fails
  the gather naming what names it ("Scene "a": the material "m" names the texture "x", …"). An
  app's own resolver's values aren't known to the gather (its scene lists their textures), and a
  mesh's `mat` id the scene doesn't list adds nothing.
- **`resolveSceneAssets`' order:** the textures resolve after the materials, the meshes and the
  closure (which reads them with their save entries); nothing in those two read the resolved
  textures.
- **`streamingManifest.ts`:** `addMaterialFieldRefs` reads `inputs` too (a Phase 3 gap: a `setup`
  material's input textures in a cell stayed in the base).
- **`ensureMaterialDependencies(props)`** (`kernel/assets/MaterialDependencies.ts`, on
  `aekasha`): a material's props or a variant's overrides; each texture `getMaterialTextureIds`
  names (`@internal`: the params slots, the inputs' and sockets' values through the runtime's
  `getMaterialInputDependencies`, so a registered resolver's `dependencies` count) that isn't
  registered is loaded from `findTextureDeclaration` (`@internal`: the development build's texture
  section, else the first scene entry with the id, a streaming scene's cell assets included), with
  `throwOnError`; a registered one is re-tagged to the caller's owner (a cache hit). **Beyond D6:**
  it also loads the TSL file (`tslMaterialId || id`) when the data has one, so one call covers
  what `createMaterial` needs (a `tslFile` the data doesn't have is a registration's, left to
  `createMaterial`). Resolves whether everything loaded (a missing declaration warned, a failed
  load logged). **Production limit:** a production build's data has only the textures a scene's
  data names, so a texture only code uses must still be listed in a scene's `textures` (the
  warning says so); a production texture table would cost every app bytes. The material editor
  (`_dbg__MaterialEditorAssets.ts`) loads its textures through it (textures only: it loads the TSL
  file itself, to show its error) and uses the kernel's two lookups instead of its own copies.
- **Tests:** `gather.test.ts`' "p302 D6: the texture closure" (6 cases: the sources, order and
  dedupe, a save entry, an inline texture, a missing id, an input texture moving into its cell);
  `kernel/assets/MaterialDependencies.test.ts` (9).
- **The proof:** `testDebugScene` no longer lists `testTexture` (only `p302ChannelMat` names it);
  the gather adds it. Gathering the repo otherwise changes no scene's textures: every other scene
  lists all of its own. The other scenes keep their lists.
- **The exit check** (Apple M2, Chrome, a dev server of its own, `?isDebug=true&aekTest=true
  &startScene=testDebugScene`, `whenSceneReady`): on WebGPU and the WebGL2 fallback `testTexture`
  is registered (a `CompressedTexture`, the pipeline output), `p302ChannelMat`'s `setup_albedo` is
  a `TextureNode` of it and `setup_mask` a `SplitNode` sampling it (not the missing texel), and the
  plane shows the texture and its red channel as in Phase 4. No new console message (Rapier's init
  deprecation and the WebGL2 fallback's notice are pre-existing).
- **`yarn verify:baselines`:** the bundles unchanged (nothing in the app's first download or the
  embeds), no debug code; the API baseline's three new exports recorded (`--update`). The scene
  runner wasn't run: `sceneTestECS`' and `testDebugScene`'s baselines need `--update` since
  Phases 3-4 anyway, before the PR.

### Phase 6 — Hub and docs — done

1. The Hub: the toolkit page's "Writing a TSL material" (`hub/pages/features/toolkit/guide.md`: the `setup` entry and `inputs`, runtime registration, the resolver forms) and the scenes-and-assets page (`hub/pages/features/scenes-and-assets/guide.md`: the texture JSON's new fields, the dependency closure); `yarn hub:build`.
2. `devTools/gather/CLAUDE.md`'s data pipeline section (the texture closure, `textureClosure.ts`, the scene pass's order) and `src/_engine/kernel/scene/CLAUDE.md`'s Scene loads (a scene's `textures` includes the closure; `loadNextSceneAssets` itself didn't change); `src/_engine/debug/editors/CLAUDE.md`'s Material editor (its textures through `ensureMaterialDependencies`); the root `CLAUDE.md` only if its data pipeline outline changes. `readme.md` if its material example changes.
3. The schemas' docs (both layers, "From p619"): `SceneSchema.ts`' `textures` (the gather adds the textures the scene's materials, spot cookies and background name) and `backgroundTexture` ("a texture the scene lists" no longer needed), `LightSchema.ts`' `map`; `.schemas/` regenerated.

As built (2026-11-13; section 1 is commit `a6194b74`, section 2 `9116a7ab`):

- **The toolkit page's "Writing a TSL material"** has five parts: One graph: `setup`
  (`testTslMat`'s JSON and TSL file included whole), A function per socket (the checkerboard,
  the order with both, the grid's and the asteroid's workarounds named the older way), The inputs
  (a table of every form, the object-form texture ref and a resolver's included; the cached keys,
  the white texel, the variants' one-level merge, `TextureNode` typing), Loading
  (`ensureMaterialDependencies`, the production limit) and Graphs and input forms from code.
- **A Hub include in app code:** the last part shows `testDebugScene.ts`' gradient resolver and
  graph and their registration through two regions, `tsl-from-code` and `tsl-from-code-use`
  (each naming the page), instead of a copy.
- **The scenes-and-assets page:** a Textures section (the new `texOpts`, the named constants,
  `flipY: false`, `isPersistent`) and The gatherer's "A scene's textures" (the closure, the
  gather's error text, when a scene still lists a texture); its Key APIs and the code-loading
  paragraph name `ensureMaterialDependencies` where they named `loadTslMaterialFileAsync`.
- **Two more pages than the plan named:** the ECS page's Features section names
  `registerMaterialInputResolver` among the `FeatureContext` seams, and the streaming page's
  "a material's texture maps" is "a material's textures" (the manifest reads `inputs`).
- **The CLAUDE.md files:** `devTools/gather/CLAUDE.md` (`textureClosure.ts`, the scene pass's
  order, the manifest's `inputs`), `src/_engine/kernel/scene/CLAUDE.md`'s Scene loads (the
  closure in `textures`, `ensureMaterialDependencies`), `src/_engine/debug/editors/CLAUDE.md`'s
  Material editor (its textures through `ensureMaterialDependencies`; and the Params tab's
  read-only object-form values, which Phase 4 hadn't written down). The root's data pipeline
  outline got one sentence (a scene lists a material without its textures). `readme.md` is
  unchanged: its material and texture examples didn't change, and its Features list has no
  materials bullet.
- **Checks:** `yarn hub:build`, `yarn test`, `yarn verify:baselines --docs`. The build's API
  warnings weren't caught then (see Phase 7's As built, which fixed them).

### Phase 7 — Versioning — done

1. Engine minor bump; app patch (`testTslMat`, `testDebugScene`'s Phase 4 planes and its `textures` dropped in Phase 5); `CHANGELOG.md` entry (Added: setup entry, runtime TSL registration, input resolvers, texture opts, dependency closure; bugs A and B shipped with p613).
2. Mark the plan done (`docs/plans/CLAUDE.md`).

As built (2026-11-13):

- **Versions:** engine (and project) 6.10.0 → 6.11.0 (Sunset), app 1.24.1 → 1.24.2; the toolkit
  keeps 3.0.1 (nothing in `src/toolkit/` changed). `yarn checkVersions --against main` passes.
- **`CHANGELOG.md`:** the entry has Engine, App and Project sections. Beyond the plan's list, the
  engine's Changed names the schema tightening: the texture constants take three's valid values
  only and `anisotropy` an integer ≥ 1 or `"MAX"`, so a texture JSON with another number fails the
  gather (every repo JSON validates, so the bump stays minor).
- **The scene runner** (`yarn verify:scenes --update`, WebGPU, run by the user): 44 scenes × 5
  configurations, 185 baselines recorded, none failed; sceneTestECS' and testDebugScene's (changed
  since Phases 3-4) included. Its one warning is thirdPersonGymScene's `workerSab` physics hash
  differing from the other targets, not this plan's.
- **The spike's decision** (Phase 3): a follow-up in p990.
- **The Hub's API warnings** (`yarn hub:build`, from Phases 3-4, missed by Phase 6's check):
  `TslSetupFn` and `TslSocketFn` named `TslGraphFn`, a helper type on no entry: each is written
  out now (`{ fn(…) }['fn']`, still a method's bivariant parameters), and the helper went
  (`asTslGraphFn` casts to `TslSocketFn`). `Material.ts`' eight `{@link}`s to
  `registerTslMaterial`, `registerMaterialInputResolver` and `loadTslMaterialFileAsync` didn't
  resolve (other modules, not imported): they take their module
  (`{@link _engine/kernel/assets/MaterialTsl!registerTslMaterial}`), as the coding standards'
  JSDoc page says. The build's one warning left is the search index's size (581 KiB gzipped, over
  450 KiB), not looked into here. `yarn verify:baselines --update`: the API, docs and bundle
  baselines unchanged (the bundle files' diff is gzip sizes moving by a few bytes), no debug code.
- **Marked done:** this file is `_DONE_p302_…`; p299's, p303's, p304's and p305's `Blocked by`
  lost it, p301's `Blocks` and the done plans' `Related` lines name the new file, and the reference
  example in `docs/plans/CLAUDE.md` and the Hub's conventions page names p303 instead.

---

## Risks

| Risk                                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup` and per-socket functions both set the same socket                     | Documented order (setup first, sockets override), plus a dev warning when a socket is overwritten                                                                                                                                                                                                                                              |
| Variants differing only by textures compile separate pipelines                | Three caches programs by node graph structure; verify in Phase 3 that two variants with different texture ids share one pipeline (count pipelines via `renderer.info` / WebGPU devtools). If not, three r187's `NodeMaterialInstance` shares one build across them (D2's variants as instances), which also answers p305's per-block splat map |
| The resolver dependency mirror in `devTools` drifts from the runtime resolver | Each resolver ships its dependency function in a side-effect-free module that both the gatherer and the runtime import (listed in `devTools/engineImports.test.ts` with its reason)                                                                                                                                                            |
| The material editor assumes `${socket}_${input}` keys                         | `setup_${key}` follows the same pattern; Phase 3 makes the Params tab list them and updates `src/_engine/debug/editors/CLAUDE.md`                                                                                                                                                                                                              |
