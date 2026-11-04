Status: draft | not-implemented
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

### D2 — Multi-socket `setup` entry

- A TSL material file may export:
  ```ts
  export const setup = (inputs: Record<string, Node | ResolvedInput>, material: NodeMaterial, staticDefines: Record<string, unknown>) => void;
  ```
- `setup` assigns any sockets it wants (`material.colorNode = …; material.normalNode = …; material.aoNode = …`) from **one** shared graph.
- **Inputs** come from a new top-level `inputs` object in the material JSON, wrapped with the same rules as `nodes` inputs. They are cached at `mat.userData.uniforms[`setup\_${key}`]`, so the material editor's Params tab (`debug/editors/material/_dbg__MaterialEditorParams.ts`, which reads ``${socket}_${input}``) finds them once it lists `inputs` under a `setup` pseudo-socket (Phase 3).
- **Order:** `setup` runs first. Then any `nodes` sockets run and may override a socket `setup` set. Existing per-socket materials are unaffected.
- **The gather:** nothing to emit. The generated loader imports the whole TSL module (Context), so `createMaterial` finds `setup` among its exports and runs it when it's there (a file without one is a per-socket file as today); no `"tslEntry"` flag.
- **Schema:** `inputs` on the TSL branch of `MaterialAssetSchema`; `inputs` in `MaterialOverridesSchema` and `MaterialVariantOverridesSchema`.
- **Variants:** `getMaterialVariant` merges `inputs` shallowly. `staticDefines` stay shallow, and that is documented: an override of a nested define object replaces the whole object.

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

### Phase 1 — Texture JSON (D1)

1. Schema additions + named enums; `setTextureOpts` fix.
2. Recompile `.schemas/texture.schema.json`; check that every existing `*.texture.json` still validates.

**Exit:** `testTexture.texture.json` with `"repeat": [4, 4]`, `"anisotropy": "MAX"` and `"flipY": false` renders as expected on WebGPU and the WebGL2 fallback.

### Phase 2 — Bugs (D5) — done by p613

1. Fix A and B.
2. Add the revisit check.

**Exit:** scene revisit and missing-texture cases are clean in the console.

p613 did both fixes and their tests (see "From p613"); what's left is the in-browser revisit check
(enter → leave → enter in `sceneTestECS` or `testDebugScene`, no disposed-texture warning), optional
now that the unit test covers the cached params: run it with Phase 1's exit check if at all.

### Phase 3 — `setup` entry + runtime registration (D2, D3)

1. `Material.ts` setup path, `registerTslMaterial` (summary and `@example`: it's on the `aekasha` entry), and `createMaterial` split below the 150-line limit as its file header promises (the TSL path into its own functions).
2. Schema `inputs` (both documentation layers, "From p619"), variant merge of `inputs`. No gather change (D2).
3. The material editor's Params tab lists a `setup` material's `inputs` (`setup_<key>` uniforms) as it lists a socket's (`debug/editors/material/_dbg__MaterialEditorParams.ts`, `src/_engine/debug/editors/CLAUDE.md`'s Material editor).
4. Convert the app's `testTslMat` (`src/app/scenes/sceneTestECS/testTslMat.material.json` and `.tsl.ts`) to a `setup` material as the reference example (keep a per-socket example too: `toolkit/materials/triplanarCheckerboard/`).

**Exit:**

- A `setup` material sets 3 sockets from one graph.
- The generated WGSL samples each texture once. Check it in the browser devtools shader source, or with `renderer.debug.getShaderAsync` if available in r186.
- `getMaterialVariant` overriding an input works.

### Phase 4 — Input resolvers (D4)

1. Registry, built-in object-form texture ref, bundle caching in `userData.uniforms`.
2. Unit tests in `Material.test.ts` (the registry's order, a bundle's cached keys), and a dummy resolver in `testDebugScene` returning a bundle of two uniforms.

**Exit:** a material JSON using `{ "texture": "testTexture", "channel": "r" }` works.

### Phase 5 — Dependency closure (D6)

1. Closure computation in `devTools/gather/sceneAssets.ts` (with a case in `devTools/gather/gather.test.ts`), and its output: `__dependencies` with the union in `SceneDataLoader.ts`' `loadNextSceneAssets`, or the append to `textures` (D6 decides here).
2. `ensureMaterialDependencies`.
3. Remove now-redundant explicit `textures` entries from one app scene to prove it, keeping the others.

**Exit:** a scene that lists only a material loads that material's textures.

### Phase 6 — Hub and docs

1. The Hub: the toolkit page's "Writing a TSL material" (`hub/pages/features/toolkit/guide.md`: the `setup` entry and `inputs`, runtime registration, the resolver forms) and the scenes-and-assets page (`hub/pages/features/scenes-and-assets/guide.md`: the texture JSON's new fields, the dependency closure); `yarn hub:build`.
2. `devTools/gather/CLAUDE.md`'s data pipeline section (the dependency closure) and `src/_engine/kernel/scene/CLAUDE.md`'s Scene loads (what `loadNextSceneAssets` loads); the root `CLAUDE.md` only if its data pipeline outline changes. `readme.md` if its material example changes.

### Phase 7 — Versioning

1. Engine minor bump; app patch (`testTslMat`); `CHANGELOG.md` entry (Added: setup entry, runtime TSL registration, input resolvers, texture opts, dependency closure; bugs A and B shipped with p613).
2. Mark the plan done (`docs/plans/CLAUDE.md`).

---

## Risks

| Risk                                                                          | Mitigation                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup` and per-socket functions both set the same socket                     | Documented order (setup first, sockets override), plus a dev warning when a socket is overwritten                                                                                                                                                                                |
| Variants differing only by textures compile separate pipelines                | Three caches programs by node graph structure; verify in Phase 3 that two variants with different texture ids share one pipeline (count pipelines via `renderer.info` / WebGPU devtools). If not, note it in p305 (a per-block splat map would then cost one pipeline per block) |
| The resolver dependency mirror in `devTools` drifts from the runtime resolver | Each resolver ships its dependency function in a side-effect-free module that both the gatherer and the runtime import (listed in `devTools/engineImports.test.ts` with its reason)                                                                                              |
| The material editor assumes `${socket}_${input}` keys                         | `setup_${key}` follows the same pattern; Phase 3 makes the Params tab list them and updates `src/_engine/debug/editors/CLAUDE.md`                                                                                                                                                |
