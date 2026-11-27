Status: draft | not-implemented
Category: Decals, Text
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p392_text-feature-msdf-renderer.md (the MTSDF node and the layout), p396_engine-decals-feature.md
Blocks: p398_decal-editing-and-bake.md
Related: p393_text-effects.md (the outline and field reads it reuses), `src/toolkit/terrain/CLAUDE.md` (the decal material's `BLEND` / `CUTOUT`, polygon offset and wetness, which the text decal material copies)

# Text Decals — Plan

Text painted onto meshes: a `TEXT` decal source for p396's projected decals and its material decal
layer, drawn with p392's MTSDF node, with effects that come from the distance field (the epic's
D8): colour, outline, wear, paint thickness, stencil breaks and emissive. No normal map is
authored; the paint's normal is computed per pixel from the field.

## Design

### D1. The source

```ts
await createDecalEntityAsync({
  target: crateId, position, normal, up, size: [0.8, 0.3],
  source: {
    kind: 'TEXT', text: 'FRAGILE', font: 'plexSans', align: 'CENTER', fit: 'CONTAIN', // 'CONTAIN' | 'WIDTH' | 'NONE'
    color: '#c02020',
    outline: { width: 0.1, color: '#000000' },
    wear: { amount: 0.4, scale: 6, edge: 0.6, seed: 3 },
    paint: { thickness: 0.4, roughness: 0.6, metalness: 0 },
    stencil: { bridges: 0 },
    emissive: null,
  },
});
```

The same object is a material decal's `source` (p396 D2) and a scene JSON decal's.

### D2. Drawing glyphs on a projected patch

- **On a flat target** (the patch's normals within a tolerance of the decal's normal): one quad per
  glyph, laid out by p392's layout inside the decal's box (`fit`), lifted by p309's `lift`, in the
  pool like any decal. Cheap and exact.
- **On a curved target:** the decal's patch (the surface provider's, as for atlas decals) with its
  projected 0..1 coordinates; the fragment finds the glyph under it through a per-decal **glyph
  grid**: the box divided into cells, each listing the glyphs overlapping it (a small data texture
  per pool: the glyph rects and the cell lists, written at the spawn). A pixel samples at most the
  glyphs of its cell (usually one or two). This keeps one patch per decal on a barrel or a rock,
  instead of a patch per glyph.
- The pool's material is the text decal material (D4); the source's `writeUVs` writes the box
  coordinates and the decal's row in the glyph data.

### D3. In the material decal layer

The same glyph grid, per material decal, in a uniform-indexed data texture; the layer's loop
samples it in UV space. A material's text decal costs a grid lookup and one or two atlas samples
per pixel inside its rect, nothing outside it.

### D4. The text decal material (`TextDecalMaterial.ts`, in `features/text/decals/`)

The `text()` feature registers the `TEXT` source with `decals()` from its install when both are
installed (`ctx.isInstalled('decals')`), and its code is `import()`ed with the first text decal.
The graph:

- **Coverage:** `sampleMtsdf` (p392), the median for the fill and the outline.
- **Wear:** a seeded value noise (`aekasha/toolkit/terrain`'s noise can't be imported by the
  engine; a small hash-based noise in the feature, integer-hashed like the toolkit's so it's stable
  on SwiftShader) raises the threshold: `coverage(median − wear × noise × (1 − edgeBias))`, eating
  the letters from the edges in; the seed per decal.
- **Paint thickness:** height `h = smoothstep(0.5, 0.5 + thickness × range, alpha SDF)`; the
  normal from `dFdx` / `dFdy` of `h` in the surface's tangent frame (the patch's derivatives, as
  p309's decal normal), blended over the surface's normal by coverage; the paint's roughness and
  metalness over the surface's.
- **Stencil bridges:** gaps cut across the glyphs at intervals along x (a stencil font look),
  from the box coordinate.
- **Emissive:** the fill's colour × intensity into the emissive (signs that glow at night).
- `BLEND` and `CUTOUT` like p309's decal material, the same polygon offset, the surface
  conditions' wetness (`SIMPLE`) when `surfaceConditions()` is installed.

### D5. The scene's fonts

A text decal's font and characters reach p391's collection (`collectFromScenes`) and the scene's
`fonts` list through the gather, like a text entity's.

## Phases

### Phase 1: Flat text decals

D1's source, D2's flat path, D4's coverage, colour and outline; tests on the fit and the flat
detection; the showcase's decals station: "FRAGILE" on a crate, a number plate on a wall.

### Phase 2: Curved targets and the glyph grid

D2's grid, its data texture and the fragment lookup; a barrel and a rock with text; the grid's
cost measured on 64 text decals (GPU ms against the flat path on a flat wall).

### Phase 3: Wear, thickness, stencil, emissive

D4's effects as variant bits (each off costs nothing, as text effects); the showcase's row of the
same word worn, thick, stencilled, glowing, in light and at night (the sky clock).

### Phase 4: Material text decals

D3: the layer's `TEXT` source; a crate material with a stamped serial number on every crate.

### Phase 5: The Hub and the docs

The Decals page's Text decals section with the showcase's regions; `features/text/CLAUDE.md` and
`features/decals/CLAUDE.md` (their Text decals sections, `aek:covers`); `docs/techniques/decals.md`.

### Phase 6: Versions and done

On the `p396-decals` branch's bump. `CHANGELOG.md`; mark the plan done.

## Verification

`yarn test`; `yarn verify:scenes --only textShowcase` (the decals station in the baseline, both
backends); Phase 2's figures.

## Non-goals

Per-glyph patches on curved targets (the grid replaces them), text along a curve, decals on skinned
meshes (p396's non-goal).
