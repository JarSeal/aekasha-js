Status: draft | not-implemented
Category: Decals, Rendering
Epic: p390_text-rendering-and-text-decals.md
Blocks: p397_text-decals.md, p398_decal-editing-and-bake.md
Related: `src/toolkit/terrain/CLAUDE.md` (the decal material, the runtime decals and their measured figures, p309 D2, D4), `src/_engine/features/terrain/CLAUDE.md` (decal sets, p309 D3), `src/_engine/features/merging/CLAUDE.md` (`BATCHED` groups, `updateMergeMember`, `setMergeMemberColor`), `src/_engine/kernel/assets/MaterialInputResolvers.ts` (the registration pattern the material decal layer's hook follows), `docs/techniques/terrain-decals.md` (the handbook page that moves with the core), `devTools/migrate/CLAUDE.md` (the codemod pattern, if the move gets one)

# The Engine Decals Feature — Plan

The epic's D6: decals on any mesh and any material, as an engine feature `decals()`
(`features/decals/`, `aekasha/decals`). Two kinds:

- **Projected decals:** a placement in the world (position, orientation, size) whose patch is the
  target surface clipped to the decal's box, drawn by a pool. p309's runtime decal core, moved out
  of the toolkit's terrain category and made surface-agnostic.
- **Material decals (new):** a material's `decals` list, placed in its meshes' UV space and
  composed into the material's colour, normal, roughness and emissive by one TSL node. Every mesh
  drawn with that material carries them.

Decal sources say what a decal draws: `ATLAS` (a cell of a `DECAL` atlas, p309's) here, `TEXT`
in p397. Terrain keeps its atlases, decal materials, generators, decal sets, ribbons and block
surface; the toolkit's runtime decal names stay as deprecated wrappers until toolkit 4.0.

## What exists (p309, measured; keep it)

- A **pool** (`toolkit/terrain/decals/RuntimeDecals.ts`) is an explicit `BATCHED` merge group of
  one material: a place per decal, its patch written into the place's own typed arrays (a spawn
  allocates nothing), the slot rewritten with `updateMergeMember`, FIFO reuse, `fifoFade` and
  lifetime fades through `setMergeMemberColor`, `geometryReserve` (`maxPatchVertices` 169), the
  positions past the patch set to its first vertex (the bounds trap), randomness from the stream
  `decals`. Measured: 192 decals → 2 render objects, 1.0-2.6 ms less CPU than separate meshes.
- **Patches:** on a terrain block the block's own grid (`blocks/BlockSurface.ts`'
  `readBlockSurface`), on any mesh three's `DecalGeometry` (`MeshDecals.ts`'
  `writeMeshDecalPatch`, `import()`ed with the first), ribbons sampled on a block
  (`DecalRibbons.ts`, `DecalRibbonPatch.ts`).
- **The decal material** (`DecalMaterial.ts`' `setupDecalMaterial`): atlas-space UVs, `uv1` edge
  fade, `BLEND` / `CUTOUT`, polygon offset (−1, −4), wetness. It stays in the toolkit.

## Design

### D1. The feature and its parts

- `decals()` (`requires: ['merging']`), listed after `merging()` and before `terrain()` in the
  template.
- `DecalPools.ts`: p309's pool, moved as it is, its material any material id (the pool doesn't
  care what draws the patch).
- `DecalSurfaces.ts`: a **surface provider** registry (`registerDecalSurfaceProvider({ id,
  matches(entityId), writePatch(…) })`). The engine's default is the mesh provider (three's
  `DecalGeometry`, lazy). `terrain()` registers the block provider (`readBlockSurface`'s exact
  grid) from its install when `decals()` is installed, so a decal on a block conforms as today.
- `DecalSources.ts`: a **source** registry (`registerDecalSource({ kind, writeUVs, material })`):
  how a source maps the patch's projected 0..1 coordinates into what its material samples.
  `ATLAS` here (the cell rect, as today); p397 registers `TEXT`.
- The public API:

```ts
const pool = createDecalPool({ id: 'bulletHoles', material: 'decalsStructure_cutout', maxDecals: 128 });
spawnDecal(pool, { position, normal, size: [0.2, 0.2], rotation, source: { kind: 'ATLAS', cell: 'bulletHole01' }, lifetime: 30 });
const id = await createDecalEntityAsync({ target: wallId, position, normal, up, size: [1, 0.5], source, material, pool? });
```

  `createDecalEntityAsync` is a placed, editable decal (an entity with a `DECAL` component:
  target, local placement on the target, source, material; its patch rebuilt when the target or
  the placement changes), drawn in a pool (the scene's default pool per material when none is
  given). The scene JSON's `decals` entries are these.
- Ribbons and trails stay terrain's (they sample a block), on the moved pool.

### D2. The material decal layer

```jsonc
// a *.material.json
"decals": [
  { "source": { "kind": "ATLAS", "atlas": "decalsStructure", "cell": "hazardStripe" },
    "uv": { "set": 0, "center": [0.5, 0.7], "size": [0.3, 0.1], "rotation": 0 },
    "opacity": 1, "color": "#ffffff", "normalStrength": 1, "roughness": null, "emissive": null }
]
```

- **The hook:** the kernel's material build gets a registered post-step
  (`registerMaterialLayer({ key: 'decals', schema?, applyAsync(material, value, ctx) })` through
  the `FeatureContext`, following `MaterialInputResolvers.ts`), so the kernel imports no decals
  code. With no `decals` key nothing runs: no graph change, no cost. The JSON key's shape is
  validated by the gather with the feature's schema (the kernel's schema passes it through as the
  feature's type, `import type`).
- **The node** (`MaterialDecalLayer.ts`): for each decal, its UV rect test, the source's sample,
  then over the material's existing `colorNode`, `normalNode`, `roughnessNode`, `emissiveNode`
  (read from the built material, falling back to its params). Up to `MAX_MATERIAL_DECALS` (8) per
  material in one loop over a small uniform array (placement and values are uniforms: moving a
  decal in the editor rebuilds nothing; adding or removing one, or a source kind change,
  rebuilds).
- Works on every node material the kernel builds (`MeshStandardNodeMaterial`, physical, lambert,
  phong, basic; a TSL `setup` material whose nodes it wraps). Not on terrain materials (their own
  graph; a decal set is their route) or the merge material (a palette member's decals are a
  follow-up, like the editor's palette limit in p990).
- **Needs:** the mesh's UV set; on a mirrored or overlapping UV island the decal shows twice. The
  handbook says so.

### D3. The move

- Engine: `features/decals/` takes `RuntimeDecals.ts` (as `DecalPools.ts`), `DecalPatch.ts`'s
  generic part and `MeshDecals.ts`; terrain's block patch becomes its surface provider
  (`features/terrain/` or the toolkit's `blocks/`, wherever `readBlockSurface` must stay: it's the
  toolkit's today, so the provider is registered from the toolkit by `registerTerrainDecalSurface()`,
  called by the app's install like `registerTerrainScatter()`).
- Toolkit: `createDecalPool`, `spawnDecal`, `spawnMeshDecalAsync` on `aekasha/toolkit/terrain`
  become `@deprecated` wrappers over `aekasha/decals` ("use `aekasha/decals`' …; removed in toolkit
  4.0"); `spawnRibbonDecal` and `createDecalTrail` stay (on the engine's pools).
- The app: `terrainShowcase`, `terrainBlockTest` and `terrainGallery` move to the new names; the
  bench `devTools/bench/terrainBlockTestDecals.ts` reruns with the same figures (the refactor's
  check).
- `docs/techniques/terrain-decals.md` splits: the general how-to into `docs/techniques/decals.md`,
  the terrain-specific parts stay.

## Phases

### Phase 1: The hook's shape (a short spike)

Prototype `registerMaterialLayer` on a standard and a TSL `setup` material: where in
`kernel/assets/Material.ts` the layer runs (after the params and nodes, before the first compile),
how it reads an existing node (`colorNode` set or not), and that a material without the key builds
the identical graph (compare `NodeBuilder` output). Write the decision here.

### Phase 2: The feature and the moved pools

1. `decals()`, `DecalPools.ts`, `DecalSurfaces.ts` (the mesh provider), `DecalSources.ts`
   (`ATLAS`); the toolkit's wrappers; the block provider; the moved tests passing unchanged in
   meaning.
2. The app's scenes on the new names; `yarn verify:scenes --only terrainShowcase,terrainGallery,
   terrainBlockTest` unchanged against `main`'s baselines; the bench's figures within noise.

### Phase 3: Placed decal entities

`DECAL` component, `createDecalEntityAsync`, the scene JSON's `decals` (gathered), the patch
rebuilt on a target's or placement's change (in `APP_RENDER_SYNC`, at most N per frame, the rest
queued), `__saveData`; tests. The `textShowcase` gets a decals station (atlas decals on a crate, a
barrel and a wall).

### Phase 4: The material decal layer

D2's hook, node and schema; tests (graph unchanged without decals; a decal's uniforms; the UV rect
maths); a material with a hazard-stripe decal in the showcase.

### Phase 5: The Hub and the docs

`features/decals/CLAUDE.md` (its `##` sections: projected decals, surfaces and sources, placed
decals, the material decal layer), its map line; the Hub's Decals feature page (`aek:covers`);
`docs/techniques/decals.md`; `src/toolkit/terrain/CLAUDE.md` and the terrain Hub page pointing at
it; the root `CLAUDE.md` (the feature list, nineteen with `text()`), `readme.md`.

### Phase 6: Versions and done

On the `p396-decals` branch (the epic's Branches and PRs): engine minor, toolkit minor (the
deprecations), app minor. `CHANGELOG.md`; mark the plan done.

## Verification

`yarn test`; the terrain scenes' baselines unchanged; the decals bench within noise; `yarn sbp`
(the feature's group; a build without decals carries none of it); `yarn verify:baselines` (the API
baseline: the new entry, the deprecated names still there).

## Non-goals

Deferred / screen-space decals (a G-buffer the renderer doesn't have), decals on skinned meshes
(their patch would need skinning), decals on terrain materials through the layer, palette members.
