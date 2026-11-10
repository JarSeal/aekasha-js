## How it works

- The pipeline reads every `*.texture.json` and `*.importedAsset.json` under `src/` and encodes
  what they point at into `src/public/aek-assets/`: KTX2 textures, and GLBs with meshopt (or
  Draco) geometry and KTX2 textures. Each output is named by a hash of its content.
- `assets.lock.json` maps each asset's source, settings and tool versions to its output. Commit
  it with the outputs: a clone then gets cache hits and never encodes.
- It runs by itself: in `yarn dev` on every save (only what the save touched), and before
  `yarn build`. `yarn assets` runs it whole, and is the only command that deletes stale outputs:
  run it before you commit asset changes. It deletes only after a run that rebuilt every asset
  (without `ktx`, or with an asset JSON that fails, it keeps them and says why).
- At runtime, the engine loads each asset's output instead of its source. The KTX2 transcoder
  turns it into whatever the device reads (BC7 on desktop, ASTC or ETC2 on mobile), in its own
  workers.

The encoder is KTX-Software's `ktx`. The pipeline downloads the pinned release into `.tools/`
the first time it needs to encode (Linux, WSL2 and macOS), and `yarn setupAssetTools` does it by
hand.

## Settings

An asset's settings live in its own JSON, under `optimize`. The toolkit's Æ symbol keeps its
Draco geometry that way:

<<< src/toolkit/models/brand/aekashaSymbol/aekashaSymbol.importedAsset.json

Shared settings live in `assets.config.json` at the repo root: defaults, profiles (`prop`,
`hero`, `compact`, `data` and your own) and rules that apply settings by path. A texture's
`slot` (`baseColor`, `normal`, `orm`, `data`, …) picks its codec and how it's resized; a GLB's
textures get theirs from the material slot that uses them.

- **UASTC** (the default): 1 byte per pixel on the GPU everywhere.
- **ETC1S**: much smaller downloads, for colour maps of distant assets.
- **`none`**: kept exact, for data read as numbers (lookup tables, splat maps).

A texture JSON can also build its image from several sources (`pack`: an ORM map from three
greyscale images, AO baked into an albedo).

## Merging a model's pieces

A level or a kit exported as many small pieces costs a draw per piece. `merge` in an imported
asset's JSON joins its static pieces into one mesh at build time:

```jsonc
{
  "id": "ruinKitLevel",
  "fileName": "./ruinKitLevel.glb",
  "merge": { "mode": "ALL", "exclude": ["door_*"] },
}
```

- **`mode`**: `BY_MATERIAL` (the default, also `"merge": true`) makes one node per glTF material,
  `__merged_<material>`, even when the file has only one; `ALL` makes one node, `__merged`. The
  engine gives an imported asset one material, so `ALL` is one draw. A scene's mesh names it like
  any node (`ruinKitLevel/__merged`), and at the origin it draws the file's layout.
- **The names** follow three's loader: `stone wall` becomes `__merged_stone_wall`, `wood.001`
  `__merged_wood001`, an unnamed material `material<index>`. Pieces with other attributes than
  the rest (one has vertex colours) can't join them: they make `__merged_2`, `__merged_3`, … and
  the run warns, naming each node's attributes.
- **Kept as they are, with their children:** the nodes `exclude` names (globs), physics nodes (a
  `colliderType` or `isPhysObj` custom property), joints and animated nodes. Skinned and
  GPU-instanced nodes and ones with a morph target or lines are kept too, with a warning. An
  excluded node keeps its name, so code still finds the doors and levers.
- Each piece's transform is baked in, a mirrored one included (it isn't drawn inside out). A
  `lodChain` is built from the merged mesh.
- The run says what it did (`merged 20 pieces into __merged (kept 3 excluded, 2 physics)`), and
  the lock entry records each merged node's pieces, vertices and triangles.
- **A file with `merge` is always written**, even with optimization off for it or for the run:
  the scenes name its merged nodes. Optimization off then means "merged, not compressed".

The trade-off: the pieces are gone as nodes, so they can't be entities, moved or picked one by
one. Keep a piece that must stay addressable out with `exclude`.

::: note What it doesn't cover

- A runtime that loads the source file instead of the output has no `__merged` node: the dev
  server's fallback when the pipeline has no output (a failed encode, `ktx` missing for
  `importTextures`) and the Assets tab's "Load source files". A scene's mesh naming the
  merged node is then not created, and the load logs the geometry it couldn't find.
- `meshIndex` counts the merged file's nodes, not the source's.
- A mesh several nodes share (six pillars of one mesh) is copied into the merge once per use, so
  the merged vertices can outgrow the source's (the kit's pillars: 16.8 → 21.0 KB of GPU memory).

:::

## Alpha-cut textures

A mip level averages alpha, so a leaf card or an impostor's edge cut by `alphaTest` breaks up
with distance. Set `optimize.alphaCoverage` to the material's `alphaTest`, and each mip level
keeps the same share of texels past the cut as the full-size image. An exported impostor's
albedo gets it by itself.

## Texture atlases

A `*.textureAtlas.json` packs images into one texture, a named slot per image and a cell per
part. A slot can also be a ready-made image of the whole layout (`image`, every cell with its
`rect`), and `mipChain: "FULL"` builds every mip level down to 1 × 1. Exported impostors use both
(see [LOD and impostors](hub:features/lod#exporting-an-impostor)).

## Budgets

`budget: { vramMB, downloadMB }` on any settings level limits an asset, and every encoded texture
has a ceiling from its slot's `maxSize` and codec. `yarn build` fails when an asset a shipped
scene uses is over its budget or has no output, naming the asset and the fix. A bigger asset gets
its own `budget` in its JSON: an explicit line a reviewer sees.

## Opting out

Optimization is never required. Switch it off for the whole project (`assets.optimization` in
`src/CONFIG.ts`), for one asset (`"optimize": false`), or for one page load: the Assets debug
tab's "Load source files" compares the outputs with their sources after a reload.

## The example

::: scene exampleToolkit
The Æ symbol from the toolkit: a Draco GLB through the pipeline, imported by the scene JSON's
`importedAssets`. The [toolkit example](hub:examples/toolkit) walks through it.
:::

## Key APIs

- [`loadTextureAsync`](api:loadTextureAsync) and [`importAssetAsync`](api:importAssetAsync)
  load an asset's output by themselves.
- [`resolveAssetUrl`](api:resolveAssetUrl): an asset's URL, output or source.

## Read more

The technique guide, `docs/techniques/asset-optimization.md`, has every setting:

- [How it works](repo:docs/techniques/asset-optimization.md#how-it-works) and
  [Add a texture](repo:docs/techniques/asset-optimization.md#add-a-texture) /
  [a model](repo:docs/techniques/asset-optimization.md#add-a-model), and
  [merging its pieces](repo:docs/techniques/asset-optimization.md#merging-pieces).
- [Profiles and settings](repo:docs/techniques/asset-optimization.md#profiles-and-settings) and
  the [codec cheat sheet](repo:docs/techniques/asset-optimization.md#codec-cheat-sheet).
- [Alpha-cut textures](repo:docs/techniques/asset-optimization.md#alpha-cut-textures) and
  [Impostor atlases](repo:docs/techniques/asset-optimization.md#impostor-atlases).
- [Budgets](repo:docs/techniques/asset-optimization.md#budgets),
  [Builds and CI](repo:docs/techniques/asset-optimization.md#builds-and-ci) and
  [Troubleshooting](repo:docs/techniques/asset-optimization.md#troubleshooting).

::: claude-md
:::
