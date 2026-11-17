# Structure materials

Concrete walls, bunkers, rock faces, dams and other large pieces drawn with the terrain material: projected from all three axes (no UVs needed, no stretching on any face), anti-tiled, varied by a macro at a structure's scale, and worn by layers painted into the vertex colour. In object space the texture sticks to a piece that moves or turns; in world space static pieces run on into each other without a seam.

`createStructureMaterial` is a thin preset over `createTerrainMaterial`, so everything on [Single-layer terrain](terrain-single-layer.md), [Vertex-colour splat](terrain-vertex-color-splat.md) and [Triplanar cliffs](terrain-triplanar-cliffs.md) applies.

## What it is

```text
 space: OBJECT   positionLocal × the mesh's scale (metres), its normal: everything follows the piece
        WORLD    the world's position and normal: static pieces line up across joints
        │
 TRIPLANAR projection (a structure's faces point every way) ──► DUAL_SCALE anti-tiling
        │
 macroNoise at 12 m (stains a few metres across) ──► wear: VERTEX_COLOR RGBA (clean, stained, grime, damage)
        │
 the shaded normal back to world once (mat3(modelWorldMatrix) · n / scale), then to view
```

- **Object space** follows `triplanarProjection`'s `alignToObject`: the coordinates, the projections and their derivatives, the frames, the rules' height, slope and facing, the macro and the normals' fade all work in the mesh's space, scaled to metres (so a piece scaled 2 × shows the texture at its real size, not stretched).
- **The defaults** (`getStructureMaterialConfig`): `space: 'OBJECT'`, `TRIPLANAR`, `DUAL_SCALE`, a `macroNoise` macro at 12 m. Any terrain field replaces its default.
- **Wear** is a painted blend: clean, stained and damaged concrete weighed by the vertex colour (`RGBA`, up to 5 layers), painted in Blender or in code from the geometry (streaks down vertical faces, chips along top edges, grime at the foot).
- **Decals** (p309) add the unique detail no tiling has: signs, cracks, scorch marks.

## Best for

|                      | Good fit                                                                                | Poor fit                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Art style            | Brutalist, industrial, military, ruins; photoreal and stylized PBR                      | Pieces with authored UV detail (trim sheets, painted signage): a UV-mapped material is cheaper and more precise  |
| Game type and camera | First and third person among large architecture; any camera on rock formations          | Small props: triplanar's 3 taps per texture on a 50 cm crate is wasted                                           |
| World size           | Levels of large pieces; a kit's walls and floors in world space so they join seamlessly | Thousands of independently moving instances of one `InstancedMesh` in object space (they share one space, below) |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): the defaults with one `LITE` layer: 2 · 2 (`DUAL_SCALE`) · 3 (`TRIPLANAR`) + 1 = **13**. With four wear layers, every layer sampled: 2 · 4 · 2 · 3 + 1 = **49**: the `TAPS` view shows over 32 on the gallery's worn pieces.
- **Bring that down with the tier preset**, as for terrain: sparse sampling of the top 2 or 3 layers (a set array), and `BIPLANAR` on the low tiers. Top-2 with `DUAL_SCALE` and `TRIPLANAR` is 25; top-2 without anti-tiling and `BIPLANAR` is 9. A slope gate saves little on a structure: walls are steep everywhere, only roofs and floors are flat.
- **ALU:** object space adds the space's position, normal and matrix per pixel: about 0.08 ms on a bunker filling much of the frame (below).
- **Measured GPU time** (p305 Phase 7, 2026-11-16: Windows Chrome 157 on an AMD RDNA 3 GPU, WebGPU, 1280 × 800, the median of three 90-frame medians of the frame, the camera 13 m in front of the gallery's bunker piece, 5 m up; empty 1.09 ms): the worn bunker (4 layers, the defaults) in `OBJECT` 1.72 ms, the same material in `WORLD` 1.64: the piece costs 0.63 ms in object space, 0.55 in world space. p310 measures every page with fixed camera presets.
- **VRAM:** the layers' sets (`concrete01` and `concrete02` 2.67 MB each at 1K `LITE`) and the macro noise (0.35 MB); the vertex colour per vertex.
- **Bindings:** `P` per layer plus the macro: 4 `LITE` wear layers bind 9 separately.
- **Draw calls:** one per piece per material; merged groups (p372) for a kit's static pieces.
- **Quality tier:** `getTerrainQualityPreset()` for the sparse sampling and anti-tiling (below).

## Maps

| Map                      | Required  | Packing                                                      | Colour space                 | Codec      | Size       |
| ------------------------ | --------- | ------------------------------------------------------------ | ---------------------------- | ---------- | ---------- |
| Each layer's texture set | Yes, 1–5  | One packing for all (`LITE` default; `FULL` for hero pieces) | Albedo sRGB, the rest linear | UASTC      | 1K         |
| The vertex colour        | With wear | `COLOR_0`, RGBA                                              | Linear                       | The mesh's | Per vertex |
| Macro noise              | Default   | `macroNoise`                                                 | Linear                       | UASTC      | 512²       |

The library's structure sets are `concrete01` (smooth, 1.1 × 0.55 m: not square, so it can't share a set array with square sets) and `concrete02` (damaged, 2 m); stains and grime borrow ground sets (`mud01`, `rocks02`).

## Blender, step by step

Structures aren't terrain blocks: no add-on operator applies, and any modelling works. Start from `structure_concrete.blend` (`src/toolkit/terrain/blender/`): two wall segments in world space and a bunker passage in object space, worn by a `Wear` colour attribute, with a box-projected preview of the four sets (Blender's triplanar).

1. **Model at real scale,** in metres; apply rotation and scale (_Ctrl A_), or keep the scale on the object: object space measures the piece × its scale in metres either way. **The origin** is the pivot the engine moves and turns the piece about, and object space's texture is anchored to it: put it at the base's centre, and give pieces that should line up origins on a common grid.
2. **No UVs:** the material projects every set from three axes (`TRIPLANAR`), so there's no unwrapping and no stretching on any face.
3. **Vertices for the wear:** a 12-triangle box can't hold a streak. Cut the faces where wear goes every 0.3-0.5 m (Loop Cut, or _Mesh → Bisect_ repeatedly; the template is cut every 0.35 m).
4. **Paint the wear** in Vertex Paint on a byte colour attribute on vertices (the template's `Wear`), as a terrain splat: pure red, green, blue for layers 1-3 (the template: stains, grime, chips), black for clean concrete (the base), Mix at strength 1; the alpha for a fifth layer (`RGBA`). Streaks run down from the tops, grime gathers at the foot, chips sit on the edges.
5. **World or object space:** static pieces that join (a wall's segments) in `WORLD`, so the concrete runs on across a joint; a piece that moves or turns in `OBJECT`, so its texture moves with it. The template's two preview materials show both.

## Export

_File → Export → glTF 2.0_, by hand (the add-on's Export Block is for terrain blocks): glTF Binary; Include: Selected Objects; Transform: +Y Up; Data → Mesh: Apply Modifiers ✓, UVs ✗ (not read), Normals ✓, Tangents ✗; Vertex Color: Active (the wear attribute active), Export All Vertex Colors ✗; Material: No Export, Images: None; Compression off (the asset pipeline encodes). Keep the piece's real-world scale in the mesh, or in its node's scale: object space measures in metres either way. Then an `<id>.importedAsset.json` beside it ([Asset optimization](asset-optimization.md)).

## Import into Ækasha

**One layer** (code):

```ts
import { createMeshEntity } from 'aekasha';
import { createStructureMaterial } from 'aekasha/toolkit/terrain';

// Damaged concrete that sticks to the piece when it moves
const concrete = createStructureMaterial('concrete02', { id: 'gateConcrete' });
createMeshEntity({ geo: 'gatePiece', mat: concrete });
```

**Worn**, four layers by the vertex colour (the gallery's bunker):

```ts
import { createStructureMaterial } from 'aekasha/toolkit/terrain';

createStructureMaterial(
  [{ set: 'concrete01' }, { set: 'concrete02' }, { set: 'mud01' }, { set: 'rocks02' }],
  { id: 'bunkerConcrete', blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } } }
);
```

**With the tiers**, whose sparse sampling reads the layers from a set array: every set must share the array's texture size and codec, and `concrete01`'s textures aren't square, so a worn material with tiers takes a square clean set (here `concrete02` clean, a ground set for the stains). The array is built first (a scene's `textureSetArrays` entry, or `buildTextureSetArray({ sets, packing })`), and `LOW` swaps the projection for `BIPLANAR`:

```ts
import { createStructureMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

const preset = getTerrainQualityPreset();
createStructureMaterial(
  [{ set: 'concrete02' }, { set: 'mud02' }, { set: 'mud01' }, { set: 'rocks02' }],
  {
    id: 'bunkerConcreteTiers',
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
    quality: { ...preset, LOW: { ...preset.LOW, projection: { mode: 'BIPLANAR' } } },
  }
);
```

**Static kit pieces in world space** (`space: 'WORLD'`), so the concrete runs on across the joints:

```ts
createStructureMaterial('concrete02', { id: 'wallConcrete', space: 'WORLD' });
```

**The JSON route** has no preset: write the defaults into the define, the sets as inputs:

```json
"staticDefines": {
  "terrain": {
    "layers": [{}],
    "space": "OBJECT",
    "projection": { "mode": "TRIPLANAR" },
    "antiTiling": { "mode": "DUAL_SCALE" },
    "macro": { "scale": 12 }
  }
},
"inputs": {
  "layer0": { "textureSet": "concrete02" },
  "macro": { "texture": "macroNoise" }
}
```

## Set-up and parameters

| Field        | What it is                                                                                                                                                            | Structure default        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `space`      | `OBJECT`: the mesh's space in metres, for pieces that move, turn or are instanced; `WORLD`: static pieces, seamless across joints. Material-wide, not a tier override | `OBJECT`                 |
| `projection` | As on [Triplanar cliffs](terrain-triplanar-cliffs.md#set-up-and-parameters)                                                                                           | `{ mode: 'TRIPLANAR' }`  |
| `antiTiling` | As on [Single-layer terrain](terrain-single-layer.md#variations)                                                                                                      | `{ mode: 'DUAL_SCALE' }` |
| `macro`      | `{ texture, scale, … }`; `undefined` for none                                                                                                                         | `macroNoise` at 12 m     |
| `blend`      | `VERTEX_COLOR` with `RGBA` for wear (layers 1–4 by R, G, B, A; layer 0 the clean surface)                                                                             | `SINGLE`                 |

`getStructureMaterialConfig(layers, opts)` returns the config without creating it, for `getTerrainMaterialProps` (loading its textures) or a JSON's fields.

## Variations

- **World vs object space:** `WORLD` for anything that never moves: the texture is continuous across pieces, so a wall of segments reads as one pour. `OBJECT` for pieces that move, turn or are placed many times (a kit piece rotated 90° keeps its texture's orientation relative to itself). **An `InstancedMesh`'s instances share its object space** (three applies the instance matrix to the local position): fine for static instances, but an instance moving on its own slides under its texture.
- **Wear layers:** clean, stained, damaged, grime. Weight streaks and chips by the vertex normal's verticality (streaks run down walls, chips sit on top edges), so a roof keeps only stains. Each layer costs `P × A × T` fetches: use sparse sampling past two.
- **Triplanar vs biplanar:** `BIPLANAR` is two thirds of the cost and hard to tell apart on flat-faced pieces; keep `TRIPLANAR` for rounded rock.
- **Decals** (p309): signs, cracks, scorch marks and graffiti over the material, for the unique detail tiling can't give.
- **A macro at the piece's scale:** 12 m for walls and bunkers (stains a few metres across), larger for dams and cliffs.
- **`FULL` for hero pieces:** the AO in its own map into indirect light.

## Pitfalls and checklist

- [ ] Static pieces in `WORLD`, moving or rotated kit pieces in `OBJECT`.
- [ ] No `InstancedMesh` instance moves on its own under an `OBJECT` material.
- [ ] Wear pieces have the vertices to carry it (subdivided where the wear goes).
- [ ] Four wear layers have the tier preset (sparse sampling) and a set array; `TAPS` stays under about 24.
- [ ] The scale of a piece is real (metres): object space measures in the mesh's space × its scale.
- **The texture slides over a moving piece:** it's in `WORLD`.
- **Vertical low-frequency streaks on a wall:** the macro samples a planar `(x, −z)` of the space, so on a wall it varies only horizontally (as on a terrain's cliff face). Lower its `brightness`, or add stains as a wear layer.
- **A seam at a joint between two walls:** they're `OBJECT` (each its own space). Use `WORLD` for static pieces that meet.
- **Debug views' stripes and checkers don't follow the piece:** the views draw them in world space.
- **"over its budget":** four `LITE` layers and the macro bind 9; a fifth layer, or a colour map, needs an array.

## Template file and example asset ids

- **Blender template:** `src/toolkit/terrain/blender/structure_concrete.blend` (its README text block mirrors this page's Blender steps).
- **The helpers:** `createStructureMaterial`, `getStructureMaterialConfig` (`src/toolkit/terrain/material/StructureMaterial.ts`, `aekasha/toolkit/terrain`).
- **The sets:** `concrete01`, `concrete02`; `mud01` and `rocks02` for grime and damage.
- **The gallery's Structures row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/structuresRow.ts`): a wall of two 8 m segments in `WORLD` space (the concrete runs on across the joint) and a bunker's passage piece turned 25° in `OBJECT` space, both worn by their vertex colour (`concrete01` clean, `concrete02` in rain streaks and stains, `mud01` grime at the foot, `rocks02` on chipped edges and impacts); two `concrete02` pillars turning and rising, `OBJECT` beside `WORLD`. Its tab holds the pillars and flies the camera to each piece; the Debug view select reaches it.
