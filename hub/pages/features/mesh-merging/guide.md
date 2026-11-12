## Installing it

List [`merging()`](api:merging), from `aekasha/merging`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)), after `physics()`: a scene's
groups are then built once its bodies exist. The merge code loads with the first group a scene
builds.

- Without `merging()`, a mesh's `merge` warns once and the mesh is drawn on its own, and the
  functions on `aekasha/merging` throw, naming the feature.
- A scene whose JSON has a mesh's `merge` or a `mergeGroups` list fails the boot without it,
  naming the feature (see [the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## A merge group

A merge group is an entity that owns one merged mesh. Its members are mesh entities that share a
material: each keeps its transform, its physics body, its geometry and material and its data,
and only its own mesh is hidden while the group draws it.

A group has a mode. `BAKED`, the default and the subject of this page up to
[Batched groups](#batched-groups-members-that-move), merges its members into one geometry: one
draw, culled whole, for static content. `BATCHED` draws them as instances of one
`BatchedMesh`, each with its own matrix and culling, for members that move, fade or have their
own LOD.

```ts
import { createMeshEntity } from 'aekasha';
import { addToMergeGroup, createMergeGroup } from 'aekasha/merging';

createMergeGroup({ id: 'ruins', castShadow: true, receiveShadow: true });
const walls = [0, 4, 8].map((x) =>
  createMeshEntity({ geo: 'wallGeo', mat: 'stoneMat', position: { x } })
);
addToMergeGroup('ruins', walls);
```

- **One draw per group and pass.** The group is drawn once in the main pass and once in each
  shadow pass that draws its members.
- **Built in the next frame**: what joins a group during a frame is merged once, in the next
  frame's render sync (an app's first build also waits a frame for the merge code to load). A
  group of more than 65 536 vertices merges in the assets worker, its new members drawn on their
  own until it's in, so no frame goes without them.
- **Culled whole.** The group is one bounding sphere: in view, all of it is drawn. It's the entry
  in the spatial index too (its members leave the `DEFAULT` domain while merged), and a member's
  own culling and LOD settings do nothing while it's merged.
- **Scene-scoped.** A group goes with the scene it was made in, and its members with theirs.
  `persistent: true` keeps a group across scene switches, and only such a group takes
  `persistent` members.
- [`dissolveMergeGroup`](api:dissolveMergeGroup) deletes the group: its members are drawn on
  their own again at once. [`getMergeGroupOf`](api:getMergeGroupOf) names an entity's group.

## Joining a group

A mesh joins a group by its `merge` prop, in code or JSON:

- **A group's id** (`merge: 'ruins'`): the group is made on first use, with the settings of the
  scene's `mergeGroups` entry for it, else its first member's shadow flags.
  [`createMergeGroup`](api:createMergeGroup) makes one with settings of its own.
- **`'AUTO'`**: the engine picks the group (see [AUTO](#auto)).
- **`{ group?, mode?, cellSize?, maxVertices?, palettes? }`**: `AUTO` (the default) with this
  mesh's own cell size, vertex cap and [palettes](#palettes-several-materials-in-one-draw); `mode`
  names the [mode](#batched-groups-members-that-move) of the group it joins.

```json
{
  "props": {
    "geo": "ruinKitWall",
    "mat": "ruinStone",
    "position": { "x": 4, "y": 0, "z": 0 },
    "merge": "AUTO"
  }
}
```

A mesh's `merge` waits for the next build (or the scene load's end) before it joins: by then an
imported model has created its bodies and your code has placed the mesh, so the checks and
`AUTO`'s cell see where it ends up. [`addToMergeGroup`](api:addToMergeGroup) adds entities that
exist already; `addToMergeGroup('AUTO', ids)` queues them as the prop does.

### AUTO

`AUTO` groups meshes that can be drawn together and are near each other:

- **The key:** the material (the same registered material, not a look-alike; or the palette it's
  in, see [Palettes](#palettes-several-materials-in-one-draw)), the geometry's attributes, both shadow flags, the render layers, whether the mesh is `persistent`, and the mode
  (`merge: { mode: 'BATCHED' }`). Meshes that differ in any of them never share a group.
- **The cell:** square cells on x and z, 32 m a side by default, from the mesh's position when it
  joins. A group never spans two cells, so it stays small enough to be culled usefully.
- **The cap:** 262 144 vertices by default; a full group opens the next one in its cell. A
  batched group counts each geometry once (its batch holds it once, whatever its members).
- **The ids** are derived (`auto:<key hash>:<cx>,<cz>:<n>`), and a scene gets the same ones on
  every visit.

A scene sets its own defaults, and gives a named group its settings:

```json
{
  "mergeGroups": [
    { "id": "AUTO", "cellSize": 50 },
    { "id": "courtyardFloor", "castShadow": false, "receiveShadow": true }
  ]
}
```

Pick the cell size from the view: large enough that a cell holds many pieces, small enough that
most of a group is in view when any of it is. `largeWorld` (a 200 m terrain) uses 50 m cells, the
example's 24 m courtyard 16 m ones.

### Imported models

- A **`merge` custom property** on a Blender node (the glTF `extras`: `AUTO` or a group's id)
  merges that node's mesh, like the physics properties (see
  [From imported models](hub:features/physics#from-imported-models)).
- **`spawnImportedAsset`'s `merge`** (`'AUTO'`, an id or the options) applies to every visible
  piece of the model. A node's own property wins over it, and the spawn's `meshProps` over both.
- A piece of a physics group whose body isn't `FIXED` is left out of the spawn's `merge`, whatever
  its mode: it moves with its body. A node's own `merge` there joins a `BATCHED` group, and a
  `BAKED` one refuses it.

Joining the pieces at build time instead ([an imported asset's `merge`](hub:features/asset-optimization#merging-a-model-s-pieces))
costs nothing at load, but the pieces are gone as nodes. A merge group keeps them entities.

## Palettes: several materials in one draw

A group draws its members with one material, so a cell of stone, brick, moss and plaster pieces
is four groups. A **palette** (`*.mergeMaterial.json`) lists materials that one shader can draw:
a group on a palette takes meshes of any of them and draws them all in one draw, with the
palette's **merge material**.

```json
{
  "id": "ruinsPalette",
  "materials": ["ruinStone", "ruinBrick", "ruinMoss", "ruinPlaster"],
  "slots": {
    "map": { "size": [256, 256] },
    "normalMap": { "size": [256, 256] },
    "orm": { "size": [256, 256], "from": ["aoMap", "roughnessMap", "metalnessMap"] }
  },
  "optimize": { "profile": "prop" }
}
```

- **The members** are 2 to 256 `STANDARD` material JSONs that agree on everything one shader
  can't vary: their state (`side`, `alphaTest`, `flatShading`, …), no `transparent`, and only maps
  a slot takes. Their colour, opacity, emissive colour and intensity, roughness, metalness,
  normal scale and AO intensity may differ: each member's go into a row of the merge material's
  table. A member that breaks the rule fails the gather, naming the material and the property.
- **The slots** are the merge material's maps: `map`, `normalMap`, `orm` (AO, roughness and
  metalness, packed from the members' separate maps when they have them) and `emissiveMap`, each
  at its `size`. The asset pipeline builds each slot as a texture array, a layer per member (see
  [A palette's arrays](hub:features/asset-optimization#a-palette-s-arrays)). A member without the
  map gets a neutral layer (white, a flat normal), which keeps its own values;
  `"missing": "SKIP"` on a slot skips the sample for those members instead.
- **A scene lists its palettes**, and the merge material is registered under the palette's id
  before the scene's code runs (a JSON mesh's `mat` can name it too). A build carries a palette's
  arrays only for a scene that lists it.

```json
{
  "mergeMaterials": ["ruinsPalette"],
  "mergeGroups": [
    { "id": "AUTO", "cellSize": 16, "palettes": ["ruinsPalette"] },
    { "id": "courtyard", "palette": "ruinsPalette" }
  ]
}
```

- **`AUTO`:** a mesh whose material is in one of the `AUTO` entry's `palettes` goes into its
  cell's group of that palette (the first palette in the list that has it). A mesh's own
  `merge: { palettes }` replaces the scene's list, and `palettes: []` keeps it out of them.
- **A named group:** `palette` in its `mergeGroups` entry, or
  [`createMergeGroup`](api:createMergeGroup)`({ id, palette })` in code. It takes a mesh whose
  material is one of the palette's, as registered: a variant (`matOverrides`) or a clone is
  another material, and is refused, naming the palette.
- A palette must be one the scene lists: the gather fails on a `mergeGroups` entry naming another,
  and `createMergeGroup` throws. A palette group can't be `persistent` (the merge material and its
  arrays are the scene's).

```ts
import { createMeshEntity } from 'aekasha';
import { addToMergeGroup, createMergeGroup } from 'aekasha/merging';

createMergeGroup({ id: 'courtyard', palette: 'ruinsPalette' });
const pieces = [
  createMeshEntity({ geo: 'wallGeo', mat: 'ruinStone', position: { x: 0 } }),
  createMeshEntity({ geo: 'wallGeo', mat: 'ruinBrick', position: { x: 4 } }),
];
addToMergeGroup('courtyard', pieces);
```

A member's values in the table are its material JSON's: a scene's saved overrides of a member's
parameters don't reach the merge material.

A variant of a listed palette (the same arrays with another slot's `missing`, say) is
[`createMergeMaterialAsync`](api:createMergeMaterialAsync) on a copy of the palette's data from
the scene's generated data: you register it under an id of its own, and it draws the meshes you
give it, never a palette group.

### When a palette pays

A palette trades pixels for draws. It saves `materials − 1` draws a cell in each pass that draws
the cell, and the merge material costs more per pixel than the members' own materials (it reads
its table and samples every slot for every member). Measured on the `mergeMaterials` debug scene,
1 600 meshes of four materials in nine cells (Chrome on an Apple M2, 1200 × 800, GPU time a frame;
WebGL2's figure holds a fixed 3.6 ms):

| Groups               | Draws | Merged geometry (WebGPU / WebGL2) | GPU, field from above | GPU, field filling the view |
| -------------------- | ----- | --------------------------------- | --------------------- | --------------------------- |
| by palette           | 10    | 43.6 / 41.3 MB                    | 4.8 / 8.6 ms          | 6.7 / 10.9 ms               |
| by palette, ≤ 65 535 | 19    | 35.8 / 33.5 MB                    | 4.8 / 8.5 ms          | 6.8 / 10.3 ms               |
| by material          | 37    | 32.7 / 32.7 MB                    | 4.1 / 7.6 ms          | 4.8 / 8.9 ms                |
| unmerged             | 1 601 | —                                 | 5.1 / 8.9 ms          | 4.7 / 7.9 ms                |

The 27 draws the palette saved cost about 0.03 ms of the CPU's frame there (a draw is about
1 µs), against 0.6-0.8 ms more GPU time from above and 1.8-1.9 ms filling the view: on that
scene, groups by material were faster. So:

- **Measure first, and use a palette where draws are short:** hundreds of draws saved (many
  materials a cell, many cells, every shadow pass), or a device whose draws cost more. With a few
  materials a cell, keep a group per material.
- **Cap a palette group at 65 535 vertices** (`maxVertices: 65535` on the `AUTO` entry or the
  mesh): a group is as big as all its materials' pieces together, and past 65 535 vertices its
  index takes 32 bits instead of 16. The palette index itself adds 4 bytes a vertex on WebGPU (1
  on WebGL2).
- **Keep a palette's textures at one size:** a slot's layers all take the slot's size, so a 256²
  member in a 1024² slot takes 16 times its memory. At one size, the arrays cost what the
  members' own textures do.
- **Don't palette a feature only one member uses** (an emissive map, a normal map): every member
  then samples it. The gather warns. `SKIP` saves the sample, but its explicit mip selection
  differs slightly from a plain sample's.
- Transparent materials and different alpha modes can't share a palette.

## Members are static

A baked group's member is drawn where it was when it was merged. Move one, and tell its group (a
[batched group](#batched-groups-members-that-move)'s members move freely):

```ts
import { getECSWorld, getEntityIdByAppId } from 'aekasha';
import { updateMergeMember } from 'aekasha/merging';

const gate = getEntityIdByAppId('ruinGate')!;
getECSWorld().setTransform(gate, { pos: { x: 4, y: 0, z: 12 } });
updateMergeMember(gate);
```

- [`updateMergeMember`](api:updateMergeMember) rewrites only the member's part of the merged
  mesh, positions, normals and tangents, in place: no rebuild, no allocation. The group's bounds
  only grow until its next build.
- [`removeFromMergeGroup`](api:removeFromMergeGroup) takes a member out: it's drawn on its own at
  once, free to move, and its triangles in the merged mesh are collapsed in place. Deleting a
  member does the same. Once a quarter of a group's vertices are unused, the group builds again,
  compact, in the next frame.
- **Disabling a member** hides its part of the merged mesh, and enabling it shows it again,
  without a rebuild.
- [`rebuildMergeGroup`](api:rebuildMergeGroup) merges a group again from where its members are
  now.

A member's `TRANSFORM` changing isn't enough: the engine doesn't watch it (a fixed body's sync
would look like a move). In debug mode, a member moved without `updateMergeMember` warns once,
naming it and its group.

### Moving a member over many frames

`updateMergeMember` writes the member's part once. For a member that moves for a while (a drag in
an editor tool), an edit session draws it on its own meanwhile and writes it into the merged mesh
once, at the end:

```ts
import { getECSWorld, getEntityIdByAppId } from 'aekasha';
import { beginMergeMemberEdit, endMergeMemberEdit } from 'aekasha/merging';

const gate = getEntityIdByAppId('ruinGate')!;
beginMergeMemberEdit(gate);
getECSWorld().setTransform(gate, { pos: { x: 4, y: 0, z: 12 } }); // as often as the drag moves
endMergeMemberEdit(gate);
```

- [`beginMergeMemberEdit`](api:beginMergeMemberEdit) hides the member's part of the merged mesh
  (in place, no rebuild) and draws its own mesh, which follows its `TRANSFORM`: moving it costs
  the group nothing per frame.
- [`endMergeMemberEdit`](api:endMergeMemberEdit) writes its part where it is now, draws it merged
  again and moves its physics body there (a fixed body doesn't follow its mesh).
- [`cancelMergeMemberEdit`](api:cancelMergeMemberEdit) puts it back where it was at the begin,
  then ends. [`isMergeMemberInEdit`](api:isMergeMemberInEdit) says whether a session is open.
- A scene exit cancels the open sessions. A member removed or deleted meanwhile stays where it
  is, on its own; a group rebuilt meanwhile keeps the member on its own until the end.

### Which member a ray hit

A raycast hits the group's mesh, whose `userData.entityId` is the group's entity.
[`getMergeMemberAtFace`](api:getMergeMemberAtFace) resolves the hit's face to the member drawn
there (a search of the group's part table, no allocation):

```ts
import * as THREE from 'three/webgpu';
import { getRootScene } from 'aekasha';
import { getMergeMemberAtFace } from 'aekasha/merging';

const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
const [hit] = ray.intersectObject(getRootScene()!, true);
const hitEntityId = hit?.object.userData.entityId as number | undefined;
const memberId =
  hitEntityId !== undefined && hit.faceIndex != null
    ? getMergeMemberAtFace(hitEntityId, hit.faceIndex)
    : undefined;
```

It's `undefined` for a face of a member removed since the build, and for anything that isn't a
built group. A [batched group](#batched-groups-members-that-move)'s hit names its member by the
hit's `batchId` instead: [`getMergeMemberAtBatchId`](api:getMergeMemberAtBatchId), below.

## Batched groups: members that move

A `BATCHED` group draws its members as instances of one three.js `BatchedMesh`: one object for
the renderer, each member an instance with its own matrix, visibility and culling. It takes what a
baked group refuses: members that move every frame (bodies included), transparent members and
members with their own [LOD](hub:features/lod). Its members still share a material.

```ts
import { createMeshEntity } from 'aekasha';
import { addToMergeGroup, createMergeGroup } from 'aekasha/merging';

createMergeGroup({ id: 'crates', mode: 'BATCHED', castShadow: true, receiveShadow: true });
const crates = [0, 2, 4].map((x) =>
  createMeshEntity({ geo: 'crateGeo', mat: 'woodMat', position: { x, y: 1 } })
);
addToMergeGroup('crates', crates);
```

In a scene's JSON, the group's entry names the mode, or a mesh's `merge` does
(`{ "group": "crates", "mode": "BATCHED" }`, or `{ "mode": "BATCHED" }` for `AUTO`'s batched
groups, which never share a group with its baked ones):

```json
{
  "mergeGroups": [{ "id": "crates", "mode": "BATCHED", "perMemberCulling": true }]
}
```

- **The mode is the group's**: its scene entry's or `createMergeGroup`'s, else the first joining
  `merge`'s that names one. A `merge` naming the other mode is refused.
- **Moves draw by themselves.** Every frame, after physics' interpolation, the batch writes the
  matrix of each member whose transform changed, from the pose its own mesh would be drawn at:
  `setTransform`, kinematic and dynamic bodies, an animation. No `updateMergeMember`, no edit
  session (`beginMergeMemberEdit` warns).
- **Each member is culled on its own**, in every pass, shadow passes included. With most of a
  field out of view, that halved the GPU time (see
  [When a batch pays](#when-a-batch-pays)). `perMemberCulling: false` skips the walk over the
  members for a batch that is always in view.
- **Hiding is per member:** disabling a member, a scene load's hold and the engine's frustum
  culling hide its instance, never the batch.
- **Draws.** On WebGPU, three draws adjacent instances of one geometry as one draw, so a batch
  keeps each geometry's members together: one draw per geometry. Members joining into ids others
  freed split those runs; the batch puts them back in order in place once its runs pass twice its
  geometries. On WebGL2 a batch is one multi-draw, in any order.
- **One entry in the spatial index**, as a baked group; its bounds grow as members move away, and
  shrink at its next full build ([`rebuildMergeGroup`](api:rebuildMergeGroup), which also makes a
  fresh batch in geometry order).
- **A member's own mesh** is hidden and out of the scene graph while the batch draws it, so three's
  scene update and a raycast skip it; leaving the group, a dissolve or "Show unmerged" puts it
  back.
- **Code size:** the batch code loads with a scene's first batched group, but three's
  `BatchedMesh` class is in the first download of every app that lists `merging()`
  ([why](hub:issues/three-classes-ship-with-their-chunk)).

Besides what [can't be merged](#what-can-t-be-merged) at all, a batched group refuses a mesh that
isn't directly under the root scene (its matrix is its transform's), a geometry whose index,
attribute names, item sizes or normalization differ from the group's, a `renderOrder` other than
its first member's (the batch is drawn at one place in the render order), and a palette.

### Per-member LOD

A member with a `LOD` keeps it in a batched group: the batch holds every level's geometry, and a
level change gives the member's instance the level's geometry in place. A cross-fade adds a
second instance with the outgoing level for `fadeSeconds`, both dithered as a
[plain mesh's](hub:features/lod#cross-fades) are, shadows too; hiding and showing fade the same.

- Each level must be drawable by the batch: the group's material, the batch's `castShadow`, and a
  geometry that agrees with the group's exactly. Impostor levels are refused.
- A `LOD` added later that doesn't fit takes the member out of its group, with a warning: it's
  drawn on its own, with its LOD.
- On WebGPU, a batch with a LOD member sorts its draw list by geometry every pass (level swaps
  would otherwise keep splitting its runs): one draw per geometry and level in use.
- A baked group still refuses a member with a `LOD`.

### Pools: decals and other short-lived members

A pool keeps a fixed number of members and reuses the oldest: decals, footprints, hit marks. A
batched group's geometry slots are what make that cheap:

- **Slots.** Each geometry takes a slot in the batch's buffers. A geometry no instance uses any
  more frees its slot, and the next new geometry takes the free slot that fits it best.
  `geometryReserve: { vertices, indices? }` gives every slot at least that room, so geometries of
  different sizes up to it all reuse each other's slots and the buffers stop growing.
- **Rewriting.** Write the oldest member's geometry (its vertices, or a new geometry on its mesh),
  move it, and call [`updateMergeMember`](api:updateMergeMember): the slot is rewritten in place
  (or moved to one that fits, past the reserve). Every member sharing the geometry draws the new
  data.
- **Transparent members** are sorted every pass, on both backends, by the group's
  `transparentOrder`: `DEPTH` (the default, back to front) or `JOIN` (in the order they joined, the
  newest on top: decals on one surface, which a depth sort reorders as the camera moves). A member
  `updateMergeMember` rewrote counts as just joined.
- **Colour and opacity per member:** [`setMergeMemberColor`](api:setMergeMemberColor) multiplies
  a colour and an opacity into the group's material for one member (a decal fading out, a unit
  tinted by its team), written only on a change, without allocating.

```ts
import { getECSWorld } from 'aekasha';
import { createMergeGroup, setMergeMemberColor, updateMergeMember } from 'aekasha/merging';

createMergeGroup({
  id: 'footprints',
  mode: 'BATCHED',
  geometryReserve: { vertices: 81, indices: 384 },
  transparentOrder: 'JOIN',
  castShadow: false,
  receiveShadow: false,
});

// Respawning the oldest footprint: its patch written into its geometry first
const opaque = { opacity: 1 };
const respawn = (decal: number, x: number, y: number, z: number) => {
  getECSWorld().setTransform(decal, { pos: { x, y, z } });
  updateMergeMember(decal);
  setMergeMemberColor(decal, opaque);
};
```

On the `batchedMeshSpike` debug scene, a pool of 128 decals rewritten at 60 a second for 10
minutes kept the same buffers and slots, and the renderer the same geometries and textures.

### Which member of a batch a ray hit

A raycast hits the batch, whose `userData.entityId` is the group's entity, and three gives the
hit's instance as `batchId`. [`getMergeMemberAtBatchId`](api:getMergeMemberAtBatchId) maps it to
the member (a walk of the group's members, no allocation):

```ts
import * as THREE from 'three/webgpu';
import { getRootScene } from 'aekasha';
import { getMergeMemberAtBatchId } from 'aekasha/merging';

const ray = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
const [hit] = ray.intersectObject(getRootScene()!, true);
const hitEntityId = hit?.object.userData.entityId as number | undefined;
const memberId =
  hitEntityId !== undefined && hit.batchId !== undefined
    ? getMergeMemberAtBatchId(hitEntityId, hit.batchId)
    : undefined;
```

It's `undefined` for an id no member holds now and for a group that isn't batched.

### When a batch pays

Measured on the `batchedMeshSpike` debug scene: 2 000 members of 20 geometries (1.2 M triangles),
one material, on a MacBook (Apple Metal 3) in Chromium at 1600 × 900; the CPU frame (the update
and `renderer.render`), the median of 3 runs. "Batched" is the engine's batched group, except the
first three rows (a hand-built `BatchedMesh` drawn the same way, within about 0.3 ms of the
engine's).

CPU frame, WebGPU / WebGL2:

| 2 000 members                            | On their own     | Baked group                 | Batched group  |
| ---------------------------------------- | ---------------- | --------------------------- | -------------- |
| Still, all in view                       | 4.77 / 3.52 ms   | 0.77 / 2.12 ms              | 1.86 / 0.84 ms |
| Still, 483 in view                       | 2.61 / 1.70 ms   | 2.98 / 0.66 ms (all drawn)  | 1.53 / 0.52 ms |
| All moving (`setTransform`)              | 5.74 / 8.22 ms   | 22.57 / 17.31 ms (rewrites) | 2.52 / 1.00 ms |
| All kinematic bodies moving              | 8.82 / 9.69 ms   | refused                     | 4.98 / 4.98 ms |
| Three LOD levels, camera dollying        | 7.70 / 5.34 ms   | refused                     | 2.93 / 1.40 ms |
| The same, 1 865 members cross-fading     | 14.89 / 16.59 ms | refused                     | 3.86 / 1.51 ms |
| 512 `BLEND` decals, 30 respawns a second | 3.01 / 3.41 ms   | refused                     | 1.48 / 0.66 ms |

- **The win is the CPU's.** Each mesh on its own costs the renderer an object; a batch is one.
  GPU time is the same every way (the same triangles), except that per-member culling draws only
  what's in view: with 483 members in view, the batch's GPU time was 1.68 ms against the baked
  group's 3.15 (WebGPU).
- **Static content in view: bake it.** A baked group is one draw with nothing to walk, and was
  the cheapest on WebGPU. A batch pays where members move, are mostly out of view, fade or have a
  LOD, or come and go.
- **Moving members: batch them.** Rewriting every member of a baked group in place every frame
  cost several times more than drawing them on their own (a tenth of them: about the same).
- **Draws on WebGPU:** 23 for the field (one per geometry, against 2 003), 55-58 with LOD (one per
  geometry and level in use). Decals are a geometry each, so a pool of 512 was 509 draws, still
  inside one object and half the CPU of separate meshes. WebGL2 draws a batch in one multi-draw.
- **Each shadow pass walks the members again:** 0.3-0.6 ms at 2 000 members on WebGPU, against
  1.8 ms more for separate meshes.
- **Clock noise:** rows measured minutes apart differ by up to about 1 ms more than their work
  explains (macOS clock scaling on a light load). Read a gap under 1 ms as unproven unless both
  backends show it.

## Scene loads

A scene's groups are built during its load, after its code has placed its meshes and physics has
created their bodies, and before the loader goes away. Meanwhile the members are held from
drawing, so the scene's first frame is already merged, and a geometry only merged members use is
never uploaded to the GPU on its own. A merge that fails is logged, and its members are drawn on
their own until the next frame builds them.

## What can't be merged

These are refused with a warning naming the entity and the reason, and drawn on their own:

- skinned meshes, morph targets, instanced and batched meshes and instanced pool instances;
- a material array (split it into a mesh per material, which a palette can merge);
- a material other than the group's (a palette group's: one its palette doesn't have; a variant
  or a clone of a member is another material);
- an entity a manager owns (`managedBy`);
- an entity in another group, a `persistent` one in a group that isn't, and a geometry whose
  attributes don't fit the group's.

A baked group also refuses what a [batched group](#batched-groups-members-that-move) takes:

- transparent materials (they're sorted per object);
- dynamic and kinematic bodies, and tier-frozen dynamic ones (a `FIXED` body is fine: it stays
  per member, as do its colliders);
- an entity with a `LOD`.

## When to merge

| Tool                                                                  | For                                      | Draws                                   | Moves                        | Culled           |
| --------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- | ---------------------------- | ---------------- |
| [Instancing](hub:features/lod#many-instances)                         | many copies of one geometry and material | one per pool (or level)                 | every frame                  | per instance     |
| **A merge group** (baked)                                             | different geometries, one material       | one per group                           | rarely (`updateMergeMember`) | the group, whole |
| **A palette group**                                                   | different geometries and materials       | one per group                           | rarely (`updateMergeMember`) | the group, whole |
| **A batched group**                                                   | different geometries, one material       | one per geometry (WebGPU), one (WebGL2) | every frame                  | per member       |
| [A merged geometry](hub:features/scenes-and-assets#merged-geometries) | a fixed assembly (a wall section)        | one per mesh                            | as one mesh                  | the mesh         |
| Each mesh on its own                                                  | anything                                 | one per mesh                            | freely                       | per mesh         |

- **Many copies of one thing:** instancing.
- **Many different static things sharing a material:** a merge group, bounded by a cell.
- **Different materials:** one group per material (`AUTO` does this by itself), or one group
  per [palette](#palettes-several-materials-in-one-draw) when the draws are what's short.
- **Different things that move, fade, come and go or need their own culling or LOD:** a
  [batched group](#batched-groups-members-that-move) (see
  [When a batch pays](#when-a-batch-pays)).

Merging pays most where a scene has many small pieces in view at once, and in every pass that
draws them: a light whose shadow covers them gains as much again. It gains little for a few large
meshes (each is one draw anyway), and costs drawing for a group mostly out of view: a group is
drawn whole whenever any of it is in the frustum.

### Measured

`largeWorld`'s ruins (398 wall, pillar, floor and rubble pieces in 8 sites) and 11 static props,
409 members in 28 `AUTO` groups of 50 m cells, against the same scene with every group dissolved
(Chrome on macOS, 1000 × 700; the main camera draws the scene twice, for its ambient occlusion):

| Sun, backend                  | Main draws | Shadow draws | CPU frame (median) |
| ----------------------------- | ---------- | ------------ | ------------------ |
| scene's, WebGPU, merged       | 76         | 18           | 2.25 ms            |
| scene's, WebGPU, on its own   | 762        | 19           | 3.23 ms            |
| scene's, WebGL2, merged       | 76         | 18           | 2.48 ms            |
| scene's, WebGL2, on its own   | 762        | 19           | 3.59 ms            |
| day-night, WebGPU, merged     | 76         | 15           | 2.39 ms            |
| day-night, WebGPU, on its own | 762        | 53           | 3.77 ms            |
| day-night, WebGL2, merged     | 76         | 15           | 2.27 ms            |
| day-night, WebGL2, on its own | 762        | 53           | 3.40 ms            |

- The main camera's draws per pass go from 381 to 38, and the CPU frame time drops by 30-37 % on
  both backends. The triangles stay the same: 38 members outside the view are drawn with their
  groups, but almost every ruin is in view.
- The scene's own sun has a fixed shadow box around the origin that reaches no ruin, so its
  shadow pass gains nothing. The day-night sky's sun follows the camera, and its shadow pass drops
  from 53 draws to 15.

## Streaming

In a [streaming](hub:features/streaming) scene, keep each group inside a cell:

- An `AUTO` cell size should divide the streaming cell size, and a build whose members are in two
  streaming cells warns (each once per scene).
- A group doesn't load, unload, prime or fade with a cell: a member whose cell unloads leaves the
  group's mesh collapsed in place (a batched group's instance is deleted), and a cell loaded during play draws its members on their own
  until the next frame merges them (the group's mesh may compile its shaders on its first draw).

## Debugging

In debug mode (`?isDebug=true`), the drawer's **Merging** tab (`h`, the last tab) shows what
merging does in the scene. Here on the [mesh merging example](hub:examples/merging), with
**Highlight all groups** on (the overlay's lines add their own draws to the example's count):

![The Merging tab on the mesh merging example: five groups, each group's members outlined in its colour](merging-tab.png)

- **The summary:** the groups and their members, the merged vertices and the wasted ones (left by
  removed members until the next build), each pass's draws now against every member drawn on its
  own (before culling: what the pass submits with everything in view), the builds and in-place
  updates in the last second, the last build's time, and how many entities were refused.
- **Highlight all groups** outlines the members of every group in view, each group in a colour
  of its own (it draws with the [lines](hub:features/lines) feature).
- **The groups:** a row per group (an `AUTO` one with its material and cell), which opens the
  group's window; its two buttons outline the group's members and show it unmerged.
- **Refused entities:** each entity whose `merge` was refused, with the reason.

A **group's window** shows its state, settings, members, vertices and wasted vertices, with
Rebuild (which compacts too) and Dissolve; a member row opens the member's window. A **member's
window** shows its group (a button opens the group's window), its state, geometry, material and
part of the merged mesh, and its position, rotation and scale as fields: editing them moves the
member in an [edit session](#moving-a-member-over-many-frames), drawn on its own while you drag
and written in place when you let go.
"Remove from group" takes it out. The profiler's Objects tab opens a group mesh's window too.

- **Undo** (`Ctrl/⌘ + Z`) takes back a dissolve, a removal and each move, during the scene visit
  they were made in: members are named by entity id, which another visit can give to another
  entity.
- **Show unmerged** (a group's row or window) hides the group's mesh and draws its members on
  their own, until you turn it off or the scene exits: an A/B of the image and the draw count. The
  image stays the same (but where two members' faces lie in one plane: draw order picks which
  shows), and each pass draws the members one by one instead of the group's one mesh, less those
  now culled on their own.

A **batched group** has a `BATCHED` badge on its row, with its members, how many are visible, its
draw runs and its compactions (or how it's sorted: by geometry with a LOD member, back to front or
in join order when transparent, one multi-draw on WebGL2), and how many members are fading. Its
window adds the batch (geometries, reserved and used vertices, instances), its draw runs,
per-member culling, its geometry slots (held, free, the reserve), the members with a colour and
their LOD (level and cull fades, LOD culled). A member's window shows its instance and geometry,
its colour and its LOD level and fade; its pose fields move it without an edit session (the batch
draws its moves). The LOD tab's window names such a member's kind "mesh, drawn by its merge
batch".

## Not yet

- A material array on a member: split it into a mesh per material.
- Custom TSL materials and `PHYSICAL` features (clearcoat, sheen, transmission) in a palette.
- A baked group's level of detail: its members with a `LOD` are refused (a batched group takes
  them).
- A palette in a batched group.

See the plans, [merge groups](repo:docs/plans/_DONE_p372_mesh-merge-groups.md),
[merge debugging and member editing](repo:docs/plans/_DONE_p373_merge-debug-and-member-editing.md),
[multi-material merging](repo:docs/plans/_DONE_p374_multi-material-merging.md) and
[batched groups](repo:docs/plans/p375_batched-mesh-batches.md),
and their epic, [static mesh merging](repo:docs/plans/p370_static-mesh-merging-and-texture-atlas-systems.md).

## Key APIs

- [`merging()`](api:merging).
- [`createMergeGroup`](api:createMergeGroup), [`addToMergeGroup`](api:addToMergeGroup),
  [`removeFromMergeGroup`](api:removeFromMergeGroup) and
  [`dissolveMergeGroup`](api:dissolveMergeGroup).
- [`updateMergeMember`](api:updateMergeMember) and [`rebuildMergeGroup`](api:rebuildMergeGroup).
- Edit sessions: [`beginMergeMemberEdit`](api:beginMergeMemberEdit),
  [`endMergeMemberEdit`](api:endMergeMemberEdit),
  [`cancelMergeMemberEdit`](api:cancelMergeMemberEdit) and
  [`isMergeMemberInEdit`](api:isMergeMemberInEdit).
- [`getMergeGroupOf`](api:getMergeGroupOf), [`getMergeMemberAtFace`](api:getMergeMemberAtFace)
  and [`getMergeMemberAtBatchId`](api:getMergeMemberAtBatchId).
- [`MeshMergeDef`](api:MeshMergeDef): a mesh's `merge` ([`MeshMergeOptions`](api:MeshMergeOptions)).
- Batched groups: [`MergeGroupSettings`](api:MergeGroupSettings)' `mode`
  ([`MergeGroupMode`](api:MergeGroupMode)), `perMemberCulling`, `geometryReserve`
  ([`MergeGeometryReserve`](api:MergeGeometryReserve)) and `transparentOrder`
  ([`MergeTransparentOrder`](api:MergeTransparentOrder)), and
  [`setMergeMemberColor`](api:setMergeMemberColor)
  ([`MergeMemberColorOptions`](api:MergeMemberColorOptions)).
- Palettes: [`MergeGroupSettings`](api:MergeGroupSettings)' `palette`, the palette data a scene
  carries, [`SceneMergeMaterial`](api:SceneMergeMaterial), and
  [`createMergeMaterialAsync`](api:createMergeMaterialAsync) for a variant.

## Read more

- The [mesh merging example](hub:examples/merging).
- [Modular kits and tile-chunk worlds](repo:docs/techniques/terrain-modular-kits.md): building a
  world from a kit in Blender, exporting it and merging it per cell, and
  [the variations](repo:docs/techniques/terrain-modular-kits.md#variations).
- [Merging a model's pieces](hub:features/asset-optimization#merging-a-model-s-pieces) at build
  time, and [merged geometries](hub:features/scenes-and-assets#merged-geometries).
- The API reference: [`aekasha/merging`](hub:documentation/aekasha/merging).

::: claude-md
:::
